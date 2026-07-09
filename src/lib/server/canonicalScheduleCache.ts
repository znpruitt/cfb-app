import type { AppGame, ScheduleWireItem } from '../schedule.ts';
import { getAppState } from './appStateStore.ts';

type ScheduleCacheEntry = { items?: ScheduleWireItem[] };

/**
 * In-process, cache-only read of the canonical schedule wire items for a season.
 *
 * Reads the durable `schedule` app-state cache that the `/api/schedule` route
 * (and admin refresh) writes under `${year}-all-all` (or the `regular` +
 * `postseason` pair). This NEVER triggers an upstream CFBD fetch, so it is
 * quota-safe on public/anonymous paths (PLATFORM-075) — server-side callers use
 * it instead of self-fetching `/api/schedule`. It is the single source the
 * canonical standings selector and Insights share, so both build the same
 * canonical games from the same inputs.
 */
export async function loadCachedScheduleItems(year: number): Promise<ScheduleWireItem[]> {
  const combined = await getAppState<ScheduleCacheEntry>('schedule', `${year}-all-all`);
  if (combined?.value?.items && combined.value.items.length > 0) {
    return combined.value.items;
  }
  const [regular, postseason] = await Promise.all([
    getAppState<ScheduleCacheEntry>('schedule', `${year}-all-regular`),
    getAppState<ScheduleCacheEntry>('schedule', `${year}-all-postseason`),
  ]);
  return [...(regular?.value?.items ?? []), ...(postseason?.value?.items ?? [])];
}

/**
 * Postseason/manual game overrides (`postseason-overrides:${slug}:${year}`) fed
 * into `buildScheduleFromApi` so canonical games match production standings.
 */
export async function loadPostseasonOverrides(
  slug: string,
  year: number
): Promise<Record<string, Partial<AppGame>>> {
  const record = await getAppState<Record<string, Partial<AppGame>>>(
    `postseason-overrides:${slug}:${year}`,
    'map'
  );
  const value = record?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}
