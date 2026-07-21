import {
  RECOGNIZED_GAME_STAT_CATEGORIES,
  classifyGameStatsRow,
  isValidProviderGameId,
  type SeasonRelation,
} from './contract.ts';
import { canonicalObservationFence, parseObservationFenceMs } from './observationFence.ts';
import type { CanonicalGame } from './canonicalSlate.ts';
import type { GameStats, TeamGameStats } from './types.ts';

/**
 * PLATFORM-086H3C1 — the single, schedule-aware, row-level evidence authority
 * (DORMANT).
 *
 * Authority model (PLATFORM-086H3C1-CFBD-ID-AUTHORITY-REVISION-v1): a UNIQUE
 * canonical CFBD game id establishes WHICH scheduled game a row belongs to
 * (association). Participant data determines ORIENTATION and INTEGRITY; it is
 * NOT a coequal attachment authority. Concretely, for one expected canonical
 * game and its candidate durable rows (all sharing the game's provider id):
 *   - a same-partition unsupported / malformed / bad-fence schema BLOCKS weaker
 *     siblings from its id alone — no participant resolution required;
 *   - a supported row whose participants cannot be fully verified stays attached
 *     but is marked `unverified` (the id still associates it);
 *   - a supported row whose fully-resolved participants provably disagree with
 *     the canonical pair is QUARANTINED (`contradicted`): it can never satisfy
 *     coverage, publish, or shadow/replace prior-good evidence;
 *   - an EXACT reversed pair is safely reoriented for neutral OR non-neutral
 *     games, with a retained integrity warning on non-neutral reversal.
 * The decision therefore distinguishes three axes — association (by id),
 * orientation (direct/reversed), and usability/integrity (verified / unverified
 * / reversed-warning / contradicted).
 *
 * Committed coverage, public projection, and analytics projection all consume
 * THIS decision — there is no second read-side duplicate authority (the former
 * `selectAnalyticsRows` was removed).
 *
 * Selection order:
 *   1. confirm partition agreement (association is the game's own id + partition);
 *   2. apply unsupported/malformed/bad-fence schema blockers by id (no participants);
 *   3. orient supported rows and assess integrity (verified/unverified/
 *      reversed-warning/contradicted); quarantine contradictions;
 *   4. rank usable candidates by sufficiency
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

/** How thoroughly a USABLE (non-quarantined) row's participants were validated. */
export type EvidenceIntegrity = 'verified' | 'unverified' | 'reversed-warning';

/** The orientation a usable row was attached in. */
export type EvidenceOrientation = 'direct' | 'reversed';

export type EvidenceBlockReason =
  | 'unsupported-schema-version'
  | 'malformed-schema-version'
  | 'v2-fence-missing-or-invalid';

/** A row that never ASSOCIATED with the game (its own partition disagrees). */
export type EvidenceCandidateRejection = 'partition-mismatch';

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

/** An associated row whose fully-resolved participants contradict the canonical pair. */
export type QuarantinedCandidate = {
  providerGameId: number;
  reason: 'participant-contradiction';
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
  /** Participant-validation integrity of the winner; null when there is none. */
  integrity: EvidenceIntegrity | null;
  /** Orientation of the winner; null when there is none. */
  orientation: EvidenceOrientation | null;
  /** Set only for `blocked-unsupported-schema`; sorted + deduplicated. */
  blockers: EvidenceBlockReason[];
  /** Lower-precedence usable candidates the winner shadowed. */
  shadowed: ShadowedCandidate[];
  /** Associated rows quarantined for a known participant contradiction. */
  quarantined: QuarantinedCandidate[];
  /** Rows for this provider id that never associated (partition disagreement). */
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

// === Schema classification (participant-independent) ===

type SchemaKind =
  | { kind: 'blocker'; reason: EvidenceBlockReason }
  | { kind: 'supported'; sufficiency: EvidenceSufficiency; fenceMs: number | null };

function schemaVersionIs2(row: GameStats): boolean {
  const record = row as unknown as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, 'schemaVersion') && record.schemaVersion === 2
  );
}

/**
 * Classify a row by SCHEMA alone — orientation-independent (`classifyGameStatsRow`
 * is symmetric across sides) and participant-independent, so a blocker is decided
 * from the game's id + schema without resolving any participant.
 */
