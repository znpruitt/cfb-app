/**
 * PLATFORM-086E2B — the secret-safe, machine-readable runtime event emitted once
 * per invocation of the rankings publication cron (`GET /api/cron/rankings`).
 *
 * Mirrors the game-stats / live-scores / Odds / weekly-schedule cron execution
 * logs: this module owns the logging POLICY so the route does not absorb it, and
 * records ONLY the allowlisted operational primitives below — never a request
 * object, response body, thrown error, provider payload, URL, rankings row,
 * registry record, schedule row, AppStateStore record, environment object,
 * header, or credential. The event doubles as proof the scheduled delivery
 * reached the application, so no durable heartbeat is written.
 *
 * The route builds one mutable {@link RankingsCronExecutionState} at entry
 * (pessimistic `failure / unexpected-error`) and emits exactly one event from a
 * single outer `finally`, so authentication failures, skips, every per-year
 * outcome, and unexpected exceptions each produce one line. Emission is
 * best-effort: a serialization or console failure must never change the HTTP
 * response or mask a thrown error.
 */

import type { QuotaRefusalReason } from '../gameStats/quotaPolicy.ts';
import type { RankingsPublicationWindowKind } from './publicationPolicy.ts';
import type { RankingsRefreshReason, RankingsSeasonType } from './refreshResult.ts';

export type RankingsCronExecutionResult =
  | 'skipped'
  | 'success'
  | 'no-op'
  | 'failure'
  | 'in-progress'
  | 'partial';

/** Route/control-owned stable reasons (E2A refresh reasons ride through as-is). */
export type RankingsCronControlReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  | 'automation-paused-or-disabled'
  | 'settings-unavailable'
  | 'registry-unavailable'
  | 'no-ranking-target'
  | 'canonical-context-unavailable'
  | 'not-a-heartbeat-slot'
  | 'no-window-due'
  | 'publication-window-complete'
  | 'publication-window-in-progress'
  | 'publication-control-unavailable'
  | `quota-${QuotaRefusalReason}`
  | 'publication-completion-unconfirmed'
  | 'year-results'
  | 'unexpected-error';

/** A per-year reason: a control reason or the exact E2A refresh reason. */
export type RankingsCronYearReason = RankingsCronControlReason | RankingsRefreshReason;

/** The aggregate reason: uniform per-year reason, or `year-results` when mixed. */
export type RankingsCronExecutionReason = RankingsCronYearReason;

export type RankingsCronYearExecution = {
  year: number;
  lifecycle: 'preseason' | 'season';
  /** The due window kind, or null when no window applied / context failed. */
  publicationWindow: RankingsPublicationWindowKind | null;
  /** The exact E2A publication key, or null when no window applied. */
  publicationKey: string | null;
  result: RankingsCronExecutionResult;
  reason: RankingsCronYearReason;
  /** True iff the `/info` quota probe was initiated for this year. */
  quotaChecked: boolean;
  /** Trustworthy remaining CFBD calls observed by the probe, when known. */
  quotaRemaining: number | null;
  attemptedSeasonTypes: RankingsSeasonType[];
  providerCallAttempted: boolean;
  rowsReceived: number;
  rowsCommitted: number;
  dataChanged: boolean;
};

/** The exact allowlisted shape serialized to a single Vercel log line. */
export type RankingsCronExecutionEvent = {
  event: 'rankings-cron';
  result: RankingsCronExecutionResult;
  reason: RankingsCronExecutionReason;
  years: RankingsCronYearExecution[];
  durationMs: number;
};

/**
 * The mutable tracker the route completes as it decides. Excludes `event`
 * (constant) and `durationMs` (computed at emit) so those cannot be set to an
 * unexpected value from inside the handler.
 */
export type RankingsCronExecutionState = Omit<RankingsCronExecutionEvent, 'event' | 'durationMs'>;

/**
 * Initialize the tracker as pessimistic `failure / unexpected-error` with no
 * year entries. Every field is corrected on the controlled path it reaches; if
 * none is (an unhandled throw), the pessimistic default stands.
 */
export function createRankingsCronExecutionState(): RankingsCronExecutionState {
  return { result: 'failure', reason: 'unexpected-error', years: [] };
}

/**
 * The aggregate result over the per-year entries (PLATFORM-086E2B §5):
 *   1. no entries, or every entry skipped → `skipped` (a skipped/no-window
 *      sibling never degrades an executed year);
 *   2. any `partial` year (`publication-completion-unconfirmed`) → `partial`;
 *   3. failures mixed with any executed non-failure → `partial`;
 *   4. only failures among the executed → `failure`;
 *   5. any success with no failure/partial → `success`;
 *   6. only clean no-ops (± contention) → `no-op`;
 *   7. only active claims / refresh contention → `in-progress`.
 */
export function aggregateRankingsCronResult(
  years: readonly RankingsCronYearExecution[]
): RankingsCronExecutionResult {
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
export function aggregateRankingsCronReason(
  years: readonly RankingsCronYearExecution[]
): RankingsCronExecutionReason {
  if (years.length === 0) return 'year-results';
  const first = years[0]!.reason;
  return years.every((entry) => entry.reason === first) ? first : 'year-results';
}

/**
 * Emit exactly one single-line structured event. Construction is an explicit
 * per-field copy from the allowlisted state — no request/response/error/payload/
 * registry object is ever serialized, and each year entry is rebuilt
 * field-by-field so an accidentally attached extra property can never leak.
 * Best-effort: any failure here is swallowed so it can neither alter the
 * response nor replace an in-flight thrown error.
 */
export function emitRankingsCronExecutionEvent(
  state: RankingsCronExecutionState,
  startedAtMs: number
): void {
  try {
    const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    const event: RankingsCronExecutionEvent = {
      event: 'rankings-cron',
      result: state.result,
      reason: state.reason,
      years: state.years.map((entry) => ({
        year: entry.year,
        lifecycle: entry.lifecycle,
        publicationWindow: entry.publicationWindow,
        publicationKey: entry.publicationKey,
        result: entry.result,
        reason: entry.reason,
        quotaChecked: entry.quotaChecked,
        quotaRemaining: entry.quotaRemaining,
        attemptedSeasonTypes: [...entry.attemptedSeasonTypes],
        providerCallAttempted: entry.providerCallAttempted,
        rowsReceived: entry.rowsReceived,
        rowsCommitted: entry.rowsCommitted,
        dataChanged: entry.dataChanged,
      })),
      durationMs,
    };
    console.log(JSON.stringify(event));
  } catch {
    // Observability is best-effort — never surface a logging fault to the caller.
  }
}
