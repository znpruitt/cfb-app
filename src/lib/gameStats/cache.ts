import type { CfbdSeasonType } from '../cfbd.ts';
import {
  getAppState,
  getAppStateEntries,
  setAppState,
  listAppStateKeys,
  withAppStateKeyLock,
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
 * IN-PROCESS per-week mutex for the game-stats read→merge→write sequence — an
 * OPTIMIZATION ONLY (it keeps same-instance overlapping refreshes from
 * contending on the durable lock), NOT a correctness guarantee: production runs
 * multiple serverless instances against shared Postgres, and a process-local
 * promise chain cannot serialize them. Cross-instance correctness comes from
 * `withDurableGameStatsWeek` below (adversarial-review remediation), which
 * every weekly writer must use. Same promise-chain mutex shape as the
 * provider-status `withScopeLock`; a rejected operation propagates but never
 * poisons the chain.
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

/** Key-scoped weekly record accessors valid only inside `withDurableGameStatsWeek`. */
export type DurableGameStatsWeekAccess = {
  read: () => Promise<WeeklyGameStats | null>;
  write: (stats: WeeklyGameStats) => Promise<void>;
};

/**
 * CROSS-INSTANCE atomic boundary for a weekly game-stats read→merge→write
 * (adversarial-review remediation): runs the callback under the durable
 * per-key lock (`withAppStateKeyLock` — a transaction-scoped Postgres advisory
 * lock in production; the whole-file mutex in the file fallback), so two
 * writers on DIFFERENT instances can no longer read the same prior record and
 * have the later last-writer-wins upsert erase the earlier one's merged rows.
 * The fresh durable read, the merge decision, and the durable write (the
 * publication step for this dataset) must all happen inside the callback;
 * provider fetches and status recording stay outside. A failed callback rolls
 * the transaction back and releases the lock — later attempts are unaffected.
 */
export function withDurableGameStatsWeek<T>(
  year: number,
  week: number,
  seasonType: CfbdSeasonType,
  fn: (access: DurableGameStatsWeekAccess) => Promise<T>
): Promise<T> {
  return withAppStateKeyLock(SCOPE, getGameStatsKey(year, week, seasonType), (access) =>
    fn({
      read: async () => (await access.get<WeeklyGameStats>())?.value ?? null,
      write: async (stats) => {
        await access.set(stats);
      },
    })
  );
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
