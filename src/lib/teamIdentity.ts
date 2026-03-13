import type { AliasMap } from './teamNames';

export type TeamCatalogItem = {
  school: string;
  mascot?: string | null;
  level?: string | null;
  conference?: string | null;
  alts?: string[];
};

export type ResolutionSource = 'alias' | 'catalog_exact' | 'catalog_variant' | 'raw';
export type ResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous';

export type TeamResolution = {
  rawInput: string;
  normalizedInput: string;
  canonicalName: string | null;
  identityKey: string | null;
  resolutionSource: ResolutionSource;
  status: ResolutionStatus;
  notes?: string;
  candidates?: string[];
};

export type TeamIdentityResolver = {
  resolveName: (raw: string) => TeamResolution;
  buildPairKey: (a: string, b: string) => string;
  buildGameKey: (params: { week: number; home: string; away: string; neutral: boolean }) => string;
  variantsForName: (raw: string) => string[];
  isFbsName: (raw: string) => boolean;
};

const STOP_WORDS = /\b(university|univ|college|the|of|and|&)\b/g;

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeTeamName(raw: string): string {
  const withoutDiacritics = stripDiacritics(raw).toLowerCase().trim();
  const noStopWords = withoutDiacritics.replace(STOP_WORDS, ' ');
  return noStopWords.replace(/[^a-z0-9]+/g, '');
}

function normalizeAliasKey(raw: string): string {
  return stripDiacritics(raw).toLowerCase().trim();
}

function normalizeLevel(level?: string | null): string {
  return (level ?? '').toString().trim().toUpperCase();
}

function dedupeStrings(values: string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    out.add(value);
  }
  return Array.from(out);
}

export function createTeamIdentityResolver(params: {
  aliasMap: AliasMap;
  teams: TeamCatalogItem[];
}): TeamIdentityResolver {
  const { aliasMap, teams } = params;

  const canonicalByVariant = new Map<string, Set<string>>();
  const fbsIdentityKeys = new Set<string>();

  const addVariant = (variant: string, canonical: string) => {
    if (!variant) return;
    const existing = canonicalByVariant.get(variant) ?? new Set<string>();
    existing.add(canonical);
    canonicalByVariant.set(variant, existing);
  };

  for (const team of teams) {
    const canonical = team.school?.trim();
    if (!canonical) continue;

    const variants = [
      canonical,
      ...(Array.isArray(team.alts) ? team.alts : []),
      team.mascot ? `${canonical} ${team.mascot}` : '',
    ].filter(Boolean);

    for (const value of variants) {
      const normalized = normalizeTeamName(value);
      addVariant(normalized, canonical);
      const aliased = aliasMap[normalizeAliasKey(value)] ?? value;
      addVariant(normalizeTeamName(aliased), canonical);
    }

    if (normalizeLevel(team.level) === 'FBS') {
      fbsIdentityKeys.add(normalizeTeamName(canonical));
    }
  }

  const resolveName = (rawInput: string): TeamResolution => {
    const raw = rawInput.trim();
    const aliasLookupKey = normalizeAliasKey(raw);
    const aliasTarget = aliasMap[aliasLookupKey];
    const baseForMatch = aliasTarget ?? raw;
    const normalizedInput = normalizeTeamName(baseForMatch);

    const candidates = Array.from(canonicalByVariant.get(normalizedInput) ?? []);
    if (candidates.length === 1) {
      const canonicalName = candidates[0]!;
      return {
        rawInput,
        normalizedInput,
        canonicalName,
        identityKey: normalizeTeamName(canonicalName),
        resolutionSource: aliasTarget ? 'alias' : 'catalog_exact',
        status: 'resolved',
      };
    }

    if (candidates.length > 1) {
      return {
        rawInput,
        normalizedInput,
        canonicalName: null,
        identityKey: null,
        resolutionSource: aliasTarget ? 'alias' : 'catalog_variant',
        status: 'ambiguous',
        notes: 'Multiple catalog teams match this normalized label',
        candidates,
      };
    }

    const startsWithCandidates = Array.from(canonicalByVariant.entries())
      .filter(([variant]) => variant.startsWith(normalizedInput) || normalizedInput.startsWith(variant))
      .flatMap(([, names]) => Array.from(names));

    const nearCandidates = dedupeStrings(startsWithCandidates);
    if (nearCandidates.length === 1) {
      const canonicalName = nearCandidates[0]!;
      return {
        rawInput,
        normalizedInput,
        canonicalName,
        identityKey: normalizeTeamName(canonicalName),
        resolutionSource: aliasTarget ? 'alias' : 'catalog_variant',
        status: 'resolved',
      };
    }

    return {
      rawInput,
      normalizedInput,
      canonicalName: null,
      identityKey: null,
      resolutionSource: aliasTarget ? 'alias' : 'raw',
      status: nearCandidates.length > 1 ? 'ambiguous' : 'unresolved',
      notes: nearCandidates.length > 1 ? 'Multiple close catalog candidates found' : undefined,
      candidates: nearCandidates.length > 0 ? nearCandidates : undefined,
    };
  };

  const variantsForName = (raw: string): string[] => {
    const resolved = resolveName(raw);
    const values = [
      resolved.identityKey ?? '',
      resolved.normalizedInput,
      normalizeTeamName(raw),
      ...((resolved.candidates ?? []).map((candidate) => normalizeTeamName(candidate))),
    ];
    return dedupeStrings(values);
  };

  const buildPairKey = (a: string, b: string): string => {
    const ra = resolveName(a);
    const rb = resolveName(b);
    const left = ra.identityKey ?? ra.normalizedInput;
    const right = rb.identityKey ?? rb.normalizedInput;
    return [left, right].sort((x, y) => x.localeCompare(y)).join('__');
  };

  const buildGameKey = (params: { week: number; home: string; away: string; neutral: boolean }): string => {
    const { week, home, away, neutral } = params;
    const homeRes = resolveName(home);
    const awayRes = resolveName(away);
    const homeKey = homeRes.identityKey ?? homeRes.normalizedInput;
    const awayKey = awayRes.identityKey ?? awayRes.normalizedInput;
    if (neutral) {
      return `${week}-${[homeKey, awayKey].sort((x, y) => x.localeCompare(y)).join('-')}-N`;
    }
    return `${week}-${homeKey}-${awayKey}-H`;
  };

  const isFbsName = (raw: string): boolean => {
    const result = resolveName(raw);
    if (!result.identityKey) return false;
    return fbsIdentityKeys.has(result.identityKey);
  };

  return {
    resolveName,
    buildPairKey,
    buildGameKey,
    variantsForName,
    isFbsName,
  };
}
