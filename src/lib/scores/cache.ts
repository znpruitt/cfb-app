import type { CfbdFallbackReason, ScorePack, SeasonType } from './types.ts';

export type CacheWeek = number | 'all';
export type CacheKey = `${number}-${CacheWeek}-${SeasonType}`;

export type CacheEntry = {
  at: number;
  items: ScorePack[];
  source: 'cfbd' | 'espn';
  cfbdFallbackReason: CfbdFallbackReason;
};

export function pruneScoresCache(
  cache: Record<CacheKey, CacheEntry>,
  maxEntries: number,
  onPrune?: (evictedCount: number, cacheSize: number) => void
): void {
  const entries = Object.entries(cache) as Array<[CacheKey, CacheEntry]>;
  if (entries.length <= maxEntries) return;

  const toDelete = entries
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, entries.length - maxEntries)
    .map(([key]) => key);

  for (const key of toDelete) {
    delete cache[key];
  }

  onPrune?.(toDelete.length, entries.length);
}
