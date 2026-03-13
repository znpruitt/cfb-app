import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';

export const dynamic = 'force-dynamic';
export const revalidate = 120;

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1' || process.env.DEBUG_CFBD === '1';
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 250;

type SeasonType = 'regular' | 'postseason';

type CfbdScheduleGame = {
  id?: number;
  week?: number;
  start_date?: string | null;
  neutral_site?: boolean;
  conference_game?: boolean;
  home_team?: string;
  away_team?: string;
  home_conference?: string | null;
  away_conference?: string | null;
  status?: string | null;
  venue?: string | null;
  notes?: string | null;
  name?: string | null;
};

type ScheduleItem = {
  id: string;
  week: number;
  startDate: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeTeam: string;
  awayTeam: string;
  homeConference: string;
  awayConference: string;
  status: string;
  venue?: string | null;
  label?: string | null;
  notes?: string | null;
  seasonType?: SeasonType;
};

interface ScheduleMeta {
  source: 'cfbd';
  cache: 'hit' | 'miss';
  fallbackUsed: false;
  generatedAt: string;
  partialFailure: boolean;
  failedSeasonTypes?: SeasonType[];
}

interface ScheduleResponse {
  items: ScheduleItem[];
  meta: ScheduleMeta;
}

type CacheEntry = {
  at: number;
  items: ScheduleItem[];
  partialFailure: boolean;
  failedSeasonTypes: SeasonType[];
};
const CACHE: Record<string, CacheEntry> = {};

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
}

function pruneCache(cache: Record<string, CacheEntry>, label: string) {
  const entries = Object.entries(cache);
  if (entries.length <= MAX_CACHE_ENTRIES) return;

  const toDelete = entries
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, entries.length - MAX_CACHE_ENTRIES)
    .map(([key]) => key);

  for (const key of toDelete) {
    delete cache[key];
  }

  if (IS_DEBUG) {
    console.log('cfbd cache evicted', {
      route: label,
      cacheSize: entries.length,
      maxEntries: MAX_CACHE_ENTRIES,
      evicted: toDelete.length,
    });
  }
}

function logDebug(params: {
  requestId: string | null;
  event: string;
  endpoint?: string;
  year: number;
  week: number | null;
  seasonType: SeasonType | 'all';
  cacheKey: string;
  itemCount?: number;
  detail?: unknown;
}) {
  if (!IS_DEBUG) return;
  const { requestId, event, endpoint, year, week, seasonType, cacheKey, itemCount, detail } =
    params;

  console.log('cfbd route debug', {
    route: 'schedule',
    requestId,
    event,
    endpoint: endpoint ?? null,
    year,
    week,
    seasonType,
    cacheKey,
    itemCount: itemCount ?? null,
    detail: detail ?? null,
  });
}

function toScheduleItem(game: CfbdScheduleGame, seasonType: SeasonType): ScheduleItem | null {
  const week = typeof game.week === 'number' ? game.week : null;
  const homeTeam = (game.home_team ?? '').trim();
  const awayTeam = (game.away_team ?? '').trim();
  if (week === null || !homeTeam || !awayTeam) return null;

  return {
    id: String(game.id ?? `${week}-${homeTeam}-${awayTeam}`),
    week,
    startDate: game.start_date ?? null,
    neutralSite: Boolean(game.neutral_site),
    conferenceGame: Boolean(game.conference_game),
    homeTeam,
    awayTeam,
    homeConference: (game.home_conference ?? '').trim(),
    awayConference: (game.away_conference ?? '').trim(),
    status: (game.status ?? 'scheduled').trim() || 'scheduled',
    venue: (game.venue ?? '').trim() || null,
    label: (game.name ?? '').trim() || null,
    notes: (game.notes ?? '').trim() || null,
    seasonType,
  };
}

