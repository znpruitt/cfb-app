import type { OddsUsageSnapshot } from '../../../lib/api/oddsUsage.ts';
import type { OddsBookmaker } from '../../../lib/odds.ts';
import { seasonYearForToday } from '../../../lib/scores/normalizers.ts';

export type SharedOddsCacheEntry = {
  data: {
    homeTeam: string;
    awayTeam: string;
    bookmakers: OddsBookmaker[];
  }[];
  lastFetch: number;
  usage: OddsUsageSnapshot | null;
};

type OddsCache = {
  entries: Record<string, SharedOddsCacheEntry>;
  dayKey: string | null;
};

export const oddsCache: OddsCache = {
  entries: {},
  dayKey: null,
};

export function __resetOddsRouteCacheForTests(): void {
  oddsCache.entries = {};
  oddsCache.dayKey = null;
}

export function resolveDefaultSeason(now = new Date()): number {
  const envSeason = Number(process.env.NEXT_PUBLIC_SEASON);
  return Number.isInteger(envSeason) && envSeason > 0 ? envSeason : seasonYearForToday(now);
}
