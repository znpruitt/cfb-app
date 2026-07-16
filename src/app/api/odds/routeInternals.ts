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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'number';
}

/**
 * STRUCTURAL validation of one raw upstream odds row (PLATFORM-086G2 P2
 * remediation #2, tightened by the nested-schema remediation). Downstream code
 * dereferences the row well past normalization: `normalizeUpstreamOddsEvent`
 * maps the nested collections verbatim, and the attachment/selection layer
 * calls string methods on the copied scalars (`pickPreferredBook` lowercases
 * `bookmakers[].key`; market selection lowercases `markets[].key`; totals
 * selection lowercases `outcomes[].name`; snapshot building trims `title`) and
 * does arithmetic on `outcomes[].price`/`point`. A row like `null`,
 * `{ home_team: 5 }`, `{ bookmakers: {} }`, or `{ bookmakers: [{ key: 5 }] }`
 * would otherwise either THROW mid-request (a generic 500 instead of the
 * stable `odds-schema-drift` classification) or — worse — be durably COMMITTED
 * as a successful refresh and poison later reads. This predicate therefore
 * validates every nested scalar those layers treat as a string or number.
 * MISSING fields stay valid — semantic gaps (e.g. no team names) are
 * normalization's concern and classify separately as usable/unusable rows.
 */
export function isStructurallyValidUpstreamOddsEvent(row: unknown): row is UpstreamOddsEvent {
  if (!isPlainObject(row)) return false;
  if (
    !isOptionalString(row.home_team) ||
    !isOptionalString(row.away_team) ||
    !isOptionalString(row.commence_time)
  ) {
    return false;
  }
  const bookmakers = row.bookmakers;
  if (bookmakers === undefined || bookmakers === null) return true;
  if (!Array.isArray(bookmakers)) return false;
  for (const book of bookmakers) {
    if (!isPlainObject(book)) return false;
    if (!isOptionalString(book.key) || !isOptionalString(book.title)) return false;
    const markets = book.markets;
    if (markets === undefined || markets === null) continue;
    if (!Array.isArray(markets)) return false;
    for (const market of markets) {
      if (!isPlainObject(market)) return false;
      if (!isOptionalString(market.key)) return false;
      const outcomes = market.outcomes;
      if (outcomes === undefined || outcomes === null) continue;
      if (!Array.isArray(outcomes)) return false;
      for (const outcome of outcomes) {
        if (!isPlainObject(outcome)) return false;
        if (
          !isOptionalString(outcome.name) ||
          !isOptionalNumber(outcome.price) ||
          !isOptionalNumber(outcome.point)
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

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

// ---------------------------------------------------------------------------
// Per-target odds commit serialization (PLATFORM-086G2 P2 remediation #1).
//
// An empty-payload refresh must read its prior-entry evidence and perform its
// conditional cold-target write ATOMICALLY with respect to a concurrent
// nonempty refresh's commit for the same season-scoped target — otherwise the
// empty branch can observe "no prior entry", lose the race to a populated
// commit, and then overwrite both caches with `[]` while refresh status keeps
// reporting the populated success. Same promise-chain mutex shape as
// `withScopeLock` in providerRefreshStatus; in-process only (cross-instance
// ordering remains the documented 086A best-effort limitation — the durable
// layer's atomic rename prevents torn writes, not stale ones).
// ---------------------------------------------------------------------------
const oddsTargetLocks = new Map<string, Promise<unknown>>();

export function withOddsTargetLock<T>(seasonScopedKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = oddsTargetLocks.get(seasonScopedKey) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  oddsTargetLocks.set(
    seasonScopedKey,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
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
