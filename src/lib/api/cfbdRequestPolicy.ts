/**
 * PLATFORM-115: completed opening-slate CFBD samples took 8.2s, 16.0s, and
 * 21.5s. A 40s ceiling covers the accepted 8-25s latency band and lets the
 * request that was still running at 30s continue for another 10s. The incomplete
 * 30s observation is a lower bound, not a claimed upper bound.
 */
export const CFBD_PEAK_LATENCY_TIMEOUT_MS = 40_000;
