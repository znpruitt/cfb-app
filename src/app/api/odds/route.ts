export const revalidate = 120;

type OddsOutcome = { name?: string; price?: number; point?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; markets?: OddsMarket[] };
type OddsEvent = { home_team?: string; away_team?: string; bookmakers?: OddsBookmaker[] };

interface OddsMeta {
  source: 'odds-api';
  cache: 'hit' | 'miss';
  fallbackUsed: boolean;
  generatedAt: string;
}

interface OddsResponse {
  items: OddsEvent[];
  meta: OddsMeta;
}

const ODDS_API = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';
const BOOKMAKERS = ['draftkings', 'betmgm', 'caesars', 'fanduel', 'espnbet', 'pointsbet', 'bet365'];
const MARKETS = ['h2h', 'spreads', 'totals'];
const REGIONS = ['us'];

type OddsCache = {
  entries: Record<string, { data: OddsEvent[]; lastFetch: number }>;
  dayKey: string | null;
  callsToday: number;
};

function responseFrom(items: OddsEvent[], meta: OddsMeta, status = 200): Response {
  return new Response(JSON.stringify({ items, meta } satisfies OddsResponse), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const oddsCache: OddsCache = {
  entries: {},
  dayKey: null,
  callsToday: 0,
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
      oddsCache.callsToday = 0;
    }

    const maxPerDay = 16;
    const stale = Date.now() - oddsCache.lastFetch > 24 * 60 * 60 * 1000;
    let fetchedFromUpstream = false;
    const cacheKey = createCacheKey(query);
    const cachedEntry = oddsCache.entries[cacheKey];
    const stale = !cachedEntry || Date.now() - cachedEntry.lastFetch > 24 * 60 * 60 * 1000;

    if (!cachedEntry || stale) {
      if (oddsCache.callsToday >= maxPerDay) {
        if (!cachedEntry) {
          return new Response(
            JSON.stringify({ error: 'Daily odds limit reached and no cache available' }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      } else {
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
        url.searchParams.set('bookmakers', BOOKMAKERS.join(','));
        url.searchParams.set('markets', MARKETS.join(','));
        url.searchParams.set('apiKey', oddsApiKey);
        url.searchParams.set('bookmakers', query.bookmakers.join(','));
        url.searchParams.set('markets', query.markets.join(','));
        url.searchParams.set('apiKey', process.env.ODDS_API_KEY || '');

        const r = await fetch(url.toString(), { next: { revalidate } });
        if (!r.ok) {
          return new Response(JSON.stringify({ error: 'upstream error', status: r.status }), {
            status: r.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const data = (await r.json()) as OddsEvent[];
        oddsCache.entries[cacheKey] = {
          data: Array.isArray(data) ? data : [],
          lastFetch: Date.now(),
        };
        oddsCache.callsToday += 1;
        fetchedFromUpstream = true;
      }
    }

    return responseFrom(oddsCache.data ?? [], {
      source: 'odds-api',
      cache: fetchedFromUpstream ? 'miss' : 'hit',
      fallbackUsed: false,
      generatedAt: new Date(oddsCache.lastFetch || Date.now()).toISOString(),
    return new Response(JSON.stringify(oddsCache.entries[cacheKey]?.data ?? []), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
