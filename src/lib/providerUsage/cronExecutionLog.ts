/**
 * Item 127 — secret-safe runtime event for the unconditional CFBD usage sampler.
 *
 * The other seven cron routes each emit one of these plus a durable receipt, so
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
  | 'unexpected-error';

export type UsageSampleCronExecutionState = {
  result: UsageSampleCronExecutionResult;
  reason: UsageSampleCronExecutionReason;
  /** UTC day the sample was filed under, or null when the run never got that far. */
  day: string | null;
  /** Whether the durable series write succeeded. */
  recorded: boolean;
  /**
   * Whether the probe returned a usable `remaining`. NOT a provider spend —
   * `/info` is unbilled, which is why this job never sets `providerCallAttempted`.
   */
  usageAvailable: boolean;
};

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
