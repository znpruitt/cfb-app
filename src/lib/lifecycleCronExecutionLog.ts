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
  // No league is in preseason at all.
  | 'no-preseason-leagues'
  // PLATFORM-086F2H1T2 — preseason leagues EXIST, but every one of them is the
  // demo league, which is manual-only for automatic transition. Distinct from
  // `no-preseason-leagues` on purpose: reusing that reason would tell an
  // operator no league is awaiting transition when one is.
  | 'no-automatic-preseason-leagues'
  | 'registry-unavailable'
  // PLATFORM-086F2H1R1 — the registry record EXISTS but does not hold a league
  // array. Distinct from `registry-unavailable` (the store read itself failed)
  // and from the zero-target reasons above, each of which asserts something
  // about leagues that a corrupt container cannot support.
  | 'registry-malformed'
  // PLATFORM-086F2H1R1 — production preseason candidates exist, but every one
  // carries a `status.year` that is not a structurally valid season year, so
  // none could be grouped or acted on. Never emitted for a demo record: the
  // demo is excluded before validity is considered.
  | 'unusable-lifecycle-year'
  | 'probe-state-unavailable'
  | 'probe-write-failed'
  | 'lifecycle-write-failed'
  // PLATFORM-086F2H1B — post-commit standings invalidation threw AFTER a
  // confirmed durable transition. The transition and its counters stand; only
  // the cache bust failed.
  | 'standings-invalidation-failed'
  // At least one snapshot target was no longer in `preseason` for the target
  // year at write time. Genuinely stale, and the only anomalous disposition.
  | 'lifecycle-transition-refused'
  // Every target was already in the target season — a benign idempotent
  // overlap or redelivery, not an anomaly.
  | 'already-in-target-season'
  // Every target was deleted from the registry after selection — a normal
  // admin action.
  | 'transition-targets-removed'
  // A mixture of already-in-target and removed targets: nothing left to do,
  // nothing wrong.
  | 'transition-not-required'
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
   * PLATFORM-086F2H1B — the guarded dispositions for this year's targets, kept
   * INDEPENDENT so a benign idempotent redelivery and an intentional deletion
   * are never indistinguishable from a genuinely stale target. Counts only:
   * league slugs must never enter a runtime event or a durable receipt.
   *
   * Only `refusedLeagues` is anomalous. All four are zero when the lifecycle
   * gate is not reached. They sum to `targetLeagues` only when the gate IS
   * reached AND the per-league loop runs to completion: a mid-loop throw
   * (`lifecycle-write-failed` / `standings-invalidation-failed`) publishes the
   * dispositions completed so far, so the sum is short by the targets never
   * attempted. Do not treat the sum as a consistency assertion.
   */
  alreadyInTargetSeasonLeagues: number;
  removedLeagues: number;
  refusedLeagues: number;
  failedSeasonTypes: ScheduleSeasonType[];
};

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type SeasonTransitionCronExecutionEvent = {
  event: 'season-transition-cron';
  result: LifecycleCronExecutionResult;
  reason: SeasonTransitionCronExecutionReason;
  years: SeasonTransitionCronYearExecution[];
  /**
   * PLATFORM-086F2H1R1 — how many PRODUCTION preseason candidates were refused
   * this run for carrying a structurally invalid `status.year`. Run-level, not
   * per-year, because a refused candidate has no usable year to file it under —
   * that is precisely what disqualified it. A count only: no slug and no
   * unusable year value ever enters the event or the receipt.
   *
   * Always an explicit non-negative integer, so a reader never infers absence.
   */
  invalidLifecycleTargets: number;
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
  return { result: 'failure', reason: 'unexpected-error', years: [], invalidLifecycleTargets: 0 };
}

// ---------------------------------------------------------------------------
// Season rollover

/** Route/control-owned stable reasons (championship-skip reasons ride through). */
export type SeasonRolloverCronControlReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | 'no-season-leagues'
  // PLATFORM-086F2H2B — season leagues EXIST, but every one of them is the demo
  // league, which is manual-only for rollover. Distinct from `no-season-leagues`
  // on purpose: that reason asserts no league is in season at all, which is
  // FALSE here and told an operator on the System Health row that nothing
  // awaited rollover. Matches the shape the three sibling jobs already use.
  | 'no-automatic-season-leagues'
  | 'registry-unavailable'
  // PLATFORM-086F2H1R4 — the registry record EXISTS but does not hold a league
  // array. Distinct from `registry-unavailable`, where the store read itself
  // failed: corruption and unavailability are different operator conditions.
  // Also distinct from `no-season-leagues`, which asserts no league is in
  // season — a claim a corrupt container cannot support.
  | 'registry-malformed'
  // PLATFORM-086F2H1R4 — every surviving production candidate carried a
  // structurally invalid `status.year`, so the run has no usable target. Note
  // it is unreachable as an aggregate REASON whenever any valid year executed:
  // the mixed path preserves the valid years' reason and reports the refusal
  // through `invalidLifecycleTargets` instead.
  | 'unusable-lifecycle-year'
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
  /**
   * PLATFORM-086F2H1R4 — how many ACTIVE PRODUCTION league records were refused
   * this run for a structurally invalid `status.year`. A COUNT only: never a
   * slug and never the unusable value. Run-level because a refused candidate
   * has no usable year to file it under, and per LEAGUE RECORD, not per
   * distinct raw year. A demo record is never counted (the demo exclusion runs
   * first), and neither are non-`season` records.
   */
  invalidLifecycleTargets: number;
  years: SeasonRolloverCronYearExecution[];
  durationMs: number;
};

export type SeasonRolloverCronExecutionState = Omit<
  SeasonRolloverCronExecutionEvent,
  'event' | 'durationMs'
> & {
  /**
   * PLATFORM-086F2H2B — carried on the run STATE but deliberately NOT emitted on
   * the event.
   *
   * It exists only to decide the zero-target reason, and that reason is what the
   * event already reports (`no-automatic-season-leagues` vs `no-season-leagues`),
   * so emitting the boolean too would be a second encoding of the same fact.
   * The three sibling jobs keep their equivalent flag local for the same reason.
   *
   * It lives here rather than in a local because `exec` IS the sink passed to
   * `groupRolloverTargets`, and R4 made that deliberate so a refusal counted
   * before a mid-loop throw cannot be discarded. Splitting the sink across two
   * objects would reopen that.
   *
   * This is the first field on the state that must NEVER reach the event, so the
   * emitter's field-by-field rebuild is now load-bearing rather than stylistic:
   * a refactor to `{ event, ...state, durationMs }` would leak it with no
   * compiler signal, because object spread bypasses excess-property checking.
   */
  excludedDemoCandidate: boolean;
};

/** Initialize the tracker as pessimistic `failure / unexpected-error`, no years. */
export function createSeasonRolloverCronExecutionState(): SeasonRolloverCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    invalidLifecycleTargets: 0,
    excludedDemoCandidate: false,
    years: [],
  };
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
        alreadyInTargetSeasonLeagues: entry.alreadyInTargetSeasonLeagues,
        removedLeagues: entry.removedLeagues,
        refusedLeagues: entry.refusedLeagues,
        failedSeasonTypes: [...entry.failedSeasonTypes],
      })),
      invalidLifecycleTargets: state.invalidLifecycleTargets,
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
      invalidLifecycleTargets: state.invalidLifecycleTargets,
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
