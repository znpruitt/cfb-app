import type { TeamCatalogItem } from './teamIdentity.ts';
import { inferSubdivisionFromConference } from './conferenceSubdivision.ts';
import { parseOwnersCsv } from './parseOwnersCsv.ts';
import type { AliasMap } from './teamNames.ts';
import { normalizeAliasLookup, normalizeTeamName } from './teamNormalization.ts';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type FuzzyMatchResult = {
  canonical: string;
  confidence: number;
  method: string;
};

export type ResolvedEntry = {
  inputName: string;
  canonicalName: string;
  owner: string;
  method: 'exact' | 'alias' | 'fuzzy';
};

export type UnresolvedEntry = {
  inputName: string;
  owner: string;
  suggestion: FuzzyMatchResult | null;
};

export type RosterValidationResult = {
  resolved: ResolvedEntry[];
  needsConfirmation: UnresolvedEntry[];
  isComplete: boolean;
};

// ---------------------------------------------------------------------------
// FBS team catalog
// ---------------------------------------------------------------------------

/**
 * Returns canonical FBS school names from the team catalog.
 * Only includes teams whose conference maps to FBS — never FCS or non-FBS.
 * This is the only valid match pool for roster upload fuzzy matching.
 */
export function getFBSTeams(teams: TeamCatalogItem[]): string[] {
  return teams
    .filter((t) => inferSubdivisionFromConference(t.conference ?? null) === 'FBS')
    .map((t) => t.school)
    .filter((s): s is string => Boolean(s?.trim()));
}

// ---------------------------------------------------------------------------
// Fuzzy matching — Levenshtein + token overlap
// ---------------------------------------------------------------------------

/** Space-optimized Levenshtein distance. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j]!;
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j - 1]!, row[j]!);
      prev = temp;
    }
  }
  return row[n]!;
}

function normalizeForFuzzy(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlapScore(input: string[], candidate: string[]): number {
  if (input.length === 0 || candidate.length === 0) return 0;
  const candidateSet = new Set(candidate);
  const matched = input.filter((t) => candidateSet.has(t)).length;
  return matched / Math.max(input.length, candidate.length);
}

/** Conservative confidence threshold — prefers no suggestion over a bad one. */
const FUZZY_CONFIDENCE_THRESHOLD = 0.65;

/**
 * Finds the best FBS team match for an input name.
 * Uses Levenshtein distance and token overlap scoring.
 * Returns null when no match exceeds the confidence threshold.
 */
export function findFuzzyMatch(inputName: string, fbsTeams: string[]): FuzzyMatchResult | null {
  const normalizedInput = normalizeForFuzzy(inputName);
  const inputTokens = normalizedInput.split(' ').filter(Boolean);

  let bestCandidate: string | null = null;
  let bestConfidence = 0;
  let bestMethod = '';

  for (const team of fbsTeams) {
    const normalizedTeam = normalizeForFuzzy(team);
    const teamTokens = normalizedTeam.split(' ').filter(Boolean);

    const dist = levenshtein(normalizedInput, normalizedTeam);
    const maxLen = Math.max(normalizedInput.length, normalizedTeam.length);
    const levScore = maxLen > 0 ? 1 - dist / maxLen : 0;

    const tokenScore = tokenOverlapScore(inputTokens, teamTokens);

    // For multi-word names, the better of the two scores wins.
    const combined = inputTokens.length > 1 ? Math.max(levScore, tokenScore) : levScore;

    if (combined > bestConfidence) {
      bestConfidence = combined;
      bestCandidate = team;
      bestMethod = levScore >= tokenScore ? 'levenshtein' : 'token';
    }
  }

  if (!bestCandidate || bestConfidence < FUZZY_CONFIDENCE_THRESHOLD) return null;
  return { canonical: bestCandidate, confidence: bestConfidence, method: bestMethod };
}

// ---------------------------------------------------------------------------
// CSV validation
// ---------------------------------------------------------------------------

/**
 * Validates a roster CSV against the FBS team catalog and existing aliases.
 *
 * Resolution priority per team name:
 * 1. Exact match against FBS canonical names and their alts → resolved (exact)
 * 2. Existing alias lookup → resolved (alias)
 * 3. Fuzzy match above threshold → needsConfirmation with suggestion
 * 4. No confident match → needsConfirmation with suggestion: null
 *
 * isComplete is true only when needsConfirmation is empty.
 */
export function validateRosterCSV(
  csvText: string,
  existingAliases: AliasMap,
  teams: TeamCatalogItem[]
): RosterValidationResult {
  const rows = parseOwnersCsv(csvText);
  const fbsTeams = getFBSTeams(teams);

  // Build normalized lookup: normalized key → canonical school name
  // Includes canonical names AND their alts for broad exact-match coverage.
  const fbsLookup = new Map<string, string>();
  for (const team of teams) {
    if (!team.school) continue;
    if (inferSubdivisionFromConference(team.conference ?? null) !== 'FBS') continue;

    const canonical = team.school;
    fbsLookup.set(normalizeTeamName(canonical), canonical);

    for (const alt of team.alts ?? []) {
      const normAlt = normalizeTeamName(alt);
      if (normAlt && !fbsLookup.has(normAlt)) {
        fbsLookup.set(normAlt, canonical);
      }
    }
  }

  const resolved: ResolvedEntry[] = [];
  const needsConfirmation: UnresolvedEntry[] = [];

  for (const row of rows) {
    const inputName = row.team;
    const owner = row.owner;

    // 1. Exact match (canonical + alts)
    const exactCanonical = fbsLookup.get(normalizeTeamName(inputName));
    if (exactCanonical) {
      resolved.push({ inputName, canonicalName: exactCanonical, owner, method: 'exact' });
      continue;
    }

    // 2. Existing alias lookup
    const aliasKey = normalizeAliasLookup(inputName);
    const aliasTarget = existingAliases[aliasKey];
    if (aliasTarget) {
      const aliasCanonical = fbsLookup.get(normalizeTeamName(aliasTarget));
      if (aliasCanonical) {
        resolved.push({ inputName, canonicalName: aliasCanonical, owner, method: 'alias' });
        continue;
      }
    }

    // 3. Fuzzy match against FBS-only pool
    const suggestion = findFuzzyMatch(inputName, fbsTeams);
    needsConfirmation.push({ inputName, owner, suggestion });
  }

  return {
    resolved,
    needsConfirmation,
    isComplete: needsConfirmation.length === 0,
  };
}
