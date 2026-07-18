import type { CfbdSeasonType } from '../cfbd.ts';
import { getAppState, getAppStateEntries, listAppStateKeys } from '../server/appStateStore.ts';
import type { WeeklyGameStats } from './types.ts';

const SCOPE = 'game-stats';

export function getGameStatsKey(year: number, week: number, seasonType: CfbdSeasonType): string {
  return `${year}:${week}:${seasonType}`;
}

// PLATFORM-086H3: this module is READ-ONLY. The former blind partition
// overwrite (the cache setter) is retired — every production write flows
// through the durable merge authority (`durableMerge.ts`), which serializes
// read→merge→write inside the per-partition transaction-scoped lock. The
// activation guard fails any reintroduced direct game-stats write.

export async function getCachedGameStats(
  year: number,
  week: number,
  seasonType: CfbdSeasonType = 'regular'
): Promise<WeeklyGameStats | null> {
  const key = getGameStatsKey(year, week, seasonType);
  const stored = await getAppState<WeeklyGameStats>(SCOPE, key);
  return stored?.value ?? null;
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
  const entries = await getAppStateEntries<WeeklyGameStats | null>(SCOPE, `${year}:`);
  // Structural floor only: a null/non-object stored value is not a partition.
  // Envelope/row validation stays at the read boundary.
  return entries
    .map((entry) => entry.value)
    .filter((value): value is WeeklyGameStats => typeof value === 'object' && value !== null);
}
