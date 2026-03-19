import { promises as fs } from 'node:fs';
import path from 'node:path';

import { fetchUpstreamResponse, UpstreamFetchError } from '../../../lib/api/fetchUpstream.ts';
import type { OddsUsageSnapshot } from '../../../lib/api/oddsUsage.ts';
import {
  applyPregameOddsSnapshot,
  buildDurableOddsSnapshot,
  freezeClosingSnapshotIfNeeded,
  reopenClosingSnapshotForDelayedKickoffIfNeeded,
  pickPreferredBook,
  selectOddsForGame,
  type CanonicalOddsItem,
  type DurableOddsRecord,
  type OddsBookmaker,
} from '../../../lib/odds.ts';
import { attachOddsEventsToSchedule } from '../../../lib/oddsAttachment.ts';
import { buildScheduleFromApi, type ScheduleWireItem } from '../../../lib/schedule.ts';
import type { CfbdConferenceRecord } from '../../../lib/conferenceSubdivision.ts';
import { updateDurableOddsStore } from '../../../lib/server/durableOddsStore.ts';
import {
  captureOddsUsageSnapshot,
  getLatestKnownOddsUsage,
  setLatestKnownOddsUsage,
} from '../../../lib/server/oddsUsageStore.ts';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '../../../lib/server/apiUsageBudget.ts';
import { seasonYearForToday } from '../../../lib/scores/normalizers.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../../../lib/teamIdentity.ts';
import { SEED_ALIASES, type AliasMap } from '../../../lib/teamNames.ts';

export const revalidate = 120;

type UpstreamOddsOutcome = { name?: string; price?: number; point?: number };
type UpstreamOddsMarket = { key?: string; outcomes?: UpstreamOddsOutcome[] };
type UpstreamOddsBookmaker = { key?: string; title?: string; markets?: UpstreamOddsMarket[] };
type UpstreamOddsEvent = {
  home_team?: string;
  away_team?: string;
  bookmakers?: UpstreamOddsBookmaker[];
};

type NormalizedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  bookmakers: OddsBookmaker[];
};

type PreparedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  book: OddsBookmaker | undefined;
};

type OddsMeta = {
  source: 'odds-api';
  cache: 'hit' | 'miss';
  fallbackUsed: boolean;
  generatedAt: string;
  usage: OddsUsageSnapshot | null;
  season: number;
};

type OddsResponse = {
  items: CanonicalOddsItem[];
  meta: OddsMeta;
};

const ODDS_API = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';
const BOOKMAKERS = ['draftkings', 'betmgm', 'caesars', 'fanduel', 'espnbet', 'pointsbet', 'bet365'];
const MARKETS = ['h2h', 'spreads', 'totals'];
const REGIONS = ['us'];
export function resolveDefaultSeason(now = new Date()): number {
  const envSeason = Number(process.env.NEXT_PUBLIC_SEASON);
  return Number.isInteger(envSeason) && envSeason > 0 ? envSeason : seasonYearForToday(now);
}

const ODDS_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 2500,
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
    { data: NormalizedOddsEvent[]; lastFetch: number; usage: OddsUsageSnapshot | null }
  >;
  dayKey: string | null;
};

type ParsedOddsQuery = {
  bookmakers: string[];
  markets: string[];
  regions: string[];
  season: number;
};

type QueryValidationError = {
  ok: false;
  field: 'bookmakers' | 'markets' | 'regions' | 'year';
  value: string | null;
  error: string;
};

type QueryValidationResult = { ok: true; query: ParsedOddsQuery } | QueryValidationError;
type ParsedCsvParamResult = { ok: true; values: string[] } | QueryValidationError;
type ParsedSeasonResult = { ok: true; season: number } | QueryValidationError;

const oddsCache: OddsCache = {
  entries: {},
  dayKey: null,
};

export function __resetOddsRouteCacheForTests(): void {
  oddsCache.entries = {};
  oddsCache.dayKey = null;
}

