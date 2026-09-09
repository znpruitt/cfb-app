import type { CfbdSeasonType } from '@/lib/cfbd';
import type { QuotaRefusalReason } from '@/lib/gameStats/quotaPolicy';
import type { GameStatsRefreshOutcomeReason } from '@/lib/gameStats/refreshOutcome';

/**
 * PLATFORM-086F1 — the secret-safe, machine-readable runtime event emitted once
 * per invocation of the QStash-triggered game-stats cron.
 *
 * This module owns the logging POLICY so the ~400-line route does not absorb it.
 * It records ONLY the allowlisted operational primitives below — never a request
 * object, response body, thrown error, provider payload, environment value, URL,
 * credential, or authorization header. The event remains the detailed
 * per-invocation log surface, including authentication failures;
 * PLATFORM-086F2E1 separately records a latest-only durable receipt
 * (`scheduler-execution-status`) after successful authentication, and that
 * receipt never replaces or changes this runtime event.
 *
 * The route builds one mutable {@link GameStatsCronExecutionState} at entry and
 * emits exactly one event from a single `finally`, so authentication failures,
 * skips, every interpreter outcome (including `partial`), and unexpected
 * exceptions each produce one line. Emission is best-effort: a serialization or
 * console failure must never change the HTTP response or mask a thrown error.
 */

export type GameStatsCronExecutionResult = 'skipped' | 'success' | 'partial' | 'no-op' | 'failure';

/**
 * Which of the route's two mutually exclusive jobs this invocation performed
 * (PLATFORM-110B). `poll` is ordinary kickoff-window polling; `reconcile` is a
 * bounded correction pass over a partition whose window has long closed. A run
 * never does both — reconciliation is considered only once polling has no
 * target — so one field describes the whole invocation, and a run that fetched
 * nothing keeps the `poll` default.
 */
export type GameStatsCronExecutionMode = 'poll' | 'reconcile';

/**
 * Stable route-level reason vocabulary. The pre-provider branches use the fixed
 * literals; a quota refusal composes `quota-${QuotaRefusalReason}`; and a normal
 * interpreter result contributes its exact {@link GameStatsRefreshOutcomeReason}
 * verbatim (never collapsed).
 */
export type GameStatsCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | 'automation-paused-or-disabled'
  | 'canonical-context-unavailable'
  // Retains its exact meaning of "this run has nothing to fetch" — since
  // PLATFORM-110B that means neither a polling target NOR a due reconciliation
  // pass. The literal is unchanged because System Health's nothing-due
  // presentation and the live-scores cron share it.
  | 'no-polling-target'
  // PLATFORM-110B: the season's reconciliation ledger could not be read or is
  // not a ledger. Reconciliation is suppressed for this run and NO provider call
  // is made; ordinary polling had already found no target.
  | 'reconciliation-ledger-unavailable'
  // PLATFORM-110B: a correction pass was due but its attempt could not be
  // RESERVED durably because the store could not record it — a full season row,
  // a write failure, or a malformed record. No provider call is made, which is
  // the point: a store that cannot record must not be able to spend. This is a
  // FAULT and is classified `failure` so it reaches an operator.
  | 'reconciliation-unreserved'
  // PLATFORM-110B: the reservation was refused because a CONCURRENT run had
  // already closed the pass, or had consumed its last permitted attempt. Both
  // are benign — the work was done, or the bound did its job — so the run
  // resolves `no-op`. Classifying these as failures let an overlapping QStash
  // delivery overwrite the successful run's evidence with a false alarm.
  | 'reconciliation-already-done'
  | 'reconciliation-attempts-exhausted'
  // PLATFORM-110B: the merge COMMITTED but its ledger settlement did not, so
  // the data work succeeded and the bookkeeping failed. Reported `partial`
  // rather than `success`, because a real fault must not read as healthy.
  | 'reconciliation-settlement-failed'
  | `quota-${QuotaRefusalReason}`
  | 'cfbd-api-key-missing'
  | 'provider-fetch-failed'
  | 'ingestion-failed'
  | 'unexpected-error'
  | GameStatsRefreshOutcomeReason;

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type GameStatsCronExecutionEvent = {
  event: 'game-stats-cron';
  result: GameStatsCronExecutionResult;
  reason: GameStatsCronExecutionReason;
  year: number;
  week: number | null;
  seasonType: CfbdSeasonType | null;
  /** Which job this invocation performed (PLATFORM-110B). */
  mode: GameStatsCronExecutionMode;
  /** True once the CFBD `/info` quota probe is invoked (regardless of result). */
  quotaChecked: boolean;
  /** True only for the billed CFBD `/games/teams` data request (not `/info`). */
  providerCallAttempted: boolean;
  committedGames: number;
  /**
   * Games whose stored content the merge CHANGED (`merge.updated`), a subset of
   * `committedGames`. It is reported for BOTH modes because it is the same fact
   * either way, and it is the number a reconciliation pass is judged on: a pass
   * that re-confirmed everything commits fence advances (`committedGames > 0`)
   * while correcting nothing (`correctedGames === 0`), and the two must never be
   * collapsed.
   */
  correctedGames: number;
  durationMs: number;
};

/**
 * The mutable tracker the route completes as it makes its decision. It excludes
 * `event` (constant) and `durationMs` (computed at emit) so those cannot be set
 * to an unexpected value from inside the handler.
 */
export type GameStatsCronExecutionState = Omit<GameStatsCronExecutionEvent, 'event' | 'durationMs'>;

/**
 * Initialize the tracker as `failure / unexpected-error` with a null partition,
 * both call flags false, and zero committed games. The season year is required
 * up front so an authentication failure still logs its year. Every field is
 * corrected on the controlled path it actually reaches; if none is (an
 * unhandled throw), the pessimistic default stands.
 */
export function createCronExecutionState(year: number): GameStatsCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    year,
    week: null,
    seasonType: null,
    mode: 'poll',
    quotaChecked: false,
    providerCallAttempted: false,
    committedGames: 0,
    correctedGames: 0,
  };
}

/**
 * Emit exactly one single-line structured event. Construction is an explicit
 * per-field copy from the allowlisted state — no request/response/error/payload
 * object is ever serialized. Best-effort: any failure here is swallowed so it
 * can neither alter the response nor replace an in-flight thrown error.
 */
export function emitGameStatsCronExecutionEvent(
  state: GameStatsCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: GameStatsCronExecutionEvent = {
      event: 'game-stats-cron',
      result: state.result,
      reason: state.reason,
      year: state.year,
      week: state.week,
      seasonType: state.seasonType,
      mode: state.mode,
      quotaChecked: state.quotaChecked,
      providerCallAttempted: state.providerCallAttempted,
      committedGames: state.committedGames,
      correctedGames: state.correctedGames,
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}
