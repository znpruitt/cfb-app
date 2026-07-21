import type { CfbdSeasonType } from '../cfbd.ts';
import {
  RECOGNIZED_GAME_STAT_CATEGORIES,
  toAnalyticsGameStats,
  type AnalyticsGameStats,
  type SeasonRelation,
} from './contract.ts';
import { parseObservationFenceMs } from './observationFence.ts';
import type { CanonicalSlateResult, CanonicalSlateUnavailableReason } from './canonicalSlate.ts';
import {
  evaluatePartitionCoverage,
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
  identityMismatch: number;
  duplicateConflict: number;
  blocked: number;
  manualOnly: number;
  pending: number;
  /** Published games whose winner's participants were not fully verified. */
  unverified: number;
  /** Published games whose winner is a reoriented non-neutral reversal. */
  reversedWarning: number;
  /** Associated rows quarantined for a known participant contradiction. */
  quarantined: number;
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
    identityMismatch: count('identity-mismatch'),
    duplicateConflict: count('duplicate-conflict'),
    blocked: count('blocked-unsupported-schema'),
    manualOnly: count('manual-only'),
    pending: coverage.pending.length,
    unverified: coverage.integrityWarnings.filter((w) => w.integrity === 'unverified').length,
    reversedWarning: coverage.integrityWarnings.filter((w) => w.integrity === 'reversed-warning')
      .length,
    quarantined: coverage.quarantined.length,
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
 * Analytics view of a partition. Accepts ONLY complete v2 or compatible legacy
 * evidence (coverage state `satisfied`) and strictly reparses raw evidence and
 * points through `toAnalyticsGameStats`. Sparse (incomplete) rows are excluded.
 * There is no duplicate selection here — the shared authority already chose the
 * winner.
 */
export function projectAnalyticsPartition(coverage: PartitionCoverage): AnalyticsGameStats[] {
  const projected: AnalyticsGameStats[] = [];
  for (const { decision } of coverage.games) {
    if (decision.state !== 'satisfied' || !decision.selected) continue;
    const analytics = toAnalyticsGameStats(decision.selected);
    if (analytics) projected.push(analytics);
  }
  return projected;
}
