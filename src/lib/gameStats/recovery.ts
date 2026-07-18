import type { CfbdSeasonType } from '../cfbd.ts';
import type { SeasonRelation } from './contract.ts';
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
import { expectsGameStats } from './coverage.ts';

/**
 * PLATFORM-086H3 — schedule-relative recovery planning (ACTIVE).
 *
 * Recovery begins from canonical-schedule expectations and compares them with
 * COMMITTED durable game-stats evidence:
 *
 *   canonical scheduled games → durable partition inspection → typed
 *   coverage/classification → bounded recovery candidates → authorized
 *   provider fetch → validated observations → durable merge authority →
 *   refreshed coverage
 *
 * The planner is pure and bounded: it emits candidate slates (newest first)
 * whose committed coverage still has recoverable or absent expected games.
 * The scheduled cron consumes exactly ONE candidate per run — one shared
 * provider request per partition, no speculative whole-season refresh — so
 * provider quota is bounded by the cron cadence regardless of how many gaps
 * exist. Stop conditions the plan encodes directly:
 *
 *   - durable evidence already sufficient → the slate is `satisfied`, never a
 *     candidate (no repeated provider calls for covered partitions);
 *   - schedule placeholders not yet provider-addressable → preserved and
 *     deferred, never fetched;
 *   - blocked (unsupported/malformed schema) rows → never auto-recovered;
 *   - slates with no completed stat-producing games → not applicable.
 *
 * The remaining stop conditions (provider unavailable, payload validation
 * failure, unresolved identity, indeterminate write, newer fence) live at the
 * writer/merge boundary, which defers truthfully rather than looping.
 */

export type GameStatsRecoverySlate = {
  week: number;
  seasonType: CfbdSeasonType;
  /** Latest completed-game kickoff in the slate (ms epoch). */
  latestCompletedKickoff: number;
  expectation: GameStatsSlateExpectation;
  coverage: GameStatsPartitionCoverage;
};

export type GameStatsRecoveryPlan = {
  /** Slates needing durable repair, newest completed kickoff first. */
  candidates: GameStatsRecoverySlate[];
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
 * the COMMITTED weekly partitions already read from durable storage (a caller
 * whose durable read failed must not fabricate an empty list and let absence
 * be inferred — report the read failure instead).
 */
export function planGameStatsRecovery(params: {
  year: number;
  scheduleItems: readonly ScheduleSlateItem[];
  records: readonly WeeklyGameStats[];
  now: number;
  seasonRelation: SeasonRelation;
  completedAfterMs?: number;
}): GameStatsRecoveryPlan {
  const { year, scheduleItems, records, now, seasonRelation } = params;
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
    const slate: GameStatsRecoverySlate = {
      week,
      seasonType,
      latestCompletedKickoff: latestCompleted.get(key) ?? 0,
      expectation,
      coverage,
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

  return { candidates, satisfied, deferred };
}
