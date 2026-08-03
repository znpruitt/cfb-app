import { NextResponse } from 'next/server';

import { completeSeasonTransition, getLeagues } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import { refreshSchedulePresentation } from '@/lib/schedule/schedulePresentationRefresh';
import type { ScheduleSeasonType } from '@/lib/scheduleSeasonFetch';
import {
  getScheduleProbeState,
  saveScheduleProbeState,
  deriveFirstGameDate,
  type ScheduleProbeState,
} from '@/lib/scheduleProbe';
import type { FullSeasonScheduleRefreshStatus } from '@/lib/schedule/fullSeasonScheduleRefreshResult';
import {
  aggregateLifecycleCronReason,
  aggregateLifecycleCronResult,
  createSeasonTransitionCronExecutionState,
  emitSeasonTransitionCronExecutionEvent,
  type LifecycleCronExecutionResult,
  type SeasonTransitionCronYearExecution,
} from '@/lib/lifecycleCronExecutionLog';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
  seasonTransitionYearsTarget,
} from '@/lib/server/schedulerExecutionStatus';

export const dynamic = 'force-dynamic';

/** Map an E1A refresh status onto the lifecycle per-year result (no transition). */
function e1aStatusToResult(status: FullSeasonScheduleRefreshStatus): LifecycleCronExecutionResult {
  return status === 'success'
    ? 'success'
    : status === 'no-op'
      ? 'no-op'
      : status === 'in-progress'
        ? 'in-progress'
        : 'failure';
}

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
  // PLATFORM-086F2H1: set only when the guarded transition REFUSED a league
  // because it was no longer in `preseason` for this target year at write time.
  // Absent on the ordinary path, so unchanged runs stay byte-identical. Refused
  // leagues never appear in `leagues` and never set `transitioned`.
  refusedLeagues?: string[];
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
  // PLATFORM-086F2E2A — one secret-safe `season-transition-cron` runtime event
  // per invocation (emitted from the single outer `finally`, auth failures
  // included) plus one latest-only durable receipt per AUTHENTICATED invocation.
  // The tracker is completed from the SAME typed E1A decisions and confirmed
  // lifecycle counts the response already uses; every existing HTTP response,
  // lifecycle decision, probe policy, E1A behavior, standings invalidation, and
  // presentation triggering is unchanged.
  const startedAtMs = Date.now();
  const exec = createSeasonTransitionCronExecutionState();
  // Alias the per-year entries into the tracker immediately so a defensive throw
  // mid-loop still carries the already-completed years into the event/receipt.
  const entries: SeasonTransitionCronYearExecution[] = [];
  exec.years = entries;
  let receiptInvocationId: string | null = null;

  const result: CronResult = { years: [] };

  try {
    // Secure: require CRON_SECRET (unchanged order).
    const authResult = verifyCronSecret(req);
    if (authResult !== 'ok') {
      exec.reason =
        authResult === 'not-configured'
          ? 'cron-secret-not-configured'
          : 'cron-authorization-invalid';
      const error =
        authResult === 'not-configured'
          ? 'CRON_SECRET is not configured on the server — set it in Vercel environment variables'
          : 'unauthorized: Bearer token did not match CRON_SECRET';
      return NextResponse.json({ years: [], error }, { status: 401 });
    }
    receiptInvocationId = createSchedulerInvocationId();

    // A. Find preseason leagues and group by year
    let leagues: Awaited<ReturnType<typeof getLeagues>>;
    try {
      leagues = await getLeagues();
    } catch (err) {
      // A registry read failure is the same 500 as before; the event/receipt
      // record the typed `registry-unavailable` reason.
      exec.reason = 'registry-unavailable';
      result.error = err instanceof Error ? err.message : 'unknown error';
      return NextResponse.json(result, { status: 500 });
    }
    const preseasonLeagues = leagues.filter((l) => l.status?.state === 'preseason');
    if (preseasonLeagues.length === 0) {
      exec.result = 'skipped';
      exec.reason = 'no-preseason-leagues';
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
      // The event entry for THIS year, completed alongside `yearResult`.
      const yearEntry: SeasonTransitionCronYearExecution = {
        year: targetYear,
        result: 'failure',
        reason: 'unexpected-error',
        scheduleRefreshReason: null,
        providerCallAttempted: false,
        targetLeagues: yearLeagues.length,
        probed: false,
        cached: false,
        transitionedLeagues: 0,
        failedSeasonTypes: [],
      };
      // Marks which throwable operation is in flight, so a propagating throw is
      // classified into the right typed per-year reason before it reaches the
      // outer catch (which produces the SAME 500 response as before).
      let phase: 'other' | 'probe-read' | 'probe-write' | 'lifecycle-write' = 'other';
      // The E1A refresh STATUS this run, captured verbatim from the typed result
      // when a refresh ran (null when the year was not probed). The per-year event
      // result is mapped from this status directly — never re-derived from the
      // reason vocabulary, which could drift from E1A's actual status.
      let refreshStatus: FullSeasonScheduleRefreshStatus | null = null;
      // Set when THIS run's probe cannot be trusted as a currently-valid schedule
      // (a failed/stale/rejected refresh) — the league must not flip off it; the
      // next cron run retries once the shared authority commits a clean schedule.
      let transitionBlocked = false;
      // PLATFORM-086F2H1: leagues the guarded transition refused this year — this
      // run's snapshot had gone stale for them. Refusals are neither successes nor
      // failures, so they are tracked separately from `yearResult.leagues`.
      const refusedLeagues: string[] = [];
      // PLATFORM-086E1C2: set ONLY by a qualifying populated E1A success this run
      // and consumed AFTER this year's probe/lifecycle/standings work, so the
      // optional presentation refresh can never precede or delay lifecycle truth.
      let shouldRefreshPresentation = false;

      try {
        // Schedule probe logic
        phase = 'probe-read';
        let probeState = await getScheduleProbeState(targetYear);
        phase = 'other';

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
          yearEntry.probed = true;

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
          refreshStatus = refresh.status;
          yearEntry.scheduleRefreshReason = refresh.reason;
          yearEntry.providerCallAttempted = refresh.providerCallAttempted;

          if (refresh.status === 'success' && refresh.items.length > 0) {
            // Complete refresh with data — the authority already committed durably.
            // Derive first game date + save probe state.
            yearResult.cached = true;
            yearEntry.cached = true;
            const firstGameDate = deriveFirstGameDate(refresh.items);
            const newProbeState: ScheduleProbeState = {
              year: targetYear,
              baseCachedAt: probeState?.baseCachedAt ?? now.toISOString(),
              firstGameDate,
            };
            phase = 'probe-write';
            await saveScheduleProbeState(newProbeState);
            phase = 'other';
            probeState = newProbeState;
            // PLATFORM-086E1C2: freshly confirmed canonical data qualifies this year
            // for ONE best-effort presentation refresh AFTER the lifecycle work below.
            shouldRefreshPresentation = true;
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
                yearEntry.failedSeasonTypes = [...refresh.failedSeasonTypes];
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
            phase = 'lifecycle-write';
            for (const league of yearLeagues) {
              // PLATFORM-086F2H1 — GUARDED transition. `yearLeagues` came from the
              // registry snapshot read at the top of this run, before the schedule
              // work above; by now another actor may have rolled this league over,
              // moved it to a different preseason year, or transitioned it already.
              // The authority re-checks `preseason` + the exact target year inside
              // its transaction and refuses otherwise, so a stale snapshot can never
              // overwrite newer lifecycle state. One lifecycle write per confirmed
              // transition synchronizes league.year to targetYear in the same
              // registry record, so there is no separate year-sync write that could
              // strand a transitioned league.
              const transition = await completeSeasonTransition(league.slug, targetYear);
              if (transition.outcome !== 'transitioned') {
                // Refused, not failed: record it truthfully and count nothing.
                refusedLeagues.push(league.slug);
                continue;
              }
              yearResult.leagues.push(league.slug);
              yearEntry.transitionedLeagues = yearResult.leagues.length;
              // Invalidate immediately on the CONFIRMED status flip — this is the
              // change that alters the standings surface (preseason owner list →
              // live season standings) AND drops the league from future
              // cron-transition retries (the route only re-processes `preseason`
              // leagues).
              invalidateStandings(league.slug);
            }
            phase = 'other';
            yearResult.transitioned = yearResult.leagues.length > 0;
            if (refusedLeagues.length > 0) yearResult.refusedLeagues = [...refusedLeagues];
          }
        }

        // PLATFORM-086E1C2: LIFECYCLE-FIRST ordering — the optional presentation
        // refresh runs only after this year's probe update, any preseason→season
        // status flips, standings invalidation, and league-year synchronization
        // completed above. Strictly best-effort: the E1C1 authority owns its own
        // leases/provider calls/status scopes and emits its own
        // `schedule-presentation-refresh` event (`trigger: 'season-transition'`);
        // its latency or failure never rolls back or blocks lifecycle truth, never
        // sets `partialFailure`/`fatalStoreError`, and never changes the
        // `CronResult` body or HTTP status. Called WITHOUT `now` so the
        // presentation observation/leases use a fresh post-lifecycle clock. Its
        // outcome likewise never changes the lifecycle event/receipt.
        if (shouldRefreshPresentation) {
          try {
            await refreshSchedulePresentation({ year: targetYear, trigger: 'season-transition' });
          } catch {
            // Defensive contract boundary — presentation faults are invisible here.
          }
        }

        // Classify the per-year event result from the SAME confirmed truth the
        // response uses: a clean transition supersedes the E1A reason; a stale
        // refusal supersedes both (it is the anomaly worth surfacing, and the
        // exact E1A reason is still preserved in `scheduleRefreshReason`);
        // otherwise a refresh reports its exact E1A outcome; otherwise the year
        // was not due.
        if (yearEntry.transitionedLeagues > 0 && refusedLeagues.length === 0) {
          yearEntry.result = 'success';
          yearEntry.reason = 'season-transitioned';
        } else if (refusedLeagues.length > 0) {
          // PLATFORM-086F2H1 — at least one league in this year's target set had
          // moved on by write time. Never `success`: `partial` when some sibling
          // still transitioned this run, otherwise `no-op` (every target had
          // already advanced — nothing was left for this run to do, and nothing
          // failed).
          yearEntry.result = yearEntry.transitionedLeagues > 0 ? 'partial' : 'no-op';
          yearEntry.reason = 'lifecycle-transition-refused';
        } else if (refreshStatus) {
          // A refresh ran without a transition — report its exact E1A status and
          // reason verbatim (the typed decision), never a re-derived guess.
          yearEntry.result = e1aStatusToResult(refreshStatus);
          yearEntry.reason = yearEntry.scheduleRefreshReason ?? 'unexpected-error';
        } else {
          yearEntry.result = 'skipped';
          yearEntry.reason = 'refresh-not-due';
        }

        result.years.push(yearResult);
        entries.push(yearEntry);
      } catch (err) {
        // A throwable operation (probe read/write or lifecycle write) failed. The
        // response is the SAME 500 the outer catch already produced (this year is
        // NOT pushed to `result.years`); the event/receipt record the typed
        // per-year reason and this year's completed-so-far counts, then finalize
        // the aggregate here because the post-loop aggregate is skipped by the
        // re-throw.
        if (phase === 'probe-read') {
          yearEntry.result = 'failure';
          yearEntry.reason = 'probe-state-unavailable';
        } else if (phase === 'probe-write') {
          // Canonical work was confirmed before the probe write — a truthful partial.
          yearEntry.result = 'partial';
          yearEntry.reason = 'probe-write-failed';
        } else if (phase === 'lifecycle-write') {
          // Partial when canonical work or an earlier league transition already
          // succeeded this year; otherwise a clean failure.
          const priorSuccess = yearEntry.cached || yearEntry.transitionedLeagues > 0;
          yearEntry.result = priorSuccess ? 'partial' : 'failure';
          yearEntry.reason = 'lifecycle-write-failed';
        } else {
          yearEntry.result = 'failure';
          yearEntry.reason = 'unexpected-error';
        }
        entries.push(yearEntry);
        exec.result = aggregateLifecycleCronResult(entries);
        exec.reason = aggregateLifecycleCronReason(entries, 'year-results');
        throw err;
      }
    }

    exec.result = aggregateLifecycleCronResult(entries);
    exec.reason = aggregateLifecycleCronReason(entries, 'year-results');

    if (fatalStoreError) {
      result.error = fatalStoreError;
      return NextResponse.json(result, { status: 500 });
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(result, { status: 500 });
  } finally {
    // Order the event/receipt years ASCENDING (the `byYear` map preserves league
    // registry insertion order, which is not guaranteed chronological), so the
    // bounded eight-entry receipt keeps the EARLIEST years and matches the
    // ascending multi-year convention of the sibling crons. This mutates only the
    // event/receipt array — the HTTP response's `result.years` is a separate
    // array and stays byte-identical.
    exec.years.sort((a, b) => a.year - b.year);
    emitSeasonTransitionCronExecutionEvent(exec, startedAtMs);
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'season-transition',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.years.some((entry) => entry.providerCallAttempted),
        target: seasonTransitionYearsTarget(exec.years),
      });
    }
  }

  return NextResponse.json(result);
}
