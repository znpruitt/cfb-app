import { NextResponse } from 'next/server';

import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats, setCachedGameStats } from '@/lib/gameStats/cache';
import { normalizeGameTeamStats } from '@/lib/gameStats/normalizers';
import type { RawGameTeamStats, WeeklyGameStats } from '@/lib/gameStats/types';
import { getAppState } from '@/lib/server/appStateStore';
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

  // Build a map of (week, seasonType) → latest game startDate
  const slateMaxDate = new Map<string, number>();
  const completedThreshold = now - 6 * 60 * 60 * 1000;

  for (const item of items) {
    if (!item.startDate) continue;
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

  if (!CFBD_API_KEY) {
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

    // Check if we already have fresh stats for this week
    const existing = await getCachedGameStats(year, week, seasonType);
    if (existing) {
      return NextResponse.json({
        ...emptyResult,
        week,
        seasonType,
        skipped: `week ${week} ${seasonType} already cached at ${existing.fetchedAt}`,
      });
    }

    // Fetch from CFBD
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const rawGames = await fetchUpstreamJson<RawGameTeamStats[]>(cfbdUrl.toString(), {
      headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
      timeoutMs: 15_000,
      retry: RETRY_POLICY,
      pacing: PACING_POLICY,
    });

    const games = normalizeGameTeamStats(rawGames, week, seasonType);
    const fetchedAt = new Date().toISOString();

    const result: WeeklyGameStats = {
      year,
      week,
      seasonType,
      fetchedAt,
      games,
    };

    await setCachedGameStats(result);

    return NextResponse.json({
      year,
      week,
      seasonType,
      gamesProcessed: games.length,
      fetchedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { ...emptyResult, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 }
    );
  }
}
