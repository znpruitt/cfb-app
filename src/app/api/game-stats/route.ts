import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import {
  getCachedGameStats,
  withDurableGameStatsWeek,
  withGameStatsWeekLock,
} from '@/lib/gameStats/cache';
import { classifyGameStatsPayload, mergeWeeklyGameStats } from '@/lib/gameStats/coverage';
import type { RawGameTeamStats, WeeklyGameStats } from '@/lib/gameStats/types';
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

  // Admin auth check
  const adminAuthFailure = await requireAdminRequest(req);
  const isAdmin = !adminAuthFailure;
  if (bypassCache && adminAuthFailure) return adminAuthFailure;

  // Check cache
  if (!bypassCache) {
    const cached = await getCachedGameStats(year, week, seasonType);
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({
          ...cached,
          meta: { cache: 'hit', source: 'cfbd' },
        });
      }
    }

    // Non-admin with stale/missing cache
    if (!isAdmin) {
      if (cached) {
        return NextResponse.json({
          ...cached,
          meta: { cache: 'hit', source: 'cfbd', stale: true },
        });
      }

      return NextResponse.json(
        { error: 'game stats cache miss: admin refresh required' },
        { status: 503 }
      );
    }
  }

  // Provider-refresh observability (PLATFORM-086A): record the manual refresh
  // attempt before credential validation and the fetch, so a missing-key early
  // return still resolves a recorded failed attempt (rereview finding #5).
  // Success is recorded only after the durable cache write.
  // Manual game-stats refresh targets one (year, week, seasonType) partition: it
  // records against only that week partition and can never establish full-season
  // game-stats success.
  const gameStatsScope = weekPartitionScope(year, week, seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', gameStatsScope, {
    startedAt: new Date().toISOString(),
  });

  // Fetch from CFBD
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
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    // Provider-OBSERVATION window start (review remediation): CFBD supplies no
    // observation timestamp, so the request-start/response-received pair is the
    // only evidence bounding this snapshot's freshness for replacement fencing.
    const fetchStartedAt = new Date().toISOString();
    const rawGames = await fetchUpstreamJson<RawGameTeamStats[]>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });

    // Classify the provider response identically to the cron (5th-review finding
    // #5): a genuine empty array is a no-op (no empty durable write, no last-success
    // advance), a nonempty payload with zero usable rows is a failure (prior-good
    // preserved), and only a payload with ≥1 usable row commits.
    const classification = classifyGameStatsPayload(rawGames, week, seasonType);
    if (classification.kind === 'noop') {
      // Valid absence: no durable write, prior-good rows (if any) retained. The
      // explicit outcome lets the panel say what actually happened instead of
      // inferring success from `games.length === 0` (PLATFORM-086H finding #1).
      await recordProviderRefreshNoop('game-stats', gameStatsScope, { attempt, source: 'cfbd' });
      const prior = await getCachedGameStats(year, week, seasonType);
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
          outcome: 'noop',
          noopReason: 'no-provider-rows',
          rowsCommitted: 0,
          rowsCached: prior?.games.length ?? 0,
        },
      });
    }
    if (classification.kind === 'no-usable-rows') {
      await recordProviderRefreshFailure('game-stats', gameStatsScope, {
        attempt,
        error: 'provider returned rows but none normalized to a usable game stat',
        code: 'game-stats-no-usable-rows',
        status: 502,
      });
      return NextResponse.json(
        { error: 'game-stats refresh produced no usable rows', code: 'game-stats-no-usable-rows' },
        { status: 502 }
      );
    }
    if (classification.kind === 'no-authoritative-rows') {
      // Usable identity but zero authoritative rows (identity-only, one-sided,
      // or unknown-categories-only data): schema drift, a visible target-local
      // failure — never silently accepted as zero-filled stats, never conflated
      // with legitimately unpublished data (an EMPTY payload → no-op above).
      // Prior-good rows are untouched and last-success does not advance.
      await recordProviderRefreshFailure('game-stats', gameStatsScope, {
        attempt,
        error: 'provider returned rows but none carried authoritative stat content',
        code: 'game-stats-no-authoritative-rows',
        status: 502,
      });
      return NextResponse.json(
        {
          error: 'game-stats refresh produced no authoritative rows',
          code: 'game-stats-no-authoritative-rows',
        },
        { status: 502 }
      );
    }

    // Merge by canonical game id (PLATFORM-086H requirement 4, shared with the
    // cron): prior-good rows a partial provider response omits are retained, an
    // unusable incoming row never clobbers a usable prior row, and identical data
    // is a no-op — no durable rewrite, no downstream invalidation. The fresh
    // prior read → merge → durable write runs inside the CROSS-INSTANCE durable
    // critical section (`withDurableGameStatsWeek`, adversarial-review
    // remediation) — a Postgres transaction-scoped advisory lock in production —
    // so overlapping cron/manual refreshes on ANY instances produce the union;
    // the in-process week lock remains as a same-instance optimization. Commit
    // time/seq are captured inside the boundary, immediately after the write.
    const outcome = await withGameStatsWeekLock(year, week, seasonType, () =>
      withDurableGameStatsWeek(year, week, seasonType, async (durable) => {
        const prior = await durable.read();
        const merge = mergeWeeklyGameStats(prior, classification.games, { fetchStartedAt });
        // `changed` is false when a prior record already holds identical rows OR
        // when every incoming row was dropped (keyless / non-authoritative).
        // Either way nothing may be rewritten — especially not an empty record
        // over a cold key, which would advance last-success for zero coverage.
        if (!merge.changed) {
          return { kind: 'no-change' as const, prior: prior ?? null };
        }
        const result: WeeklyGameStats = {
          year,
          week,
          seasonType,
          fetchStartedAt,
          fetchedAt: new Date().toISOString(),
          games: merge.games,
        };
        // Durable write FIRST; refresh status advances only after the merged
        // record is committed (rereview findings #3/#6).
        await durable.write(result);
        return {
          kind: 'committed' as const,
          result,
          rowsCommitted: merge.rowsCommitted,
          committedAt: new Date().toISOString(),
          commitSeq: nextProviderCommitSeq(),
        };
      })
    );

    if (outcome.kind === 'no-change') {
      await recordProviderRefreshNoop('game-stats', gameStatsScope, { attempt, source: 'cfbd' });
      return NextResponse.json({
        ...(outcome.prior ?? { year, week, seasonType, fetchedAt: null, games: [] }),
        meta: {
          cache: 'miss',
          source: 'cfbd',
          outcome: 'noop',
          noopReason: 'no-new-rows',
          rowsCommitted: 0,
          rowsCached: outcome.prior?.games.length ?? 0,
        },
      });
    }

    await recordProviderRefreshSuccess('game-stats', gameStatsScope, {
      attempt,
      committedAt: outcome.committedAt,
      commitSeq: outcome.commitSeq,
      source: 'cfbd',
      rowsCommitted: outcome.rowsCommitted,
    });

    return NextResponse.json({
      ...outcome.result,
      meta: {
        cache: 'miss',
        source: 'cfbd',
        outcome: 'committed',
        rowsCommitted: outcome.rowsCommitted,
        rowsCached: outcome.result.games.length,
      },
    });
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
