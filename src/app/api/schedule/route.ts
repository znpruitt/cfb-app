import { NextResponse } from 'next/server';

import { type ScheduleItem, type SeasonType } from '@/lib/schedule/cfbdSchedule';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import type { FullSeasonScheduleRefreshResult } from '@/lib/schedule/fullSeasonScheduleRefreshResult';
import {
  enrichScheduleItemsWithPresentation,
  type PresentationEnrichedScheduleItem,
} from '@/lib/schedule/schedulePresentationJoin';
import { refreshSchedulePresentation } from '@/lib/schedule/schedulePresentationRefresh';

import { SCHEDULE_ROUTE_CACHE } from './cache';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';
import {
  canonicalScheduleAggregateKey,
  loadCanonicalScheduleEntry,
} from '@/lib/server/canonicalScheduleCache';
import { ScheduleRowNonConformanceError } from '@/lib/server/durableScheduleRow';
import { requireAdminRequest } from '@/lib/server/adminAuth';
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
  /**
   * Canonical schedule items with the OPTIONAL cache-only presentation overlay
   * (PLATFORM-086E1C1): `media` joined by exact provider game id and venue
   * display fields filled by exact `venueId` — never persisted back to the
   * durable `schedule/*` records.
   */
  items: PresentationEnrichedScheduleItem[];
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

/**
 * Canonical season-type partition for a schedule row. Every row mapped by
 * `mapCfbdScheduleGame` carries a canonical `seasonType` ('regular' | 'postseason');
 * we read that field directly — never a raw provider label. `gamePhase` is only a
 * defensive fallback for a hypothetical legacy row persisted before `seasonType`
 * was populated (conference championships are part of the regular season type).
 */
function canonicalSeasonType(item: ScheduleItem): SeasonType {
  if (item.seasonType === 'regular' || item.seasonType === 'postseason') {
    return item.seasonType;
  }
  return item.gamePhase === 'postseason' ? 'postseason' : 'regular';
}

/**
 * Narrow a season's canonical rows to the requested window (PLATFORM-663).
 *
 * This REPLACES the per-window durable keys. `/api/schedule` used to answer a
 * `week` or `seasonType` request by fetching that window from the provider and
 * committing it to its own `schedule/${year}-${week}-${seasonType}` (or
 * `${year}-all-${seasonType}`) record — a key no whole-season reader ever
 * consulted, so a repaired window stayed invisible to standings, Insights, the
 * draft board, archives and diagnostics while the aggregate they all read kept
 * its older rows. #663's ruling is aggregate-only: one durable key per season,
 * and every narrower view is a projection of it.
 *
 * Because this is a pure filter over the already-committed aggregate, a window
 * request can no longer disagree with the whole season — the divergence is gone
 * by construction rather than detected. `week` matches the row's own `week`;
 * `seasonType` matches `canonicalSeasonType`, so a row is classified exactly as
 * the durable partition writers used to classify it.
 */
function selectScheduleWindow(
  items: ScheduleItem[],
  week: number | null,
  seasonType: SeasonType | 'all'
): ScheduleItem[] {
  if (week === null && seasonType === 'all') return items;
  return items.filter(
    (item) =>
      (week === null || item.week === week) &&
      (seasonType === 'all' || canonicalSeasonType(item) === seasonType)
  );
}

/**
 * Map a shared full-season refresh result to the `/api/schedule` HTTP response
 * (PLATFORM-086E1A). Lease contention is a truthful 409 with NO provider request;
 * a failure carries the authority's HTTP status + closed reason code; a success or
 * validated no-op serves the confirmed items — presentation-enriched cache-only
 * (PLATFORM-086E1C1) — with the standard schedule meta. The success/empty
 * response body matches the pre-migration full-year shape.
 *
 * PLATFORM-663: the served rows are narrowed to the requested window. The
 * authority still refreshes and commits the WHOLE season — there is one
 * refreshable unit now — so a window request reports the same success the
 * full-year request does, over a projection of the same committed rows.
 */
async function fullSeasonRefreshResponse(
  result: FullSeasonScheduleRefreshResult,
  now: number,
  window: { week: number | null; seasonType: SeasonType | 'all' }
): Promise<NextResponse> {
  if (result.status === 'in-progress') {
    return NextResponse.json(
      { error: 'schedule refresh already in progress for this year', code: result.reason },
      { status: 409 }
    );
  }
  if (result.status === 'failure') {
    return NextResponse.json(
      {
        error: 'schedule refresh failed',
        code: result.reason,
        // PLATFORM-126B widened the authority's field to carry a per-partition
        // upstream class. This PUBLIC response body is byte-preserved: it still
        // emits the plain season-type list and never the retained class, which
        // is durable diagnostic evidence for operators, not member-facing data.
        ...(result.failedPartitions.length > 0
          ? {
              detail: {
                failedSeasonTypes: result.failedPartitions.map((partition) => partition.seasonType),
              },
            }
          : {}),
      },
      { status: result.httpStatus }
    );
  }
  return NextResponse.json<ScheduleResponse>({
    items: await enrichScheduleItemsWithPresentation({
      year: result.requestedYear,
      items: selectScheduleWindow(result.items, window.week, window.seasonType),
    }),
    meta: {
      source: 'cfbd',
      cache: 'miss',
      fallbackUsed: false,
      generatedAt: result.observedAt ?? new Date(now).toISOString(),
      partialFailure: false,
    },
  });
}

