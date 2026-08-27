import { NextResponse } from 'next/server';

import {
  completeSeasonTransition,
  readLeagueRegistry,
  type LeagueRegistryReadResult,
} from '@/lib/leagueRegistry';
import { isStructurallyValidSeasonYear, TEST_LEAGUE_SLUG } from '@/lib/league';
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

/**
 * PLATFORM-086F2H1B — the carried runtime-envelope deferral, resolved now that
 * this route is being touched. Per preseason year this handler serially awaits
 * the shared E1A full-season refresh (lease + two provider partitions + durable
 * commit), a probe write, the per-league lifecycle writes, and a best-effort
 * presentation refresh, so it is the longest-running route in the app and
 * previously relied entirely on the platform default.
 *
 * 300s DEPENDS ON THIS PROJECT'S CONFIRMED CONFIGURATION: Vercel Hobby with
 * Fluid Compute enabled (verified in the dashboard, 2026-08-04). Hobby WITHOUT
 * Fluid caps functions at 60s and rejects a larger value at build time, which
 * fails the whole deployment — not just this route. If Fluid is ever disabled
 * for this project, lower this value first. (300s is the Fluid/Pro default
 * ceiling, not the absolute maximum; Pro allows more.)
 *
 * The scheduler, its daily 00:00 UTC cadence in `vercel.json`, and the runtime
 * are unchanged by THIS declaration, and `vercel.json` gains no `fluid` key.
 * Nothing here should be read as a claim that the route's behavior is otherwise
 * unchanged: F2H1B rewrites its lifecycle write path, its result/reason
 * classification, and its 500-response body — see the guarded-transition work
 * below.
 */
export const maxDuration = 300;

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
  // PLATFORM-086F2H1B — the guarded dispositions for this year's snapshot
  // targets. Since PLATFORM-086F2H1T2 those are the NON-demo preseason leagues:
  // `test` is filtered out before grouping, so it never appears in
  // `targetLeagues` or any disposition. A count that looks short against Season
  // Management is that policy, not data loss.
  // `leagues` above stays the list of leagues this invocation actually
  // transitioned; these are counts only, so no slug reaches the runtime
  // event or the durable receipt. Always present once the lifecycle gate is
  // reached, so a reader never has to infer a missing count.
  targetLeagues?: number;
  transitionedLeagues?: number;
  alreadyInTargetSeasonLeagues?: number;
  removedLeagues?: number;
  refusedLeagues?: number;
};

