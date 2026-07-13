import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats, setCachedGameStats } from '@/lib/gameStats/cache';
import {
  classifyGameStatsPayload,
  expectsGameStats,
  hasUsableGameStats,
} from '@/lib/gameStats/coverage';
import type { RawGameTeamStats, WeeklyGameStats } from '@/lib/gameStats/types';
import { getAppState } from '@/lib/server/appStateStore';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import type { CacheEntry } from '@/app/api/schedule/cache';

export const dynamic = 'force-dynamic';

const CFBD_API_KEY = process.env.CFBD_API_KEY ?? '';

const RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 429, 500, 502, 503, 504],
} as const;

const PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

type CronResult = {
  year: number;
  week: number | null;
  seasonType: CfbdSeasonType | null;
  gamesProcessed: number;
  fetchedAt: string | null;
  skipped?: string;
  error?: string;
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

/**
 * Determine the most recently completed week from the cached schedule.
 * Looks at game start dates relative to now to find the latest week
 * with games that have already been played.
 */
async function findLatestCompletedWeek(
  year: number
): Promise<{ week: number; seasonType: CfbdSeasonType } | null> {
  // Check regular season schedule cache first
  const cacheKey = `${year}-all-all`;
  const stored = await getAppState<CacheEntry>('schedule', cacheKey);
  if (!stored?.value?.items?.length) return null;

  const now = Date.now();
  const items = stored.value.items;

  // Build a map of (week, seasonType) → latest game startDate. Only STAT-PRODUCING
  // games count (5th-review finding #1): a disrupted game (canceled/postponed/…)
  // never yields team stats, so a slate composed solely of them contributes
  // nothing and is never selected — otherwise every cron run would re-spend CFBD
  // quota on a permanently unresolvable week (its cache can never be "usable").
  const slateMaxDate = new Map<string, number>();
  const completedThreshold = now - 6 * 60 * 60 * 1000;

  for (const item of items) {
    if (!item.startDate) continue;
    if (!expectsGameStats(item.status)) continue;
    const gameTime = new Date(item.startDate).getTime();
    if (gameTime > completedThreshold) continue;

    const seasonType: CfbdSeasonType = item.seasonType === 'postseason' ? 'postseason' : 'regular';
    const key = `${item.week}:${seasonType}`;
    const prev = slateMaxDate.get(key) ?? 0;
    if (gameTime > prev) slateMaxDate.set(key, gameTime);
  }

  if (slateMaxDate.size === 0) return null;

  // Select the slate whose most recent game is latest by calendar date
  let bestKey: string | null = null;
  let bestDate = 0;
  for (const [key, maxDate] of slateMaxDate) {
    if (maxDate > bestDate) {
      bestDate = maxDate;
      bestKey = key;
    }
  }

  if (!bestKey) return null;
  const [weekStr, seasonType] = bestKey.split(':');
  return { week: parseInt(weekStr, 10), seasonType: seasonType as CfbdSeasonType };
}

export async function GET(req: Request): Promise<NextResponse<CronResult>> {
  const authResult = verifyCronSecret(req);
  if (authResult !== 'ok') {
    const error =
      authResult === 'not-configured'
        ? 'CRON_SECRET is not configured on the server'
        : 'unauthorized: Bearer token did not match CRON_SECRET';
    return NextResponse.json(
      { year: 0, week: null, seasonType: null, gamesProcessed: 0, fetchedAt: null, error },
      { status: 401 }
    );
  }

  const year = seasonYearForToday();
  const emptyResult: CronResult = {
    year,
    week: null,
    seasonType: null,
    gamesProcessed: 0,
    fetchedAt: null,
  };

  // Operational auto-refresh control (PLATFORM-086A): game-stats is a
  // NONCRITICAL ingestion job, so it honors the global pause and its per-dataset
  // enable flag. Manual admin refresh (/api/game-stats?bypassCache=1) stays
  // available even when paused. (The lifecycle-critical season-transition cron is
  // exempt and does not call this.)
  if (!(await isAutoRefreshAllowed('game-stats'))) {
    return NextResponse.json({
      ...emptyResult,
      skipped: 'automatic game-stats refresh is paused or disabled',
    });
  }

  if (!CFBD_API_KEY) {
    // Missing credential on an unpaused cron: record a failed attempt so the
    // panel shows the automatic refresh is broken (rereview finding #5), then
    // return the established safe response. Prior-good data is preserved.
    const attempt = await beginProviderRefreshAttempt('game-stats', {
      startedAt: new Date().toISOString(),
    });
    await recordProviderRefreshFailure('game-stats', {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return NextResponse.json(
      { ...emptyResult, error: 'CFBD_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    const latest = await findLatestCompletedWeek(year);
    if (!latest) {
      return NextResponse.json({
        ...emptyResult,
        skipped: 'no completed weeks found in cached schedule',
      });
    }

    const { week, seasonType } = latest;

    // Skip only when we already have USABLE stats for this week. A cached record
    // with `games: []` (CFBD returned no rows, or every row was dropped during
    // normalization) is NOT coverage — treating a bare key as cached would leave
    // an empty week permanently skipped on every subsequent run (4th-review
    // finding #3). Re-fetching an empty week is bounded by the cron cadence and
    // its pause/enable gate, so this cannot spin: it self-resolves once CFBD
    // publishes the week's stats.
    const existing = await getCachedGameStats(year, week, seasonType);
    if (hasUsableGameStats(existing)) {
      return NextResponse.json({
        ...emptyResult,
        week,
        seasonType,
        skipped: `week ${week} ${seasonType} already cached at ${existing?.fetchedAt}`,
      });
    }

    // Fetch from CFBD
    const attempt = await beginProviderRefreshAttempt('game-stats', {
      startedAt: new Date().toISOString(),
    });

    try {
      const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
      const rawGames = await fetchUpstreamJson<RawGameTeamStats[]>(cfbdUrl.toString(), {
        headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
        timeoutMs: 15_000,
        retry: RETRY_POLICY,
        pacing: PACING_POLICY,
      });

      // Classify the provider response before committing (5th-review finding #5).
      const classification = classifyGameStatsPayload(rawGames, week, seasonType);
      if (classification.kind === 'noop') {
        // Genuine empty provider array (stats not published yet): a no-op, NOT a
        // durable commit. Writing `games: []` would advance last-success while
        // `hasUsableGameStats` still treats the week as uncovered — a contradiction.
        await recordProviderRefreshNoop('game-stats', { attempt, source: 'cfbd' });
        return NextResponse.json({
          year,
          week,
          seasonType,
          gamesProcessed: 0,
          fetchedAt: null,
          skipped: `week ${week} ${seasonType}: provider returned no game stats yet (no-op)`,
        });
      }
      if (classification.kind === 'no-usable-rows') {
        // A NONEMPTY payload that normalized to zero usable rows is schema
        // drift/validation failure — preserve prior-good, record failed, do not
        // advance last-success.
        await recordProviderRefreshFailure('game-stats', {
          attempt,
          error: `week ${week} ${seasonType}: provider returned rows but none normalized to a usable game stat`,
          code: 'game-stats-no-usable-rows',
          status: 502,
        });
        return NextResponse.json(
          { ...emptyResult, week, seasonType, error: 'game-stats-no-usable-rows' },
          { status: 502 }
        );
      }

      const { games } = classification;
      const fetchedAt = new Date().toISOString();

      const result: WeeklyGameStats = {
        year,
        week,
        seasonType,
        fetchedAt,
        games,
      };

      await setCachedGameStats(result);
      // Durable commit time + sequence for success ordering (rereview findings #3/#6).
      const committedAt = new Date().toISOString();
      const commitSeq = nextProviderCommitSeq();

      await recordProviderRefreshSuccess('game-stats', {
        attempt,
        committedAt,
        commitSeq,
        source: 'cfbd',
        rowsCommitted: games.length,
      });

      return NextResponse.json({
        year,
        week,
        seasonType,
        gamesProcessed: games.length,
        fetchedAt,
      });
    } catch (err) {
      await recordProviderRefreshFailure('game-stats', {
        attempt,
        error: err instanceof Error ? err.message : 'unknown error',
      });
      throw err;
    }
  } catch (err) {
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }
}
