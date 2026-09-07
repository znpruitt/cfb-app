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
        plannedRuns: state.plannedRuns,
        unconfirmedKickoffs: state.unconfirmedKickoffs,
        durationMs: Math.max(0, Math.round(Date.now() - startedAtMs)),
      })
    );
  } catch {
    // Observability is best-effort and must never alter the route outcome.
  }
}
