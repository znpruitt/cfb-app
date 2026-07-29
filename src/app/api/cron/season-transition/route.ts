import { NextResponse } from 'next/server';

import { getLeagues, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import type { ScheduleSeasonType } from '@/lib/scheduleSeasonFetch';
import {
  getScheduleProbeState,
  saveScheduleProbeState,
  deriveFirstGameDate,
  type ScheduleProbeState,
} from '@/lib/scheduleProbe';

export const dynamic = 'force-dynamic';

type YearResult = {
  year: number;
  probed: boolean;
  cached: boolean;
  transitioned: boolean;
  leagues: string[];
  firstGameDate: string | null;
  // PLATFORM-085B: set when a transition schedule refresh was requested but the
  // shared authority did not durably commit a complete populated schedule this run
  // (a failed/drifted/empty-replacement partition), so no partial schedule was
  // committed and prior-good durable state was retained.
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

    // Set when the shared authority reports a genuine store outage (prior-state
    // read failure or durable commit failure) for any year — surfaced as a 500 to
    // preserve the pre-migration HTTP behavior, after every year is processed.
    let fatalStoreError: string | null = null;

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
      // Set when THIS run's probe cannot be trusted as a currently-valid schedule
      // (a failed/stale/rejected refresh) — the league must not flip off it; the
      // next cron run retries once the shared authority commits a clean schedule.
      let transitionBlocked = false;

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

        // The season-transition cron is the schedule dataset's only automatic
        // refresh. It is lifecycle-critical and drives the SHARED full-season
        // schedule authority (PLATFORM-086E1A) — one completeness-checked,
        // observation-ordered, concurrency-safe writer that owns the lease, the
        // regular+postseason fetch, the durable commit, standings invalidation, and
        // the provider-refresh status (recorded against THIS year's scope). It is
        // EXEMPT from the operator auto-refresh pause because the authority applies
        // no pause gate. The cron consumes the authority's CONFIRMED result — it
        // never refetches the provider or re-records status.
        const refresh = await refreshFullSeasonSchedule({ year: targetYear, now: nowMs });

        if (refresh.status === 'success' && refresh.items.length > 0) {
          // Complete refresh with data — the authority already committed durably.
          // Derive first game date + save probe state.
          yearResult.cached = true;
          const firstGameDate = deriveFirstGameDate(refresh.items);
          const newProbeState: ScheduleProbeState = {
            year: targetYear,
            baseCachedAt: probeState?.baseCachedAt ?? now.toISOString(),
            firstGameDate,
          };
          await saveScheduleProbeState(newProbeState);
          probeState = newProbeState;
        } else if (refresh.status === 'no-op' && refresh.reason === 'empty-response') {
          // Genuinely unpublished / inapplicable absence (a future season not yet
          // published): retain prior-good, do not update the probe, and do not
          // block the transition. For a genuinely-absent year there is no
          // `firstGameDate`, so the transition gate below naturally skips.
        } else {
          // Every other outcome — a failed/drifted/empty-replacement partition, a
          // stale observation, lease contention, missing credentials, or a durable
          // commit failure — means we did NOT confirm a clean schedule this run. The
          // authority retained prior-good durable state and recorded the outcome in
          // provider-status; the league must NOT flip off unconfirmed data. Block
          // the transition this run; the next run retries.
          if (refresh.status === 'failure') {
            yearResult.partialFailure = true;
            if (refresh.failedSeasonTypes.length > 0) {
              yearResult.failedSeasonTypes = refresh.failedSeasonTypes;
            }
            // A genuine store outage (prior-state read or durable commit) surfaces as
            // a 500 (pre-migration behavior), while still recording this year's
            // partialFailure. Data/partition/empty-replacement failures stay 200.
            if (
              refresh.reason === 'canonical-context-unavailable' ||
              refresh.reason === 'durable-commit-failed'
            ) {
              fatalStoreError =
                refresh.reason === 'canonical-context-unavailable'
                  ? `schedule ${targetYear}: prior durable schedule state unreadable`
                  : `schedule ${targetYear}: durable schedule commit failed`;
            }
          }
          transitionBlocked = true;
        }
      }

      yearResult.firstGameDate = probeState?.firstGameDate ?? null;

      // Season transition check — only for THIS year's leagues. Skipped when this
      // run could not confirm a currently-valid schedule (transitionBlocked): a
      // league flips only off a probe we can currently trust, never off a
      // failed/stale/empty-provider run.
      if (probeState?.firstGameDate && !transitionBlocked) {
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

    if (fatalStoreError) {
      result.error = fatalStoreError;
      return NextResponse.json(result, { status: 500 });
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
