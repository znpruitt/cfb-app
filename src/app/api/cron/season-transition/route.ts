import { NextResponse } from 'next/server';

import { getLeagues, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { setAppState } from '@/lib/server/appStateStore';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import { mapCfbdScheduleGame, type ScheduleItem } from '@/lib/schedule/cfbdSchedule';
import { hasRequiredSeasonTypeFailure, type ScheduleSeasonType } from '@/lib/scheduleSeasonFetch';
import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import {
  getScheduleProbeState,
  saveScheduleProbeState,
  deriveFirstGameDate,
  type ScheduleProbeState,
} from '@/lib/scheduleProbe';
import type { CacheEntry } from '@/app/api/schedule/cache';

export const dynamic = 'force-dynamic';

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
  // PLATFORM-085B: set when a transition schedule refresh was requested but at
  // least one partition (regular/postseason) failed or was uncertain, so no
  // partial schedule was committed and prior-good durable state was retained.
  partialFailure?: boolean;
  failedSeasonTypes?: ScheduleSeasonType[];
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
    return NextResponse.json({ years: [], error }, { status: 401 });
  }

  const result: CronResult = { years: [] };

  try {
    // A. Find preseason leagues and group by year
    const leagues = await getLeagues();
    const preseasonLeagues = leagues.filter((l) => l.status?.state === 'preseason');
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

        // Fetch schedule from CFBD for both regular and postseason.
        const { items, failedSeasonTypes } = await fetchCfbdSchedule(targetYear);

        // Transition schedule completeness gate (PLATFORM-085B). The cron
        // requests BOTH the regular and postseason partitions, so ALL requested
        // partitions must resolve without a fetch/schema failure before this is
        // published as a complete transition schedule. A partition that threw,
        // returned a non-array, or normalized a nonempty payload to zero rows is
        // UNCERTAINTY (not valid absence) — committing partial rows here would
        // let downstream standings/Insights/rollover treat an incomplete
        // schedule as complete fresh state.
        const incomplete = hasRequiredSeasonTypeFailure('all', failedSeasonTypes);

        if (incomplete) {
          // Uncertain/partial: retain prior-good durable schedule + probe state.
          // Do NOT overwrite the durable cache, update the probe, or transition
          // from this fetch. `cached` stays false; the next cron run retries.
          yearResult.partialFailure = true;
          yearResult.failedSeasonTypes = failedSeasonTypes;
        } else if (items.length > 0) {
          // Complete refresh with data. Durable-first (PLATFORM-085A): persist
          // the schedule, then the probe. (The cron keeps no process-memory
          // schedule cache; standings invalidation runs on the status flip
          // below, only after the durable status write.)
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
        // else: complete but genuinely zero games yet (both partitions fetched
        // OK and legitimately empty). Nothing to cache/probe — leave prior-good
        // durable state untouched and retry on a later run rather than
        // overwriting a good schedule with an empty snapshot.
      }

      yearResult.firstGameDate = probeState?.firstGameDate ?? null;

      // Season transition check — only for THIS year's leagues
      if (probeState?.firstGameDate) {
        const firstGameMs = new Date(probeState.firstGameDate).getTime();
        const oneDayBeforeMs = firstGameMs - 24 * 60 * 60 * 1000;

        if (nowMs >= oneDayBeforeMs) {
          for (const league of yearLeagues) {
            await updateLeagueStatus(league.slug, { state: 'season', year: targetYear });
            yearResult.leagues.push(league.slug);
            // Invalidate immediately on the status flip — this is the change that
            // alters the standings surface (preseason owner list → live season
            // standings) AND drops the league from future cron-transition retries
            // (the route only re-processes `preseason` leagues). It must not be
            // gated behind the separate year-sync write below: if that threw, the
            // league would be stranded in `season` with a stale preseason snapshot
            // and no retry to re-invalidate.
            invalidateStandings(league.slug);
            await updateLeague(league.slug, { year: targetYear });
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

type TransitionScheduleFetch = {
  items: ScheduleItem[];
  /** Requested partitions that failed or were uncertain (not valid absence). */
  failedSeasonTypes: ScheduleSeasonType[];
};

/**
 * Fetch the full season schedule from CFBD (regular + postseason) for a
 * transition refresh, reporting per-partition completeness.
 *
 * PLATFORM-085B: the caller must be able to distinguish a COMPLETE result from
 * a PARTIAL/UNCERTAIN one so it never commits partial rows as a complete
 * transition schedule. A season-type is reported in `failedSeasonTypes` when its
 * fetch throws, returns a non-array payload, or normalizes a NONEMPTY payload to
 * zero rows (schema drift). An EMPTY provider payload (`games.length === 0`) is
 * treated as legitimate valid absence (e.g. postseason before bowl season), NOT
 * a failure.
 */
async function fetchCfbdSchedule(year: number): Promise<TransitionScheduleFetch> {
  const seasonTypes: ScheduleSeasonType[] = ['regular', 'postseason'];
  // Read the key at call time (not a module-load const) so it tracks env
  // rotation and stays consistent with the scores/schedule routes.
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';

  if (!cfbdApiKey) {
    console.error('CRON season-transition: CFBD_API_KEY not configured');
    // Never attempted → every requested partition is uncertain, not "empty".
    return { items: [], failedSeasonTypes: [...seasonTypes] };
  }

  const allItems: ScheduleItem[] = [];
  const failedSeasonTypes: ScheduleSeasonType[] = [];

  for (const seasonType of seasonTypes) {
    try {
      const url = buildCfbdGamesUrl({ year, seasonType });
      const games = await fetchUpstreamJson<unknown[]>(url.toString(), {
        headers: { Authorization: `Bearer ${cfbdApiKey}` },
        timeoutMs: 15_000,
        retry: RETRY_POLICY,
      });

      if (!Array.isArray(games)) {
        console.error(
          `CRON season-transition: ${seasonType} ${year} returned a non-array payload (uncertain)`
        );
        failedSeasonTypes.push(seasonType);
        continue;
      }

      let mapped = 0;
      for (const raw of games) {
        const result = mapCfbdScheduleGame(raw as Record<string, unknown>, seasonType);
        if (result.ok) {
          allItems.push(result.item);
          mapped += 1;
        }
      }

      // A NONEMPTY payload that normalizes to ZERO rows is schema drift, not
      // valid absence — treat as uncertainty so it cannot masquerade as a
      // successfully-empty partition and stall the transition on bad data.
      if (games.length > 0 && mapped === 0) {
        console.error(
          `CRON season-transition: ${seasonType} ${year} normalized ${games.length} rows to zero (schema drift?)`
        );
        failedSeasonTypes.push(seasonType);
      }
    } catch (err) {
      console.error(`CRON season-transition: failed to fetch ${seasonType} for ${year}`, err);
      failedSeasonTypes.push(seasonType);
    }
  }

  allItems.sort((a, b) => a.week - b.week || (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  return { items: allItems, failedSeasonTypes };
}
