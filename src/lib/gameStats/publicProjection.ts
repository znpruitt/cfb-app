import type { CfbdSeasonType } from '../cfbd.ts';
import { classifyScorePackStatus } from '../gameStatus.ts';
import type { ScorePack } from '../scores.ts';
import {
  RECOGNIZED_GAME_STAT_CATEGORIES,
  toAnalyticsGameStats,
  type AnalyticsGameStats,
  type SeasonRelation,
} from './contract.ts';
import { parseObservationFenceMs } from './observationFence.ts';
import {
  selectCanonicalPartition,
  type CanonicalSlate,
  type CanonicalSlateResult,
  type CanonicalSlateUnavailableReason,
} from './canonicalSlate.ts';
import { selectGameEvidence } from './evidenceAuthority.ts';
import {
  evaluatePartitionCoverage,
  groupRowsById,
  type PartitionCoverage,
  type PartitionCoverageState,
} from './partitionCoverage.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3C1 — schema-safe public + analytics projections (DORMANT).
 *
 * Both projections consume the SAME evidence decision that coverage computes, so
 * the winner and conflict classification can never diverge across surfaces —
 * only field eligibility differs. The public wire is built from explicit
 * envelope, game, team, and recognized-raw-category allowlists; a persisted
 * object is never spread onto the wire, and internal persistence metadata
 * (schema version, observation fence, transaction/recovery state) never leaks.
 * This projection is not wired to the live `/api/game-stats` response.
 */

// === Public wire (allowlisted) ===

export type PublicTeamGameStats = {
  school: string;
  schoolId: number;
  conference: string;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  rushingAttempts: number;
  passingAttempts: number;
  passingCompletions: number;
  rushingTDs: number;
  passingTDs: number;
  firstDowns: number;
  turnovers: number;
  fumblesLost: number;
  interceptionsThrown: number;
  passesIntercepted: number;
  fumblesRecovered: number;
  thirdDownAttempts: number;
  thirdDownConversions: number;
  thirdDownPct: number;
  fourthDownAttempts: number;
  fourthDownConversions: number;
  penaltyCount: number;
  penaltyYards: number;
  possessionSeconds: number;
  interceptionReturnYards: number;
  interceptionReturnTDs: number;
  kickReturnYards: number;
  kickReturnTDs: number;
  puntReturnYards: number;
  puntReturnTDs: number;
  /** Recognized contract categories only. */
  raw: Record<string, string>;
};

export type PublicGameStats = {
  providerGameId: number;
  /** False for a structurally valid sparse row — visibly incomplete. */
  complete: boolean;
  home: PublicTeamGameStats;
  away: PublicTeamGameStats;
};

export type PublicAvailability = {
  partitionState: PartitionCoverageState;
  expected: number;
  satisfied: number;
  incomplete: number;
  absent: number;
  duplicateConflict: number;
  blocked: number;
  manualOnly: number;
  pending: number;
  /** Games published on the wire (satisfied + incomplete). */
  published: number;
};

export type PublicWeeklyGameStats = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  fetchedAt: string;
  games: PublicGameStats[];
  availability: PublicAvailability;
};

export type PublicProjectionResult =
  | { status: 'available'; wire: PublicWeeklyGameStats }
  | { status: 'absent' }
  | { status: 'read-failure' }
  | { status: 'malformed-envelope' }
  | { status: 'partition-mismatch' }
  | { status: 'invalid-fetched-at' }
  | { status: 'non-array-games' }
  | { status: 'context-unavailable'; reason: CanonicalSlateUnavailableReason };

