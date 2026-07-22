import {
  RECOGNIZED_GAME_STAT_CATEGORIES,
  classifyGameStatsRow,
  isValidProviderGameId,
  type SeasonRelation,
} from './contract.ts';
import { parseObservationFenceMs } from './observationFence.ts';
import type { CanonicalGame } from './canonicalSlate.ts';
import type { GameStats, TeamGameStats } from './types.ts';

/**
 * PLATFORM-086H3C1 — the single, schedule-aware, row-level evidence authority
 * (DORMANT).
 *
 * Authority model (PLATFORM-086H3C1-SIMPLIFICATION-v1): a UNIQUE canonical CFBD
 * game id, plus partition agreement, establishes association — WHICH scheduled
 * game a durable row belongs to. That is the whole association authority.
 * Numeric participant validation was REMOVED: schedule records do not yet persist
 * the numeric participant ids (`homeId`/`awayId`) that would make it operational,
 * so it is deferred as a separate pre-activation prerequisite (after schedule
 * persistence captures those ids). CFBD `homeAway` remains trusted — sides are
 * never swapped — and two rows for the same id that disagree on a side's stored
 * `homeAway` are a `duplicate-conflict`, not silently collapsed.
 *
 * For one expected canonical game and its candidate durable rows (all sharing the
 * game's provider id):
 *   - a same-partition unsupported / malformed / bad-fence schema BLOCKS weaker
 *     siblings from its id alone;
 *   - every other schema-supported row is a usable candidate;
 *   - the winner is the highest-sufficiency, freshest, deterministically chosen
 *     row (complete v2 > compatible legacy > sparse v2 > defective).
 *
 * Committed coverage, public projection, and analytics projection all consume
 * THIS decision — there is no second read-side duplicate authority (the former
 * `selectAnalyticsRows` was removed).
 *
 * Selection order:
 *   1. confirm partition agreement (association is the game's own id + partition);
 *   2. apply unsupported/malformed/bad-fence schema blockers by id;
 *   3. rank supported candidates by sufficiency;
 *   4. apply freshness ONLY among v2 candidates in the same sufficiency class;
 *   5. collapse equivalent candidates; divergent same-class candidates conflict.
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

/**
 * Per-game evidence state. These names are exactly the per-game coverage states,
 * so coverage maps 1:1 without re-deriving policy. (`identity-mismatch` returns
 * with participant validation in a later pre-activation prerequisite.)
 */
export type EvidenceState =
  | 'satisfied'
  | 'incomplete'
  | 'manual-only'
  | 'blocked-unsupported-schema'
  | 'duplicate-conflict'
  | 'absent';

