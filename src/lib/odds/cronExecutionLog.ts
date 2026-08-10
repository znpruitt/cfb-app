import type { OddsRefreshReason } from './refreshResult.ts';

/**
 * PLATFORM-086C2 — the secret-safe, machine-readable runtime event emitted once
 * per invocation of the Odds cron (`GET /api/cron/odds`).
 *
 * Mirrors the game-stats / live-scores cron execution logs: this module owns the
 * logging POLICY so the route does not absorb it, and records ONLY the allowlisted
 * operational primitives below — never a request object, response body, thrown
 * error, provider payload, environment value, URL, credential, or authorization
 * header. The event remains the detailed per-invocation log surface, including
 * authentication failures; PLATFORM-086F2E1 separately records a latest-only
 * durable receipt (`scheduler-execution-status`) after successful
 * authentication, and that receipt never replaces or changes this runtime event.
 *
 * The route builds one mutable {@link OddsCronExecutionState} at entry and emits
 * exactly one event from a single `finally`, so authentication failures, skips,
 * every refresh outcome, and unexpected exceptions each produce one line.
 * Emission is best-effort: a serialization or console failure must never change
 * the HTTP response or mask a thrown error.
 */

export type OddsCronExecutionResult = 'skipped' | 'success' | 'no-op' | 'failure';

/**
 * The staged cadence the pure policy selected, verbatim. `early` (PLATFORM-089)
 * is a DISTINCT value rather than a second meaning for `baseline`: the two carry
 * materially different thresholds — 24 hours out beyond the 7-day horizon, 6
 * hours inside it — and an operator reading a receipt cannot tell a once-a-day
 * preseason check from a six-hourly in-season one if both say `baseline`.
 */
export type OddsCronCadence = 'early' | 'baseline' | 'pregame';

/**
 * The stable route reason vocabulary: the two cron-authentication literals plus
 * the shared {@link OddsRefreshReason} (which already carries the settings-skip,
 * context/polling/control, closing-maintenance, quota, provider, payload, no-op,
 * and success reasons).
 */
export type OddsCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | OddsRefreshReason;

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type OddsCronExecutionEvent = {
  event: 'odds-cron';
  result: OddsCronExecutionResult;
  reason: OddsCronExecutionReason;
  year: number;
  cadence: OddsCronCadence | null;
  /** Count of eligible canonical games this run (0 when none/undetermined). */
  eligibleGames: number;
  /** True once the quota-free `/sports` probe is invoked (regardless of result). */
  quotaChecked: boolean;
  /** True only for the ONE billed `/odds` request — never the `/sports` probe. */
  providerCallAttempted: boolean;
  /** Estimated `/odds` cost: 0 until a due provider target is selected, then 3. */
  requestCost: number;
  /** Trustworthy fresh `/sports` remaining before the request (else null). */
  quotaRemainingBefore: number | null;
  /** Trustworthy post-call remaining, or the conservative estimate (else null). */
  quotaRemainingAfter: number | null;
  /** Confirmed provider-event commit count only (0 on skip/no-op/failure). */
  rowsCommitted: number;
  /** True only when the cache-only closing maintenance made a confirmed change. */
  closingStoreChanged: boolean;
  durationMs: number;
};

/**
 * The mutable tracker the route completes as it decides. Excludes `event`
 * (constant) and `durationMs` (computed at emit) so those cannot be set to an
 * unexpected value from inside the handler.
 */
export type OddsCronExecutionState = Omit<OddsCronExecutionEvent, 'event' | 'durationMs'>;

/**
 * Initialize the tracker as `failure / unexpected-error` with null cadence, zero
 * counts/cost, null quota values, and both call flags false. The season year is
 * required up front so an authentication failure still logs its year. Every field
 * is corrected on the controlled path it reaches; if none is (an unhandled throw),
 * the pessimistic default stands.
 */
export function createOddsCronExecutionState(year: number): OddsCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    year,
    cadence: null,
    eligibleGames: 0,
    quotaChecked: false,
    providerCallAttempted: false,
    requestCost: 0,
    quotaRemainingBefore: null,
    quotaRemainingAfter: null,
    rowsCommitted: 0,
    closingStoreChanged: false,
  };
}

/**
 * Emit exactly one single-line structured event. Construction is an explicit
 * per-field copy from the allowlisted state — no request/response/error/payload
 * object is ever serialized. Best-effort: any failure here is swallowed so it can
 * neither alter the response nor replace an in-flight thrown error.
 */
export function emitOddsCronExecutionEvent(
  state: OddsCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: OddsCronExecutionEvent = {
      event: 'odds-cron',
      result: state.result,
      reason: state.reason,
      year: state.year,
      cadence: state.cadence,
      eligibleGames: state.eligibleGames,
      quotaChecked: state.quotaChecked,
      providerCallAttempted: state.providerCallAttempted,
      requestCost: state.requestCost,
      quotaRemainingBefore: state.quotaRemainingBefore,
      quotaRemainingAfter: state.quotaRemainingAfter,
      rowsCommitted: state.rowsCommitted,
      closingStoreChanged: state.closingStoreChanged,
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}