/** Outcome of the durable envelope read the caller performs. */
export type DurableReadOutcome = { status: 'ok'; value: unknown } | { status: 'read-failed' };

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function publicTeam(team: TeamGameStats): PublicTeamGameStats {
  const rawSource = team && typeof team.raw === 'object' && team.raw !== null ? team.raw : {};
  const raw: Record<string, string> = {};
  for (const category of RECOGNIZED_GAME_STAT_CATEGORIES) {
    const value = (rawSource as Record<string, unknown>)[category];
    if (typeof value === 'string') raw[category] = value;
  }
  return {
    school: typeof team.school === 'string' ? team.school : '',
    schoolId: num(team.schoolId),
    conference: typeof team.conference === 'string' ? team.conference : '',
    points: num(team.points),
    totalYards: num(team.totalYards),
    rushingYards: num(team.rushingYards),
    passingYards: num(team.passingYards),
    rushingAttempts: num(team.rushingAttempts),
    passingAttempts: num(team.passingAttempts),
    passingCompletions: num(team.passingCompletions),
    rushingTDs: num(team.rushingTDs),
    passingTDs: num(team.passingTDs),
    firstDowns: num(team.firstDowns),
    turnovers: num(team.turnovers),
    fumblesLost: num(team.fumblesLost),
    interceptionsThrown: num(team.interceptionsThrown),
    passesIntercepted: num(team.passesIntercepted),
    fumblesRecovered: num(team.fumblesRecovered),
    thirdDownAttempts: num(team.thirdDownAttempts),
    thirdDownConversions: num(team.thirdDownConversions),
    thirdDownPct: num(team.thirdDownPct),
    fourthDownAttempts: num(team.fourthDownAttempts),
    fourthDownConversions: num(team.fourthDownConversions),
    penaltyCount: num(team.penaltyCount),
    penaltyYards: num(team.penaltyYards),
    possessionSeconds: num(team.possessionSeconds),
    interceptionReturnYards: num(team.interceptionReturnYards),
    interceptionReturnTDs: num(team.interceptionReturnTDs),
    kickReturnYards: num(team.kickReturnYards),
    kickReturnTDs: num(team.kickReturnTDs),
    puntReturnYards: num(team.puntReturnYards),
    puntReturnTDs: num(team.puntReturnTDs),
    raw,
  };
}

function publicGame(selected: GameStats, complete: boolean): PublicGameStats {
  return {
    providerGameId: selected.providerGameId,
    complete,
    home: publicTeam(selected.home),
    away: publicTeam(selected.away),
  };
}

function buildAvailability(coverage: PartitionCoverage, published: number): PublicAvailability {
  const count = (state: string): number =>
    coverage.games.filter((g) => g.decision.state === state).length;
  return {
    partitionState: coverage.state,
    expected: coverage.games.length,
    satisfied: count('satisfied'),
    incomplete: count('incomplete'),
    absent: count('absent'),
    duplicateConflict: count('duplicate-conflict'),
    blocked: count('blocked-unsupported-schema'),
    manualOnly: count('manual-only'),
    pending: coverage.pending.length,
    published,
  };
}

/** Build the allowlisted public wire from an already-computed coverage result. */
export function projectPublicFromCoverage(
  coverage: PartitionCoverage,
  fetchedAt: string
): PublicWeeklyGameStats {
  const games: PublicGameStats[] = [];
  for (const { decision } of coverage.games) {
    // Every coverage-satisfied game publishes; sparse rows publish as incomplete.
    if (decision.state === 'satisfied' && decision.selected) {
      games.push(publicGame(decision.selected, true));
    } else if (decision.state === 'incomplete' && decision.selected) {
      games.push(publicGame(decision.selected, false));
    }
  }
  return {
    year: coverage.year,
    week: coverage.week,
    seasonType: coverage.seasonType,
    fetchedAt,
    games,
    availability: buildAvailability(coverage, games.length),
  };
}

// === Envelope validation ===

type EnvelopeValidation =
  | { status: 'ok'; record: WeeklyGameStats }
  | { status: 'absent' }
  | { status: 'malformed-envelope' }
  | { status: 'partition-mismatch' }
  | { status: 'invalid-fetched-at' }
  | { status: 'non-array-games' };

