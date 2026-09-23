/**
 * PLATFORM-757a — secret-safe runtime event for the STANDALONE schedule-
 * presentation job.
 *
 * Mirrors every other cron route: one structured line per invocation — INCLUDING
 * authentication failures, because the emit sits in the route's unconditional
 * outer `finally` — from a closed reason vocabulary rather than provider or
 * error text.
 *
 * That is the event/receipt distinction, and it is deliberate: the RECEIPT is
 * written only after successful authentication, so a logged line is never
 * evidence that a request authenticated. `schedule/cronExecutionLog.ts` states
 * the same split for the weekly cron.
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

/** How bad a result is. Only ever compared, never rendered. */
const RESULT_SEVERITY: Record<SchedulePresentationCronExecutionResult, number> = {
  success: 0,
  'no-op': 1,
  skipped: 1,
  partial: 2,
  failure: 3,
};

function worseOf(
  a: SchedulePresentationCronExecutionResult,
  b: SchedulePresentationCronExecutionResult
): SchedulePresentationCronExecutionResult {
  return RESULT_SEVERITY[b] > RESULT_SEVERITY[a] ? b : a;
}

/**
 * Classify the run.
 *
 * ## Three facts, and the order they are combined in
 *
 * 1. **The executed years' own aggregate** — what the refreshes did.
 * 2. **A budget stop**, when a selected year was never STARTED. This takes the
 *    REASON, because it is the most actionable thing an operator can be told
 *    about the run: a skipped year's media is exactly as stale as if nothing had
 *    run, so a run that refreshed year 1 cleanly and never reached year 2 is not
 *    a success.
 * 3. **Refused production targets** (`invalidLifecycleTargets`), which degrade
 *    the RESULT and never touch the reason.
 *
 * ## Why the budget takes the reason but not, by itself, the result
 *
 * An earlier version returned `partial` outright whenever a year was skipped,
 * BEFORE looking at the years that did run. Codex and the review both noted the
 * masking direction: a run where every executed year FAILED and one was skipped
 * reported `partial`, understating it. The result is therefore the WORSE of the
 * year aggregate and `partial`, so both facts survive — reason
 * `budget-exhausted`, result `failure` — instead of one hiding the other.
 *
 * ## Why a refusal degrades the result but never the reason
 *
 * `AGENTS.md` → the lifecycle-refusal aggregation rule: *"refusals plus executed
 * years → preserve the executed years' uniform reason … The reason is never
 * overwritten by the refusal, because the receipt's year entries carry counts
 * and no reason field, so overwriting would erase the only durable record of
 * what those years did."* `schedule-refresh/route.ts:612-622` is the same rule
 * in the sibling job. A refusal must not UPGRADE a run whose valid years did
 * nothing, which is why it maps a non-success aggregate to `failure` rather
 * than to `partial`.
 */
export function aggregateSchedulePresentationCron(
  years: readonly SchedulePresentationYearExecution[],
  yearsSkippedForBudget: number,
  // REQUIRED, not defaulted: a caller that forgot to pass this would silently
  // report a clean run over a population that refused a production league, and
  // no compiler signal would say so.
  invalidLifecycleTargets: number
): {
  result: SchedulePresentationCronExecutionResult;
  reason: SchedulePresentationCronExecutionReason;
} {
  // Refusals with NO executed years: the refusal is the whole story, and it is
  // the one case where it owns the reason too, because there are no executed
  // years whose reason it could erase.
  if (years.length === 0) {
    if (invalidLifecycleTargets > 0) {
      return { result: 'failure', reason: 'unusable-lifecycle-year' };
    }
    if (yearsSkippedForBudget > 0) {
      return { result: 'partial', reason: 'budget-exhausted' };
    }
    return { result: 'skipped', reason: 'no-maintenance-target' };
  }

  const hasFailure = years.some(
    (entry) => entry.result === 'failure' || entry.result === 'partial'
  );
  const hasSuccess = years.some((entry) => entry.result === 'success');
  let result: SchedulePresentationCronExecutionResult;
  let reason: SchedulePresentationCronExecutionReason;
  if (hasFailure && hasSuccess) {
    result = 'partial';
    reason = 'presentation-partial';
  } else if (hasFailure) {
    result = 'failure';
    reason = 'presentation-failed';
  } else if (hasSuccess) {
    result = 'success';
    reason = 'presentation-refreshed';
  } else {
    // Every year was `no-op` or `in-progress`: nothing was due, or another
    // holder had the lease. Neither is an error and neither committed anything.
    result = 'no-op';
    reason = 'presentation-no-op';
  }

  if (yearsSkippedForBudget > 0) {
    result = worseOf(result, 'partial');
    reason = 'budget-exhausted';
  }

  if (invalidLifecycleTargets > 0) {
    result = result === 'success' || result === 'partial' ? 'partial' : 'failure';
  }

  return { result, reason };
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
