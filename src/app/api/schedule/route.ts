import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import {
  mapCfbdScheduleGame,
  type CfbdScheduleGame,
  type ScheduleDropReason,
  type ScheduleItem,
  type SeasonType,
} from '@/lib/schedule/cfbdSchedule';
import { hasRequiredSeasonTypeFailure } from '@/lib/scheduleSeasonFetch';

import { type CacheEntry, SCHEDULE_ROUTE_CACHE } from './cache';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { requireAdminRequest } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;
const SCHEDULE_CACHE_TTL_MS = revalidate * 1000;

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1' || process.env.DEBUG_CFBD === '1';
const MAX_CACHE_ENTRIES = 250;
const CFBD_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
const CFBD_PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

interface ScheduleMeta {
  source: 'cfbd';
  cache: 'hit' | 'miss';
  fallbackUsed: false;
  generatedAt: string;
  partialFailure: boolean;
  failedSeasonTypes?: SeasonType[];
  stale?: boolean;
  rebuildRequired?: boolean;
}

interface ScheduleResponse {
  items: ScheduleItem[];
  meta: ScheduleMeta;
}

function isFreshScheduleCacheEntry(
  entry: (typeof SCHEDULE_ROUTE_CACHE)[string] | undefined,
  now: number
): boolean {
  return Boolean(entry && now - entry.at < SCHEDULE_CACHE_TTL_MS);
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

function parseBooleanQueryParam(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
}

function pruneCache(cache: typeof SCHEDULE_ROUTE_CACHE, label: string) {
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
  const authHeader = `Bearer ${cfbdApiKey}`;
  if (IS_DEBUG) {
    console.log('schedule request debug', {
      route: 'schedule',
      requestId,
      year,
      week,
      seasonType,
      cacheKey,
      url: requestUrl,
      headers: {
        authorization: `Bearer ***${cfbdApiKey.slice(-4)}`,
      },
    });
  }

  const upstream = await fetchUpstreamJson<CfbdScheduleGame[]>(cfbdUrl.toString(), {
    cache: 'no-store',
    timeoutMs: 12_000,
    headers: { Authorization: authHeader },
    retry: CFBD_RETRY_POLICY,
    pacing: CFBD_PACING_POLICY,
  });

  const mapped: ScheduleItem[] = [];
  const dropped: Record<ScheduleDropReason, number> = {
    invalid_payload: 0,
    missing_week: 0,
    missing_home_team: 0,
    missing_away_team: 0,
  };

  for (const game of upstream) {
    const result = mapCfbdScheduleGame(game, seasonType);
    if (result.ok) {
      mapped.push(result.item);
      continue;
    }
    dropped[result.reason] += 1;
  }

  const items = mapped;

  if (IS_DEBUG) {
    console.log('schedule debug', {
      route: 'schedule',
      requestId,
      year,
      week,
      seasonType,
      cacheKey,
      url: requestUrl,
      rawCount: upstream.length,
      mappedCount: items.length,
      droppedCount: upstream.length - items.length,
      dropped,
      sampleRaw: upstream.slice(0, 3),
      sampleMapped: items.slice(0, 3),
    });
  }

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

  return { items, requestUrl };
}

export async function GET(req: Request) {
  recordRouteRequest('schedule');
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));
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
  const now = Date.now();
  const adminAuthFailure = requireAdminRequest(req);
  const isAdmin = !adminAuthFailure;
  if (bypassCache && adminAuthFailure) return adminAuthFailure;

  const hit = SCHEDULE_ROUTE_CACHE[cacheKey];
  if (!bypassCache && isFreshScheduleCacheEntry(hit, now)) {
    recordRouteCacheHit('schedule');
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

  if (!bypassCache) {
    const stored = await getAppState<CacheEntry>('schedule', cacheKey);
    const storedValue = stored?.value;
    if (storedValue && isFreshScheduleCacheEntry(storedValue, now)) {
      SCHEDULE_ROUTE_CACHE[cacheKey] = storedValue;
      pruneCache(SCHEDULE_ROUTE_CACHE, 'schedule');
      recordRouteCacheHit('schedule');
      return NextResponse.json<ScheduleResponse>({
        items: storedValue.items,
        meta: {
          source: 'cfbd',
          cache: 'hit',
          fallbackUsed: false,
          generatedAt: new Date(storedValue.at).toISOString(),
          partialFailure: storedValue.partialFailure,
          ...(storedValue.failedSeasonTypes.length > 0
            ? { failedSeasonTypes: storedValue.failedSeasonTypes }
            : {}),
        },
      });
    }

    if (!isAdmin) {
      if (storedValue) {
        SCHEDULE_ROUTE_CACHE[cacheKey] = storedValue;
        pruneCache(SCHEDULE_ROUTE_CACHE, 'schedule');
        recordRouteCacheHit('schedule');
        return NextResponse.json<ScheduleResponse>({
          items: storedValue.items,
          meta: {
            source: 'cfbd',
            cache: 'hit',
            fallbackUsed: false,
            generatedAt: new Date(storedValue.at).toISOString(),
            partialFailure: storedValue.partialFailure,
            stale: true,
            rebuildRequired: true,
            ...(storedValue.failedSeasonTypes.length > 0
              ? { failedSeasonTypes: storedValue.failedSeasonTypes }
              : {}),
          },
        });
      }

      return NextResponse.json(
        {
          error:
            'schedule cache miss: admin refresh required (retry with bypassCache=1 and admin token)',
        },
        { status: 503 }
      );
    }
  }

  recordRouteCacheMiss('schedule');

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

  const requiredSeasonTypeFailure = hasRequiredSeasonTypeFailure(
    requestedSeasonType,
    failedSeasonTypes
  );

  if (successes.length === 0 || requiredSeasonTypeFailure) {
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
  const nextCacheEntry: CacheEntry = {
    at: now,
    items,
    partialFailure: failedSeasonTypes.length > 0,
    failedSeasonTypes,
  };
  SCHEDULE_ROUTE_CACHE[cacheKey] = nextCacheEntry;
  pruneCache(SCHEDULE_ROUTE_CACHE, 'schedule');
  await setAppState('schedule', cacheKey, nextCacheEntry);

  if (IS_DEBUG) {
    console.log('schedule route summary', {
      route: 'schedule',
      requestId,
      year,
      week,
      seasonType: requestedSeasonType,
      cacheKey,
      count: items.length,
      partialFailure: requiredSeasonTypeFailure,
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
      partialFailure: requiredSeasonTypeFailure,
      ...(requiredSeasonTypeFailure ? { failedSeasonTypes } : {}),
    },
  });
}
