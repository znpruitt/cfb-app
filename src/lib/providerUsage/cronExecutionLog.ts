/**
 * Item 127 — secret-safe runtime event for the unconditional CFBD usage sampler.
 *
 * The other eight cron routes each emit one of these plus a durable receipt, so
 * "did this job run, and what did it decide" is answerable after Vercel's runtime
 * logs expire. A sampler without one would be the exact gap Item 126 documents,
 * created in a route added after documenting it.
 *
 * Nothing here can fail the run: the emit is wrapped, and the reasons are a closed
 * vocabulary rather than provider or error text.
 */
export type UsageSampleCronExecutionResult = 'success' | 'partial' | 'no-op' | 'failure';

export type UsageSampleCronExecutionReason =
  | 'cron-secret-not-configured'
  | 'cron-authorization-invalid'
  /** A usable observation was taken and written. */
  | 'sample-recorded'
  /**
   * The probe returned nothing usable; the all-null observation was still written.
   * Paired with result `partial`, NOT `success` — System Health raises issues only
   * for failure and partial, and a silent run of empty samples is the failure mode
   * this job would otherwise hide.
   */
  | 'sample-recorded-unavailable'
  /** The durable write failed. The observation is lost; the run is not an error. */
  | 'sample-write-failed'
  | 'sample-write-indeterminate'
  | 'series-unreadable'
  | 'unexpected-error';

export type UsageSampleCronExecutionState = {
  result: UsageSampleCronExecutionResult;
  reason: UsageSampleCronExecutionReason;
  /** UTC day the sample was filed under, or null when the run never got that far. */
  day: string | null;
  /**
   * Whether the durable series write succeeded — `null` when a COMMIT or ROLLBACK
   * failed after the mutation was submitted, leaving durability genuinely unknown.
   * `false` means durably ABSENT and must never stand in for "we cannot tell".
   */
  recorded: boolean | null;
  /**
   * Whether the probe returned a usable `remaining`. NOT a provider spend: CFBD's
   * developer confirmed (2026-09-04) that `/info` and `/info/usage` do not count
   * against the quota, which is why this job never sets `providerCallAttempted`.
   * `quotaPolicy`'s parenthetical still calls this unverified and is now stale.
   */
  usageAvailable: boolean;
};

/**
 * The write outcome as the receipt records it. `indeterminate` becomes `null`, NOT
 * `false`: both reviewers independently found that rounding it down made System
 * Health render "not recorded" for a write whose durability is genuinely unknown —
 * asserting the loss the write path had just refused to assert.
 */
export function recordedFromWriteOutcome(
  outcome: 'recorded' | 'not-recorded' | 'indeterminate' | 'unreadable'
): boolean | null {
  if (outcome === 'indeterminate') return null;
  return outcome === 'recorded';
}

export function createUsageSampleCronExecutionState(): UsageSampleCronExecutionState {
  return {
    result: 'failure',
    reason: 'unexpected-error',
    day: null,
    recorded: false,
    usageAvailable: false,
  };
}

export function emitUsageSampleCronExecutionEvent(
  state: UsageSampleCronExecutionState,
  startedAtMs: number
): void {
  try {
    console.log(
      JSON.stringify({
        event: 'usage-sample-cron',
        result: state.result,
        reason: state.reason,
        day: state.day,
        recorded: state.recorded,
        usageAvailable: state.usageAvailable,
        durationMs: Math.max(0, Math.round(Date.now() - startedAtMs)),
      })
    );
  } catch {
    // Observability is best-effort and must never alter the route outcome.
  }
}