/** Build the cache-hit response body for a window of an already-committed season. */
async function cachedWindowResponse(params: {
  year: number;
  entry: {
    at: number;
    items: ScheduleItem[];
    partialFailure: boolean;
    failedSeasonTypes: string[];
  };
  week: number | null;
  seasonType: SeasonType | 'all';
  stale: boolean;
}): Promise<NextResponse> {
  const { year, entry, week, seasonType, stale } = params;
  const failedSeasonTypes = entry.failedSeasonTypes.filter(
    (value): value is SeasonType => value === 'regular' || value === 'postseason'
  );
  return NextResponse.json<ScheduleResponse>({
    items: await enrichScheduleItemsWithPresentation({
      year,
      items: selectScheduleWindow(entry.items, week, seasonType),
    }),
    meta: {
      source: 'cfbd',
      cache: 'hit',
      fallbackUsed: false,
      generatedAt: new Date(entry.at).toISOString(),
      partialFailure: entry.partialFailure,
      ...(stale ? { stale: true, rebuildRequired: true } : {}),
      ...(failedSeasonTypes.length > 0 ? { failedSeasonTypes } : {}),
    },
  });
}

export async function GET(req: Request) {
  recordRouteRequest('schedule');
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));

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

  // PLATFORM-663 — ONE durable key per season. Every request shape, narrow or
  // whole-year, resolves against `schedule/${year}-all-all` (with the legacy
  // partition pair as the shared read-time fallback) and is then projected to the
  // requested window. There is no longer a per-window cache key to read, write,
  // compose, or diverge from.
  const aggregateKey = canonicalScheduleAggregateKey(year);
  const isWholeSeasonRequest = week === null && requestedSeasonType === 'all';
  const now = Date.now();
  const adminAuthFailure = await requireAdminRequest(req);
  const isAdmin = !adminAuthFailure;
  if (bypassCache && adminAuthFailure) return adminAuthFailure;

  if (!bypassCache) {
    const processEntry = SCHEDULE_ROUTE_CACHE[aggregateKey];
    if (isFreshScheduleCacheEntry(processEntry, now)) {
      recordRouteCacheHit('schedule');
      return cachedWindowResponse({
        year,
        entry: processEntry!,
        week,
        seasonType: requestedSeasonType,
        stale: false,
      });
    }

    // Process entry missing or expired → consult durable storage, which is never
    // masked by a stale local mirror.
    // PLATFORM-813: a stored season that does not conform to `ScheduleWireItem` is a
    // shaped 503, not an opaque 500. The reader throws `ScheduleRowNonConformanceError`,
    // and without this handler it escaped `GET` as Next's default 500 with no body — while
    // every other failure this route returns is shaped JSON. 503 matches the cache-miss
    // refusal below because the remedy is the same: an admin refresh rebuilds the season.
    // `detail` names the key, row and field. Asserted by the schedule route test
    // "a non-conforming stored season answers a shaped 503 naming the row".
    let stored: Awaited<ReturnType<typeof loadCanonicalScheduleEntry<ScheduleItem>>>;
    try {
      stored = await loadCanonicalScheduleEntry<ScheduleItem>(year);
    } catch (error) {
      if (!(error instanceof ScheduleRowNonConformanceError)) throw error;
      return NextResponse.json(
        {
          error:
            'schedule cache unreadable: the stored season does not conform to the schedule row type — an admin refresh is required to rebuild it',
          code: 'schedule-cache-nonconforming',
          detail: error.message,
        },
        { status: 503 }
      );
    }
    if (stored) {
      // Only the aggregate owns the process-cache slot; a partition-pair read is a
      // compatibility path and is never promoted (there is no authoritative
      // process slot for it, exactly as before #663).
      if (stored.source === 'aggregate') {
        SCHEDULE_ROUTE_CACHE[aggregateKey] = {
          at: stored.at,
          items: stored.items,
          partialFailure: stored.partialFailure,
          failedSeasonTypes: stored.failedSeasonTypes.filter(
            (value): value is SeasonType => value === 'regular' || value === 'postseason'
          ),
        };
        pruneCache(SCHEDULE_ROUTE_CACHE, 'schedule');
      }

      const fresh = now - stored.at < SCHEDULE_CACHE_TTL_MS;
      if (fresh) {
        recordRouteCacheHit('schedule');
        return cachedWindowResponse({
          year,
          entry: stored,
          week,
          seasonType: requestedSeasonType,
          stale: false,
        });
      }

      // Stale: a non-admin gets the stale rows flagged for rebuild; an admin falls
      // through to refresh the season.
      if (!isAdmin) {
        recordRouteCacheHit('schedule');
        return cachedWindowResponse({
          year,
          entry: stored,
          week,
          seasonType: requestedSeasonType,
          stale: true,
        });
      }
    } else if (!isAdmin) {
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

  // PLATFORM-086E1A + PLATFORM-663: the shared full-season authority is now the
  // ONLY writer this route can reach — one completeness-checked, observation-
  // ordered, concurrency-safe writer on one key. It owns the lease, provider
  // fetch, commit, standings invalidation, and provider-status resolution; a
  // concurrent full-year refresh maps to HTTP 409 with NO provider request.
  //
  // A narrow (`week` / `seasonType`) request refreshes the WHOLE season and then
  // serves its window. That is deliberate and it is the ruling: the targeted
  // writer this branch replaced committed a key nothing read, so it could report
  // success while leaving every rendered surface on older rows. Refreshing the
  // season is strictly more coverage and lands on the key every reader reads.
  const result = await refreshFullSeasonSchedule({ year, now });

  // THE PROBE FOLLOWS THE AGGREGATE, NOT THE REQUEST SHAPE (PLATFORM-663 review).
  //
  // This gate was originally `bypassCache && isWholeSeasonRequest`, on the reasoning
  // that a window request must not acquire side effects the narrow path never had.
  // That reasoning was stale the moment this slice landed: the narrow path never had
  // them because it never COMMITTED THE AGGREGATE, and now it does. Keeping the gate
  // meant a window refresh could move the season's earliest kickoff while
  // `schedule-probe` kept the old date — and the season-transition cron gates
  // `shouldFetch` on exactly that date (`cron/season-transition/route.ts:411-414`),
  // so an obsolete probe defers the next lifecycle-critical refresh until the stale
  // date's seven-day window. A guard kept past its reason is as much a defect as one
  // removed with it.
  //
  // So: any successful populated commit re-derives the probe, whatever the request
  // shape that caused it.
  //
  // WHAT THAT WIDENS, stated because dropping `bypassCache` from the gate widens it
  // further than "window refreshes" (review round 2). Any ADMIN GET that finds a
  // stale aggregate now writes `schedule-probe` — including the internal sub-request
  // from `/api/debug/_lib/loadDebugSeasonContext.ts:52`, which forwards the caller's
  // own admin credentials on purpose (`forwardAdminAuthHeaders`). So a read-shaped
  // debug request can write lifecycle state. **That is correct, not incidental:** the
  // same request was ALREADY committing the aggregate before this slice — the
  // fallthrough is unchanged — and the probe is derived FROM the aggregate, so the
  // two moving together is the invariant. The bug would be a commit with a probe
  // left behind. (`/api/odds/route.ts:241` also self-fetches this route but forwards
  // NO credentials, so it is non-admin and cannot reach the refresh at all; the
  // review named it and it does not qualify.)
  //
  // Presentation seeding stays bound to the authorized whole-season `bypassCache=1`
  // request. That asymmetry is deliberate and it is NOT the same shape as the probe
  // bug above: PLATFORM-086E1C1 scoped seeding to that one request on purpose, the
  // media overlay is display-only, and it self-heals on the next whole-season or
  // weekly refresh — whereas a stale probe silently defers a lifecycle cron. The
  // honest cost: games first committed by a WINDOW refresh carry no media/venue
  // overlay until the next seeding. Widening it would spend provider calls on a path
  // that never did, so it is a separate decision rather than a fix folded in here.
  if (result.status === 'success' && result.items.length > 0) {
    try {
      const existingProbe = await getScheduleProbeState(year);
      const firstGameDate = await deriveFirstGameDate(year, result.items);
      await saveScheduleProbeState({
        year,
        baseCachedAt: existingProbe?.baseCachedAt ?? new Date(now).toISOString(),
        firstGameDate,
      });
    } catch {
      // Non-fatal — probe state update failure must not block the schedule response.
    }

    // PLATFORM-086E1C1 manual presentation seeding: ONLY the authorized
    // full-year `bypassCache=1` refresh whose E1A result is a populated
    // success invokes the presentation authority. The authority resolves every
    // fault into its typed result and never throws, so a presentation failure
    // can never replace the successful canonical schedule response below; the
    // defensive catch is belt-and-suspenders. Runs AFTER the probe update so it
    // can never block it, and BEFORE the response join so the response serves
    // whatever presentation cache won after the attempt.
    if (bypassCache && isWholeSeasonRequest) {
      try {
        await refreshSchedulePresentation({ year, trigger: 'manual' });
      } catch {
        // Never let presentation seeding disturb the canonical schedule response.
      }
    }
  }

  if (IS_DEBUG) {
    console.log('schedule route summary', {
      route: 'schedule',
      year,
      week,
      seasonType: requestedSeasonType,
      cacheKey: aggregateKey,
      status: result.status,
      count: result.status === 'success' ? result.items.length : 0,
    });
  }

  return fullSeasonRefreshResponse(result, now, { week, seasonType: requestedSeasonType });
}
