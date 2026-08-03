import type { FullSeasonScheduleRefreshReason } from '@/lib/schedule/fullSeasonScheduleRefreshResult';
import type { ChampionshipRolloverSkipReason } from '@/lib/schedule/nationalChampionshipRollover';
import type { ScheduleSeasonType } from '@/lib/scheduleSeasonFetch';

/**
 * PLATFORM-086F2E2A — the secret-safe, machine-readable runtime events emitted
 * once per invocation of the two Vercel-native lifecycle crons
 * (`GET /api/cron/season-transition`, `GET /api/cron/season-rollover`).
 *
 * Mirrors the five QStash cron execution logs (PLATFORM-086F1/B1/C2/E1B/E2B):
 * this module owns the logging POLICY so neither route absorbs it, and records
 * ONLY the allowlisted operational primitives below — never a request/response
 * object, thrown error, error message, stack, league record, schedule row,
 * archive, provider payload, environment value, URL, credential, or
 * authorization header. Before F2E2A these two routes emitted NO app-side
 * execution event (their auth failures appeared only in platform request logs);
 * this closes that gap. The event stays the detailed per-invocation log surface,
 * including authentication failures; PLATFORM-086F2E1's durable receipt
 * (`scheduler-execution-status`) is a separate latest-only record written only
 * after successful authentication, and never replaces or changes this event.
 *
 * Each route builds one mutable tracker at entry (pessimistic
 * `failure / unexpected-error`) and emits exactly one event from a single outer
 * `finally`, so authentication failures, skips, every per-year outcome, and
 * unexpected exceptions each produce one line. Emission is best-effort: a
 * serialization or console failure must never change the HTTP response or mask a
 * thrown error.
 */

export type LifecycleCronExecutionResult =
  | 'skipped'
  | 'success'
  | 'partial'
  | 'no-op'
  | 'failure'
  | 'in-progress';

// ---------------------------------------------------------------------------
// Season transition

/** Route/control-owned stable reasons (E1A refresh reasons ride through as-is). */
export type SeasonTransitionCronControlReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | 'no-preseason-leagues'
  | 'registry-unavailable'
  | 'probe-state-unavailable'
  | 'probe-write-failed'
  | 'lifecycle-write-failed'
  // PLATFORM-086F2H1 — the guarded preseason→season transition refused at least
  // one league because it was no longer in `preseason` for the target year at
  // write time (this run's registry snapshot predates its schedule work). A
  // refusal is NOT a failure and NOT a counted transition; it records that the
  // cron's target set had gone stale.
  | 'lifecycle-transition-refused'
  | 'refresh-not-due'
  | 'season-transitioned'
  | 'year-results'
  | 'unexpected-error';

/** A per-year reason: a control reason or the exact E1A refresh reason. */
export type SeasonTransitionCronYearReason =
  | SeasonTransitionCronControlReason
  | FullSeasonScheduleRefreshReason;

/** The aggregate reason: uniform per-year reason, or `year-results` when mixed. */
export type SeasonTransitionCronExecutionReason = SeasonTransitionCronYearReason;

export type SeasonTransitionCronYearExecution = {
  year: number;
  result: LifecycleCronExecutionResult;
  reason: SeasonTransitionCronYearReason;
  /** The exact E1A refresh reason when a refresh ran this year, else null. */
  scheduleRefreshReason: FullSeasonScheduleRefreshReason | null;
  providerCallAttempted: boolean;
  targetLeagues: number;
  probed: boolean;
  cached: boolean;
  transitionedLeagues: number;
  /**
   * The three non-transitioned dispositions, kept INDEPENDENT (F2H review) —
   * collapsing them into one count made a benign redelivery and an intentional
   * deletion indistinguishable from a genuinely stale target. Each is recorded
   * as its own field rather than only in `reason`, so the signal survives a
   * later throw (which reclassifies `reason` to `lifecycle-write-failed`) and
   * stays legible when multi-year aggregation collapses the top-level reason to
   * `year-results`.
   *
   * Only `refusedLeagues` is an anomaly; the other two are normal outcomes.
   */
  refusedLeagues: number;
  /** Already in the target season — an idempotent at-least-once redelivery. */
  alreadyInSeasonLeagues: number;
  /** Removed from the registry after target selection — a normal admin action. */
  removedLeagues: number;
  failedSeasonTypes: ScheduleSeasonType[];
};

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type SeasonTransitionCronExecutionEvent = {
  event: 'season-transition-cron';
  result: LifecycleCronExecutionResult;
  reason: SeasonTransitionCronExecutionReason;
  years: SeasonTransitionCronYearExecution[];
  durationMs: number;
};

/**
 * The mutable tracker the route completes as it decides. Excludes `event`
 * (constant) and `durationMs` (computed at emit) so those cannot be set to an
 * unexpected value from inside the handler.
 */
export type SeasonTransitionCronExecutionState = Omit<
  SeasonTransitionCronExecutionEvent,
  'event' | 'durationMs'
>;

/** Initialize the tracker as pessimistic `failure / unexpected-error`, no years. */
export function createSeasonTransitionCronExecutionState(): SeasonTransitionCronExecutionState {
  return { result: 'failure', reason: 'unexpected-error', years: [] };
}

// ---------------------------------------------------------------------------
// Season rollover

/** Route/control-owned stable reasons (championship-skip reasons ride through). */
export type SeasonRolloverCronControlReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | 'no-season-leagues'
  | 'registry-unavailable'
  | 'read-failed'
  | 'rollover-complete'
  | 'rollover-partial'
  | 'rollover-failed'
  | 'year-results'
  | 'unexpected-error';

