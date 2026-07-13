import { NextResponse } from 'next/server';

import { getLeagues, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import { mapCfbdScheduleGame, type ScheduleItem } from '@/lib/schedule/cfbdSchedule';
import {
  classifyEmptyScheduleRefresh,
  hasRequiredSeasonTypeFailure,
  type ScheduleSeasonType,
} from '@/lib/scheduleSeasonFetch';
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
      // Set when THIS run's probe cannot be trusted as a currently-valid schedule
      // (an unexpected empty replacement) — the league must not flip off it; the
      // next cron run retries once the provider recovers (finding #2).
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

        // Provider-refresh observability (PLATFORM-086A): the season-transition
        // cron is the schedule dataset's only automatic refresh. It is
        // lifecycle-critical and EXEMPT from the global auto-refresh pause, but
        // its probe outcome is still recorded so operators can see when the
        // schedule was last (successfully) refreshed. Multiple probed years in
        // one run are last-write-wins on the shared schedule status key.
        const scheduleAttempt = await beginProviderRefreshAttempt('schedule', {
          startedAt: new Date(nowMs).toISOString(),
        });

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
          await recordProviderRefreshFailure('schedule', {
            attempt: scheduleAttempt,
            error: `season-transition probe incomplete (missing: ${failedSeasonTypes.join(', ') || 'unknown'})`,
            partialFailure: true,
            failedPartitions: failedSeasonTypes,
          });
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
          let committedAt: string;
          let commitSeq: number;
          try {
            await setAppState('schedule', cacheKey, cacheEntry);
            // Capture the durable COMMIT time + sequence immediately, BEFORE the
            // probe save below, so success ordering uses the commit time — not the
            // later status-call time after probe work (rereview findings #3/#6).
            committedAt = new Date().toISOString();
            commitSeq = nextProviderCommitSeq();
          } catch (persistError) {
            // The schedule fetch succeeded but the durable commit failed: resolve
            // the open attempt as failed rather than letting it dangle
            // `in-progress` when the outer catch returns 500 (rereview finding #2).
            // Prior-good durable schedule is preserved.
            await recordProviderRefreshFailure('schedule', {
              attempt: scheduleAttempt,
              error:
                persistError instanceof Error
                  ? persistError.message
                  : 'season-transition schedule commit failed',
              code: 'schedule-durable-commit-failed',
              status: 500,
            });
            throw persistError;
          }
          yearResult.cached = true;

          // The durable schedule is committed → record success now (before the
          // probe bookkeeping). A probe-save failure below is a separate concern
          // that does NOT falsify the schedule commit, so it must not turn this
          // into a "failed" schedule refresh; it propagates to the outer 500
          // handler while the attempt stays truthfully resolved as success.
          await recordProviderRefreshSuccess('schedule', {
            attempt: scheduleAttempt,
            committedAt,
            commitSeq,
            source: 'cfbd',
            rowsCommitted: items.length,
          });

          // Derive first game date + save probe state.
          const firstGameDate = deriveFirstGameDate(items);
          const newProbeState: ScheduleProbeState = {
            year: targetYear,
            baseCachedAt: probeState?.baseCachedAt ?? now.toISOString(),
            firstGameDate,
          };
          await saveScheduleProbeState(newProbeState);
          probeState = newProbeState;
        } else {
          // Both partitions fetched OK and produced zero rows. Classify with the
          // SAME shared policy as the authorized schedule route (6th-review
          // finding #2) so the two paths cannot drift: an empty probe OVER a
          // populated prior-good schedule is an unexpected empty replacement
          // (reject + retain prior-good + block the transition this run), while a
          // genuinely unpublished/inapplicable empty probe is a valid no-op.
          let priorDurableRows: number;
          try {
            const priorDurable = await getAppState<CacheEntry>('schedule', `${targetYear}-all-all`);
            priorDurableRows = priorDurable?.value?.items?.length ?? 0;
          } catch (readError) {
            // The prior durable schedule read failed while classifying an empty
            // probe (transient app-state outage). A read failure is NOT a
            // classification result — we cannot confirm whether a populated
            // schedule already exists, so we must not transition off this
            // unverifiable probe. Resolve the OPEN attempt as failed (mirroring the
            // durable-commit-failure path above) rather than leaving it
            // `in-progress`, retain prior-good schedule/probe (nothing written), and
            // rethrow to the outer handler's established safe 500 response. The
            // lifecycle transition for this year is skipped.
            await recordProviderRefreshFailure('schedule', {
              attempt: scheduleAttempt,
              error: `season-transition probe for ${targetYear}: prior durable schedule could not be read while classifying an empty provider response — cannot safely determine prior schedule state (${readError instanceof Error ? readError.message : 'unknown read error'})`,
              code: 'schedule-prior-cache-read-failed',
              status: 500,
            });
            throw readError;
          }
          const classification = classifyEmptyScheduleRefresh({
            mappedRows: 0,
            priorDurableRows,
          });
          if (classification === 'unexpected-empty-replacement') {
            // Do NOT overwrite the durable schedule/probe — retain prior-good — and
            // do NOT transition off an empty probe: we cannot confirm a currently
            // valid schedule, so defer the flip to a run where the probe validates.
            yearResult.partialFailure = true;
            transitionBlocked = true;
            await recordProviderRefreshFailure('schedule', {
              attempt: scheduleAttempt,
              error: `season-transition probe returned zero games for ${targetYear} while a populated schedule is cached — rejected as an unexpected empty replacement`,
              code: 'schedule-empty-replacement-rejected',
              status: 502,
            });
          } else {
            // Valid absence (a future season not yet published): leave prior-good
            // durable state untouched and resolve the attempt as a NO-OP so it
            // neither dangles `in-progress` nor advances last-success with zero rows.
            await recordProviderRefreshNoop('schedule', {
              attempt: scheduleAttempt,
              source: 'cfbd',
            });
          }
        }
      }

      yearResult.firstGameDate = probeState?.firstGameDate ?? null;

      // Season transition check — only for THIS year's leagues. Skipped when this
      // run's probe was a rejected empty replacement (finding #2): a league flips
      // only off a probe we can currently trust, never off an empty-provider day.
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
