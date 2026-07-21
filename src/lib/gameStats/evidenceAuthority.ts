import {
  RECOGNIZED_GAME_STAT_CATEGORIES,
  classifyGameStatsRow,
  isValidProviderGameId,
} from './contract.ts';
import { canonicalObservationFence, parseObservationFenceMs } from './observationFence.ts';
import type { CanonicalGame } from './canonicalSlate.ts';
import type { GameStats, TeamGameStats } from './types.ts';

/**
 * PLATFORM-086H3C1 — the single, schedule-aware, row-level evidence authority
 * (DORMANT).
 *
 * For one expected canonical game plus its candidate durable rows, this decides
 * exactly ONE outcome: the selected canonically oriented row and its provenance,
 * or a typed conflict / blocker, plus any shadowed lower-precedence candidates
 * and the rows that failed to attach. Committed coverage, public projection, and
 * analytics projection all consume THIS decision — there is no second read-side
 * duplicate authority (the former `selectAnalyticsRows` was removed).
 *
 * Selection order (per the C1 handoff doc):
 *   1. validate candidate partition identity, provider id, and participants;
 *   2. canonically orient attachable candidates (reversal only for neutral games);
 *   3. apply matching unsupported/malformed-schema (and bad-v2-fence) blockers;
 *   4. rank interpretable candidates by sufficiency
 *      (complete v2 > compatible legacy > sparse v2 > defective);
 *   5. apply freshness ONLY among v2 candidates in the same sufficiency class.
 *
 * Evidence selection is row-level: read-time field composition across rows is
 * forbidden. Component-level composition stays with the dormant durable merge
 * service, which C1 never activates or calls.
 */

// === Result contract ===

export type EvidenceSufficiency = 'v2-complete' | 'legacy-compatible' | 'v2-sparse' | 'defective';

/** Provenance of a SELECTED row (defective classes never win). */
export type EvidenceProvenance = 'v2-complete' | 'legacy-compatible' | 'v2-sparse';

export type EvidenceBlockReason =
  | 'unsupported-schema-version'
  | 'malformed-schema-version'
  | 'v2-fence-missing-or-invalid';

export type EvidenceCandidateRejection =
  | 'partition-mismatch'
  | 'participant-unresolved'
  | 'participant-mismatch'
  | 'reversed-non-neutral'
  | 'ambiguous-identity';

/**
 * Per-game evidence state. These names are exactly the per-game coverage states,
 * so coverage maps 1:1 without re-deriving policy.
 */
export type EvidenceState =
  | 'satisfied'
  | 'incomplete'
  | 'manual-only'
  | 'blocked-unsupported-schema'
  | 'duplicate-conflict'
  | 'identity-mismatch'
  | 'absent';

export type ShadowedCandidate = {
  providerGameId: number;
  source: EvidenceSufficiency;
  fence: string | null;
};

export type RejectedCandidate = {
  providerGameId: number;
  reason: EvidenceCandidateRejection;
};

export type EvidenceDecision = {
  providerGameId: number;
  state: EvidenceState;
  /** Set for satisfied / incomplete / duplicate-conflict; null otherwise. */
  provenance: EvidenceProvenance | null;
  /** Canonically oriented winner; set only for satisfied / incomplete. */
  selected: GameStats | null;
  /** Set only for `blocked-unsupported-schema`; sorted + deduplicated. */
  blockers: EvidenceBlockReason[];
  /** Lower-precedence attached candidates the winner shadowed. */
  shadowed: ShadowedCandidate[];
  /** Rows for this provider id that did not attach. */
  rejected: RejectedCandidate[];
};

/** Resolve a stored row's raw school label to a canonical identity key. */
export type ResolveParticipantKey = (school: unknown) => string | null;

// === Canonical reorientation (non-mutating) ===

