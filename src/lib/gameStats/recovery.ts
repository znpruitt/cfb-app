import type { CfbdSeasonType } from '../cfbd.ts';
import type { SeasonRelation } from './contract.ts';
import type { TeamIdentityResolver } from '../teamIdentity.ts';
import type { WeeklyGameStats } from './types.ts';
import {
  deriveSlateExpectation,
  GAME_STATS_COMPLETED_AFTER_MS,
  providerAddressableId,
  type GameStatsSlateExpectation,
  type ScheduleSlateItem,
} from './ingestion.ts';
import {
  evaluateGameStatsPartitionCoverage,
  isPartitionRecoverySatisfied,
  type GameStatsPartitionCoverage,
} from './partitionCoverage.ts';
import {
  gameStatsRecoveryKey,
  isRecoveryEligible,
  type GameStatsRecoveryDispositionRecord,
} from './recoveryDisposition.ts';
import { expectsGameStats } from './coverage.ts';

/**
 * PLATFORM-086H3 — schedule-relative recovery planning (ACTIVE).
 *
 * Recovery begins from canonical-schedule expectations and compares them with
 * COMMITTED durable game-stats evidence:
 *
 *   canonical scheduled games → durable partition inspection → typed
 *   coverage/classification → bounded recovery candidates → durable recovery
 *   disposition (backoff/rotation) → authorized provider fetch → validated
 *   observations → durable merge authority → committed reread → refreshed
 *   coverage
 *
 * The planner is pure and bounded: it emits candidate slates (newest first)
 * whose committed coverage still has recoverable or absent expected games,
 * each flagged with per-partition ELIGIBILITY from the durable recovery
 * disposition. The scheduled cron consumes exactly ONE eligible candidate per
 * run — one shared provider request per partition, no speculative multi-slate
 * fetching — and candidate ROTATION happens across runs: a newer partition
 * that is backing off (or terminal) yields to older eligible partitions
 * instead of starving them. Stop conditions the plan encodes directly:
 *
 *   - durable evidence already sufficient → the slate is `satisfied`, never a
 *     candidate (no repeated provider calls for covered partitions);
 *   - schedule placeholders not yet provider-addressable OR with unresolved
 *     canonical participants → preserved and deferred, never fetched (a
 *     numeric provider id alone is not resolution);
 *   - FCS-vs-FCS slate games → excluded by classification, never fetched;
 *   - blocked (unsupported/malformed schema) rows → never auto-recovered;
 *   - slates with no completed stat-producing games → not applicable;
 *   - a partition inside its backoff window or terminal → ineligible this
 *     run (selection rotates to the next eligible candidate).
 *
 * The remaining stop conditions (provider unavailable, payload validation
 * failure, unresolved identity, indeterminate write, newer fence) live at the
 * writer/merge/publication boundary, which defers truthfully — and records
 * the disposition that bounds the NEXT run — rather than looping.
 */

export type GameStatsRecoverySlate = {
  week: number;
  seasonType: CfbdSeasonType;
  /** Latest completed-game kickoff in the slate (ms epoch). */
  latestCompletedKickoff: number;
  expectation: GameStatsSlateExpectation;
  coverage: GameStatsPartitionCoverage;
  /** Whether the durable recovery disposition permits selection at `now`. */
  eligible: boolean;
  disposition: GameStatsRecoveryDispositionRecord | null;
};

export type GameStatsRecoveryPlan = {
  /** Slates needing durable repair, newest completed kickoff first. */
  candidates: GameStatsRecoverySlate[];
  /** The bounded per-run selection: the newest ELIGIBLE candidate, if any. */
  target: GameStatsRecoverySlate | null;
  /** Slates whose committed durable evidence is already sufficient. */
  satisfied: GameStatsRecoverySlate[];
  /** Slates with stat-producing games but none completed/addressable yet. */
  deferred: GameStatsRecoverySlate[];
};

function normalizeSeasonType(value: unknown): CfbdSeasonType {
  return value === 'postseason' ? 'postseason' : 'regular';
}