async function fetchSeasonType(params: {
  year: number;
  week: number | null;
  seasonType: SeasonType;
  cacheKey: string;
  requestId: string | null;
}): Promise<{ items: ScheduleItem[]; requestUrl: string }> {
  const { year, week, seasonType, cacheKey, requestId } = params;
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  const cfbdUrl = buildCfbdGamesUrl({ year, seasonType, week });
  const requestUrl = `${cfbdUrl.origin}${cfbdUrl.pathname}${cfbdUrl.search}`;

  const upstream = await fetchUpstreamJson<CfbdScheduleGame[]>(cfbdUrl.toString(), {
    cache: 'no-store',
    timeoutMs: 12_000,
    headers: { Authorization: `Bearer ${cfbdApiKey}` },
  });

  const items = upstream
    .map((game) => toScheduleItem(game, seasonType))
    .filter((v): v is ScheduleItem => Boolean(v));

  if (items.length === 0) {
    logDebug({
      requestId,
      event: 'upstream_empty',
      endpoint: requestUrl,
      year,
      week,
      seasonType,
      cacheKey,
      itemCount: items.length,
    });
  }

  CACHE[cacheKey] = { at: Date.now(), items, partialFailure: false, failedSeasonTypes: [] };
  pruneCache(CACHE, 'schedule');

  return { items, requestUrl };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const requestId = req.headers.get('x-request-id');

  const currentYear = new Date().getUTCFullYear();
  const minYear = 2000;
  const maxYear = currentYear + 1;

  let year = seasonYearForToday();
  if (yearParam != null) {
    const parsedYear = parseNonNegativeInt(yearParam);
    if (parsedYear == null || parsedYear < minYear || parsedYear > maxYear) {
      return NextResponse.json(
        {
          error: `year must be an integer between ${minYear} and ${maxYear}`,
          field: 'year',
          value: yearParam,
        },
        { status: 400 }
      );
    }
    year = parsedYear;
  }

  const week = weekParam == null ? null : parseNonNegativeInt(weekParam);
  if (weekParam != null && week === null) {
    return NextResponse.json(
      { error: 'week must be a non-negative integer', field: 'week' },
      { status: 400 }
    );
  }

  const requestedSeasonType: SeasonType | 'all' =
    seasonTypeParam === 'postseason'
      ? 'postseason'
      : seasonTypeParam === 'regular'
        ? 'regular'
        : 'all';

  const cacheKey = `${year}-${week ?? 'all'}-${requestedSeasonType}`;
  const hit = CACHE[cacheKey];
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json<ScheduleResponse>({
      items: hit.items,
      meta: {
        source: 'cfbd',
        cache: 'hit',
        fallbackUsed: false,
        generatedAt: new Date(hit.at).toISOString(),
        partialFailure: hit.partialFailure,
        ...(hit.failedSeasonTypes.length > 0 ? { failedSeasonTypes: hit.failedSeasonTypes } : {}),
      },
    });
  }

  const seasonTypes: SeasonType[] =
    requestedSeasonType === 'all' ? ['regular', 'postseason'] : [requestedSeasonType];

  const results = await Promise.allSettled(
    seasonTypes.map((seasonType) =>
      fetchSeasonType({
        year,
        week,
        seasonType,
        cacheKey: `${year}-${week ?? 'all'}-${seasonType}`,
        requestId,
      })
    )
  );

  const successes: Array<{ seasonType: SeasonType; items: ScheduleItem[]; endpoint: string }> = [];
  const failedSeasonTypes: SeasonType[] = [];
  let firstError: unknown = null;

  for (const [idx, result] of results.entries()) {
    const seasonType = seasonTypes[idx];
    if (result.status === 'fulfilled') {
      successes.push({ seasonType, items: result.value.items, endpoint: result.value.requestUrl });
      continue;
    }

    failedSeasonTypes.push(seasonType);
    if (firstError == null) firstError = result.reason;

    if (result.reason instanceof UpstreamFetchError) {
      logDebug({
        requestId,
        event: 'upstream_failed',
        endpoint: result.reason.details.url,
        year,
        week,
        seasonType,
        cacheKey,
        detail: {
          kind: result.reason.details.kind,
          status: result.reason.details.status ?? null,
          message: result.reason.details.message,
        },
      });
    } else {
      logDebug({
        requestId,
        event: 'upstream_failed',
        year,
        week,
        seasonType,
        cacheKey,
        detail: result.reason instanceof Error ? result.reason.message : 'unknown error',
      });
    }
  }

  if (successes.length === 0 || failedSeasonTypes.length > 0) {
    if (successes.length > 0) {
      return NextResponse.json(
        {
          error: 'partial upstream error',
          detail: {
            message: 'one or more required CFBD season type requests failed',
            failedSeasonTypes,
          },
        },
        { status: 502 }
      );
    }

    if (firstError instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'upstream error', detail: firstError.details },
        { status: firstError.details.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: firstError instanceof Error ? firstError.message : 'unknown error' },
      { status: 502 }
    );
  }

  const items = successes
    .flatMap((payload) => payload.items)
    .sort((a, b) => a.week - b.week || (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  CACHE[cacheKey] = {
    at: now,
    items,
    partialFailure: failedSeasonTypes.length > 0,
    failedSeasonTypes,
  };
  pruneCache(CACHE, 'schedule');

  if (IS_DEBUG) {
    console.log('schedule route summary', {
      route: 'schedule',
      requestId,
      year,
      week,
      seasonType: requestedSeasonType,
      cacheKey,
      count: items.length,
      partialFailure: failedSeasonTypes.length > 0,
      failedSeasonTypes,
      requests: successes.map((payload) => ({
        seasonType: payload.seasonType,
        endpoint: payload.endpoint,
        count: payload.items.length,
      })),
      weeks: Array.from(new Set(items.map((item) => item.week))).sort((a, b) => a - b),
      sample: items.slice(0, 10).map((item) => ({
        id: item.id,
        week: item.week,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        seasonType: item.seasonType,
        label: item.label,
      })),
    });
  }

  return NextResponse.json<ScheduleResponse>({
    items,
    meta: {
      source: 'cfbd',
      cache: 'miss',
      fallbackUsed: false,
      generatedAt: new Date(now).toISOString(),
      partialFailure: failedSeasonTypes.length > 0,
      ...(failedSeasonTypes.length > 0 ? { failedSeasonTypes } : {}),
    },
  });
}
