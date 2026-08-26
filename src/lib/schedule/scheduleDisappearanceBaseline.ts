import { getAppState, type AppStateRecord } from '../server/appStateStore.ts';

type ScheduleStateReader = (scope: string, key: string) => Promise<AppStateRecord<unknown> | null>;

function hasPopulatedItems(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as { items?: unknown }).items) &&
      (value as { items: unknown[] }).items.length > 0
  );
}

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
 */
export async function loadScheduleDisappearanceFallback(params: {
  year: number;
  aggregateValue: unknown;
  readState?: ScheduleStateReader;
}): Promise<readonly unknown[]> {
  if (hasPopulatedItems(params.aggregateValue)) return [];

  const readState = params.readState ?? getAppState;
  let regular: AppStateRecord<unknown> | null;
  let postseason: AppStateRecord<unknown> | null;
  try {
    [regular, postseason] = await Promise.all([
      readState('schedule', `${params.year}-all-regular`),
      readState('schedule', `${params.year}-all-postseason`),
    ]);
  } catch {
    return [];
  }

  const regularItems = partitionItems(regular);
  const postseasonItems = partitionItems(postseason);
  if (regularItems === null || postseasonItems === null) return [];
  return [...regularItems, ...postseasonItems];
}
