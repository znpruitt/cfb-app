import { fetchUpstreamResponse, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import type { OddsUsageSnapshot } from '@/lib/api/oddsUsage';
import {
  captureOddsUsageSnapshot,
  getLatestKnownOddsUsage,
  setLatestKnownOddsUsage,
} from '@/lib/server/oddsUsageStore';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';

export const revalidate = 120;

type UpstreamOddsOutcome = { name?: string; price?: number; point?: number };
type UpstreamOddsMarket = { key?: string; outcomes?: UpstreamOddsOutcome[] };
type UpstreamOddsBookmaker = { key?: string; title?: string; markets?: UpstreamOddsMarket[] };
type UpstreamOddsEvent = {
  home_team?: string;
  away_team?: string;
  bookmakers?: UpstreamOddsBookmaker[];
};

type OddsOutcome = { name?: string; price?: number; point?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; title?: string; markets?: OddsMarket[] };
type OddsEvent = { homeTeam: string; awayTeam: string; bookmakers: OddsBookmaker[] };

interface OddsMeta {
  source: 'odds-api';
  cache: 'hit' | 'miss';
  fallbackUsed: boolean;
  generatedAt: string;
  usage: OddsUsageSnapshot | null;
}

interface OddsResponse {
  items: OddsEvent[];
  meta: OddsMeta;
}

const ODDS_API = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';
const BOOKMAKERS = ['draftkings', 'betmgm', 'caesars', 'fanduel', 'espnbet', 'pointsbet', 'bet365'];
const MARKETS = ['h2h', 'spreads', 'totals'];
const REGIONS = ['us'];

const ODDS_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 2_500,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
const ODDS_PACING_POLICY = {
  key: 'odds-api',
  minIntervalMs: 200,
} as const;

type OddsCache = {
  entries: Record<
    string,
    { data: OddsEvent[]; lastFetch: number; usage: OddsUsageSnapshot | null }
  >;
  dayKey: string | null;
};

function responseFrom(items: OddsEvent[], meta: OddsMeta, status = 200): Response {
  return new Response(JSON.stringify({ items, meta } satisfies OddsResponse), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeUpstreamOddsEvent(event: UpstreamOddsEvent): OddsEvent | null {
  const homeTeam = event.home_team?.trim() ?? '';
  const awayTeam = event.away_team?.trim() ?? '';
  if (!homeTeam || !awayTeam) return null;

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

  return { homeTeam, awayTeam, bookmakers };
}

const oddsCache: OddsCache = {
  entries: {},
  dayKey: null,
};

function createCacheKey(query: {
  bookmakers: string[];
  markets: string[];
  regions: string[];
}): string {
  const bookmakers = [...query.bookmakers].sort().join(',');
  const markets = [...query.markets].sort().join(',');
  const regions = [...query.regions].sort().join(',');
  return `bookmakers=${bookmakers}|markets=${markets}|regions=${regions}`;
}

function dayKeyUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

type QueryValidationResult =
  | {
      ok: true;
      bookmakers: string[];
      markets: string[];
      regions: string[];
    }
  | {
      ok: false;
      field: 'bookmakers' | 'markets' | 'regions';
      value: string | null;
      error: string;
    };

function parseCsvList(raw: string | null): string[] | null {
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

function validateOptionalCsvParam(
  field: 'bookmakers' | 'markets' | 'regions',
  raw: string | null,
  allowed: readonly string[]
): QueryValidationResult | null {
  if (raw === null) return null;
  const values = parseCsvList(raw);
  if (!values) {
    return {
      ok: false,
      field,
      value: raw,
      error: `${field} must be a comma-separated list`,
    };
  }
  const invalid = values.find((v) => !allowed.includes(v));
  if (invalid) {
    return {
      ok: false,
      field,
      value: raw,
      error: `${field} contains unsupported value "${invalid}"`,
    };
  }

  return {
    ok: true,
    bookmakers: field === 'bookmakers' ? values : BOOKMAKERS,
    markets: field === 'markets' ? values : MARKETS,
    regions: field === 'regions' ? values : REGIONS,
  };
}

function validateQuery(url: URL): QueryValidationResult {
  let bookmakers = BOOKMAKERS;
  let markets = MARKETS;
  let regions = REGIONS;

  const validators: Array<QueryValidationResult | null> = [
    validateOptionalCsvParam('bookmakers', url.searchParams.get('bookmakers'), BOOKMAKERS),
    validateOptionalCsvParam('markets', url.searchParams.get('markets'), MARKETS),
    validateOptionalCsvParam('regions', url.searchParams.get('regions'), REGIONS),
  ];

  for (const result of validators) {
    if (!result) continue;
    if (!result.ok) return result;
    bookmakers = result.bookmakers;
    markets = result.markets;
    regions = result.regions;
  }

  return { ok: true, bookmakers, markets, regions };
}

export async function GET(req: Request): Promise<Response> {
  recordRouteRequest('odds');
  try {
    const query = validateQuery(new URL(req.url));
    if (!query.ok) {
      return new Response(
        JSON.stringify({ error: query.error, field: query.field, value: query.value }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const dayKey = dayKeyUTC();
    if (oddsCache.dayKey !== dayKey) {
      oddsCache.dayKey = dayKey;
    }

    const cacheKey = createCacheKey(query);
    const cachedEntry = oddsCache.entries[cacheKey];
    const stale = !cachedEntry || Date.now() - cachedEntry.lastFetch > 30 * 60 * 1000;
    let fetchedFromUpstream = false;

    if (!cachedEntry || stale) {
      recordRouteCacheMiss('odds');
      {
        const oddsApiKey = process.env.ODDS_API_KEY?.trim();
        if (!oddsApiKey) {
          return new Response(JSON.stringify({ error: 'ODDS_API_KEY missing' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const url = new URL(ODDS_API);
        url.searchParams.set('regions', query.regions.join(','));
        url.searchParams.set('oddsFormat', 'american');
        url.searchParams.set('dateFormat', 'iso');
        url.searchParams.set('bookmakers', query.bookmakers.join(','));
        url.searchParams.set('markets', query.markets.join(','));
        url.searchParams.set('apiKey', oddsApiKey);

        const upstreamRes = await fetchUpstreamResponse(url.toString(), {
          cache: 'no-store',
          timeoutMs: 12_000,
          retry: ODDS_RETRY_POLICY,
          pacing: ODDS_PACING_POLICY,
          throwOnHttpError: false,
        });
        if (!upstreamRes.ok) {
          const usage = await captureOddsUsageSnapshot(upstreamRes.headers, {
            sportKey: 'americanfootball_ncaaf',
            markets: query.markets,
            regions: query.regions,
            endpointType: 'odds',
            cacheStatus: 'miss',
          });

          if (
            (upstreamRes.status === 402 || upstreamRes.status === 429) &&
            (!usage || usage.remaining > 0)
          ) {
            await setLatestKnownOddsUsage({
              used: usage?.limit ?? 500,
              remaining: 0,
              lastCost: usage?.lastCost ?? 0,
              limit: usage?.limit ?? 500,
              capturedAt: new Date().toISOString(),
              source: 'quota-error-fallback',
              sportKey: 'americanfootball_ncaaf',
              markets: query.markets,
              regions: query.regions,
              endpointType: 'odds',
              cacheStatus: 'miss',
            });
          }

          const responseBody = await upstreamRes.text().catch(() => '');
          throw new UpstreamFetchError({
            kind: 'http',
            message: `Upstream request failed with status ${upstreamRes.status}${upstreamRes.statusText ? ` (${upstreamRes.statusText})` : ''}`,
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            url: url.toString(),
            responseBody,
          });
        }

        const upstreamData = (await upstreamRes.json()) as UpstreamOddsEvent[];
        const usage = await captureOddsUsageSnapshot(upstreamRes.headers, {
          sportKey: 'americanfootball_ncaaf',
          markets: query.markets,
          regions: query.regions,
          endpointType: 'odds',
          cacheStatus: 'miss',
        });

        oddsCache.entries[cacheKey] = {
          // API route boundary: provider quirks are normalized here for app consumption.
          data: Array.isArray(upstreamData)
            ? upstreamData
                .map(normalizeUpstreamOddsEvent)
                .filter((event): event is OddsEvent => Boolean(event))
            : [],
          lastFetch: Date.now(),
          usage,
        };
        fetchedFromUpstream = true;
      }
    }

    if (cachedEntry && !stale) {
      recordRouteCacheHit('odds');
    }

    const responseEntry = oddsCache.entries[cacheKey] ?? cachedEntry;
    const lastFetchAt = responseEntry?.lastFetch ?? Date.now();

    return responseFrom(responseEntry?.data ?? [], {
      source: 'odds-api',
      cache: fetchedFromUpstream ? 'miss' : 'hit',
      fallbackUsed: false,
      generatedAt: new Date(lastFetchAt).toISOString(),
      usage: responseEntry?.usage ?? (await getLatestKnownOddsUsage()),
    });
  } catch (e) {
    if (e instanceof UpstreamFetchError) {
      return new Response(JSON.stringify({ error: 'upstream error', detail: e.details }), {
        status: e.details.status ?? 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const msg = e instanceof Error ? e.message : 'internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