/** A per-year reason: a control reason or the exact championship-gate skip reason. */
export type SeasonRolloverCronYearReason =
  | SeasonRolloverCronControlReason
  | ChampionshipRolloverSkipReason;

/** The aggregate reason: uniform per-year reason, or `year-results` when mixed. */
export type SeasonRolloverCronExecutionReason = SeasonRolloverCronYearReason;

export type SeasonRolloverCronYearExecution = {
  year: number;
  result: LifecycleCronExecutionResult;
  reason: SeasonRolloverCronYearReason;
  /** Rollover is cache-only — always false. */
  providerCallAttempted: false;
  targetLeagues: number;
  rolledOverLeagues: number;
  suppressionCleared: number;
};

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type SeasonRolloverCronExecutionEvent = {
  event: 'season-rollover-cron';
  result: LifecycleCronExecutionResult;
  reason: SeasonRolloverCronExecutionReason;
  years: SeasonRolloverCronYearExecution[];
  durationMs: number;
};

export type SeasonRolloverCronExecutionState = Omit<
  SeasonRolloverCronExecutionEvent,
  'event' | 'durationMs'
>;

/** Initialize the tracker as pessimistic `failure / unexpected-error`, no years. */
export function createSeasonRolloverCronExecutionState(): SeasonRolloverCronExecutionState {
  return { result: 'failure', reason: 'unexpected-error', years: [] };
}

// ---------------------------------------------------------------------------
// Shared aggregation (PLATFORM-086F2E2A §5)

/**
 * The aggregate result over the per-year entries (identical policy for both
 * lifecycle events):
 *   1. no entries, or every entry skipped → `skipped` (a skipped sibling never
 *      degrades an executed year);
 *   2. any per-year `partial` → `partial`;
 *   3. failures mixed with any executed non-failure → `partial`;
 *   4. only failures among the executed → `failure`;
 *   5. any success with no failure/partial → `success`;
 *   6. only clean no-ops → `no-op`;
 *   7. only contention/in-progress outcomes → `in-progress`.
 */
export function aggregateLifecycleCronResult(
  years: ReadonlyArray<{ result: LifecycleCronExecutionResult }>
): LifecycleCronExecutionResult {
  const executed = years.filter((entry) => entry.result !== 'skipped');
  if (years.length === 0 || executed.length === 0) return 'skipped';
  if (executed.some((entry) => entry.result === 'partial')) return 'partial';
  const hasFailure = executed.some((entry) => entry.result === 'failure');
  const hasSuccess = executed.some((entry) => entry.result === 'success');
  const hasNoop = executed.some((entry) => entry.result === 'no-op');
  const hasInProgress = executed.some((entry) => entry.result === 'in-progress');
  if (hasFailure && (hasSuccess || hasNoop || hasInProgress)) return 'partial';
  if (hasFailure) return 'failure';
  if (hasSuccess) return 'success';
  if (hasNoop) return 'no-op';
  return 'in-progress';
}

/**
 * The aggregate top-level reason: the uniform per-year reason when EVERY year
 * shares it, otherwise `year-results`. (Auth failures and the pre-target route
 * paths never reach this — the route sets their literal reasons directly.)
 */
export function aggregateLifecycleCronReason<R extends string>(
  years: ReadonlyArray<{ reason: R }>,
  mixed: R
): R {
  if (years.length === 0) return mixed;
  const first = years[0]!.reason;
  return years.every((entry) => entry.reason === first) ? first : mixed;
}

// ---------------------------------------------------------------------------
// Emission (each event rebuilt field-by-field so an attached extra never leaks)

/**
 * Emit exactly one single-line structured event. Construction is an explicit
 * per-field copy from the allowlisted state — no request/response/error/league/
 * schedule/archive object is ever serialized. Best-effort: any failure here is
 * swallowed so it can neither alter the response nor replace an in-flight throw.
 */
export function emitSeasonTransitionCronExecutionEvent(
  state: SeasonTransitionCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: SeasonTransitionCronExecutionEvent = {
      event: 'season-transition-cron',
      result: state.result,
      reason: state.reason,
      years: state.years.map((entry) => ({
        year: entry.year,
        result: entry.result,
        reason: entry.reason,
        scheduleRefreshReason: entry.scheduleRefreshReason,
        providerCallAttempted: entry.providerCallAttempted,
        targetLeagues: entry.targetLeagues,
        probed: entry.probed,
        cached: entry.cached,
        transitionedLeagues: entry.transitionedLeagues,
        refusedLeagues: entry.refusedLeagues,
        alreadyInSeasonLeagues: entry.alreadyInSeasonLeagues,
        removedLeagues: entry.removedLeagues,
        failedSeasonTypes: [...entry.failedSeasonTypes],
      })),
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}

export function emitSeasonRolloverCronExecutionEvent(
  state: SeasonRolloverCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: SeasonRolloverCronExecutionEvent = {
      event: 'season-rollover-cron',
      result: state.result,
      reason: state.reason,
      years: state.years.map((entry) => ({
        year: entry.year,
        result: entry.result,
        reason: entry.reason,
        providerCallAttempted: false,
        targetLeagues: entry.targetLeagues,
        rolledOverLeagues: entry.rolledOverLeagues,
        suppressionCleared: entry.suppressionCleared,
      })),
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}