function responseFrom(items: CanonicalOddsItem[], meta: OddsMeta, status = 200): Response {
  return new Response(JSON.stringify({ items, meta } satisfies OddsResponse), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeUpstreamOddsEvent(event: UpstreamOddsEvent): NormalizedOddsEvent | null {
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

function parseCsvList(raw: string | null): string[] | null {
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

function parseValidatedCsvParam(
  field: 'bookmakers' | 'markets' | 'regions',
  raw: string | null,
  allowed: readonly string[],
  fallback: string[]
): ParsedCsvParamResult {
  if (raw === null) {
    return { ok: true, values: fallback };
  }

  const values = parseCsvList(raw);
  if (!values) {
    return {
      ok: false,
      field,
      value: raw,
      error: `${field} must be a comma-separated list`,
    };
  }

  const invalid = values.find((value) => !allowed.includes(value));
  if (invalid) {
    return {
      ok: false,
      field,
      value: raw,
      error: `${field} contains unsupported value "${invalid}"`,
    };
  }

  return { ok: true, values };
}

function parseRequestedSeason(raw: string | null): ParsedSeasonResult {
  if (raw === null) {
    return { ok: true, season: resolveDefaultSeason() };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 3000) {
    return {
      ok: false,
      field: 'year',
      value: raw,
      error: 'year must be a valid YYYY season',
    };
  }

  return { ok: true, season: parsed };
}

function parseOddsQuery(url: URL): QueryValidationResult {
  const seasonResult = parseRequestedSeason(url.searchParams.get('year'));
  if (!seasonResult.ok) return seasonResult;

  const bookmakersResult = parseValidatedCsvParam(
    'bookmakers',
    url.searchParams.get('bookmakers'),
    BOOKMAKERS,
    BOOKMAKERS
  );
  if (!bookmakersResult.ok) return bookmakersResult;

  const marketsResult = parseValidatedCsvParam(
    'markets',
    url.searchParams.get('markets'),
    MARKETS,
    MARKETS
  );
  if (!marketsResult.ok) return marketsResult;

  const regionsResult = parseValidatedCsvParam(
    'regions',
    url.searchParams.get('regions'),
    REGIONS,
    REGIONS
  );
  if (!regionsResult.ok) return regionsResult;

  return {
    ok: true,
    query: {
      season: seasonResult.season,
      bookmakers: bookmakersResult.values,
      markets: marketsResult.values,
      regions: regionsResult.values,
    },
  };
}

async function readConferenceRecords(req: Request): Promise<CfbdConferenceRecord[]> {
  const reqUrl = new URL(req.url);
  const conferencesUrl = new URL('/api/conferences', reqUrl.origin);
  const response = await fetch(conferencesUrl.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`conferences ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { items?: CfbdConferenceRecord[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

async function readTeamsCatalog(): Promise<TeamCatalogItem[]> {
  const raw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const parsed = JSON.parse(raw) as { items?: TeamCatalogItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

async function readAliasesForSeason(season: number): Promise<AliasMap> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), 'data', `aliases-${season}.json`),
      'utf8'
    );
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...SEED_ALIASES };
    }

    const aliases: AliasMap = { ...SEED_ALIASES };
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string') {
        aliases[key] = value;
      }
    }
    return aliases;
  } catch {
    return { ...SEED_ALIASES };
  }
}

async function fetchCanonicalSchedule(req: Request, season: number): Promise<ScheduleWireItem[]> {
  const reqUrl = new URL(req.url);
  const scheduleUrl = new URL(`/api/schedule?year=${season}`, reqUrl.origin);
  const response = await fetch(scheduleUrl.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`schedule ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { items?: ScheduleWireItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

function emptyRecord(canonicalGameId: string): DurableOddsRecord {
  return {
    canonicalGameId,
    latestSnapshot: null,
    closingSnapshot: null,
    closingFrozenAt: null,
  };
}

function hasStoredOddsData(record: DurableOddsRecord): boolean {
  return Boolean(record.latestSnapshot || record.closingSnapshot || record.closingFrozenAt);
}

async function buildCanonicalOddsItems(params: {
  season: number;
  scheduleItems: ScheduleWireItem[];
  oddsEvents: NormalizedOddsEvent[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  conferenceRecords: CfbdConferenceRecord[];
  requestTime: string;
  snapshotCapturedAt: string;
}): Promise<CanonicalOddsItem[]> {
  const {
    season,
    scheduleItems,
    oddsEvents,
    teams,
    aliasMap,
    conferenceRecords,
    requestTime,
    snapshotCapturedAt,
  } = params;
  const builtSchedule = buildScheduleFromApi({
    scheduleItems,
    teams,
    aliasMap,
    season,
    conferenceRecords,
  });
  const games = builtSchedule.games;

  const observedNames = Array.from(
    new Set(
      [
        ...games.flatMap((game) => [game.canHome, game.canAway]),
        ...oddsEvents.flatMap((event) => [event.homeTeam, event.awayTeam]),
      ].filter(Boolean)
    )
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });

  const preparedEvents: PreparedOddsEvent[] = oddsEvents.map((event) => ({
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    book: pickPreferredBook(event),
  }));

  const attached = attachOddsEventsToSchedule({
    games,
    events: preparedEvents,
    resolver,
  });

  const gameByKey = new Map(games.map((game) => [game.key, game]));

  const nextStore = await updateDurableOddsStore(season, (currentStore) => {
    const nextStore: Record<string, DurableOddsRecord> = { ...currentStore };

    const assignRecord = (gameKey: string, nextRecord: DurableOddsRecord): void => {
      const prevSerialized = JSON.stringify(nextStore[gameKey] ?? null);
      const hasData = hasStoredOddsData(nextRecord);
      const nextSerialized = JSON.stringify(hasData ? nextRecord : null);
      if (prevSerialized === nextSerialized) return;

      if (hasData) {
        nextStore[gameKey] = nextRecord;
      } else {
        delete nextStore[gameKey];
      }
    };

    for (const game of games) {
      const currentRecord = nextStore[game.key] ?? emptyRecord(game.key);
      assignRecord(
        game.key,
        freezeClosingSnapshotIfNeeded({
          record: reopenClosingSnapshotForDelayedKickoffIfNeeded({
            record: currentRecord,
            kickoff: game.date,
            now: requestTime,
          }),
          kickoff: game.date,
          now: requestTime,
        })
      );
    }

    for (const match of attached) {
      const game = gameByKey.get(match.gameKey);
      if (!game) continue;

      const snapshot = buildDurableOddsSnapshot({
        game,
        event: match.event,
        resolver,
        capturedAt: snapshotCapturedAt,
      });
      if (!snapshot) continue;

      const currentRecord = nextStore[game.key] ?? emptyRecord(game.key);
      const updated = applyPregameOddsSnapshot({
        record: currentRecord,
        snapshot,
        kickoff: game.date,
        now: requestTime,
      });

      assignRecord(
        game.key,
        freezeClosingSnapshotIfNeeded({
          record: updated,
          kickoff: game.date,
          now: requestTime,
        })
      );
    }

    return nextStore;
  });

  const items: CanonicalOddsItem[] = [];
  for (const game of games) {
    const odds = selectOddsForGame({
      game,
      record: nextStore[game.key] ?? null,
      now: requestTime,
    });
    if (!odds) continue;
    items.push({ canonicalGameId: game.key, odds });
  }

  return items;
}

export async function GET(req: Request): Promise<Response> {
  recordRouteRequest('odds');
  try {
    const parsedQuery = parseOddsQuery(new URL(req.url));
    if (!parsedQuery.ok) {
      return new Response(
        JSON.stringify({
          error: parsedQuery.error,
          field: parsedQuery.field,
          value: parsedQuery.value,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const query = parsedQuery.query;

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
        timeoutMs: 12000,
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
        data: Array.isArray(upstreamData)
          ? upstreamData
              .map(normalizeUpstreamOddsEvent)
              .filter((event): event is NormalizedOddsEvent => Boolean(event))
          : [],
        lastFetch: Date.now(),
        usage,
      };
      fetchedFromUpstream = true;
    }

    if (cachedEntry && !stale) {
      recordRouteCacheHit('odds');
    }

    const responseEntry = oddsCache.entries[cacheKey] ?? cachedEntry;
    const requestTime = new Date().toISOString();
    const snapshotCapturedAt = new Date(responseEntry?.lastFetch ?? Date.now()).toISOString();
    const [scheduleItems, teams, aliasMap, conferenceRecords] = await Promise.all([
      fetchCanonicalSchedule(req, query.season),
      readTeamsCatalog(),
      readAliasesForSeason(query.season),
      readConferenceRecords(req),
    ]);

    const items = await buildCanonicalOddsItems({
      season: query.season,
      scheduleItems,
      oddsEvents: responseEntry?.data ?? [],
      teams,
      aliasMap,
      conferenceRecords,
      requestTime,
      snapshotCapturedAt,
    });

    return responseFrom(items, {
      source: 'odds-api',
      cache: fetchedFromUpstream ? 'miss' : 'hit',
      fallbackUsed: false,
      generatedAt: requestTime,
      usage: responseEntry?.usage ?? (await getLatestKnownOddsUsage()),
      season: query.season,
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
