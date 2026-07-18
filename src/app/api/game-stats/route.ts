import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats } from '@/lib/gameStats/cache';
import { deriveSlateExpectation, ingestGameStatsObservations } from '@/lib/gameStats/ingestion';
import { toPublicWeeklyGameStats } from '@/lib/gameStats/publicProjection';
import type { DurableMergeResult } from '@/lib/gameStats/durableMerge';
import type { WeeklyGameStats } from '@/lib/gameStats/types';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
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

/**
 * Structural sanity of a durable weekly record. A record that exists but is
 * not shaped like a weekly partition is CORRUPT durable state — served as a
 * real failure, never reinterpreted as a cache miss or an empty week.
 */
function isStructurallyValidRecord(record: WeeklyGameStats): boolean {
  return record !== null && typeof record === 'object' && Array.isArray(record.games);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));

  const currentYear = new Date().getUTCFullYear();
  const minYear = 2001;
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

  if (week === null) {
    return NextResponse.json(
      { error: 'week parameter is required for game stats', field: 'week' },
      { status: 400 }
    );
  }

  const seasonType: CfbdSeasonType = seasonTypeParam === 'postseason' ? 'postseason' : 'regular';

  // Bypass (refresh) requires existing administrative authorization; parameter
  // validation above already failed before any provider access.
  if (bypassCache) {
    const adminAuthFailure = await requireAdminRequest(req);
    if (adminAuthFailure) return adminAuthFailure;
  }

  // Ordinary reads are CACHE-ONLY for every caller (PLATFORM-086H3): they
  // never trigger a provider call. Provider access happens exclusively through
  // the explicit admin-authorized bypass below. Public output flows through
  // the projection that strips v2 persistence metadata; legacy rows pass
  // through byte-equivalent.
  if (!bypassCache) {
    let cached: WeeklyGameStats | null;
    try {
      cached = await getCachedGameStats(year, week, seasonType);
    } catch (error) {
      // A failed durable READ is not absence: corrupt or unavailable storage
      // is reported as a real failure, never as an empty week or a cache miss.
      return NextResponse.json(
        {
          error: 'game stats durable state unavailable',
          code: 'game-stats-durable-read-failed',
          detail: error instanceof Error ? error.message : 'unknown error',
        },
        { status: 500 }
      );
    }

    if (cached) {
      if (!isStructurallyValidRecord(cached)) {
        return NextResponse.json(
          {
            error: 'game stats durable state is malformed for this partition',
            code: 'game-stats-durable-state-invalid',
          },
          { status: 500 }
        );
      }
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({
          ...toPublicWeeklyGameStats(cached),
          meta: { cache: 'hit', source: 'cfbd' },
        });
      }
      return NextResponse.json({
        ...toPublicWeeklyGameStats(cached),
        meta: { cache: 'hit', source: 'cfbd', stale: true },
      });
    }

    return NextResponse.json(
      { error: 'game stats cache miss: admin refresh required' },
      { status: 503 }
    );
  }

  // === Authorized refresh (admin-only, explicit) ===

  // Canonical-schedule expectation BEFORE the provider fetch: statistics only
  // ever attach to games the schedule already defines, and an unavailable
  // schedule fails the refresh before quota is spent.
  let expectation;
  try {
    const scheduleItems = await loadCachedScheduleItems(year);
    expectation = deriveSlateExpectation({
      scheduleItems,
      year,
      week,
      seasonType,
      now: Date.now(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'canonical schedule unavailable for game-stats refresh',
        code: 'game-stats-schedule-read-failed',
        detail: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 }
    );
  }
  if (!expectation.scheduleAvailable) {
    return NextResponse.json(
      {
        error: `no canonical schedule cached for ${year}; cache the season schedule before refreshing game stats`,
        code: 'game-stats-schedule-unavailable',
      },
      { status: 409 }
    );
  }

  // Provider-refresh observability (PLATFORM-086A): record the manual refresh
  // attempt before credential validation and the fetch, so a missing-key early
  // return still resolves a recorded failed attempt. Success is recorded only
  // after the durable merge authority confirms a committed outcome.
  const gameStatsScope = weekPartitionScope(year, week, seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', gameStatsScope, {
    startedAt: new Date().toISOString(),
  });

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    await recordProviderRefreshFailure('game-stats', gameStatsScope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return NextResponse.json({ error: 'CFBD_API_KEY not configured' }, { status: 500 });
  }

  try {
    // Observation fence: when THIS provider fetch started.
    const fetchStartedAt = new Date().toISOString();
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const rawGames = await fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });

    const ingestion = await ingestGameStatsObservations({
      year,
      week,
      seasonType,
      fetchStartedAt,
      payload: rawGames,
      expectation,
    });

    switch (ingestion.kind) {
      case 'invalid-payload': {
        await recordProviderRefreshFailure('game-stats', gameStatsScope, {
          attempt,
          error: 'provider payload was not an array',
          code: 'game-stats-invalid-payload',
          status: 502,
        });
        return NextResponse.json(
          {
            error: 'game-stats refresh received an invalid payload',
            code: 'game-stats-invalid-payload',
          },
          { status: 502 }
        );
      }
      case 'schema-drift': {
        await recordProviderRefreshFailure('game-stats', gameStatsScope, {
          attempt,
          error: `provider returned ${ingestion.entryCount} row(s) but none parsed as a game observation`,
          code: 'game-stats-schema-drift',
          status: 502,
        });
        return NextResponse.json(
          {
            error: 'game-stats refresh produced no parseable observations',
            code: 'game-stats-schema-drift',
          },
          { status: 502 }
        );
      }
      case 'valid-empty': {
        // Valid empty provider response: a no-op, never a destructive clear
        // and never a fabricated success. `emptyContext` reports whether the
        // canonical schedule expected completed games to have stats.
        await recordProviderRefreshNoop('game-stats', gameStatsScope, { attempt, source: 'cfbd' });
        return NextResponse.json({
          year,
          week,
          seasonType,
          fetchedAt: null,
          games: [],
          meta: {
            cache: 'miss',
            source: 'cfbd',
            noApplicableData: true,
            emptyContext: ingestion.emptyContext,
          },
        });
      }
      case 'unmatched-only': {
        await recordProviderRefreshFailure('game-stats', gameStatsScope, {
          attempt,
          error: `${ingestion.unmatched} provider observation(s) matched no canonical schedule game in week ${week} ${seasonType}`,
          code: 'game-stats-unmatched-observations',
          status: 502,
        });
        return NextResponse.json(
          {
            error: 'no provider observation matched a canonical schedule game',
            code: 'game-stats-unmatched-observations',
          },
          { status: 502 }
        );
      }
      case 'no-persistable-observations': {
        await recordProviderRefreshFailure('game-stats', gameStatsScope, {
          attempt,
          error: `${ingestion.matched} matched observation(s) carried no persistable category evidence`,
          code: 'game-stats-no-persistable-observations',
          status: 502,
        });
        return NextResponse.json(
          {
            error: 'matched observations carried no persistable category evidence',
            code: 'game-stats-no-persistable-observations',
          },
          { status: 502 }
        );
      }
      case 'merged': {
        return await respondToMergedRefresh({
          merge: ingestion.merge,
          attempt,
          gameStatsScope,
          year,
          week,
          seasonType,
        });
      }
    }
  } catch (error) {
    await recordProviderRefreshFailure('game-stats', gameStatsScope, {
      attempt,
      error: error instanceof Error ? error.message : 'unknown error',
      status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 502,
    });
    if (error instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'upstream error', detail: error.details },
        { status: error.details.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'unknown error' },
      { status: 502 }
    );
  }
}

