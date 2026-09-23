/**
 * PLATFORM-757a — secret-safe runtime event for the STANDALONE schedule-
 * presentation job.
 *
 * Mirrors every other cron route: one structured line per authenticated
 * invocation, from a closed reason vocabulary rather than provider or error
 * text, emitted from the route's outer `finally` alongside the durable receipt.
 *
 * Nothing here can fail the run — the emit is wrapped.
 */

import type {
  SchedulePresentationAggregateStatus,
  SchedulePresentationRefreshReason,
} from './schedulePresentationResult.ts';

export type SchedulePresentationCronExecutionResult =
  | 'skipped'
  | 'success'
  | 'partial'
  | 'no-op'
  | 'failure';

export type SchedulePresentationCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  /** The league registry container was present but corrupt. */
  | 'registry-malformed'
  /** The registry read threw, or a record threw while being walked. */
  | 'canonical-context-unavailable'
  /** No active production league owns a season year. */
  | 'no-maintenance-target'
  /** An ACTIVE demo league was the only candidate, and it is excluded. */
  | 'no-automatic-maintenance-target'
  /** Active production leagues existed; every one carried an unusable year. */
  | 'unusable-lifecycle-year'
  /**
   * Acceptance 8. Global pause, or the Schedule dataset toggle, is off. The job
   * makes NO provider call and refreshes nothing.
   */
  | 'automation-paused-or-disabled'
  /** The settings store could not be read, so the gate cannot be evaluated. */
  | 'settings-unavailable'
  /** At least one year committed fresh presentation rows. */
  | 'presentation-refreshed'
  /** Every year ran and none needed a change (or none was due). */
  | 'presentation-no-op'
  /** Some years succeeded and some failed. */
  | 'presentation-partial'
  /** Every year failed. */
  | 'presentation-failed'
  /**
   * Acceptance 9. At least one selected year was never STARTED because the
   * remaining budget could not cover a year's worst case. Its own reason, not a
   * flavour of `partial`: a budget stop is a capacity fact about this job, and
   * collapsing it into the refresh outcomes is what would hide a job that is
   * chronically unable to reach its later years.
   */
  | 'budget-exhausted'
  | 'unexpected-error';

/** One year's outcome, as both the event and the receipt record it. */
export type SchedulePresentationYearExecution = {
  year: number;
  result: SchedulePresentationAggregateStatus;
  media: SchedulePresentationRefreshReason;
  venues: SchedulePresentationRefreshReason;
  /**
   * Whether EITHER part issued a provider request. Taken verbatim from the
   * authority's own two part results — never re-derived from the reasons, which
   * would be a second spelling of a fact the authority already states, and
   * would silently disagree with it the moment the vocabulary grows.
   */
  providerCallAttempted: boolean;
};

export type SchedulePresentationCronExecutionState = {
  result: SchedulePresentationCronExecutionResult;
  reason: SchedulePresentationCronExecutionReason;
  /** Active season years selected from the registry. */
  totalYears: number;
  /** Per-year outcomes, in the order they ran. */
  years: SchedulePresentationYearExecution[];
  /** Selected years never started because the budget could not cover one. */
  yearsSkippedForBudget: number;
  /** Active PRODUCTION leagues refused for a structurally invalid `status.year`. */
  invalidLifecycleTargets: number;
};

export function createSchedulePresentationCronExecutionState(): SchedulePresentationCronExecutionState {
  return {
    // Pessimistic defaults: an authenticated run that throws before deciding
    // anything files a failure, never a silent success.
    result: 'failure',
    reason: 'unexpected-error',
    totalYears: 0,
    years: [],
    yearsSkippedForBudget: 0,
    invalidLifecycleTargets: 0,
  };
}

/**
 * Classify the run from the per-year outcomes alone.
 *
 * A budget stop OUTRANKS the refresh aggregate, because a run that refreshed
 * one year cleanly and never reached the second is not a success — the second
 * year's media is exactly as stale as if nothing had run. Asserted by
 * `presentationCronExecutionLog.test.ts`.
 */
export function aggregateSchedulePresentationCron(
  years: readonly SchedulePresentationYearExecution[],
  yearsSkippedForBudget: number
): {
  result: SchedulePresentationCronExecutionResult;
  reason: SchedulePresentationCronExecutionReason;
} {
  if (yearsSkippedForBudget > 0) {
    return { result: 'partial', reason: 'budget-exhausted' };
  }
  if (years.length === 0) {
    return { result: 'skipped', reason: 'no-maintenance-target' };
  }
  const hasFailure = years.some(
    (entry) => entry.result === 'failure' || entry.result === 'partial'
  );
  const hasSuccess = years.some((entry) => entry.result === 'success');
  if (hasFailure && hasSuccess) return { result: 'partial', reason: 'presentation-partial' };
  if (hasFailure) return { result: 'failure', reason: 'presentation-failed' };
  if (hasSuccess) return { result: 'success', reason: 'presentation-refreshed' };
  // Every year was `no-op` or `in-progress`: nothing was due, or another holder
  // had the lease. Neither is an error and neither committed anything.
  return { result: 'no-op', reason: 'presentation-no-op' };
}

export function emitSchedulePresentationCronExecutionEvent(
  state: SchedulePresentationCronExecutionState,
  startedAtMs: number
): void {
  try {
    console.log(
      JSON.stringify({
        event: 'schedule-presentation-cron',
        result: state.result,
        reason: state.reason,
        totalYears: state.totalYears,
        // Explicit per-field copy so an accidentally attached extra property
        // can never reach the serialized line.
        years: state.years.map((entry) => ({
          year: entry.year,
          result: entry.result,
          media: entry.media,
          venues: entry.venues,
          providerCallAttempted: entry.providerCallAttempted,
        })),
        yearsSkippedForBudget: state.yearsSkippedForBudget,
        invalidLifecycleTargets: state.invalidLifecycleTargets,
        durationMs: Math.max(0, Math.round(Date.now() - startedAtMs)),
      })
    );
  } catch {
    // Observability is best-effort and must never alter the route outcome.
  }
}
