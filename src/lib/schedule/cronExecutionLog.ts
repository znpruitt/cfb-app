import type { FullSeasonScheduleRefreshReason } from './fullSeasonScheduleRefreshResult.ts';
import type { FinalScoreDifferenceIdentity } from './finalScoreSweep.ts';
import type { SeasonType } from './cfbdSchedule.ts';
import type { WeeklyScheduleRefreshOperation } from './weeklyRefreshOperation.ts';

/**
 * PLATFORM-086E1B — the secret-safe, machine-readable runtime event emitted once
 * per invocation of the weekly schedule cron (`GET /api/cron/schedule-refresh`).
 *
 * Mirrors the game-stats / live-scores / Odds cron execution logs: this module
 * owns the logging POLICY so the route does not absorb it, and records ONLY the
 * allowlisted operational primitives below — never a request object, response
 * body, thrown error, schedule item, provider payload, URL, registry row,
 * environment object, header, or credential. The event remains the detailed
 * per-invocation log surface, including authentication failures;
 * PLATFORM-086F2E1 separately records a latest-only durable receipt
 * (`scheduler-execution-status`) after successful authentication, and that
 * receipt never replaces or changes this runtime event.
 *
 * The route builds one mutable {@link ScheduleRefreshCronExecutionState} at entry
 * (pessimistic `failure / unexpected-error`) and emits exactly one event from a
 * single outer `finally`, so authentication failures, skips, every per-year
 * outcome, and unexpected exceptions each produce one line. Emission is
 * best-effort: a serialization or console failure must never change the HTTP
 * response or mask a thrown error.
 */

export type ScheduleRefreshCronExecutionResult =
  | 'skipped'
  | 'success'
  | 'partial'
  | 'no-op'
  | 'failure';

export type ScheduleRefreshCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  // No league is in `season` or `preseason` at all.
  | 'no-maintenance-target'
  // PLATFORM-086F2H1T3 — active leagues EXIST, but every one that would have
  // produced a maintenance year is the demo league, which is manual-only.
  // Distinct from `no-maintenance-target` on purpose: reusing that reason would
  // tell an operator no active league exists when one does.
  | 'no-automatic-maintenance-target'
  // PLATFORM-086F2H1R2 — the registry record EXISTS but does not hold a league
  // array. Distinct from `canonical-context-unavailable`, which this route also
  // uses for a genuine store READ failure: a corrupt container is readable, and
  // reporting either zero-target reason above would assert something about
  // leagues the container cannot support.
  | 'registry-malformed'
  // PLATFORM-086F2H1R2 — active PRODUCTION leagues exist, but every one carries
  // a `status.year` that is not a structurally valid season year, so none could
  // own a maintenance year. Never emitted for a demo record: the demo exclusion
  // runs first.
  | 'unusable-lifecycle-year'
  | 'automation-paused-or-disabled'
  | 'season-transition-owner'
  | 'canonical-context-unavailable'
  | 'settings-unavailable'
  | 'year-results'
  | 'unexpected-error';

export type ScheduleRefreshCronYearExecution = {
  year: number;
  /** The classified operation, or null when context was unavailable/skipped pre-classification. */
  operation: WeeklyScheduleRefreshOperation | null;
  result: 'skipped' | 'success' | 'no-op' | 'failure';
  reason:
    | FullSeasonScheduleRefreshReason
    | 'automation-paused-or-disabled'
    | 'season-transition-owner'
    | 'canonical-context-unavailable'
    | 'settings-unavailable'
    | 'score-sweep-failed';
  providerCallAttempted: boolean;
  rowsReceived: number;
  rowsCommitted: number;
  dataChanged: boolean;
  scoreRepairs: number;
  scoreDifferenceCount: number;
  scoreDifferences: ReadonlyArray<FinalScoreDifferenceIdentity>;
  scoreDifferencesTruncated: boolean;
  scoreSweepFailedPartitions: ReadonlyArray<{ week: number; seasonType: SeasonType }>;
  kickoffsChanged: number;
};

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type ScheduleRefreshCronExecutionEvent = {
  event: 'schedule-refresh-cron';
  result: ScheduleRefreshCronExecutionResult;
  reason: ScheduleRefreshCronExecutionReason;
  years: ScheduleRefreshCronYearExecution[];
  /**
   * PLATFORM-086F2H1R2 — how many active PRODUCTION leagues were refused this
   * run for carrying a structurally invalid `status.year`. Run-level, not
   * per-year, because a refused candidate has no usable year to file it under —
   * that is exactly what disqualified it. A count only: never a slug, and never
   * the invalid value.
   *
   * Always an explicit nonnegative integer, so a reader never infers absence.
   */
  invalidLifecycleTargets: number;
  durationMs: number;
};

/**
 * The mutable tracker the route completes as it decides. Excludes `event`
 * (constant) and `durationMs` (computed at emit) so those cannot be set to an
 * unexpected value from inside the handler.
 */