export type EvidenceDecision = {
  providerGameId: number;
  state: EvidenceState;
  /** Set for satisfied / incomplete / duplicate-conflict; null otherwise. */
  provenance: EvidenceProvenance | null;
  /** The selected winner as stored (never reoriented); set for satisfied / incomplete. */
  selected: GameStats | null;
  /** Set only for `blocked-unsupported-schema`; sorted + deduplicated. */
  blockers: EvidenceBlockReason[];
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
    // `homeAway` is trusted orientation evidence (sides are never swapped), so two
    // rows that disagree on a side's stored designation are NOT equivalent and
    // must conflict rather than silently collapse.
    homeAway: record.homeAway,
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
 * Publishable fingerprint. Excludes `fetchStartedAt`, persistence metadata, and
 * unrecognized raw categories; includes provider id, both sides' stored `homeAway`
 * designation and school identity, points evidence, every explicit public
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

/** Whether two rows are equivalent publishable evidence. */
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
 * Classify a row by SCHEMA alone. A blocker is decided from the game's id +
 * schema — no participant interpretation.
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

// === Per-candidate assessment (association → block / usable / skip) ===

type UsableCandidate = {
  /** The stored row, used as-is (CFBD `homeAway` is trusted; never reoriented). */
  row: GameStats;
  sufficiency: EvidenceSufficiency;
  fenceMs: number | null;
};

type CandidateAssessment =
  | { kind: 'skip' }
  | { kind: 'blocker'; reason: EvidenceBlockReason }
  | { kind: 'usable'; candidate: UsableCandidate };

function assessCandidate(row: GameStats, game: CanonicalGame): CandidateAssessment {
  // Association is the game's own id (already matched by the caller) PLUS
  // partition agreement — a row whose own partition fields disagree is stored
  // under a different scheduled context and is never evidence here.
  if (row.week !== game.providerWeek || row.seasonType !== game.seasonType) {
    return { kind: 'skip' };
  }
  const schema = schemaKind(row);
  if (schema.kind === 'blocker') return { kind: 'blocker', reason: schema.reason };
  // The stored row is used as-is; CFBD `homeAway` is trusted and never swapped.
  return {
    kind: 'usable',
    candidate: { row, sufficiency: schema.sufficiency, fenceMs: schema.fenceMs },
  };
}

// === Winner selection ===

const SUFFICIENCY_RANK: Record<EvidenceSufficiency, number> = {
  'v2-complete': 0,
  'legacy-compatible': 1,
  'v2-sparse': 2,
  defective: 3,
};

function decide(
  providerGameId: number,
  usable: UsableCandidate[],
  seasonRelation: SeasonRelation
): EvidenceDecision {
  const base = { providerGameId, provenance: null, selected: null, blockers: [] };

  if (usable.length === 0) return { ...base, state: 'absent' };

  const topRank = Math.min(...usable.map((c) => SUFFICIENCY_RANK[c.sufficiency]));
  const topClass = usable.find((c) => SUFFICIENCY_RANK[c.sufficiency] === topRank)!.sufficiency;

  if (topClass === 'defective') {
    // Usable-but-defective evidence only. Season relation decides the disposition
    // (mirroring `evaluateGameStatsRow`): a CURRENT-season defective row is
    // recoverable — a refetch fills the gap — so it reads as a plain `absent`
    // gap; a HISTORICAL defective row cannot be auto-recovered and is the terminal
    // `manual-only` state that compatibility policy reserves.
    return { ...base, state: seasonRelation === 'current' ? 'absent' : 'manual-only' };
  }

  const top = usable.filter((c) => c.sufficiency === topClass);
  const provenance = topClass as EvidenceProvenance;
  const isV2Class = topClass === 'v2-complete' || topClass === 'v2-sparse';

  // Freshness applies ONLY among v2 candidates in the same sufficiency class.
  const newestFenceMs = isV2Class ? Math.max(...top.map((c) => c.fenceMs ?? -Infinity)) : -Infinity;
  const contenders = isV2Class ? top.filter((c) => c.fenceMs === newestFenceMs) : top;

  // Choose a DETERMINISTIC representative among the surviving contenders. Equal-
  // fence, publishable-equivalent rows can still differ in excluded metadata (a
  // `Z` vs `+00:00` fetchStartedAt encoding, unrecognized raw categories), so
  // taking `contenders[0]` would let candidate order change the selected row. The
  // canonical (key-sorted) serialization is a stable total order.
  const winner = contenders
    .map((candidate) => ({ candidate, key: canonicalJson(candidate.row) }))
    .reduce((best, entry) => (entry.key < best.key ? entry : best)).candidate;
  const allEquivalent = contenders.every((c) => evidenceEquivalent(c.row, winner.row));
  if (!allEquivalent) {
    // Equal-fence divergent v2, or divergent legacy duplicates → conflict.
    return { ...base, state: 'duplicate-conflict', provenance };
  }

  return {
    ...base,
    state: topClass === 'v2-sparse' ? 'incomplete' : 'satisfied',
    provenance,
    selected: winner.row,
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

  for (const row of candidateRows) {
    const record = asRecord(row);
    if (!record || !isValidProviderGameId(record.providerGameId)) continue;
    if (record.providerGameId !== providerGameId) continue;

    const assessment = assessCandidate(row, game);
    if (assessment.kind === 'blocker') blockers.push(assessment.reason);
    else if (assessment.kind === 'usable') usable.push(assessment.candidate);
  }

  // A matching same-id unsupported/malformed/bad-fence row blocks the game — by
  // id alone — and never falls back to a sibling.
  if (blockers.length > 0) {
    return {
      providerGameId,
      state: 'blocked-unsupported-schema',
      provenance: null,
      selected: null,
      blockers: Array.from(new Set(blockers)).sort(),
    };
  }

  return decide(providerGameId, usable, seasonRelation);
}