type CronResult = {
  years: YearResult[];
  /**
   * PLATFORM-086F2H1R1 — production preseason candidates refused this run for a
   * structurally invalid `status.year`. Always an explicit non-negative integer,
   * including on the pre-target and authentication paths, so a client never has
   * to distinguish "none refused" from "field absent".
   */
  invalidLifecycleTargets: number;
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

  const result: CronResult = { years: [], invalidLifecycleTargets: 0 };

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
      return NextResponse.json({ years: [], invalidLifecycleTargets: 0, error }, { status: 401 });
    }
    receiptInvocationId = createSchedulerInvocationId();

    // A. Find preseason leagues and group by year
    //
    // PLATFORM-086F2H1R1 — read the registry through the typed reader so a
    // MALFORMED container is distinguishable from an empty one. `getLeagues()`
    // maps both to `[]`, which would make this run report a zero-target reason
    // asserting no league is awaiting transition — false, and unverifiable,
    // when the container holding them is corrupt.
    let registry: LeagueRegistryReadResult;
    try {
      registry = await readLeagueRegistry();
    } catch (err) {
      // A registry read failure is the same 500 as before; the event/receipt
      // record the typed `registry-unavailable` reason. `exec.result` stays the
      // pessimistic `failure` the tracker was created with.
      exec.reason = 'registry-unavailable';
      result.error = err instanceof Error ? err.message : 'unknown error';
      return NextResponse.json(result, { status: 500 });
    }
    if (registry.kind === 'malformed') {
      // A present-but-corrupt container. Refuse before any probe, provider,
      // lifecycle, or invalidation work, and say so rather than claiming an
      // empty registry. 500 mirrors the store-outage path: neither is a
      // controlled operational outcome the operator can read as "nothing to do".
      exec.reason = 'registry-malformed';
      result.error = 'league registry is malformed';
      return NextResponse.json(result, { status: 500 });
    }
    // `missing` keeps the pre-R1 empty-registry behavior exactly.
    const leagues = registry.kind === 'ok' ? registry.leagues : [];
    const preseasonLeagues = leagues.filter((l) => l.status?.state === 'preseason');
    if (preseasonLeagues.length === 0) {
      exec.result = 'skipped';
      exec.reason = 'no-preseason-leagues';
      return NextResponse.json(result);
    }

    // PLATFORM-086F2H1T2 — the demo league is MANUAL-ONLY for automatic season
    // transition; its lifecycle is driven by the dedicated sandbox controls.
    //
    // Filtered HERE, before the zero-target decision and before grouping by
    // year, so a demo-only year never reaches a schedule-probe read or write, a
    // provider refresh, a lifecycle write, standings invalidation, or any
    // target/disposition count on the response, runtime event, or durable
    // receipt. Filtering after grouping would still spend a billed CFBD call on
    // a year no production league occupies.
    //
    // The canonical slug is used directly rather than through a shared
    // cross-job predicate: F2H1T3–T5 change their own surfaces, and a shared
    // abstraction introduced here would couple them.
    const automaticTargets = preseasonLeagues.filter((l) => l.slug !== TEST_LEAGUE_SLUG);
    if (automaticTargets.length === 0) {
      // Preseason leagues exist — they are just all demo. Reusing
      // `no-preseason-leagues` here would be factually false on the operator's
      // System Health row.
      exec.result = 'skipped';
      exec.reason = 'no-automatic-preseason-leagues';
      return NextResponse.json(result);
    }

    // PLATFORM-086F2H1R1 — structural year validity, applied AFTER the demo
    // exclusion above.
    //
    // The ordering is load-bearing in one direction: a demo record carrying an
    // unusable year must keep reporting `no-automatic-preseason-leagues`, not
    // the new unusable-year reason. Validating first would let a malformed DEMO
    // record flip this run's zero-target reason and silently undo F2H1T2.
    //
    // `status.year` reaches this point straight from durable JSON —
    // `getLeagues()` performs no per-record validation — so before this slice
    // the cast on the grouping line was the only thing between corrupt storage
    // and a Map key. An unusable year became that key, survived the
    // zero-target gate, drove a probe read and a billed E1A refresh, and (when
    // `undefined`) produced a per-year entry whose `year` key `JSON.stringify`
    // drops, which fails receipt validation and discards the WHOLE job's latest
    // receipt from System Health.
    //
    // Refused candidates are counted, never grouped: they produce no year key,
    // no per-year entry, no probe read or write, no provider request, no
    // lifecycle write or invalidation, and no `targetLeagues` contribution to
    // any valid year.
    // Validity and grouping share ONE pass, so the narrowed year is the value
    // that keys the map — there is no second unchecked cast whose safety depends
    // on a loop somewhere above it.
    const byYear = new Map<number, typeof automaticTargets>();
    let invalidLifecycleTargets = 0;
    for (const league of automaticTargets) {
      const year = (league.status as { state: 'preseason'; year?: unknown }).year;
      if (!isStructurallyValidSeasonYear(year)) {
        invalidLifecycleTargets += 1;
        continue;
      }
      const group = byYear.get(year) ?? [];
      group.push(league);
      byYear.set(year, group);
    }
    // Set BEFORE the per-year loop so a mid-loop throw cannot lose the refusal.
    exec.invalidLifecycleTargets = invalidLifecycleTargets;
    result.invalidLifecycleTargets = invalidLifecycleTargets;

    /**
     * PLATFORM-086F2H1R1 — the single aggregation authority, used by BOTH the
     * normal post-loop path and the per-year catch path, so a later throw can
     * never erase an invalid-target count detected before it.
     *
     * The exact table:
     *   - no invalid targets                  → preserve the normal aggregate;
     *   - invalid targets only (no entries)   → `failure / unusable-lifecycle-year`;
     *   - invalid targets PLUS valid years    → preserve the valid years' uniform
     *     reason, using `year-results` only when their reasons genuinely disagree;
     *     classify `partial` when their aggregate is `success` or `partial`, and
     *     `failure` otherwise.
     *
     * A refusal never rewrites the reason: it already rides on
     * `invalidLifecycleTargets` across all three surfaces, while the receipt's
     * year entries carry counts and no reason field, so overwriting would erase
     * the only durable record of what the valid years did.
     */
    const finalizeAggregate = (): void => {
      const yearsResult = aggregateLifecycleCronResult(entries);

      if (invalidLifecycleTargets > 0 && entries.length === 0) {
        // Nothing valid was even attempted — the refusal IS the outcome, and it
        // is the only thing there is to name.
        exec.result = 'failure';
        exec.reason = 'unusable-lifecycle-year';
        return;
      }

      // The REASON always names the executed years, refusals or not. The
      // refusal already rides on `invalidLifecycleTargets` across all three
      // surfaces, so overwriting the reason would buy nothing and cost the only
      // durable record of WHY those years failed: the receipt's year entries
      // carry counts but no reason field. `year-results` also means "the
      // per-year reasons disagree" — asserting it for a single year is false.
      exec.reason = aggregateLifecycleCronReason(entries, 'year-results');

      if (invalidLifecycleTargets === 0) {
        exec.result = yearsResult;
        return;
      }

      // A refusal alongside executed years. Classify `partial` when the valid
      // years' own aggregate is `success` or `partial`, else `failure` — so
      // `no-op`, `in-progress`, and `skipped` all read `failure` here.
      //
      // This is deliberately NOT the claim that a `partial` aggregate proves
      // work was committed: `aggregateLifecycleCronResult` also returns
      // `partial` for `failure` + `no-op`, where nothing landed. The rule is
      // simply that a refusal must not UPGRADE a run whose valid years did
      // nothing, which is the same instinct the per-year branches below apply
      // when they refuse `partial` for a year that "wrote NOTHING".
      exec.result = yearsResult === 'success' || yearsResult === 'partial' ? 'partial' : 'failure';
    };

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
        alreadyInTargetSeasonLeagues: 0,
        removedLeagues: 0,
        refusedLeagues: 0,
        failedSeasonTypes: [],
      };
      // Marks which throwable operation is in flight, so a propagating throw is
      // classified into the right typed per-year reason before it reaches the
      // outer catch (which produces the SAME 500 response as before).
      let phase:
        | 'other'
        | 'probe-read'
        | 'probe-write'
        | 'lifecycle-write'
        | 'standings-invalidation' = 'other';
      // The E1A refresh STATUS this run, captured verbatim from the typed result
      // when a refresh ran (null when the year was not probed). The per-year event
      // result is mapped from this status directly — never re-derived from the
      // reason vocabulary, which could drift from E1A's actual status.
      let refreshStatus: FullSeasonScheduleRefreshStatus | null = null;
      // PLATFORM-086F2H1B: set once the transition time gate is passed and the
      // guarded loop runs, so classification can tell "no lifecycle work was
      // attempted" from "lifecycle work ran and produced dispositions".
      let lifecycleGateReached = false;
      // Idempotent targets whose stale projection this run actually repaired.
      let healedProjections = 0;
      /**
       * Did this year produce durable work, or a disposition, that a later
       * throw must not disown? Confirmed canonical data, a committed
       * transition, a healed projection (also a committed registry write), or a
       * recorded refusal — the last because a year with any refusal is ALWAYS
       * `partial` (AGENTS.md → Lifecycle Authority Invariants #2): the
       * authenticated run reached its lifecycle stage and declined a stale
       * target, which `failure` would erase. Named for what it means rather
       * than `priorSuccess`: neither a refusal nor a repair is a success.
       */
      const hasRecordedWork = (): boolean =>
        yearEntry.cached ||
        yearEntry.transitionedLeagues > 0 ||
        healedProjections > 0 ||
        yearEntry.refusedLeagues > 0;
      /**
       * Mirror the dispositions the event/receipt already carry onto the HTTP
       * body. Called from the normal path AND from the per-year catch, because a
       * post-commit throw (a later league's write, or the standings
       * invalidation) must not leave the response silent about a transition that
       * already committed durably — the three surfaces have to agree.
       */
      const publishDispositions = (): void => {
        yearResult.transitioned = yearResult.leagues.length > 0;
        yearResult.targetLeagues = yearEntry.targetLeagues;
        yearResult.transitionedLeagues = yearEntry.transitionedLeagues;
        yearResult.alreadyInTargetSeasonLeagues = yearEntry.alreadyInTargetSeasonLeagues;
        yearResult.removedLeagues = yearEntry.removedLeagues;
        yearResult.refusedLeagues = yearEntry.refusedLeagues;
      };
      // Set when THIS run's probe cannot be trusted as a currently-valid schedule
      // (a failed/stale/rejected refresh) — the league must not flip off it; the
      // next cron run retries once the shared authority commits a clean schedule.
      let transitionBlocked = false;
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
        // 3. Within 7 days of the first league-visible UTC game date (refresh for
        //    latest schedule updates)
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
            // Derive first game date + save probe state. The entire probe update
            // is one post-commit phase: either the identity reads or the durable
            // write can throw after canonical schedule work already succeeded.
            yearResult.cached = true;
            yearEntry.cached = true;
            phase = 'probe-write';
            const firstGameDate = await deriveFirstGameDate(targetYear, refresh.items);
            const newProbeState: ScheduleProbeState = {
              year: targetYear,
              baseCachedAt: probeState?.baseCachedAt ?? now.toISOString(),
              firstGameDate,
            };
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

        // Season transition check — only for THIS year's leagues. `firstGameDate`
        // is a UTC-midnight calendar anchor, so subtracting one day means the
        // transition becomes due at 00:00 UTC on the preceding date; exact kickoff
        // time is deliberately irrelevant. Skipped when this run could not confirm
        // a currently-valid schedule (transitionBlocked): a league flips only off
        // a probe we can currently trust, never off a failed/stale/empty-provider run.
        if (probeState?.firstGameDate && !transitionBlocked) {
          const firstGameMs = new Date(probeState.firstGameDate).getTime();
          const oneDayBeforeMs = firstGameMs - 24 * 60 * 60 * 1000;

          if (nowMs >= oneDayBeforeMs) {
            lifecycleGateReached = true;
            for (const league of yearLeagues) {
              // PLATFORM-086F2H1B — GUARDED transition. `yearLeagues` came from the
              // registry snapshot read at the top of this run, BEFORE the E1A
              // refresh and probe work above; by now a league may have been rolled
              // over, moved to another preseason year, transitioned by an
              // overlapping delivery, or deleted. The authority re-checks the
              // expected state and exact year inside its own transaction, so a
              // stale snapshot can never overwrite newer lifecycle state, and each
              // disposition is recorded separately rather than assumed.
              phase = 'lifecycle-write';
              const transition = await completeSeasonTransition(league.slug, targetYear);
              phase = 'other';

              if (transition.outcome === 'transitioned') {
                // Record the confirmed transition and its counters FIRST, so an
                // invalidation throw below cannot erase the fact that the durable
                // lifecycle write already committed.
                // `leagues` (slugs) is the pre-existing HTTP-response field and
                // stays admin-only; the counter is maintained exactly like its
                // three siblings rather than derived from it, so the four
                // dispositions have one shape and one update point each.
                yearResult.leagues.push(league.slug);
                yearEntry.transitionedLeagues += 1;
              } else if (transition.outcome === 'already-in-target-season') {
                yearEntry.alreadyInTargetSeasonLeagues += 1;
                // The idempotent branch can still WRITE, repairing a stale
                // top-level projection. A run that durably changed data must not
                // be classified `no-op` — that is the one thing `no-op` rules out.
                if (transition.healed) healedProjections += 1;
              } else if (transition.outcome === 'league-removed') {
                // An operator deleted the league after target selection. A normal
                // admin action: nothing was mutated and nothing needs invalidating.
                yearEntry.removedLeagues += 1;
                continue;
              } else {
                // Genuinely stale — some other state, or a different lifecycle
                // year. No lifecycle mutation occurred, so no invalidation.
                yearEntry.refusedLeagues += 1;
                continue;
              }

              // Reached only by `transitioned` and `already-in-target-season`.
              //
              // Reachability of the idempotent case, stated honestly: this run's
              // snapshot keeps ONLY `preseason` leagues, so a league an earlier
              // invocation already flipped to `season` is never a target again.
              // `already-in-target-season` therefore arises from an OVERLAPPING
              // delivery, not from a later run recovering a killed one — and a
              // once-daily Vercel cron does not normally overlap. It is
              // invalidated anyway because it is cheap, correct, and the only
              // point at which this route observes such a league; it is NOT a
              // recovery mechanism for a run killed between commit and bust.
              // That gap is real and remains open.
              //
              // Durable lifecycle mutation and Next cache invalidation cannot be
              // one atomic operation; this ordering narrows the window, it does
              // not close it.
              phase = 'standings-invalidation';
              invalidateStandings(league.slug);
              phase = 'other';
            }
            publishDispositions();
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
        // response uses: a transition supersedes the E1A reason; otherwise a
        // refresh reports its exact E1A outcome; otherwise the year was not due.
        if (yearEntry.refusedLeagues > 0) {
          // PLATFORM-086F2H1B — at least one target had moved on by write time.
          // ALWAYS `partial`, even when every target was refused: this
          // authenticated run performed its canonical/probe stage and then did
          // not complete the lifecycle work it set out to do. `partial` is what
          // System Health surfaces (`systemHealthIssues` raises an execution
          // issue only for `failure`/`partial`), so classifying a fully-stale
          // target set as `no-op` would hide it entirely. It also prevents
          // labelling a run that made a billed provider call and durably
          // committed a schedule as an overall no-op.
          yearEntry.result = 'partial';
          yearEntry.reason = 'lifecycle-transition-refused';
        } else if (yearEntry.transitionedLeagues > 0) {
          // Benign already-in-target or removed siblings never degrade a run
          // that actually transitioned something.
          yearEntry.result = 'success';
          yearEntry.reason = 'season-transitioned';
        } else if (lifecycleGateReached && yearEntry.alreadyInTargetSeasonLeagues > 0) {
          // `no-op` is reserved for a run that committed NOTHING: no canonical
          // refresh and no lifecycle projection change. A billed E1A call that
          // durably committed a schedule counts, exactly as it does in
          // `hasRecordedWork()` — otherwise the identical year would report
          // `no-op` when it completed cleanly and `partial` when its cache bust
          // threw, making the non-throwing run look like strictly less work. A
          // repaired projection counts for the same reason: that write is real.
          //
          // The reason stays the LIFECYCLE outcome either way; the E1A detail
          // travels separately on `scheduleRefreshReason`.
          yearEntry.result = yearEntry.cached || healedProjections > 0 ? 'success' : 'no-op';
          yearEntry.reason =
            yearEntry.removedLeagues > 0 ? 'transition-not-required' : 'already-in-target-season';
        } else if (lifecycleGateReached && yearEntry.removedLeagues > 0) {
          // Same rule: a committed canonical refresh is not a no-op, even when
          // every lifecycle target turned out to have been deleted.
          yearEntry.result = yearEntry.cached ? 'success' : 'no-op';
          yearEntry.reason = 'transition-targets-removed';
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
        // A throwable operation (probe read/update or lifecycle write) failed. The
        // response is the SAME 500 the outer catch already produced; whether this
        // year appears in `result.years` depends on the lifecycle gate — see the
        // `lifecycleGateReached` push below. The event/receipt record the typed
        // per-year reason and this year's completed-so-far counts, then finalize
        // the aggregate here because the post-loop aggregate is skipped by the
        // re-throw.
        if (phase === 'probe-read') {
          yearEntry.result = 'failure';
          yearEntry.reason = 'probe-state-unavailable';
        } else if (phase === 'probe-write') {
          // The probe-update phase currently starts only after canonical work is
          // confirmed. Still use the shared predicate so a future phase-boundary
          // change cannot relabel a no-work failure as partial.
          yearEntry.result = hasRecordedWork() ? 'partial' : 'failure';
          yearEntry.reason = 'probe-write-failed';
        } else if (phase === 'lifecycle-write') {
          yearEntry.result = hasRecordedWork() ? 'partial' : 'failure';
          yearEntry.reason = 'lifecycle-write-failed';
        } else if (phase === 'standings-invalidation') {
          // PLATFORM-086F2H1B — only the post-commit cache bust threw. Whatever
          // lifecycle work preceded it stands: never roll it back, never
          // relabel a committed write as failed.
          //
          // Gated on the SAME predicate as the lifecycle-write branch above,
          // because `partial` has to mean something. A year whose only target
          // was an untouched `already-in-target-season` match wrote NOTHING —
          // the bust is invalidating a cache no run in this invocation dirtied
          // — so `partial` would assert progress that did not happen. That year
          // is a clean `failure`. A prior canonical refresh, transition, heal,
          // or refusal makes it a truthful `partial`.
          //
          // The reason names THIS fault unconditionally, even when an earlier
          // league in the same year was refused. The single reason field cannot
          // carry both facts, and between them only the invalidation fault has
          // no other carrier: a refusal survives in `refusedLeagues`, which the
          // receipt persists and System Health renders, whereas relabelling this
          // `lifecycle-transition-refused` would point an operator at stale
          // lifecycle state when the exposure is committed standings serving a
          // stale cache.
          yearEntry.result = hasRecordedWork() ? 'partial' : 'failure';
          yearEntry.reason = 'standings-invalidation-failed';
        } else {
          yearEntry.result = 'failure';
          yearEntry.reason = 'unexpected-error';
        }
        // PLATFORM-086F2H1B — when the lifecycle gate ran, this year produced
        // dispositions that the event and receipt already record. Mirror them
        // onto the response and push the year, so a 500 caused by a post-commit
        // failure cannot omit a transition that durably committed. A throw
        // BEFORE the gate produces no dispositions, so on those paths the year
        // is still absent from the response, as it was pre-F2H1B.
        if (lifecycleGateReached) {
          publishDispositions();
          result.years.push(yearResult);
        }
        entries.push(yearEntry);
        finalizeAggregate();
        throw err;
      }
    }

    finalizeAggregate();

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
        target: seasonTransitionYearsTarget(exec.years, exec.invalidLifecycleTargets),
      });
    }
  }

  return NextResponse.json(result);
}
