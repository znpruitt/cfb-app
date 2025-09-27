type OddsOutcome = { name?: string; price?: number; point?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; markets?: OddsMarket[] };
type OddsEvent = { home_team?: string; away_team?: string; bookmakers?: OddsBookmaker[] };

const ODDS_API = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';
const BOOKMAKERS = ['draftkings', 'betmgm', 'caesars', 'fanduel', 'espnbet', 'pointsbet', 'bet365'];
const MARKETS = ['h2h', 'spreads', 'totals'];

type OddsCache = {
  data: OddsEvent[] | null;
  lastFetch: number;
  dayKey: string | null;
  callsToday: number;
};

const oddsCache: OddsCache = {
  data: null,
  lastFetch: 0,
  dayKey: null,
  callsToday: 0,
};

function dayKeyUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export async function GET(): Promise<Response> {
  try {
    const dayKey = dayKeyUTC();
    if (oddsCache.dayKey !== dayKey) {
      oddsCache.dayKey = dayKey;
      oddsCache.callsToday = 0;
    }

    const maxPerDay = 16;
    const stale = Date.now() - oddsCache.lastFetch > 24 * 60 * 60 * 1000;

    if (!oddsCache.data || stale) {
      if (oddsCache.callsToday >= maxPerDay) {
        if (!oddsCache.data) {
          return new Response(
            JSON.stringify({ error: 'Daily odds limit reached and no cache available' }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      } else {
        const url = new URL(ODDS_API);
        url.searchParams.set('regions', 'us');
        url.searchParams.set('oddsFormat', 'american');
        url.searchParams.set('dateFormat', 'iso');
        url.searchParams.set('bookmakers', BOOKMAKERS.join(','));
        url.searchParams.set('markets', MARKETS.join(','));
        url.searchParams.set('apiKey', process.env.ODDS_API_KEY || '');

        const r = await fetch(url.toString(), { cache: 'no-store' });
        if (!r.ok) {
          return new Response(JSON.stringify({ error: 'upstream error', status: r.status }), {
            status: r.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const data = (await r.json()) as OddsEvent[];
        oddsCache.data = Array.isArray(data) ? data : [];
        oddsCache.lastFetch = Date.now();
        oddsCache.callsToday += 1;
      }
    }

    return new Response(JSON.stringify(oddsCache.data ?? []), {
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