/**
 * Move each complete team-side object atomically and rewrite only the
 * orientation marker. Every team-side field travels with its team; every
 * game-level field (`providerGameId`, `week`, `seasonType`, `schemaVersion`,
 * `fetchStartedAt`) is preserved. Statistics are never negated, inverted, or
 * recomputed, and the input row is never mutated.
 */
export function reorientRow(row: GameStats): GameStats {
  return {
    ...row,
    home: { ...row.away, homeAway: 'home' },
    away: { ...row.home, homeAway: 'away' },
  };
}

// === Publishable-content equivalence ===

/**
 * The explicit public normalized fields that travel with a team. Read-time
 * equivalence compares these plus school identity, points evidence, and
 * recognized raw categories — deliberately BROADER than analytics equivalence so
 * a difference in any explicit public field cannot be hidden by an
 * analytics-only match.
 */
const PUBLISHABLE_TEAM_NUMERIC_FIELDS: readonly (keyof TeamGameStats)[] = [
  'totalYards',
  'rushingYards',
  'passingYards',
  'rushingAttempts',
  'passingAttempts',
  'passingCompletions',
  'rushingTDs',
  'passingTDs',
  'firstDowns',
  'turnovers',
  'fumblesLost',
  'interceptionsThrown',
  'passesIntercepted',
  'fumblesRecovered',
  'thirdDownAttempts',
  'thirdDownConversions',
  'thirdDownPct',
  'fourthDownAttempts',
  'fourthDownConversions',
  'penaltyCount',
  'penaltyYards',
  'possessionSeconds',
  'interceptionReturnYards',
  'interceptionReturnTDs',
  'kickReturnYards',
  'kickReturnTDs',
  'puntReturnYards',
  'puntReturnTDs',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Recognized raw entries only, in a deterministic (sorted) order. */
function recognizedRaw(raw: unknown): Record<string, string> {
  const map = asRecord(raw);
  const out: Record<string, string> = {};
  if (!map) return out;
  for (const category of RECOGNIZED_GAME_STAT_CATEGORIES) {
    const value = map[category];
    if (typeof value === 'string') out[category] = value;
  }
  return out;
}

function publishableTeam(team: unknown): unknown {
  const record = asRecord(team) ?? {};
  const numeric: Record<string, unknown> = {};
  for (const field of PUBLISHABLE_TEAM_NUMERIC_FIELDS) numeric[field] = record[field];
  return {
    school: record.school,
    schoolId: record.schoolId,
    conference: record.conference,
    points: record.points,
    pointsProvided: record.pointsProvided === true,
    numeric,
    raw: recognizedRaw(record.raw),
  };
}

/**
 * Canonically oriented publishable fingerprint. Excludes `fetchStartedAt`,
 * persistence metadata, and unrecognized raw categories; includes provider id,
 * both oriented sides' school identity, points evidence, every explicit public
 * normalized field, and recognized raw categories.
 */
function publishableFingerprint(row: GameStats): unknown {
  return {
    providerGameId: row.providerGameId,
    home: publishableTeam(row.home),
    away: publishableTeam(row.away),
  };
}

/** Recursively key-sorted JSON — order-independent structural comparison. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  const record = asRecord(value);
  if (!record) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
  return sorted;
}

/** Whether two oriented rows are equivalent publishable evidence. */
export function evidenceEquivalent(a: GameStats, b: GameStats): boolean {
  return canonicalJson(publishableFingerprint(a)) === canonicalJson(publishableFingerprint(b));
}

// === Candidate classification ===

type CandidateKind =
  | { kind: 'blocker'; reason: EvidenceBlockReason }
  | { kind: 'attached'; sufficiency: EvidenceSufficiency; fenceMs: number | null };

function schemaVersionIs2(row: GameStats): boolean {
  const record = row as unknown as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, 'schemaVersion') && record.schemaVersion === 2
  );
}

