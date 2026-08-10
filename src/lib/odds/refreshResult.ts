/**
 * PLATFORM-086C1 — the ONE typed shared Odds refresh-result contract.
 *
 * The manual `/api/odds?refresh=1` route consumes this vocabulary today; the
 * FUTURE PLATFORM-086C2 automatic cron route will consume the SAME vocabulary,
 * so the two callers can never diverge on what a refresh attempt meant. Outcome
 * truth is produced by the refresh authority (lease/context/quota/merge/commit
 * modules) as a typed value — never re-derived by reparsing an HTTP response.
 *
 * The status axis is intentionally small and total:
 *   - `skipped`  — the authority declined BEFORE any billed provider request
 *                  (lease contention, no eligible target, not due, backoff,
 *                  cache-only context failure, quota refusal). No `/odds` call
 *                  happened and no provider-refresh success/failure is fabricated.
 *   - `success`  — a fresh provider payload was durably committed.
 *   - `no-op`    — the provider responded and validated but nothing changed
 *                  (valid empty, unchanged, or a stale observation that lost to a
 *                  fresher commit). A completed check WITHOUT a last-success
 *                  advance.
 *   - `failure`  — a billed provider request, payload rejection, or durable
 *                  commit failed; prior-good data is retained.
 *
 * The reason axis is a closed, stable, secret-free union: never a provider
 * payload, credential, or arbitrary context detail. Some reasons are only
 * reachable from the DORMANT automatic path (built for C2, not wired in C1);
 * they are enumerated here so the contract is complete for both callers.
 */

export type OddsRefreshStatus = 'skipped' | 'success' | 'no-op' | 'failure';

export type OddsRefreshReason =
  // ---- skipped (no billed provider request) ----
  | 'refresh-in-progress' // a nonexpired durable lease already holds this target
  | 'canonical-context-unavailable' // cache-only schedule/catalog/alias/build read failed
  | 'no-eligible-target' // no canonical game qualifies for automatic polling
  | 'refresh-not-due' // cadence has not elapsed for this target
  | 'automatic-backoff' // durable automatic failure backoff is active
  | 'quota-probe-failed' // the zero-cost `/sports` usage probe failed (transport/HTTP)
  | 'quota-usage-untrustworthy' // usage headers missing/malformed — fail closed
  | 'quota-reserve' // trustworthy usage below the automatic 50-credit reserve
  | 'odds-api-key-missing' // ODDS_API_KEY absent
  // ---- failure (billed provider request or commit) ----
  | 'provider-fetch-failed' // transport/HTTP failure issuing `/odds`
  | 'odds-invalid-payload' // non-array / unparseable body
  | 'odds-schema-drift' // structurally malformed rows / zero usable events
  | 'odds-empty-unexpected' // empty payload but odds are expected for this target
  | 'durable-commit-failed' // the atomic durable transaction failed
  | 'unexpected-error' // an unclassified internal error
  // ---- no-op (validated but nothing changed) ----
  | 'empty-response' // valid empty payload for a legitimately quiet target
  | 'early-lines-withdrawn' // prior rows vanished, but only for games beyond the expectation horizon
  | 'stale-observation' // this observation lost to a fresher committed one
  | 'unchanged-clean' // recomputed durable state equals prior-good
  // ---- success ----
  | 'written-clean' // a fresh payload was durably committed
  // ---- automatic cron flow (PLATFORM-086C2) ----
  | 'automation-paused-or-disabled' // global pause on or Odds dataset toggle off (skipped)
  | 'polling-state-unavailable' // durable raw-cache/refresh-control read failed (failure)
  | 'refresh-control-unavailable' // lease/control store unavailable at acquire (failure)
  | 'closing-maintenance' // a closing-only durable change with no provider refresh due (success)
  | 'closing-maintenance-failed'; // the cache-only closing maintenance store write failed (failure)

/**
 * A billed-provider outcome is one that resolves the AUTOMATIC failure backoff:
 * a provider fetch/payload/commit failure ADVANCES it; a success or valid no-op
 * RESETS it. Missing credentials, quota refusal, context failure, and lease
 * refusal are NOT billed-provider outcomes — they neither advance nor reset.
 */
export type OddsRefreshLeaseResolution =
  | 'success' // resets failure count + records a completed check
  | 'no-op' // resets failure count + records a completed check
  | 'billed-failure' // advances the automatic backoff
  | 'release-only'; // clears the lease without advancing/resetting/completing

export type OddsRefreshResult = {
  status: OddsRefreshStatus;
  reason: OddsRefreshReason;
  /** The HTTP status the authenticated manual route returns for this outcome. */
  httpStatus: 200 | 409 | 500 | 502 | 503;
  /** Rows durably committed (provider-event count) — only meaningful on success. */
  rowsCommitted?: number;
};

/**
 * The lease resolution implied by a refresh result — the single mapping both
 * callers use so lease bookkeeping (backoff advance/reset, completed-check
 * recording) can never drift from the outcome vocabulary.
 */
export function leaseResolutionForResult(result: OddsRefreshResult): OddsRefreshLeaseResolution {
  if (result.status === 'success') return 'success';
  if (result.status === 'no-op') return 'no-op';
  if (result.status === 'failure') {
    // Only a genuinely billed provider request/commit advances the backoff.
    return result.reason === 'provider-fetch-failed' ||
      result.reason === 'odds-invalid-payload' ||
      result.reason === 'odds-schema-drift' ||
      result.reason === 'odds-empty-unexpected' ||
      result.reason === 'durable-commit-failed'
      ? 'billed-failure'
      : 'release-only';
  }
  // skipped
  return 'release-only';
}

export function oddsRefreshResult(
  status: OddsRefreshStatus,
  reason: OddsRefreshReason,
  httpStatus: OddsRefreshResult['httpStatus'],
  extra?: Pick<OddsRefreshResult, 'rowsCommitted'>
): OddsRefreshResult {
  return { status, reason, httpStatus, ...(extra ?? {}) };
}