/**
 * Plan bounded, schedule-relative recovery for one season year. `records` are
 * the COMMITTED weekly partitions already read from durable storage, and
 * `dispositions` the durable recovery bookkeeping (a caller whose durable
 * read failed must not fabricate empties and let absence be inferred —
 * report the read failure instead).
 */
export function planGameStatsRecovery(params: {
  year: number;
  scheduleItems: readonly ScheduleSlateItem[];
  resolver: TeamIdentityResolver;
  records: readonly WeeklyGameStats[];
  dispositions?: ReadonlyMap<string, GameStatsRecoveryDispositionRecord>;
  now: number;
  seasonRelation: SeasonRelation;
  completedAfterMs?: number;
}): GameStatsRecoveryPlan {
  const { year, scheduleItems, resolver, records, now, seasonRelation } = params;
  const dispositions = params.dispositions ?? new Map();
  const completedAfterMs = params.completedAfterMs ?? GAME_STATS_COMPLETED_AFTER_MS;

  // Discover slates from the canonical schedule (never from stored stats) and
  // track each slate's latest COMPLETED stat-producing kickoff for ordering.
  const slateKeys = new Map<string, { week: number; seasonType: CfbdSeasonType }>();
  const latestCompleted = new Map<string, number>();
  for (const item of scheduleItems) {
    if (!expectsGameStats(item.status)) continue;
    const seasonType = normalizeSeasonType(item.seasonType);
    const key = `${item.week}:${seasonType}`;
    if (!slateKeys.has(key)) slateKeys.set(key, { week: item.week, seasonType });
    if (providerAddressableId(item.id) === null || !item.startDate) continue;
    const kickoff = new Date(item.startDate).getTime();
    if (!Number.isFinite(kickoff) || kickoff > now - completedAfterMs) continue;
    const prev = latestCompleted.get(key) ?? 0;
    if (kickoff > prev) latestCompleted.set(key, kickoff);
  }

  const recordBySlate = new Map<string, WeeklyGameStats>();
  for (const record of records) {
    recordBySlate.set(`${record.week}:${normalizeSeasonType(record.seasonType)}`, record);
  }

  const candidates: GameStatsRecoverySlate[] = [];
  const satisfied: GameStatsRecoverySlate[] = [];
  const deferred: GameStatsRecoverySlate[] = [];

  for (const [key, { week, seasonType }] of slateKeys) {
    const expectation = deriveSlateExpectation({
      scheduleItems,
      resolver,
      year,
      week,
      seasonType,
      now,
      completedAfterMs,
    });
    const coverage = evaluateGameStatsPartitionCoverage(
      expectation,
      recordBySlate.get(key) ?? null,
      { seasonRelation }
    );
    const disposition = dispositions.get(gameStatsRecoveryKey(year, week, seasonType)) ?? null;
    const slate: GameStatsRecoverySlate = {
      week,
      seasonType,
      latestCompletedKickoff: latestCompleted.get(key) ?? 0,
      expectation,
      coverage,
      eligible: isRecoveryEligible(disposition, now),
      disposition,
    };
    if (expectation.expectedIds.size === 0) {
      deferred.push(slate);
      continue;
    }
    if (isPartitionRecoverySatisfied(coverage)) satisfied.push(slate);
    else candidates.push(slate);
  }

  const newestFirst = (a: GameStatsRecoverySlate, b: GameStatsRecoverySlate) =>
    b.latestCompletedKickoff - a.latestCompletedKickoff ||
    b.week - a.week ||
    a.seasonType.localeCompare(b.seasonType);
  candidates.sort(newestFirst);
  satisfied.sort(newestFirst);
  deferred.sort(newestFirst);

  return {
    candidates,
    // Rotation: the newest ELIGIBLE candidate — a backed-off/terminal newer
    // slate lets older eligible slates progress across runs.
    target: candidates.find((slate) => slate.eligible) ?? null,
    satisfied,
    deferred,
  };
}