type MergedRefreshParams = {
  merge: DurableMergeResult;
  attempt: Awaited<ReturnType<typeof beginProviderRefreshAttempt>>;
  gameStatsScope: ReturnType<typeof weekPartitionScope>;
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
};

/**
 * Map a durable merge result onto the manual-refresh HTTP response, with
 * status publication STRICTLY after confirmed durable outcomes:
 *
 *   - written/partially-merged/refreshed → success recorded after COMMIT, the
 *     COMMITTED partition re-read and served through the public projection;
 *   - unchanged/stale → truthful no-op (no last-success advance), committed
 *     state served;
 *   - conflict → failure, stored rows preserved bit-for-bit;
 *   - unavailable → failure, durable state untouched, prior-good preserved;
 *   - indeterminate → failure that says durability is UNKNOWN; nothing is
 *     published or claimed, and retrying the same refresh is safe.
 */
async function respondToMergedRefresh(params: MergedRefreshParams) {
  const { merge, attempt, gameStatsScope, year, week, seasonType } = params;
  const accepted = merge.inserted.length + merge.updated.length + merge.refreshed.length;
  const durable = {
    outcome: merge.outcome,
    inserted: merge.inserted.length,
    updated: merge.updated.length,
    refreshed: merge.refreshed.length,
    unchanged: merge.unchanged.length,
    stale: merge.stale.length,
    conflicts: merge.conflicts.length,
    retainedExisting: merge.retainedExisting.length,
    skippedNonPersistable: merge.skippedNonPersistable,
  };

  switch (merge.outcome) {
    // Fence-only refreshes surface as `written` with the game ids listed under
    // `refreshed` — freshness evidence is itself a durable commit.
    case 'written':
    case 'partially-merged':
    case 'unchanged':
    case 'stale': {
      if (merge.outcome === 'written' || merge.outcome === 'partially-merged') {
        const committedAt = new Date().toISOString();
        const commitSeq = nextProviderCommitSeq();
        await recordProviderRefreshSuccess('game-stats', gameStatsScope, {
          attempt,
          committedAt,
          commitSeq,
          source: 'cfbd',
          rowsCommitted: accepted,
          partialFailure: merge.outcome === 'partially-merged',
        });
      } else {
        await recordProviderRefreshNoop('game-stats', gameStatsScope, { attempt, source: 'cfbd' });
      }

      // Serve the COMMITTED durable partition (re-read after the merge), never
      // process memory — a retry or concurrent writer may have advanced it.
      let committed: WeeklyGameStats | null;
      try {
        committed = await getCachedGameStats(year, week, seasonType);
      } catch (error) {
        return NextResponse.json(
          {
            error: 'game stats merged but durable re-read failed',
            code: 'game-stats-durable-read-failed',
            detail: error instanceof Error ? error.message : 'unknown error',
            durable,
          },
          { status: 500 }
        );
      }
      if (!committed) {
        // The merge reported a no-change outcome against an empty partition
        // (e.g. every observation stale/skipped) — truthfully empty, never
        // fabricated content.
        return NextResponse.json({
          year,
          week,
          seasonType,
          fetchedAt: null,
          games: [],
          meta: { cache: 'miss', source: 'cfbd', durable },
        });
      }
      return NextResponse.json({
        ...toPublicWeeklyGameStats(committed),
        meta: { cache: 'miss', source: 'cfbd', durable },
      });
    }
    case 'conflict': {
      await recordProviderRefreshFailure('game-stats', gameStatsScope, {
        attempt,
        error: `durable merge rejected every observation (${merge.conflicts.length} conflict(s)); stored rows preserved`,
        code: 'game-stats-merge-conflict',
        status: 409,
      });
      return NextResponse.json(
        {
          error: 'durable merge conflict: stored rows preserved unchanged',
          code: 'game-stats-merge-conflict',
          durable,
        },
        { status: 409 }
      );
    }
    case 'unavailable': {
      await recordProviderRefreshFailure('game-stats', gameStatsScope, {
        attempt,
        error: `durable storage unavailable (${merge.unavailableReason}); durable state untouched`,
        code: 'game-stats-durable-unavailable',
        status: 503,
      });
      return NextResponse.json(
        {
          error: `durable storage unavailable (${merge.unavailableReason}); prior data preserved`,
          code: 'game-stats-durable-unavailable',
          durable,
        },
        { status: 503 }
      );
    }
    case 'indeterminate': {
      await recordProviderRefreshFailure('game-stats', gameStatsScope, {
        attempt,
        error: `durable write durability unknown (${merge.indeterminate?.reason}); retry is safe and idempotent`,
        code: 'game-stats-durable-indeterminate',
        status: 500,
      });
      return NextResponse.json(
        {
          error: 'durable write could not be confirmed committed or rolled back; retry is safe',
          code: 'game-stats-durable-indeterminate',
          durable,
        },
        { status: 500 }
      );
    }
  }
}
