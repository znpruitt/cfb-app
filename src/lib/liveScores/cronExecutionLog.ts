import type { QuotaRefusalReason } from '@/lib/gameStats/quotaPolicy';

/**
 * PLATFORM-086B1 — the secret-safe, machine-readable runtime event emitted once
 * per invocation of the (dormant) live-scores cron.
 *
 * Mirrors the game-stats cron execution log (PLATFORM-086F1): this module owns
 * the logging POLICY so the route does not absorb it, and records ONLY the
 * allowlisted operational primitives below — never a request object, response
 * body, thrown error, provider payload, environment value, URL, credential, or
 * authorization header. The event remains the detailed per-invocation log
 * surface, including authentication failures; PLATFORM-086F2E1 separately
 * records a latest-only durable receipt (`scheduler-execution-status`) after
 * successful authentication, and that receipt never replaces or changes this
 * runtime event.
 *
 * The route builds one mutable {@link LiveScoresCronExecutionState} at entry and
 * emits exactly one event from a single `finally`, so authentication failures,
 * skips, every polling outcome (including `partial`), and unexpected exceptions
 * each produce one line. Emission is best-effort: a serialization or console
 * failure must never change the HTTP response or mask a thrown error.
 */

export type LiveScoresCronExecutionResult = 'skipped' | 'success' | 'partial' | 'no-op' | 'failure';

export type LiveScoresPollingMode = 'scoreboard' | 'final-reconciliation';

/**
 * Stable route-level reason vocabulary. Pre-provider branches use the fixed
 * literals; a quota refusal composes `quota-${QuotaRefusalReason}`; scoreboard
 * and final-reconciliation contribute their exact classification literals.
 */
export type LiveScoresCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | 'automation-paused-or-disabled'
  | 'canonical-context-unavailable'
  | 'no-polling-target'
  | `quota-${QuotaRefusalReason}`
  | 'cfbd-api-key-missing'
  | 'provider-fetch-failed'
  | 'scoreboard-invalid-payload'
  | 'scoreboard-schema-drift'
  | 'scoreboard-empty-unexpected'
  | 'scoreboard-no-target-matches'
  | 'scoreboard-targets-missing'
  | 'scoreboard-unchanged-clean'
  | 'scoreboard-written-clean'
  | 'scoreboard-written-partial'
  | 'final-reconciliation-confirmed'
  | 'final-reconciliation-partial'
  | 'final-reconciliation-not-confirmed'
  | 'final-reconciliation-invalid-payload'
  | 'final-reconciliation-empty-unexpected'
  | 'durable-commit-failed'
  | 'unexpected-error';

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type LiveScoresCronExecutionEvent = {
  event: 'live-scores-cron';
  result: LiveScoresCronExecutionResult;
  reason: LiveScoresCronExecutionReason;
  year: number;
  mode: LiveScoresPollingMode | null;
  /** Count of canonical games targeted this run (0 outside a resolved target). */
  targetGames: number;
  /** Count of exact week partitions targeted this run. */
  targetPartitions: number;
  /** True once the CFBD `/info` quota probe is invoked (regardless of result). */
  quotaChecked: boolean;
  /** True only for the ONE billed CFBD `/scoreboard` or `/games` request. */
  providerCallAttempted: boolean;
  /** Confirmed durable score/status changes only (0 on skip/no-op/failure). */
  committedGames: number;
  durationMs: number;
};

/**
 * The mutable tracker the route completes as it makes its decision. Excludes
 * `event` (constant) and `durationMs` (computed at emit) so those cannot be set
 * to an unexpected value from inside the handler.
 */
export type LiveScoresCronExecutionState = Omit<
  LiveScoresCronExecutionEvent,
  'event' | 'durationMs'
>;

/**
 * Initialize the tracker as `failure / unexpected-error` with no mode, both call
 * flags false, and zero target/committed counts. The season year is required up
 * front so an authentication failure still logs its year. Every field is
 * corrected on the controlled path it actually reaches; if none is (an unhandled
 * throw), the pessimistic default stands.
 */
export function createLiveScoresCronExecutionState(year: number): LiveScoresCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    year,
    mode: null,
    targetGames: 0,
    targetPartitions: 0,
    quotaChecked: false,
    providerCallAttempted: false,
    committedGames: 0,
  };
}

/**
 * Emit exactly one single-line structured event. Construction is an explicit
 * per-field copy from the allowlisted state — no request/response/error/payload
 * object is ever serialized. Best-effort: any failure here is swallowed so it
 * can neither alter the response nor replace an in-flight thrown error.
 */
export function emitLiveScoresCronExecutionEvent(
  state: LiveScoresCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: LiveScoresCronExecutionEvent = {
      event: 'live-scores-cron',
      result: state.result,
      reason: state.reason,
      year: state.year,
      mode: state.mode,
      targetGames: state.targetGames,
      targetPartitions: state.targetPartitions,
      quotaChecked: state.quotaChecked,
      providerCallAttempted: state.providerCallAttempted,
      committedGames: state.committedGames,
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}