function schemaKind(row: GameStats): SchemaKind {
  const state = classifyGameStatsRow(row).state;
  if (state === 'unsupported-version')
    return { kind: 'blocker', reason: 'unsupported-schema-version' };
  if (state === 'malformed-v2') return { kind: 'blocker', reason: 'malformed-schema-version' };

  if (schemaVersionIs2(row)) {
    // A schema-2 row that cannot be ordered by a valid fence is blocked — it
    // cannot be safely ranked against or overwritten by a sibling.
    const fenceMs = parseObservationFenceMs(
      (row as unknown as Record<string, unknown>).fetchStartedAt
    );
    if (fenceMs === null) return { kind: 'blocker', reason: 'v2-fence-missing-or-invalid' };
    const sufficiency: EvidenceSufficiency =
      state === 'v2-complete' ? 'v2-complete' : state === 'v2-sparse' ? 'v2-sparse' : 'defective';
    return { kind: 'supported', sufficiency, fenceMs };
  }

  // Legacy row (no schema version): no row-level freshness.
  const sufficiency: EvidenceSufficiency =
    state === 'legacy-compatible' ? 'legacy-compatible' : 'defective';
  return { kind: 'supported', sufficiency, fenceMs: null };
}

// === Orientation + integrity (participants govern these, not attachment) ===

type OrientationOutcome = {
  orientedRow: GameStats;
  orientation: EvidenceOrientation;
  integrity: EvidenceIntegrity | 'contradicted';
};

/**
 * Orient a supported, id-associated row and assess its participant integrity.
 *
 * A CONTRADICTION requires positive proof — BOTH canonical participants and BOTH
 * row participants fully resolved, and the resolved pair matches neither the
 * direct nor the reversed canonical pair. Anything less (a canonical or row
 * participant that does not resolve) cannot prove a contradiction, so the row
 * stays attached as `unverified` in its stored orientation. An exact reversed
 * pair is reoriented for neutral or non-neutral games; non-neutral reversal keeps
 * an integrity warning.
 */
function orientAndAssess(
  row: GameStats,
  game: CanonicalGame,
  resolveKey: ResolveParticipantKey
): OrientationOutcome {
  const homeKey = resolveKey(asRecord(row.home)?.school);
  const awayKey = resolveKey(asRecord(row.away)?.school);
  const canonicalHome = game.home?.identityKey ?? null;
  const canonicalAway = game.away?.identityKey ?? null;

  const fullyResolved =
    canonicalHome !== null && canonicalAway !== null && homeKey !== null && awayKey !== null;
  if (fullyResolved) {
    if (homeKey === canonicalHome && awayKey === canonicalAway) {
      return { orientedRow: row, orientation: 'direct', integrity: 'verified' };
    }
    if (homeKey === canonicalAway && awayKey === canonicalHome) {
      return {
        orientedRow: reorientRow(row),
        orientation: 'reversed',
        integrity: game.neutral ? 'verified' : 'reversed-warning',
      };
    }
    // Both pairs fully known and neither orientation matches → known contradiction.
    return { orientedRow: row, orientation: 'direct', integrity: 'contradicted' };
  }
  // Not enough resolved to prove agreement OR contradiction: the id still
  // associates the row; validation is simply unverified.
  return { orientedRow: row, orientation: 'direct', integrity: 'unverified' };
}

// === Per-candidate assessment (association → block / usable / quarantine) ===

type CandidateAssessment =
  | { kind: 'unassociated'; reason: EvidenceCandidateRejection }
  | { kind: 'blocker'; reason: EvidenceBlockReason }
  | { kind: 'contradicted' }
  | { kind: 'usable'; candidate: UsableCandidate };

function assessCandidate(
  row: GameStats,
  game: CanonicalGame,
  resolveKey: ResolveParticipantKey
): CandidateAssessment {
  // Association is the game's own id (already matched by the caller) PLUS
  // partition agreement — a row whose own partition fields disagree belongs to a
  // different scheduled context and never associates here.
  if (row.week !== game.providerWeek || row.seasonType !== game.seasonType) {
    return { kind: 'unassociated', reason: 'partition-mismatch' };
  }

  // Blocking is by id + schema, WITHOUT participant resolution.
  const schema = schemaKind(row);
  if (schema.kind === 'blocker') return { kind: 'blocker', reason: schema.reason };

  const oriented = orientAndAssess(row, game, resolveKey);
  if (oriented.integrity === 'contradicted') return { kind: 'contradicted' };
  return {
    kind: 'usable',
    candidate: {
      orientedRow: oriented.orientedRow,
      orientation: oriented.orientation,
      integrity: oriented.integrity,
      sufficiency: schema.sufficiency,
      fenceMs: schema.fenceMs,
    },
  };
}

