import type { OddsUsageSnapshot } from '../../../lib/api/oddsUsage.ts';
import type { OddsBookmaker } from '../../../lib/odds.ts';
import { seasonYearForToday } from '../../../lib/scores/normalizers.ts';

type UpstreamOddsOutcome = { name?: string; price?: number; point?: number };
type UpstreamOddsMarket = { key?: string; outcomes?: UpstreamOddsOutcome[] };
type UpstreamOddsBookmaker = { key?: string; title?: string; markets?: UpstreamOddsMarket[] };
export type UpstreamOddsEvent = {
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: UpstreamOddsBookmaker[];
};

export type NormalizedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  bookmakers: OddsBookmaker[];
};

/**
 * Normalize a raw Odds API event into the canonical attachment shape. Carries
 * `commence_time` through as `commenceTime` so the attachment layer can
 * disambiguate repeated meetings of the same team pair by date.
 */
export function normalizeUpstreamOddsEvent(event: UpstreamOddsEvent): NormalizedOddsEvent | null {
  const homeTeam = event.home_team?.trim() ?? '';
  const awayTeam = event.away_team?.trim() ?? '';
  if (!homeTeam || !awayTeam) return null;

  const commenceTime = event.commence_time?.trim() || null;

  const bookmakers: OddsBookmaker[] = (event.bookmakers ?? []).map((book) => ({
    key: book.key,
    title: book.title,
    markets: (book.markets ?? []).map((market) => ({
      key: market.key,
      outcomes: (market.outcomes ?? []).map((outcome) => ({
        name: outcome.name,
        price: outcome.price,
        point: outcome.point,
      })),
    })),
  }));

  return { homeTeam, awayTeam, commenceTime, bookmakers };
}

export type SharedOddsCacheEntry = {
  data: NormalizedOddsEvent[];
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
