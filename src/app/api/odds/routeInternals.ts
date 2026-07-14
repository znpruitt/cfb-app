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
};

export const oddsCache: OddsCache = {
  entries: {},
};

export function __resetOddsRouteCacheForTests(): void {
  oddsCache.entries = {};
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

// The DEFAULT odds query the ordinary served UI uses (no bookmakers/markets/regions
// filters). A filtered request writes a DIFFERENT cache key, so freshness must be
// judged only against this canonical key — never the newest across all filtered
// variants (5th-review finding #2).
export const ODDS_DEFAULT_BOOKMAKERS = [
  'draftkings',
  'betmgm',
  'caesars',
  'fanduel',
  'espnbet',
  'pointsbet',
  'bet365',
];
export const ODDS_DEFAULT_MARKETS = ['h2h', 'spreads', 'totals'];
export const ODDS_DEFAULT_REGIONS = ['us'];

/** Cache-key fragment for a given filter set (season-independent). */
export function createOddsCacheKey(query: {
  bookmakers: string[];
  markets: string[];
  regions: string[];
}): string {
  const bookmakers = [...query.bookmakers].sort().join(',');
  const markets = [...query.markets].sort().join(',');
  const regions = [...query.regions].sort().join(',');
  return `bookmakers=${bookmakers}|markets=${markets}|regions=${regions}`;
}

/**
 * The season-scoped `odds-cache` key for the CANONICAL/DEFAULT odds request served
 * to ordinary users. Diagnostics read exactly this entry for freshness so a filtered
 * refresh cannot make the served snapshot look fresh.
 */
export function defaultOddsCacheKey(season: number): string {
  return `${season}:${createOddsCacheKey({
    bookmakers: ODDS_DEFAULT_BOOKMAKERS,
    markets: ODDS_DEFAULT_MARKETS,
    regions: ODDS_DEFAULT_REGIONS,
  })}`;
}