// === Winner selection ===

const SUFFICIENCY_RANK: Record<EvidenceSufficiency, number> = {
  'v2-complete': 0,
  'legacy-compatible': 1,
  'v2-sparse': 2,
  defective: 3,
};

type UsableCandidate = {
  orientedRow: GameStats;
  orientation: EvidenceOrientation;
  integrity: EvidenceIntegrity;
  sufficiency: EvidenceSufficiency;
  fenceMs: number | null;
};

function shadow(providerGameId: number, candidate: UsableCandidate): ShadowedCandidate {
  return {
    providerGameId,
    source: candidate.sufficiency,
    fence: candidate.fenceMs === null ? null : canonicalObservationFence(candidate.fenceMs),
  };
}

function decide(
  providerGameId: number,
  usable: UsableCandidate[],
  quarantined: QuarantinedCandidate[],
  rejected: RejectedCandidate[],
  seasonRelation: SeasonRelation
): EvidenceDecision {
  const base = {
    providerGameId,
    provenance: null,
    selected: null,
    integrity: null,
    orientation: null,
    blockers: [],
    shadowed: [],
    quarantined,
    rejected,
  };

  if (usable.length === 0) {
    // No usable evidence. An associated row that was QUARANTINED (a known
    // participant contradiction) means evidence exists for this game id but its
    // participants provably disagree → identity-mismatch; otherwise absent.
    return { ...base, state: quarantined.length > 0 ? 'identity-mismatch' : 'absent' };
  }

  const topRank = Math.min(...usable.map((c) => SUFFICIENCY_RANK[c.sufficiency]));
  const topClass = usable.find((c) => SUFFICIENCY_RANK[c.sufficiency] === topRank)!.sufficiency;
  const lower = usable.filter((c) => c.sufficiency !== topClass);

  if (topClass === 'defective') {
    // Usable-but-defective evidence only. Season relation decides the disposition
    // (mirroring `evaluateGameStatsRow`): a CURRENT-season defective row is
    // recoverable — a refetch fills the gap — so it reads as a plain `absent`
    // gap; a HISTORICAL defective row cannot be auto-recovered and is the terminal
    // `manual-only` state that compatibility policy reserves.
    return {
      ...base,
      state: seasonRelation === 'current' ? 'absent' : 'manual-only',
    };
  }

  const top = usable.filter((c) => c.sufficiency === topClass);
  const provenance = topClass as EvidenceProvenance;
  const isV2Class = topClass === 'v2-complete' || topClass === 'v2-sparse';

  // Freshness applies ONLY among v2 candidates in the same sufficiency class.
  const newestFenceMs = isV2Class ? Math.max(...top.map((c) => c.fenceMs ?? -Infinity)) : -Infinity;
  const contenders = isV2Class ? top.filter((c) => c.fenceMs === newestFenceMs) : top;
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
    integrity: winner.integrity,
    orientation: winner.orientation,
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
  resolveKey: ResolveParticipantKey,
  seasonRelation: SeasonRelation
): EvidenceDecision {
  const providerGameId = game.providerGameId;
  const blockers: EvidenceBlockReason[] = [];
  const usable: UsableCandidate[] = [];
  const quarantined: QuarantinedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const row of candidateRows) {
    const record = asRecord(row);
    if (!record || !isValidProviderGameId(record.providerGameId)) continue;
    if (record.providerGameId !== providerGameId) continue;

    const assessment = assessCandidate(row, game, resolveKey);
    if (assessment.kind === 'unassociated') {
      rejected.push({ providerGameId, reason: assessment.reason });
    } else if (assessment.kind === 'blocker') {
      blockers.push(assessment.reason);
    } else if (assessment.kind === 'contradicted') {
      quarantined.push({ providerGameId, reason: 'participant-contradiction' });
    } else {
      usable.push(assessment.candidate);
    }
  }

  // A matching same-id unsupported/malformed/bad-fence row blocks the game — by
  // id alone, no participant resolution — and never falls back to a sibling.
  if (blockers.length > 0) {
    return {
      providerGameId,
      state: 'blocked-unsupported-schema',
      provenance: null,
      selected: null,
      integrity: null,
      orientation: null,
      blockers: Array.from(new Set(blockers)).sort(),
      shadowed: [],
      quarantined,
      rejected,
    };
  }

  return decide(providerGameId, usable, quarantined, rejected, seasonRelation);
}