function validateEnvelope(
  value: unknown,
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): EnvelopeValidation {
  if (value === null || value === undefined) return { status: 'absent' };
  if (typeof value !== 'object' || Array.isArray(value)) return { status: 'malformed-envelope' };
  const record = value as Record<string, unknown>;
  if (
    typeof record.year !== 'number' ||
    typeof record.week !== 'number' ||
    (record.seasonType !== 'regular' && record.seasonType !== 'postseason')
  ) {
    return { status: 'malformed-envelope' };
  }
  if (record.year !== year || record.week !== week || record.seasonType !== seasonType) {
    return { status: 'partition-mismatch' };
  }
  // `fetchedAt` is validated BEFORE the games shape so an invalid timestamp is
  // never masked by a coincidental non-array payload.
  if (parseObservationFenceMs(record.fetchedAt) === null) return { status: 'invalid-fetched-at' };
  if (!Array.isArray(record.games)) return { status: 'non-array-games' };
  return { status: 'ok', record: record as unknown as WeeklyGameStats };
}

/**
 * Full public projection for one partition: validates the durable envelope,
 * distinguishing genuine absence, durable-read failure, malformed envelope,
 * partition mismatch, invalid `fetchedAt`, and a non-array games payload; then
 * projects the SAME coverage decisions to the allowlisted public wire.
 */
export function projectPublicPartition(
  slateResult: CanonicalSlateResult,
  week: number,
  seasonType: CfbdSeasonType,
  read: DurableReadOutcome,
  seasonRelation: SeasonRelation
): PublicProjectionResult {
  if (slateResult.status === 'unavailable') {
    return { status: 'context-unavailable', reason: slateResult.reason };
  }
  if (read.status === 'read-failed') return { status: 'read-failure' };

  const validation = validateEnvelope(read.value, slateResult.slate.year, week, seasonType);
  if (validation.status !== 'ok') return { status: validation.status };

  const coverage = evaluatePartitionCoverage(
    slateResult.slate,
    week,
    seasonType,
    validation.record,
    seasonRelation
  );
  return {
    status: 'available',
    wire: projectPublicFromCoverage(coverage, validation.record.fetchedAt),
  };
}

// === Analytics projection (projection-only, behind the shared authority) ===

/**
 * PLATFORM-086H3C4 — the required paired analytics input. The slate's canonical
 * game keys and the score-map keys MUST come from the SAME canonical game build
 * or persisted snapshot:
 *   - a live season supplies the exact canonical game keys used when attaching
 *     reconciled live scores;
 *   - an archived season supplies the keys preserved from `archive.games`
 *     alongside that archive's own `scoresByKey`.
 * `game.key` is the ONLY score lookup key — never `eventId` (which key
 * disambiguation can intentionally diverge from), never a provider id, raw
 * label, or an independently rebuilt key.
 */
export type CanonicalAnalyticsReadInput = {
  slate: CanonicalSlate;
  scoresByKey: Readonly<Record<string, ScorePack>>;
};

