/**
 * PLATFORM-102 slice 4 — the secret-safe runtime event for the polling planner.
 *
 * Every other cron route emits one of these plus a durable receipt, so "did this
 * job run, and what did it decide" survives Vercel's runtime-log retention. The
 * planner needs it more than most: it is the only job whose failure is SILENT
 * downstream, because a planner that stops leaves the schedules it last installed
 * running unchanged, and delivery health goes on judging them against a record
 * that still describes that plan as current.
 *
 * Closed vocabulary only. No cron expression, schedule id, header block, request,
 * response body, provider payload, environment value or thrown message ever
 * reaches this event — the counts and the reason are the whole of it, and the
 * durable planner record is where the intent lives, under its own allowlist.
 */

export type PollingPlannerCronExecutionResult = 'success' | 'partial' | 'no-op' | 'failure';

export type PollingPlannerCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  /** Every schedule reached its planned state, and at least one was written. */
  | 'plan-applied'
  /** Every schedule was ALREADY in its planned state — the modal quiet-day run. */
  | 'plan-unchanged'
  /**
   * At least one schedule could not be brought to its planned state, or its
   * durable record did not confirm. `partial`, never `failure`, while any other
   * schedule landed: a job that reduces wakeups must not report a total outage
   * because one of four schedules refused.
   */
  | 'plan-partially-applied'
  /** Nothing could be applied at all — no credential, or QStash unreachable. */
  | 'plan-not-applied'
  /**
   * EVERY planner-owned job is under an operator hold, so the planner touched
   * nothing. Paired with `no-op`, never `failure`: a held job is doing exactly
   * what an operator told it to, and `schedulerExecutionIssues` raises nothing for
   * `no-op` — which is the point. A deliberate stop must not page anyone.
   */
  | 'plan-held'
  /**
   * The SETTINGS store could not be read, so whether a hold exists is unknown.
   *
   * THE NAME IS BORROWED, NOT COINED. `rankings/route.ts` and
   * `schedule-refresh/route.ts` already answer the identical `getProviderRefreshSettings`
   * throw with `settings-unavailable`, `cronExecutionLog` carries it with an
   * aggregation rule, and `providerRefreshSettings` names it in its own docstring —
   * "noncritical callers fail closed (`settings-unavailable`)". A planner-only synonym
   * would have given one fault two names and left every reason-keyed consumer knowing
   * only one of them. Found by review, which located the closer prior art this
   * vocabulary's first draft missed.
   *
   * PAIRED WITH `failure`, AND THAT IS THE POINT. The planner still fails closed and
   * holds every job — refusing to mutate schedules under uncertain settings is
   * correct. Reporting that uncertainty as `no-op` / `plan-held` was not:
   * `schedulerExecutionIssues` deliberately raises nothing for `no-op`, so a transient
   * settings-read failure stopped the planner silently, in a state indistinguishable
   * from a deliberate operator stop, with the alerting built to ignore it (issue #619,
   * and Item 189 before it).
   *
   * A GENUINE HOLD IS UNCHANGED — still `no-op` / `plan-held`, still silent. The
   * distinction is the cause, not the behaviour: both hold everything, and only one
   * of them is something an operator chose.
   */
  | 'settings-unavailable'
  /**
   * The canonical schedule could not be read, so no windows could be derived.
   * The planner FAILS CLOSED here rather than planning an empty day: an empty
   * window list is a legitimate plan for a dead day, and treating an unreadable
   * schedule as one would pause a live game day's dense polling.
   */
  | 'schedule-unreadable'
  | 'unexpected-error';

export type PollingPlannerCronExecutionState = {
  result: PollingPlannerCronExecutionResult;
  reason: PollingPlannerCronExecutionReason;
  /** The UTC day planned (`YYYY-MM-DD`), or null when the run never got that far. */
  day: string | null;
  /** Confirmed writes and pauses. */
  schedulesApplied: number;
  /** Schedules already in the planned state — nothing sent. */
  schedulesUnchanged: number;
  /** Schedules left in an unknown or unwanted state. */
  schedulesFailed: number;
  /** Planner-owned jobs whose durable record write did not confirm. */
  recordsNotWritten: number;
  /**
   * Planner-owned jobs the planner deliberately did not touch, because an
   * operator holds them.
   *
   * REPORTED SEPARATELY FROM EVERY OTHER COUNT so a held job can never be read as
   * a succeeded or failed one. That distinction is the whole reason the hold
   * exists: delivery health must be able to tell a deliberately stopped job from a
   * broken one.
   */
  jobsHeld: number;
  /** Reporting only: how many firings the day's plan buys, across both jobs. */
  plannedRuns: number;
  /** Reporting only: kickoffs with no published time, given whole-day coverage. */
  unconfirmedKickoffs: number;
};

export function createPollingPlannerCronExecutionState(): PollingPlannerCronExecutionState {
  return {
    // Pessimistic by construction: an exception anywhere leaves this untouched
    // and the run reports a failure rather than an unremarked success.
    result: 'failure',
    reason: 'unexpected-error',
    day: null,
    schedulesApplied: 0,
    schedulesUnchanged: 0,
    schedulesFailed: 0,
    recordsNotWritten: 0,
    jobsHeld: 0,
    plannedRuns: 0,
    unconfirmedKickoffs: 0,
  };
}

export function emitPollingPlannerCronExecutionEvent(
  state: PollingPlannerCronExecutionState,
  startedAtMs: number
): void {
  try {
    console.log(
      JSON.stringify({
        event: 'polling-planner-cron',
        result: state.result,
        reason: state.reason,
        day: state.day,
        schedulesApplied: state.schedulesApplied,
        schedulesUnchanged: state.schedulesUnchanged,
        schedulesFailed: state.schedulesFailed,
        recordsNotWritten: state.recordsNotWritten,
        jobsHeld: state.jobsHeld,
        plannedRuns: state.plannedRuns,
        unconfirmedKickoffs: state.unconfirmedKickoffs,
        durationMs: Math.max(0, Math.round(Date.now() - startedAtMs)),
      })
    );
  } catch {
    // Observability is best-effort and must never alter the route outcome.
  }
}
