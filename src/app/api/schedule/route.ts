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
import {
  classifyEmptyScheduleRefresh,
  hasRequiredSeasonTypeFailure,
} from '@/lib/scheduleSeasonFetch';

import { type CacheEntry, SCHEDULE_ROUTE_CACHE } from './cache';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { yearScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import {
  getScheduleProbeState,
  saveScheduleProbeState,
  deriveFirstGameDate,
} from '@/lib/scheduleProbe';

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
  return month >= 6 ? year : year - 1;
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

  // A non-array provider payload is uncertainty (schema drift), not valid
  // absence — throw so this partition lands in `failedSeasonTypes` rather than
  // being read as a successful empty result (PLATFORM-085C).
  if (!Array.isArray(upstream)) {
    throw new Error(`schedule ${seasonType} ${year}: provider returned a non-array payload`);
  }

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

  // PLATFORM-085C: a NONEMPTY provider payload that normalizes to ZERO schedule
  // rows is schema drift (field renames, shape change), NOT valid absence. Throw
  // so the caller treats this partition as uncertainty — it lands in
  // `failedSeasonTypes`, the completeness gate rejects the refresh, and the
  // prior-good durable schedule is never overwritten with a schema-drifted empty
  // result. An EMPTY upstream (`upstream.length === 0`) is legitimate absence
  // (e.g. postseason before bowls, a future week with no games) and returns [].
  if (upstream.length > 0 && items.length === 0) {
    throw new Error(
      `schedule ${seasonType} ${year}: provider returned ${upstream.length} rows but none normalized to a valid schedule item (schema drift)`
    );
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
  const adminAuthFailure = await requireAdminRequest(req);
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

  // Provider-refresh observability (PLATFORM-086A): reaching here means an admin
  // (or bypassCache) refresh will fetch upstream. Record the attempt before the
  // fetch; success is recorded only after a durable commit, failure on any 502.
  // Schedule status is YEAR-scoped (a 2026 refresh must never affect 2025 status).
  // Both season-type partitions are fetched under one year target below.
  const scheduleScope = yearScope(year);
  const providerAttempt = await beginProviderRefreshAttempt('schedule', scheduleScope, {
    startedAt: new Date(now).toISOString(),
  });

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
    // A required-partition failure is a REJECTED refresh (085B/085C): no commit,
    // prior-good durable schedule retained. Record failure so last-success is not
    // advanced and the partial is visible to operators.
    await recordProviderRefreshFailure('schedule', scheduleScope, {
      attempt: providerAttempt,
      error:
        firstError instanceof Error
          ? firstError.message
          : 'schedule refresh failed (partial or upstream error)',
      status: firstError instanceof UpstreamFetchError ? (firstError.details.status ?? 502) : 502,
      partialFailure: true,
      failedPartitions: failedSeasonTypes,
      durationMs: Date.now() - now,
    });

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

  // Classify an ALL-EMPTY result BEFORE any durable or process-cache write
  // (4th-review finding #1). Every requested partition validly returned zero rows
  // (a required-partition failure already returned at the 085B gate above). Writing
  // the empty snapshot and THEN recording a no-op is self-contradictory: the no-op
  // preserves prior success metadata (claiming old rows are still served) while the
  // authoritative cache has just been emptied. Distinguish two cases; neither
  // writes the empty result:
  //   (A) an unexpected empty REPLACEMENT of a populated schedule — treat as schema
  //       drift / incomplete upstream, preserve prior-good, record a failure; vs
  //   (B) a valid INAPPLICABLE / unpublished absence (postseason before bowls, a
  //       future season not yet published) — record a no-op, serve empty.
  // There is no legitimate production case for intentionally committing an empty
  // schedule OVER a populated one, so case (C) "authoritative zero-row commit"
  // collapses into (A): reject rather than overwrite.
  if (items.length === 0) {
    let priorDurableRows: number;
    try {
      const priorDurable = await getAppState<CacheEntry>('schedule', cacheKey);
      priorDurableRows = priorDurable?.value?.items?.length ?? 0;
    } catch (readError) {
      // The prior durable schedule read failed while classifying an empty provider
      // response (transient app-state outage). A read failure is NOT a
      // classification result — without knowing whether a populated schedule
      // already exists we cannot safely decide valid-no-op vs unexpected-empty-
      // replacement. Resolve the OPEN attempt as failed (best-effort) rather than
      // leaving it permanently `in-progress`, write nothing (prior-good retained),
      // and return the established 502 error. Recording + returning here means no
      // outer catch double-resolves the attempt.
      await recordProviderRefreshFailure('schedule', scheduleScope, {
        attempt: providerAttempt,
        error: `schedule ${requestedSeasonType} ${year}: prior durable schedule could not be read while classifying an empty provider response — cannot safely determine prior schedule state (${readError instanceof Error ? readError.message : 'unknown read error'})`,
        code: 'schedule-prior-cache-read-failed',
        status: 502,
        durationMs: Date.now() - now,
      });
      return NextResponse.json(
        {
          error:
            'schedule refresh could not classify an empty provider response — prior schedule cache was unreadable',
          detail: { code: 'schedule-prior-cache-read-failed' },
        },
        { status: 502 }
      );
    }
    // Shared empty-response policy (6th-review finding #2) — the SAME classifier
    // the season-transition cron uses, so the two paths cannot drift.
    const classification = classifyEmptyScheduleRefresh({ mappedRows: 0, priorDurableRows });
    if (classification === 'unexpected-empty-replacement') {
      // (A) Do NOT overwrite prior-good durable schedule and do NOT touch the
      // process cache. Record a failure so `lastSuccessAt` is preserved and the
      // empty replacement is visible to operators.
      await recordProviderRefreshFailure('schedule', scheduleScope, {
        attempt: providerAttempt,
        error: `schedule ${requestedSeasonType} ${year}: provider returned zero games while a populated schedule is cached — rejected as an unexpected empty replacement`,
        code: 'schedule-empty-replacement-rejected',
        status: 502,
        durationMs: Date.now() - now,
      });
      return NextResponse.json(
        {
          error: 'schedule refresh returned no games while a populated schedule is cached',
          detail: { rejected: 'unexpected-empty-replacement' },
        },
        { status: 502 }
      );
    }
    // (B) No prior-good populated schedule for this key: a genuinely empty /
    // inapplicable request. Nothing is written (durable prior-good, if any empty
    // record, is untouched; the process cache is not mutated). Record a no-op so
    // `lastSuccessAt` is not advanced with zero rows, and serve an empty success.
    await recordProviderRefreshNoop('schedule', scheduleScope, {
      attempt: providerAttempt,
      source: 'cfbd',
      durationMs: Date.now() - now,
    });
    return NextResponse.json<ScheduleResponse>({
      items: [],
      meta: {
        source: 'cfbd',
        cache: 'miss',
        fallbackUsed: false,
        generatedAt: new Date(now).toISOString(),
        partialFailure: false,
      },
    });
  }

  const nextCacheEntry: CacheEntry = {
    at: now,
    items,
    partialFailure: failedSeasonTypes.length > 0,
    failedSeasonTypes,
  };
  // Durable-first commit order (PLATFORM-085A): persist to app-state BEFORE
  // publishing to the process cache and invalidating standings, so a failed
  // durable write can never leave this instance serving a "fresh" schedule that
  // no other instance can durably reproduce.
  let committedAt: string;
  let commitSeq: number;
  try {
    await setAppState('schedule', cacheKey, nextCacheEntry);
    // Capture the durable COMMIT time + sequence for success ordering (rereview
    // findings #3/#6).
    committedAt = new Date().toISOString();
    commitSeq = nextProviderCommitSeq();
  } catch (commitError) {
    // The provider fetch succeeded but the durable commit failed. Resolve the open
    // attempt as failed (rereview finding #6) — without this it would dangle as an
    // in-progress attempt with no matching outcome, unlike the other instrumented
    // routes. Prior-good durable schedule is preserved (nothing reached the
    // process cache), and no success is recorded.
    await recordProviderRefreshFailure('schedule', scheduleScope, {
      attempt: providerAttempt,
      error: commitError instanceof Error ? commitError.message : 'schedule durable commit failed',
      code: 'schedule-durable-commit-failed',
      status: 500,
      partialFailure: failedSeasonTypes.length > 0,
      failedPartitions: failedSeasonTypes,
      durationMs: Date.now() - now,
    });
    return NextResponse.json(
      {
        error: 'schedule persistence failed',
        detail: commitError instanceof Error ? commitError.message : 'unknown error',
      },
      { status: 500 }
    );
  }
  SCHEDULE_ROUTE_CACHE[cacheKey] = nextCacheEntry;
  pruneCache(SCHEDULE_ROUTE_CACHE, 'schedule');

  // Durable schedule committed with real rows (all-empty was classified and
  // returned above, so `items.length > 0` here) — record the success. Reaching
  // this point means all requested partitions resolved (085B gate above).
  await recordProviderRefreshSuccess('schedule', scheduleScope, {
    attempt: providerAttempt,
    committedAt,
    commitSeq,
    source: 'cfbd',
    rowsCommitted: items.length,
    partialFailure: failedSeasonTypes.length > 0,
    failedPartitions: failedSeasonTypes,
    durationMs: Date.now() - now,
  });

  // Invalidate canonical standings for every league at this year. Schedule
  // is season-scoped, not league-scoped, so we walk the registry. The set is
  // small (one platform admin's leagues today); the per-tag revalidate is
  // cheap.
  try {
    const leagues = await getLeagues();
    for (const league of leagues) {
      invalidateStandings(league.slug, year);
    }
  } catch {
    // Non-fatal — schedule write already succeeded; canonical will refresh on
    // the next mutation or natural cache turnover.
  }

  // Update schedule probe state when a full-season admin refresh completes
  if (bypassCache && week === null && requestedSeasonType === 'all' && items.length > 0) {
    try {
      const existingProbe = await getScheduleProbeState(year);
      const firstGameDate = deriveFirstGameDate(items);
      await saveScheduleProbeState({
        year,
        baseCachedAt: existingProbe?.baseCachedAt ?? new Date(now).toISOString(),
        firstGameDate,
      });
    } catch {
      // Non-fatal — probe state update failure should not block the schedule response
    }
  }

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
