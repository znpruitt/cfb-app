import type { ScheduleItem, SeasonType } from '@/lib/schedule/cfbdSchedule';

export type CacheEntry = {
  at: number;
  items: ScheduleItem[];
  partialFailure: boolean;
  failedSeasonTypes: SeasonType[];
};

export const SCHEDULE_ROUTE_CACHE: Record<string, CacheEntry> = {};

export function resetScheduleRouteCacheForTests(): void {
  for (const key of Object.keys(SCHEDULE_ROUTE_CACHE)) {
    delete SCHEDULE_ROUTE_CACHE[key];
  }
}
