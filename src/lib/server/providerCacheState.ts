/**
 * Cache-only provider-data AVAILABILITY (PLATFORM-086A-ADMIN-TRUTHFULNESS-HOTFIX).
 *
 * Answers a single narrow question per dataset — "is there cached provider data
 * for this year?" — so the admin panel can distinguish "no PLATFORM-086A refresh
 * history yet" from "no data at all". It is deliberately CACHE-ONLY (never a
 * provider call) and does exactly ONE guarded durable read per dataset, all in
 * parallel, so it adds no per-dataset repeated reads.
 *
 *   available → durable cache holds content for this year
 *   absent    → read succeeded and found no content
 *   unknown   → the read failed; availability could not be proven safely
 *
 * `unknown` never asserts absence — an operator must not be told data is gone
 * because a durable read hiccupped.
 */

import type { CacheEntry as ScheduleCacheEntry } from '@/app/api/schedule/cache';
import { defaultOddsCacheKey } from '@/app/api/odds/routeInternals';
import type { CacheEntry as ScoresCacheEntry } from '@/lib/scores/cache';
import { getAppState, getAppStateEntries } from './appStateStore.ts';
import { listCachedGameStats } from '../gameStats/cache.ts';
import { usableGameStatsGameIds } from '../gameStats/coverage.ts';
import { PROVIDER_DATASETS, type ProviderDataset } from '../providerDatasets.ts';

export type ProviderCacheAvailability = 'available' | 'absent' | 'unknown';

export type ProviderCacheStates = Record<ProviderDataset, ProviderCacheAvailability>;

async function probe(fn: () => Promise<boolean>): Promise<ProviderCacheAvailability> {
  try {
    return (await fn()) ? 'available' : 'absent';
  } catch {
    return 'unknown';
  }
}

/**
 * Cache availability for every provider dataset for `year`. Each probe reads the
 * exact durable key the served UI / diagnostics read, and content — not bare key
 * presence — decides availability (an empty `items` / `weeks` / blank-identity
 * record is `absent`, matching the diagnostics "measure coverage, not presence"
 * rule).
 */
export async function getProviderCacheStates(year: number): Promise<ProviderCacheStates> {
  const [scores, schedule, odds, rankings, conferences, gameStats] = await Promise.all([
    probe(async () => {
      const entries = await getAppStateEntries<ScoresCacheEntry>('scores', `${year}-`);
      return entries.some((entry) => (entry.value.items?.length ?? 0) > 0);
    }),
    probe(async () => {
      const rec = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-all`);
      return (rec?.value?.items?.length ?? 0) > 0;
    }),
    probe(async () => {
      const rec = await getAppState<{ lastFetch?: number | null }>(
        'odds-cache',
        defaultOddsCacheKey(year)
      );
      return typeof rec?.value?.lastFetch === 'number' && Number.isFinite(rec.value.lastFetch);
    }),
    probe(async () => {
      const rec = await getAppState<{ response?: { weeks?: unknown[] } }>('rankings', String(year));
      const weeks = rec?.value?.response?.weeks;
      return Array.isArray(weeks) && weeks.length > 0;
    }),
    probe(async () => {
      const rec = await getAppState<{ items?: unknown[] }>('conferences', 'snapshot');
      return (rec?.value?.items?.length ?? 0) > 0;
    }),
    probe(async () => {
      for (const record of await listCachedGameStats(year)) {
        if (usableGameStatsGameIds(record).size > 0) return true;
      }
      return false;
    }),
  ]);

  return {
    scores,
    schedule,
    odds,
    rankings,
    conferences,
    'game-stats': gameStats,
  };
}

/** A conservative all-`unknown` map, used when the availability pass itself fails. */
export function unknownProviderCacheStates(): ProviderCacheStates {
  return PROVIDER_DATASETS.reduce((acc, dataset) => {
    acc[dataset] = 'unknown';
    return acc;
  }, {} as ProviderCacheStates);
}
