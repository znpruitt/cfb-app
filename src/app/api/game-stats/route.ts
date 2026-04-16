import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats, setCachedGameStats } from '@/lib/gameStats/cache';
import { normalizeGameTeamStats } from '@/lib/gameStats/normalizers';
import type { RawGameTeamStats, WeeklyGameStats } from '@/lib/gameStats/types';
import { requireAdminRequest } from '@/lib/server/adminAuth';

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
        { error: `year must be an integer between ${minYear} and ${maxYear}`, field: 'year', value: yearParam },
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

  const seasonType: CfbdSeasonType =
    seasonTypeParam === 'postseason' ? 'postseason' : 'regular';

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

  // Fetch from CFBD
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    return NextResponse.json(
      { error: 'CFBD_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const rawGames = await fetchUpstreamJson<RawGameTeamStats[]>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });

    const games = normalizeGameTeamStats(rawGames, week, seasonType);

    const result: WeeklyGameStats = {
      year,
      week,
      seasonType,
      fetchedAt: new Date().toISOString(),
      games,
    };

    await setCachedGameStats(result);

    return NextResponse.json({
      ...result,
      meta: { cache: 'miss', source: 'cfbd' },
    });
  } catch (error) {
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