/**
 * Analytics view of one partition (PLATFORM-086H3C4 readiness correction). A
 * canonical game contributes ONLY when it has BOTH:
 *   1. FINAL canonical score evidence —
 *      `classifyScorePackStatus(input.scoresByKey[game.key]) === 'final'`; AND
 *   2. complete game-stat evidence — a `satisfied` decision from the shared
 *      evidence authority (`selectGameEvidence`) with a selected row that passes
 *      the strict `toAnalyticsGameStats` projection (reparse of raw evidence +
 *      points; never stored fallbacks).
 *
 * Analytics eligibility is INDEPENDENT of C1's six-hour missing-data threshold:
 * every addressable, stat-producing canonical game in the partition is
 * considered — whether C1 currently labels it `expected` or `pending` — so a
 * game that finishes within six hours of kickoff becomes analytics-eligible the
 * moment its score is final and its stats are complete. It does not wait six
 * hours or for the rest of the weekly slate. The six-hour threshold, coverage
 * evaluation, recovery gap states, and diagnostics are UNCHANGED — they keep
 * deciding when missing stats become a coverage/recovery gap, never when
 * final-and-complete evidence becomes eligible. Placeholders and
 * disrupted/non-stat-producing games remain excluded.
 *
 * The game is EXCLUDED when its score evidence is missing, scheduled, in
 * progress, disrupted, ambiguous, or unavailable (a missing key classifies as
 * `scheduled`, so absence is excluded without a special case), OR when its
 * game-stat evidence is sparse (incomplete), absent, conflicting, unsupported
 * (blocked), or manual-only. An in-progress game with complete stats remains
 * durable evidence — stored, merged, and selectable — but is excluded from
 * launch analytics until its score is final; finality is an ANALYTICS
 * eligibility rule only, never an ingestion, persistence, merge, or general
 * evidence-selection requirement.
 *
 * Contract:
 *   - `committedRecord` is the already-read durable record for exactly
 *     `input.slate.year` + `week` + `seasonType`. `null` means the caller
 *     successfully established the partition is ABSENT — a durable read failure
 *     must be handled by the caller and never converted to `null`.
 *   - A non-null committed record is validated through the SAME
 *     `validateEnvelope` authority the public projection uses (the durable
 *     store itself never validates stored values): a malformed envelope, a
 *     partition mismatch, an invalid `fetchedAt`, or a non-array `games`
 *     payload fails CLOSED to no analytics evidence — it never throws and
 *     never publishes from a corrupt envelope.
 *   - Pure: inspects only the supplied slate, attached scores, partition
 *     identity, committed record, and season relation. It never calls
 *     cache/store readers, fetches a provider, loads a schedule or archive, or
 *     mutates state. Assembling live and archived inputs and performing durable
 *     reads is the caller's (E's) responsibility.
 *   - Association, evidence selection, duplicate authority, and the strict
 *     analytics projection are all REUSED from C1 (`validateEnvelope`,
 *     `groupRowsById`, `selectGameEvidence`, `toAnalyticsGameStats`) — there is
 *     no second envelope/selection/completeness policy, and no
 *     recovery-filtered `PartitionCoverage` input.
 */
export function projectAnalyticsPartition(
  input: CanonicalAnalyticsReadInput,
  week: number,
  seasonType: CfbdSeasonType,
  committedRecord: WeeklyGameStats | null,
  seasonRelation: SeasonRelation
): AnalyticsGameStats[] {
  // Validate the COMPLETE committed envelope through the module's single
  // validation authority before touching its rows. Durable app-state is
  // untyped at rest, so identity agreement alone is not proof of shape: a
  // matching-but-malformed envelope (bad `fetchedAt`, non-array `games`,
  // malformed fields) and a partition mismatch all fail CLOSED to no analytics
  // evidence — never a throw, never analytics from a corrupt envelope.
  let validated: WeeklyGameStats | null = null;
  if (committedRecord !== null) {
    const validation = validateEnvelope(committedRecord, input.slate.year, week, seasonType);
    if (validation.status !== 'ok') return [];
    validated = validation.record;
  }

  // Addressable, stat-producing games of this partition: `expected` AND
  // `pending` (the six-hour threshold has no analytics authority); placeholders
  // and disrupted games are excluded by the partition selection itself.
  const partition = selectCanonicalPartition(input.slate, week, seasonType);
  const rowsById = groupRowsById(validated);

  const projected: AnalyticsGameStats[] = [];
  for (const game of [...partition.expected, ...partition.pending]) {
    // 1. Canonical FINAL score evidence is required first — a missing/scheduled/
    //    in-progress/disrupted/ambiguous score never yields analytics. The lookup
    //    uses the canonical attachment key (`game.key`), the key scores are
    //    attached under; `eventId` can be shared across disambiguated games.
    if (classifyScorePackStatus(input.scoresByKey[game.key]) !== 'final') continue;
    // 2. Then the shared evidence authority + strict completeness requirements.
    const decision = selectGameEvidence(
      game,
      rowsById.get(game.providerGameId) ?? [],
      seasonRelation
    );
    if (decision.state !== 'satisfied' || !decision.selected) continue;
    const analytics = toAnalyticsGameStats(decision.selected);
    if (analytics) projected.push(analytics);
  }
  return projected;
}
