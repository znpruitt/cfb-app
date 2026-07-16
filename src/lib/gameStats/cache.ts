import type { CfbdSeasonType } from '../cfbd.ts';
import {
  getAppState,
  getAppStateEntries,
  setAppState,
  listAppStateKeys,
} from '../server/appStateStore.ts';
import type { WeeklyGameStats } from './types.ts';

const SCOPE = 'game-stats';

export function getGameStatsKey(year: number, week: number, seasonType: CfbdSeasonType): string {
  return `${year}:${week}:${seasonType}`;
}

export async function getCachedGameStats(
  year: number,
  week: number,
  seasonType: CfbdSeasonType = 'regular'
): Promise<WeeklyGameStats | null> {
  const key = getGameStatsKey(year, week, seasonType);
  const stored = await getAppState<WeeklyGameStats>(SCOPE, key);
  return stored?.value ?? null;
}

export async function setCachedGameStats(stats: WeeklyGameStats): Promise<void> {
  const key = getGameStatsKey(stats.year, stats.week, stats.seasonType);
  await setAppState(SCOPE, key, stats);
}

const weekLocks = new Map<string, Promise<unknown>>();

/**
 * Per-week critical section for the game-stats read→merge→write sequence
 * (PLATFORM-086H review remediation). Both refresh paths (cron and manual)
 * mutate a weekly record via read prior → merge → durable write; two overlapping
 * refreshes for the same (year, week, seasonType) could otherwise both read the
 * same prior record and the later write would silently drop rows the first just
 * merged in — violating the prior-good retention guarantee. Same promise-chain
 * mutex shape as the provider-status `withScopeLock` and odds
 * `withOddsTargetLock`. A rejected operation propagates to its caller but never
 * poisons the chain (the stored tail swallows the rejection), so later refreshes
 * proceed normally. The durable write IS the publication step for this dataset
 * (no separate process cache), so everything downstream observes only complete
 * merges. IN-PROCESS ONLY, per the documented 086A limitation — cross-instance
 * serialization is out of scope; the durable store remains last-writer-wins
 * across instances.
 */
export function withGameStatsWeekLock<T>(
  year: number,
  week: number,
  seasonType: CfbdSeasonType,
  fn: () => Promise<T>
): Promise<T> {
  const key = getGameStatsKey(year, week, seasonType);
  const prev = weekLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  weekLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export async function listCachedGameStatsWeeks(year: number): Promise<string[]> {
  const allKeys = await listAppStateKeys(SCOPE);
  const prefix = `${year}:`;
  return allKeys.filter((k) => k.startsWith(prefix));
}

/**
 * Every cached weekly game-stats RECORD for a year (not just its keys), in one
 * durable read. Provider-data diagnostics use this to judge coverage by actual
 * game content instead of key existence (PLATFORM-086A 4th-review finding #3).
 */
export async function listCachedGameStats(year: number): Promise<WeeklyGameStats[]> {
  const entries = await getAppStateEntries<WeeklyGameStats>(SCOPE, `${year}:`);
  return entries.map((entry) => entry.value);
}