export type ScheduleRefreshCronExecutionState = Omit<
  ScheduleRefreshCronExecutionEvent,
  'event' | 'durationMs'
>;

/**
 * Initialize the tracker as pessimistic `failure / unexpected-error` with no
 * year entries. Every field is corrected on the controlled path it reaches; if
 * none is (an unhandled throw), the pessimistic default stands.
 */
export function createScheduleRefreshCronExecutionState(): ScheduleRefreshCronExecutionState {
  return { result: 'failure', reason: 'unexpected-error', years: [], invalidLifecycleTargets: 0 };
}

/**
 * The aggregate result over the per-year entries (PLATFORM-086E1B §5, extended
 * by E1B1):
 *   1. no entries → `skipped`;
 *   2. all entries skipped → `skipped`;
 *   3. ≥1 failure AND ≥1 non-failure (success/no-op) among the non-skipped →
 *      `partial`;
 *   4. every non-skipped entry failed → `failure`;
 *   5. ≥1 success and no failure → `success`;
 *   6. otherwise (≥1 no-op, no success/failure) → `no-op`.
 * Skips are excluded before the partial/failure comparison, so neither a gated
 * ordinary year NOR a transition-owned preseason year (an intentional
 * `season-transition-owner` deferral) can make a successful sibling run partial —
 * mixed deferrals/skips plus successful work aggregate to success/no-op
 * according to the executed work.
 */
export function aggregateScheduleCronResult(
  years: readonly ScheduleRefreshCronYearExecution[]
): ScheduleRefreshCronExecutionResult {
  const nonSkipped = years.filter((entry) => entry.result !== 'skipped');
  if (years.length === 0 || nonSkipped.length === 0) return 'skipped';
  const hasFailure = nonSkipped.some((entry) => entry.result === 'failure');
  const hasSuccess = nonSkipped.some((entry) => entry.result === 'success');
  const hasNoop = nonSkipped.some((entry) => entry.result === 'no-op');
  if (hasFailure && (hasSuccess || hasNoop)) return 'partial';
  if (hasFailure) return 'failure';
  if (hasSuccess) return 'success';
  return hasNoop ? 'no-op' : 'skipped';
}

/**
 * The aggregate top-level reason over the per-year entries: a uniform
 * transition-deferred/gated/context/settings run reports that uniform reason;
 * anything mixed or actually executed reports `year-results`. (Auth failures and
 * the no-target / registry-failure paths never reach this — the route sets their
 * literal reasons directly.)
 */
export function aggregateScheduleCronReason(
  years: readonly ScheduleRefreshCronYearExecution[]
): ScheduleRefreshCronExecutionReason {
  const uniform = (
    reason:
      | 'automation-paused-or-disabled'
      | 'season-transition-owner'
      | 'canonical-context-unavailable'
      | 'settings-unavailable'
  ): boolean => years.length > 0 && years.every((entry) => entry.reason === reason);
  if (uniform('season-transition-owner')) return 'season-transition-owner';
  if (uniform('automation-paused-or-disabled')) return 'automation-paused-or-disabled';
  if (uniform('canonical-context-unavailable')) return 'canonical-context-unavailable';
  if (uniform('settings-unavailable')) return 'settings-unavailable';
  return 'year-results';
}

/**
 * Emit exactly one single-line structured event. Construction is an explicit
 * per-field copy from the allowlisted state — no request/response/error/payload/
 * registry object is ever serialized, and each year entry is rebuilt
 * field-by-field so an accidentally attached extra property can never leak.
 * Best-effort: any failure here is swallowed so it can neither alter the
 * response nor replace an in-flight thrown error.
 */
export function emitScheduleRefreshCronExecutionEvent(
  state: ScheduleRefreshCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: ScheduleRefreshCronExecutionEvent = {
      event: 'schedule-refresh-cron',
      result: state.result,
      reason: state.reason,
      years: state.years.map((entry) => ({
        year: entry.year,
        operation: entry.operation,
        result: entry.result,
        reason: entry.reason,
        providerCallAttempted: entry.providerCallAttempted,
        rowsReceived: entry.rowsReceived,
        rowsCommitted: entry.rowsCommitted,
        dataChanged: entry.dataChanged,
        scoreRepairs: entry.scoreRepairs,
        scoreDifferenceCount: entry.scoreDifferenceCount,
        scoreDifferences: entry.scoreDifferences.map((difference) => ({
          providerGameId: difference.providerGameId,
          week: difference.week,
          seasonType: difference.seasonType,
        })),
        scoreDifferencesTruncated: entry.scoreDifferencesTruncated,
        scoreSweepFailedPartitions: entry.scoreSweepFailedPartitions.map((partition) => ({
          week: partition.week,
          seasonType: partition.seasonType,
        })),
        kickoffsChanged: entry.kickoffsChanged,
      })),
      invalidLifecycleTargets: state.invalidLifecycleTargets,
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}
