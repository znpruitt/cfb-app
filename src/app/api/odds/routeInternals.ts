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

/**
 * Pick the freshest of two odds cache fallback entries by `lastFetch`. Used on
 * the quota-suppressed path so a stale in-memory entry never shadows a newer
 * durable entry written by another refresh or instance. Ties keep `a`.
 */
export function pickFreshestOddsFallback(
  a: SharedOddsCacheEntry | undefined,
  b: SharedOddsCacheEntry | undefined
): SharedOddsCacheEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.lastFetch > a.lastFetch ? b : a;
}

export function resolveDefaultSeason(now = new Date()): number {
  const envSeason = Number(process.env.NEXT_PUBLIC_SEASON);
  return Number.isInteger(envSeason) && envSeason > 0 ? envSeason : seasonYearForToday(now);
}
