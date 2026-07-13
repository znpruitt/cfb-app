/**
 * Server-authoritative applicable score partitions, derived CACHE-ONLY from the
 * schedule (PLATFORM-086A 7th review). Both the cache-only diagnostics feed and
 * the aggregate score-refresh endpoint resolve applicability through this ONE
 * module, so a manual/aggregate refresh never depends on a client supplying the
 * correct partition list (and never fires a doomed postseason request before
 * bowls exist). No provider call is made to determine applicability.
 */

import { getAppState } from './appStateStore.ts';
import type { CacheEntry as ScheduleCacheEntry } from '@/app/api/schedule/cache';
import type { CfbdSeasonType } from '../cfbd.ts';

function normalizeSeasonType(value: unknown): CfbdSeasonType {
  return value === 'postseason' ? 'postseason' : 'regular';
}

/**
 * Score season-types worth requesting for a refresh, derived from schedule items.
 * Regular is the baseline (also the safe default when nothing is cached, so a
 * refresh still does something); postseason is added ONLY once the schedule
 * carries postseason games — before then a postseason score request is a doomed
 * no-op that should be skipped. Applicability is never inferred from week number.
 */
export function deriveApplicableScoreSeasonTypes(
  items: ScheduleCacheEntry['items']
): CfbdSeasonType[] {
  let hasRegular = false;
  let hasPostseason = false;
  for (const item of items) {
    if (normalizeSeasonType(item.seasonType) === 'postseason') hasPostseason = true;
    else hasRegular = true;
    if (hasRegular && hasPostseason) break;
  }
  const types: CfbdSeasonType[] = [];
  if (hasRegular || !hasPostseason) types.push('regular');
  if (hasPostseason) types.push('postseason');
  return types;
}

/**
 * Cache-only applicable score partitions for `year`: reads the durable schedule
 * (`${year}-all-all`) and derives applicability WITHOUT any provider call. This
 * is the server-authoritative source of applicability for the aggregate score
 * refresh — a client need not (and must not have to) supply the partition list
 * correctly. Falls back to regular-only when no schedule is cached.
 */
export async function getApplicableScoreSeasonTypes(year: number): Promise<CfbdSeasonType[]> {
  const rec = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-all`);
  return deriveApplicableScoreSeasonTypes(rec?.value?.items ?? []);
}
