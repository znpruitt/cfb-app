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
 * Authority model (PLATFORM-086H3C1-CFBD-ID-AUTHORITY-REVISION-v2): a UNIQUE
 * canonical CFBD game id establishes WHICH scheduled game a row belongs to
 * (association). CFBD `homeAway` establishes side orientation and is TRUSTED —
 * sides are NEVER swapped at read time. Participant identity is validated ONLY
 * with numeric CFBD ids (game-stat `schoolId`, from CFBD `teamId`, against the
 * schedule's optional numeric `homeId`/`awayId`); names/aliases inform display or
 * diagnostics but never verify or contradict identity. Concretely, for one
 * expected canonical game and its candidate durable rows (all sharing the game's
 * provider id):
 *   - a same-partition unsupported / malformed / bad-fence schema BLOCKS weaker
 *     siblings from its id alone — before participant validation;
 *   - when all four numeric ids are valid, direct home/away agreement is
 *     `verified`; an exact reversal, or any other disagreement, is QUARANTINED
 *     (`contradicted`) — no side objects are swapped;
 *   - when either the schedule ids or the row's `schoolId`s are unavailable, the
 *     id-associated row stays attached and `unverified`;
 *   - a quarantined contradiction can never satisfy coverage, publish, enter
 *     analytics, or shadow/replace prior-good evidence.
 * Neutral-site status has NO effect on validation. The decision distinguishes
 * association (by id) and usability/integrity (verified / unverified /
 * contradicted); there is no orientation/reversal concept.
 *
 * Committed coverage, public projection, and analytics projection all consume
 * THIS decision — there is no second read-side duplicate authority (the former
 * `selectAnalyticsRows` was removed).
 *
 * Selection order:
 *   1. confirm partition agreement (association is the game's own id + partition);
 *   2. apply unsupported/malformed/bad-fence schema blockers by id (no participants);
 *   3. validate supported rows by numeric participant id (verified/unverified);
 *      quarantine numeric contradictions;
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

/**
 * How thoroughly a USABLE (non-quarantined) row's participants were validated by
 * numeric CFBD id: `verified` when all four numeric ids agree directly,
 * `unverified` when the schedule ids or the row's `schoolId`s are unavailable.
 */
export type EvidenceIntegrity = 'verified' | 'unverified';

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

/** An associated row whose numeric participant ids contradict the scheduled pair. */
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
  /** The selected winner as stored (never reoriented); set for satisfied / incomplete. */
  selected: GameStats | null;
  /** Numeric-id participant-validation integrity of the winner; null when there is none. */
  integrity: EvidenceIntegrity | null;
  /** Set only for `blocked-unsupported-schema`; sorted + deduplicated. */
  blockers: EvidenceBlockReason[];
  /** Lower-precedence usable candidates the winner shadowed. */
  shadowed: ShadowedCandidate[];
  /** Associated rows quarantined for a known participant contradiction. */
  quarantined: QuarantinedCandidate[];
  /** Rows for this provider id that never associated (partition disagreement). */
  rejected: RejectedCandidate[];
};

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

// === Numeric participant-identity validation (names never verify/contradict) ===

/** A stored row's numeric CFBD team id for a side, or null when unusable. */
function rowSchoolId(side: unknown): number | null {
  const id = asRecord(side)?.schoolId;
  return isValidProviderGameId(id) ? id : null;
}

/**
 * Validate a supported, id-associated row's participants using ONLY numeric CFBD
 * ids: the game-stat `schoolId`s (from CFBD `teamId`) against the schedule's
 * numeric `homeId`/`awayId`. CFBD `homeAway` is trusted, so no side is ever
 * swapped and neutral-site status is irrelevant:
 *   - all four ids valid + direct agreement → `verified`;
 *   - all four ids valid + an exact reversal OR any other disagreement →
 *     `contradicted` (quarantine);
 *   - any of the four ids unavailable → `unverified` (the id still associates it).
 * Names/aliases are never consulted here.
 */
function assessParticipantIntegrity(
  row: GameStats,
  game: CanonicalGame
): EvidenceIntegrity | 'contradicted' {
  const scheduleHomeId = game.homeId;
  const scheduleAwayId = game.awayId;
  const rowHomeId = rowSchoolId(row.home);
  const rowAwayId = rowSchoolId(row.away);

  if (
    scheduleHomeId === null ||
    scheduleAwayId === null ||
    rowHomeId === null ||
    rowAwayId === null
  ) {
    return 'unverified';
  }
  if (rowHomeId === scheduleHomeId && rowAwayId === scheduleAwayId) return 'verified';
  // Exact reversal or any other fully-known numeric disagreement → contradiction.
  return 'contradicted';
}

// === Per-candidate assessment (association → block / usable / quarantine) ===

type CandidateAssessment =
  | { kind: 'unassociated'; reason: EvidenceCandidateRejection }
  | { kind: 'blocker'; reason: EvidenceBlockReason }
  | { kind: 'contradicted' }
  | { kind: 'usable'; candidate: UsableCandidate };

function assessCandidate(row: GameStats, game: CanonicalGame): CandidateAssessment {
  // Association is the game's own id (already matched by the caller) PLUS
  // partition agreement — a row whose own partition fields disagree belongs to a
  // different scheduled context and never associates here.
  if (row.week !== game.providerWeek || row.seasonType !== game.seasonType) {
    return { kind: 'unassociated', reason: 'partition-mismatch' };
  }

  // Blocking is by id + schema, BEFORE any participant validation.
  const schema = schemaKind(row);
  if (schema.kind === 'blocker') return { kind: 'blocker', reason: schema.reason };

  const integrity = assessParticipantIntegrity(row, game);
  if (integrity === 'contradicted') return { kind: 'contradicted' };
  // The stored row is used as-is; CFBD `homeAway` is trusted and never swapped.
  return {
    kind: 'usable',
    candidate: {
      row,
      integrity,
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
  /** The stored row, used as-is (CFBD `homeAway` is trusted; never reoriented). */
  row: GameStats;
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
    .map((candidate) => ({ candidate, key: canonicalJson(candidate.row) }))
    .reduce((best, entry) => (entry.key < best.key ? entry : best)).candidate;
  const allEquivalent = contenders.every((c) => evidenceEquivalent(c.row, winner.row));
  if (!allEquivalent) {
    // Equal-fence divergent v2, or divergent legacy duplicates → conflict.
    return { ...base, state: 'duplicate-conflict', provenance };
  }

  const shadowed = [...lower, ...olderSameClass].map((c) => shadow(providerGameId, c));
  return {
    ...base,
    state: topClass === 'v2-sparse' ? 'incomplete' : 'satisfied',
    provenance,
    selected: winner.row,
    integrity: winner.integrity,
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

    const assessment = assessCandidate(row, game);
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
      blockers: Array.from(new Set(blockers)).sort(),
      shadowed: [],
      quarantined,
      rejected,
    };
  }

  return decide(providerGameId, usable, quarantined, rejected, seasonRelation);
}