function classifyCandidateKind(orientedRow: GameStats): CandidateKind {
  const state = classifyGameStatsRow(orientedRow).state;
  if (state === 'unsupported-version')
    return { kind: 'blocker', reason: 'unsupported-schema-version' };
  if (state === 'malformed-v2') return { kind: 'blocker', reason: 'malformed-schema-version' };

  if (schemaVersionIs2(orientedRow)) {
    // A schema-2 row that cannot be ordered by a valid fence is blocked — it
    // cannot be safely ranked against or overwritten by a sibling.
    const fenceMs = parseObservationFenceMs(
      (orientedRow as unknown as Record<string, unknown>).fetchStartedAt
    );
    if (fenceMs === null) return { kind: 'blocker', reason: 'v2-fence-missing-or-invalid' };
    const sufficiency: EvidenceSufficiency =
      state === 'v2-complete' ? 'v2-complete' : state === 'v2-sparse' ? 'v2-sparse' : 'defective';
    return { kind: 'attached', sufficiency, fenceMs };
  }

  // Legacy row (no schema version): no row-level freshness.
  const sufficiency: EvidenceSufficiency =
    state === 'legacy-compatible' ? 'legacy-compatible' : 'defective';
  return { kind: 'attached', sufficiency, fenceMs: null };
}

// === Attachment (participant validation + orientation) ===

type AttachOutcome =
  | { ok: true; orientedRow: GameStats }
  | { ok: false; reason: EvidenceCandidateRejection };

function attachCandidate(
  row: GameStats,
  game: CanonicalGame,
  resolveKey: ResolveParticipantKey
): AttachOutcome {
  // Row-level partition fields must agree with the requested partition.
  if (row.week !== game.providerWeek || row.seasonType !== game.seasonType) {
    return { ok: false, reason: 'partition-mismatch' };
  }
  const homeKey = resolveKey(asRecord(row.home)?.school);
  const awayKey = resolveKey(asRecord(row.away)?.school);
  if (homeKey === null || awayKey === null) return { ok: false, reason: 'participant-unresolved' };
  if (homeKey === awayKey) return { ok: false, reason: 'ambiguous-identity' };

  const canonicalHome = game.home!.identityKey;
  const canonicalAway = game.away!.identityKey;
  const direct = homeKey === canonicalHome && awayKey === canonicalAway;
  if (direct) return { ok: true, orientedRow: row };

  const reversed = homeKey === canonicalAway && awayKey === canonicalHome;
  if (reversed) {
    // Reversal is accepted ONLY for neutral games, and only after full
    // canonical reorientation.
    if (!game.neutral) return { ok: false, reason: 'reversed-non-neutral' };
    return { ok: true, orientedRow: reorientRow(row) };
  }
  return { ok: false, reason: 'participant-mismatch' };
}

// === Winner selection ===

const SUFFICIENCY_RANK: Record<EvidenceSufficiency, number> = {
  'v2-complete': 0,
  'legacy-compatible': 1,
  'v2-sparse': 2,
  defective: 3,
};

type AttachedCandidate = {
  orientedRow: GameStats;
  sufficiency: EvidenceSufficiency;
  fenceMs: number | null;
};

function shadow(providerGameId: number, candidate: AttachedCandidate): ShadowedCandidate {
  return {
    providerGameId,
    source: candidate.sufficiency,
    fence: candidate.fenceMs === null ? null : canonicalObservationFence(candidate.fenceMs),
  };
}

