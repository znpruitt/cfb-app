/**
 * PLATFORM-115: completed CFBD responses were measured at 8.2-25s during the
 * opening slate. A 40s ceiling covers that completed band with 15s of headroom
 * and lets the request that was still running at 30s continue for another 10s.
 * The incomplete 30s observation is a lower bound, not a claimed upper bound.
 */
export const CFBD_PEAK_LATENCY_TIMEOUT_MS = 40_000;
