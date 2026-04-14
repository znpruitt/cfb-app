import { NextResponse } from 'next/server';

import { getLeagues, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { setAppState } from '@/lib/server/appStateStore';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import { mapCfbdScheduleGame, type ScheduleItem } from '@/lib/schedule/cfbdSchedule';
import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import {
  getScheduleProbeState,
  saveScheduleProbeState,
  deriveFirstGameDate,
  type ScheduleProbeState,
} from '@/lib/scheduleProbe';
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

type YearResult = {
  year: number;
  probed: boolean;
  cached: boolean;
  transitioned: boolean;
  leagues: string[];
  firstGameDate: string | null;
};

type CronResult = {
  years: YearResult[];
  error?: string;
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

export async function GET(req: Request): Promise<NextResponse<CronResult>> {
  // Secure: require CRON_SECRET
  const authResult = verifyCronSecret(req);
  if (authResult !== 'ok') {
    const error =
      authResult === 'not-configured'
        ? 'CRON_SECRET is not configured on the server — set it in Vercel environment variables'
        : 'unauthorized: Bearer token did not match CRON_SECRET';
    return NextResponse.json(
      { years: [], error },
      { status: 401 }
    );
  }

  const result: CronResult = { years: [] };

  try {
    // A. Find preseason leagues and group by year
    const leagues = await getLeagues();
    const preseasonLeagues = leagues.filter(
      (l) => l.status?.state === 'preseason'
    );
    if (preseasonLeagues.length === 0) {
      return NextResponse.json(result);
    }

    // Group leagues by their preseason year so each year is probed/transitioned independently
    const byYear = new Map<number, typeof preseasonLeagues>();
    for (const league of preseasonLeagues) {
      const year = (league.status as { state: 'preseason'; year: number }).year;
      const group = byYear.get(year) ?? [];
      group.push(league);
      byYear.set(year, group);
    }

    const now = new Date();
    const nowMs = now.getTime();

    // B. Process each year group independently
    for (const [targetYear, yearLeagues] of byYear) {
      const yearResult: YearResult = {
        year: targetYear,
        probed: false,
        cached: false,
        transitioned: false,
        leagues: [],
        firstGameDate: null,
      };

      // Schedule probe logic
      let probeState = await getScheduleProbeState(targetYear);

      // Fetch when:
      // 1. No cached data yet (baseCachedAt is null/missing), OR
      // 2. firstGameDate is still unknown (need to keep probing until CFBD publishes dates), OR
      // 3. Within 7 days of first game (refresh for latest schedule updates)
      const shouldFetch =
        !probeState?.baseCachedAt ||
        !probeState.firstGameDate ||
        nowMs >= new Date(probeState.firstGameDate).getTime() - 7 * 24 * 60 * 60 * 1000;

      if (shouldFetch) {
        yearResult.probed = true;

        // Fetch schedule from CFBD for both regular and postseason
        const items = await fetchCfbdSchedule(targetYear);

        if (items.length > 0) {
          // Cache via appStateStore under the same key the schedule route uses
          const cacheKey = `${targetYear}-all-all`;
          const cacheEntry: CacheEntry = {
            at: nowMs,
            items,
            partialFailure: false,
            failedSeasonTypes: [],
          };
          await setAppState('schedule', cacheKey, cacheEntry);
          yearResult.cached = true;

          // Derive first game date
          const firstGameDate = deriveFirstGameDate(items);

          // Save probe state
          const newProbeState: ScheduleProbeState = {
            year: targetYear,
            baseCachedAt: probeState?.baseCachedAt ?? now.toISOString(),
            firstGameDate,
          };
          await saveScheduleProbeState(newProbeState);
          probeState = newProbeState;
        }
      }

      yearResult.firstGameDate = probeState?.firstGameDate ?? null;

      // Season transition check — only for THIS year's leagues
      if (probeState?.firstGameDate) {
        const firstGameMs = new Date(probeState.firstGameDate).getTime();
        const oneDayBeforeMs = firstGameMs - 24 * 60 * 60 * 1000;

        if (nowMs >= oneDayBeforeMs) {
          for (const league of yearLeagues) {
            await updateLeagueStatus(league.slug, { state: 'season', year: targetYear });
            await updateLeague(league.slug, { year: targetYear });
            yearResult.leagues.push(league.slug);
          }
          yearResult.transitioned = yearResult.leagues.length > 0;
        }
      }

      result.years.push(yearResult);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}

/**
 * Fetch the full season schedule from CFBD (regular + postseason).
 * Returns normalized ScheduleItem[]. Returns empty array on failure.
 */
async function fetchCfbdSchedule(year: number): Promise<ScheduleItem[]> {
  if (!CFBD_API_KEY) {
    console.error('CRON season-transition: CFBD_API_KEY not configured');
    return [];
  }

  const seasonTypes = ['regular', 'postseason'] as const;
  const allItems: ScheduleItem[] = [];

  for (const seasonType of seasonTypes) {
    try {
      const url = buildCfbdGamesUrl({ year, seasonType });
      const games = await fetchUpstreamJson<unknown[]>(url.toString(), {
        headers: { Authorization: `Bearer ${CFBD_API_KEY}` },
        timeoutMs: 15_000,
        retry: RETRY_POLICY,
      });

      if (!Array.isArray(games)) continue;

      for (const raw of games) {
        const result = mapCfbdScheduleGame(raw as Record<string, unknown>, seasonType);
        if (result.ok) {
          allItems.push(result.item);
        }
      }
    } catch (err) {
      console.error(`CRON season-transition: failed to fetch ${seasonType} for ${year}`, err);
      // Continue with partial data if one season type fails
    }
  }

  return allItems.sort(
    (a, b) => a.week - b.week || (a.startDate ?? '').localeCompare(b.startDate ?? '')
  );
}