function decide(
  providerGameId: number,
  attached: AttachedCandidate[],
  rejected: RejectedCandidate[]
): EvidenceDecision {
  const base = {
    providerGameId,
    provenance: null,
    selected: null,
    blockers: [],
    shadowed: [],
    rejected,
  };

  if (attached.length === 0) {
    // A row that failed to attach on IDENTITY (not merely partition) means
    // evidence exists for this game id but its participants disagree.
    const identityIssue = rejected.some((r) => r.reason !== 'partition-mismatch');
    return { ...base, state: identityIssue ? 'identity-mismatch' : 'absent' };
  }

  const topRank = Math.min(...attached.map((c) => SUFFICIENCY_RANK[c.sufficiency]));
  const topClass = attached.find((c) => SUFFICIENCY_RANK[c.sufficiency] === topRank)!.sufficiency;
  const lower = attached.filter((c) => c.sufficiency !== topClass);

  if (topClass === 'defective') {
    // Attached but only defective/ineligible evidence — never satisfies, never a
    // clean gap; historical-compatibility policy resolves it out of band.
    return { ...base, state: 'manual-only' };
  }

  const top = attached.filter((c) => c.sufficiency === topClass);
  const provenance = topClass as EvidenceProvenance;
  const isV2Class = topClass === 'v2-complete' || topClass === 'v2-sparse';

  // Freshness applies ONLY among v2 candidates in the same sufficiency class.
  const contenders = isV2Class
    ? top.filter((c) => c.fenceMs === Math.max(...top.map((t) => t.fenceMs ?? -Infinity)))
    : top;
  // Older-fence same-class v2 candidates are shadowed by the fresher evidence.
  const olderSameClass = isV2Class ? top.filter((c) => !contenders.includes(c)) : [];

  // Choose a DETERMINISTIC representative among the surviving contenders. Equal-
  // fence, publishable-equivalent rows can still differ in excluded metadata (a
  // `Z` vs `+00:00` fetchStartedAt encoding, unrecognized raw categories), so
  // taking `contenders[0]` would let candidate order change the selected row.
  // The canonical (key-sorted) serialization is a stable total order.
  const winner = contenders
    .map((candidate) => ({ candidate, key: canonicalJson(candidate.orientedRow) }))
    .reduce((best, entry) => (entry.key < best.key ? entry : best)).candidate;
  const allEquivalent = contenders.every((c) =>
    evidenceEquivalent(c.orientedRow, winner.orientedRow)
  );
  if (!allEquivalent) {
    // Equal-fence divergent v2, or divergent legacy duplicates → conflict.
    return { ...base, state: 'duplicate-conflict', provenance };
  }

  const shadowed = [...lower, ...olderSameClass].map((c) => shadow(providerGameId, c));
  return {
    ...base,
    state: topClass === 'v2-sparse' ? 'incomplete' : 'satisfied',
    provenance,
    selected: winner.orientedRow,
    shadowed,
  };
}

/**
 * Decide the single evidence outcome for one expected canonical game from its
 * candidate durable rows. `candidateRows` are the rows whose provider id matches
 * this game; any other id is ignored. Selection is invariant to candidate order.
 */
export function selectGameEvidence(
  game: CanonicalGame,
  candidateRows: readonly GameStats[],
  resolveKey: ResolveParticipantKey
): EvidenceDecision {
  const providerGameId = game.providerGameId;
  const blockers: EvidenceBlockReason[] = [];
  const attached: AttachedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const row of candidateRows) {
    const record = asRecord(row);
    if (!record || !isValidProviderGameId(record.providerGameId)) continue;
    if (record.providerGameId !== providerGameId) continue;

    const outcome = attachCandidate(row, game, resolveKey);
    if (!outcome.ok) {
      rejected.push({ providerGameId, reason: outcome.reason });
      continue;
    }
    const kind = classifyCandidateKind(outcome.orientedRow);
    if (kind.kind === 'blocker') blockers.push(kind.reason);
    else
      attached.push({
        orientedRow: outcome.orientedRow,
        sufficiency: kind.sufficiency,
        fenceMs: kind.fenceMs,
      });
  }

  // A matching, attachable unsupported/malformed/bad-fence row blocks the game
  // and never falls back to a legacy or supported-v2 sibling.
  if (blockers.length > 0) {
    return {
      providerGameId,
      state: 'blocked-unsupported-schema',
      provenance: null,
      selected: null,
      blockers: Array.from(new Set(blockers)).sort(),
      shadowed: [],
      rejected,
    };
  }

  return decide(providerGameId, attached, rejected);
}
