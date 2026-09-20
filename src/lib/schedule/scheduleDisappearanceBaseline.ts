import { getAppState, type AppStateRecord } from '../server/appStateStore.ts';
import {
  CANONICAL_SCHEDULE_SCOPE,
  canonicalScheduleAggregateServes,
  canonicalSchedulePartitionKeys,
} from '../server/canonicalScheduleCache.ts';

type ScheduleStateReader = (scope: string, key: string) => Promise<AppStateRecord<unknown> | null>;

function partitionItems(record: AppStateRecord<unknown> | null): readonly unknown[] | null {
  if (record === null || record.value == null) return [];
  if (typeof record.value !== 'object' || Array.isArray(record.value)) return null;
  const items = (record.value as { items?: unknown }).items;
  return Array.isArray(items) ? items : null;
}

/**
 * Capture the partition-only schedule that canonical readers currently serve when
 * the aggregate is absent/empty. The snapshot is taken before provider work; its
 * stored `at` value is deliberately irrelevant, so a caller reusing an older clock
 * instant across several years cannot suppress a valid baseline.
 *
 * Any malformed/read-failed partition makes this observability-only fallback
 * unavailable as a whole. Canonical commit behavior is never blocked.
 *
 * PLATFORM-663: the aggregate-serves predicate and the two partition key strings
 * now come from `canonicalScheduleCache` — this file was the third independent
 * copy of both. It deliberately does NOT call `loadCachedScheduleItems`, for two
 * reasons that are behavioural, not stylistic:
 *   - it must not re-read the aggregate. The caller passes a value already read
 *     in snapshot order, and fallback eligibility comes from that order — never
 *     from a fresh read that could race the commit it is the baseline for.
 *   - its validity policy is STRICTER on purpose. `loadCachedScheduleItems`
 *     treats a malformed partition as empty and returns the other one's rows;
 *     here a partial baseline would UNDERSTATE the prior set, and this value
 *     feeds the games-vanished detector — so a partial read would manufacture a
 *     disappearance. Unavailable-as-a-whole is the safe answer, and it is why
 *     the shared reader is the wrong shape for this one caller.
 */
export async function loadScheduleDisappearanceFallback(params: {
  year: number;
  aggregateValue: unknown;
  readState?: ScheduleStateReader;
}): Promise<readonly unknown[]> {
  if (canonicalScheduleAggregateServes(params.aggregateValue)) return [];

  const readState = params.readState ?? getAppState;
  const [regularKey, postseasonKey] = canonicalSchedulePartitionKeys(params.year);
  let regular: AppStateRecord<unknown> | null;
  let postseason: AppStateRecord<unknown> | null;
  try {
    [regular, postseason] = await Promise.all([
      readState(CANONICAL_SCHEDULE_SCOPE, regularKey),
      readState(CANONICAL_SCHEDULE_SCOPE, postseasonKey),
    ]);
  } catch {
    return [];
  }

  const regularItems = partitionItems(regular);
  const postseasonItems = partitionItems(postseason);
  if (regularItems === null || postseasonItems === null) return [];
  return [...regularItems, ...postseasonItems];
}
