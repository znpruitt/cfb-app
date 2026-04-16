import type { CfbdSeasonType } from '../cfbd.ts';
import { getAppState, setAppState, listAppStateKeys } from '../server/appStateStore.ts';
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

export async function listCachedGameStatsWeeks(year: number): Promise<string[]> {
  const allKeys = await listAppStateKeys(SCOPE);
  const prefix = `${year}:`;
  return allKeys.filter((k) => k.startsWith(prefix));
}
