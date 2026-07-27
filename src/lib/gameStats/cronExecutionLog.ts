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
 * credential, or authorization header. The event doubles as proof that the
 * request reached the application, so no durable heartbeat is written.
 *
 * The route builds one mutable {@link GameStatsCronExecutionState} at entry and
 * emits exactly one event from a single `finally`, so authentication failures,
 * skips, every interpreter outcome (including `partial`), and unexpected
 * exceptions each produce one line. Emission is best-effort: a serialization or
 * console failure must never change the HTTP response or mask a thrown error.
 */

export type GameStatsCronExecutionResult = 'skipped' | 'success' | 'partial' | 'no-op' | 'failure';

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
  | 'no-polling-target'
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
  /** True once the CFBD `/info` quota probe is invoked (regardless of result). */
  quotaChecked: boolean;
  /** True only for the billed CFBD `/games/teams` data request (not `/info`). */
  providerCallAttempted: boolean;
  committedGames: number;
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
