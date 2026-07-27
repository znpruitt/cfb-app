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
 * (ACTIVE).
 *
 * Authority model (PLATFORM-086H3C1-SIMPLIFICATION-v1 + PLATFORM-086H3C5): a
 * UNIQUE canonical CFBD game id, plus partition agreement, establishes
 * association — WHICH scheduled game a durable row belongs to. Numeric
 * participant validation (PLATFORM-086H3C5) then decides whether an associated,
 * schema-supported row's stored `schoolId`s are the schedule's own numeric
 * `homeId`/`awayId` — by EXACT ORIENTED equality only. An exact reversal is a
 * mismatch; neutral-site status changes nothing; provider names, canonical
 * names, aliases, and conferences neither verify nor contradict numeric
 * identity. CFBD `homeAway` remains trusted — sides are never swapped or
 * reoriented — and two verified rows for the same id that disagree on a side's
 * stored `homeAway` are a `duplicate-conflict`, not silently collapsed.
 *
 * Validation fails CLOSED (activation prerequisite): evidence that cannot be
 * numerically validated never satisfies coverage, publishes, or enters
 * analytics. Missing schedule ids and missing/invalid stored ids are the typed
 * `participant-validation-unavailable` state — distinct from a PROVEN
 * `identity-mismatch` and from ordinary evidence absence; neither is ever
 * guessed into the other.
 *
 * For one expected canonical game and its candidate durable rows (all sharing the
 * game's provider id):
 *   - a same-partition unsupported / malformed / bad-fence schema BLOCKS weaker
 *     siblings from its id alone (before any participant interpretation);
 *   - every other schema-supported row is a usable candidate;
 *   - only participant-VERIFIED candidates are ranked; the winner is the
 *     highest-sufficiency, freshest, deterministically chosen verified row
 *     (complete v2 > compatible legacy > sparse v2 > defective).
 *
 * Committed coverage, public projection, and analytics projection all consume
 * THIS decision — there is no second read-side duplicate authority (the former
 * `selectAnalyticsRows` was removed).
 *
 * Selection order:
 *   1. confirm partition agreement (association is the game's own id + partition);
 *   2. apply unsupported/malformed/bad-fence schema blockers by id;
 *   3. validate supported candidates by exact numeric home/away ids — a
 *      mismatched or unverifiable candidate is EXCLUDED from ranking and can
 *      never displace, shadow, or replace a verified sibling;
 *   4. rank the verified candidates by sufficiency;
 *   5. apply freshness ONLY among v2 candidates in the same sufficiency class;
 *   6. collapse equivalent candidates; divergent same-class candidates conflict.
 *
 * Evidence selection is row-level: read-time field composition across rows is
 * forbidden. Component-level composition stays with the durable merge service
 * (the write path); this read-model authority never calls it.
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
 * so coverage maps 1:1 without re-deriving policy.
 * PLATFORM-086H3C5 adds the two fail-closed participant-validation states:
 * `participant-validation-unavailable` (required schedule or stored numeric ids
 * are unavailable — NOT a proven contradiction, NOT ordinary absence) and
 * `identity-mismatch` (all four ids known, no candidate directly matches).
 * Neither publishes, satisfies coverage, or enters analytics.
 */
export type EvidenceState =
  | 'satisfied'
  | 'incomplete'
  | 'manual-only'
  | 'blocked-unsupported-schema'
  | 'duplicate-conflict'
  | 'participant-validation-unavailable'
  | 'identity-mismatch'
  | 'absent';

/**
 * Typed participant-validation outcome (PLATFORM-086H3C5). Per-candidate during
 * selection; the decision carries the outcome that governed it. There is
 * deliberately NO broad `unverified` value that could satisfy coverage —
 * anything short of `verified` fails closed.
 */
export type ParticipantValidationOutcome =
  | 'verified'
  | 'schedule-ids-unavailable'
  | 'stored-ids-unavailable'
  | 'mismatch';

export type EvidenceDecision = {
  providerGameId: number;
  state: EvidenceState;
  /** Set for satisfied / incomplete / duplicate-conflict; null otherwise. */
  provenance: EvidenceProvenance | null;
  /** The selected winner as stored (never reoriented); set for satisfied / incomplete. */
  selected: GameStats | null;
  /** Set only for `blocked-unsupported-schema`; sorted + deduplicated. */
  blockers: EvidenceBlockReason[];
  /**
   * The participant-validation outcome that governed this decision: `verified`
   * when ranking proceeded over verified candidates (whatever the final state),
   * the specific unavailable/mismatch reason for the two new states, and `null`
   * when validation was never reached (schema-blocked, or no usable candidates).
   */
  participantValidation: ParticipantValidationOutcome | null;
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

// === Participant validation (PLATFORM-086H3C5) ===

/**
 * Validate one schema-supported candidate's stored numeric identity against the
 * schedule's numeric participant ids. EXACT ORIENTED comparison only:
 * `stored.home.schoolId === schedule.homeId && stored.away.schoolId ===
 * schedule.awayId`. An exact reversal is a mismatch like any other disagreement
 * — sides are never swapped, reoriented, negated, or recomputed, and
 * neutral-site status changes nothing. Missing schedule ids (either side) are
 * `schedule-ids-unavailable`; missing/invalid stored ids are
 * `stored-ids-unavailable` — both are validation gaps, never a PROVEN mismatch.
 * Names, aliases, and conferences are never consulted.
 */
function validateCandidateParticipants(
  row: GameStats,
  game: CanonicalGame
): ParticipantValidationOutcome {
  if (game.homeId === null || game.awayId === null) return 'schedule-ids-unavailable';
  const home = asRecord(asRecord(row)?.home);
  const away = asRecord(asRecord(row)?.away);
  const storedHomeId = home?.schoolId;
  const storedAwayId = away?.schoolId;
  if (!isValidProviderGameId(storedHomeId) || !isValidProviderGameId(storedAwayId)) {
    return 'stored-ids-unavailable';
  }
  return storedHomeId === game.homeId && storedAwayId === game.awayId ? 'verified' : 'mismatch';
}

// === Winner selection ===

const SUFFICIENCY_RANK: Record<EvidenceSufficiency, number> = {
  'v2-complete': 0,
  'legacy-compatible': 1,
  'v2-sparse': 2,
  defective: 3,
};

/**
 * Rank candidates that already passed participant validation (`verified` only —
 * the caller excludes mismatched/unverifiable candidates before ranking, so a
 * higher-sufficiency mismatched row can never displace a verified one).
 */
function decide(
  providerGameId: number,
  usable: UsableCandidate[],
  seasonRelation: SeasonRelation
): EvidenceDecision {
  const base = {
    providerGameId,
    provenance: null,
    selected: null,
    blockers: [],
    participantValidation: 'verified' as const,
  };

  // Defensive only — the caller resolves an empty candidate set before
  // validation, so ranking always receives at least one verified candidate.
  if (usable.length === 0) {
    return { ...base, state: 'absent', participantValidation: null };
  }

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
  // id alone, BEFORE any participant interpretation — and never falls back to a
  // sibling. Missing or contradictory participants cannot bypass a schema block.
  if (blockers.length > 0) {
    return {
      providerGameId,
      state: 'blocked-unsupported-schema',
      provenance: null,
      selected: null,
      blockers: Array.from(new Set(blockers)).sort(),
      participantValidation: null,
    };
  }

  // With valid schedule ids and no candidate rows the decision remains plain
  // `absent` — participant validation only ever judges rows that exist.
  if (usable.length === 0) {
    return {
      providerGameId,
      state: 'absent',
      provenance: null,
      selected: null,
      blockers: [],
      participantValidation: null,
    };
  }

  // PLATFORM-086H3C5: numeric participant validation gates ranking. Only
  // verified candidates may satisfy, publish, or enter analytics; mismatched
  // and unverifiable candidates are excluded from ranking entirely, so they can
  // never displace, shadow, or replace a verified sibling of ANY sufficiency.
  const validations = usable.map((candidate) => ({
    candidate,
    validation: validateCandidateParticipants(candidate.row, game),
  }));
  const verified = validations
    .filter((entry) => entry.validation === 'verified')
    .map((entry) => entry.candidate);

  if (verified.length === 0) {
    const base = { providerGameId, provenance: null, selected: null, blockers: [] };
    // A known numeric contradiction outranks a validation gap: if ANY candidate
    // proves all four ids and disagrees, the game is `identity-mismatch`.
    if (validations.some((entry) => entry.validation === 'mismatch')) {
      return { ...base, state: 'identity-mismatch', participantValidation: 'mismatch' };
    }
    // Otherwise validation was unavailable. The schedule-side gap dominates the
    // reason (it applies to every candidate uniformly); a stored-side gap is
    // reported when the schedule ids were present but no row's ids were usable.
    return {
      ...base,
      state: 'participant-validation-unavailable',
      participantValidation:
        game.homeId === null || game.awayId === null
          ? 'schedule-ids-unavailable'
          : 'stored-ids-unavailable',
    };
  }

  return decide(providerGameId, verified, seasonRelation);
}
