/**
 * PLATFORM-115: completed opening-slate CFBD samples took 8.2s, 16.0s, and
 * 21.5s. A 40s ceiling covers the accepted 8-25s latency band and lets the
 * request that was still running at 30s continue for another 10s. The incomplete
 * 30s observation is a lower bound, not a claimed upper bound.
 */
export const CFBD_PEAK_LATENCY_TIMEOUT_MS = 40_000;

/**
 * The `/info` quota-probe ceiling (PLATFORM-755). Same NUMBER as
 * {@link CFBD_PEAK_LATENCY_TIMEOUT_MS} today, deliberately a DIFFERENT constant:
 * the two are constrained by different things and must be free to diverge. A
 * future payload-driven change to the `/games` ceiling must not silently
 * retighten a quota gate whose constraint is invocation share.
 *
 * ## Why the probe's ceiling is not smaller than the payload ceiling
 *
 * The intuition that `/info` is a "small probe" and therefore fast is WRONG, and
 * it was measured wrong rather than argued wrong. `/info` latency sits in the
 * same band as PLATFORM-115's `/games` samples — payload size does not predict
 * CFBD latency.
 *
 * ## The measurement
 *
 * `usage-sample` fires every six hours (QStash `turfwar-usage-sample-6h`) and
 * stamps its observation's `at`
 * IMMEDIATELY after the probe settles, so `at − scheduled slot` bounds
 * (QStash delivery jitter + probe latency). Over the retained
 * `provider-usage / cfbd-observations` series read on the read-only replica:
 *
 *   N = 33, 2026-09-05 → 2026-09-13
 *   min 971ms  p50 10,809ms  p90 24,953ms  p95 34,604ms  max 37,027ms
 *   >5s: 31/33     >10s: 21/33     >20s: 8/33
 *
 * **Coverage, stated because the value rests on it:** this is an UPPER BOUND
 * including delivery jitter, over 33 samples in 8 days from ONE cron — not a
 * per-call measurement. In the single run where jitter is separately observable
 * (2026-09-13: receipt `startedAt` 00:00:01.188, observation `at` 00:00:29.859)
 * jitter was 1,188ms and the probe was ~28.7s — about 96% of the delta. The
 * fastest observation (971ms total) independently caps jitter below 1s there.
 * The other 32 are sums that cannot be decomposed.
 *
 * ## Why 40s and not tighter
 *
 * Every caller's failure path on an unusable probe is REFUSE, so the deadline
 * does not protect the gated work — it CANCELS it. A tighter ceiling therefore
 * buys nothing and costs samples: against the series above, 30s would drop 2 of
 * 33 observations and 40s drops none, each drop being a 6-hour hole in an
 * append-only series that exists to be read.
 *
 * ## What the invocation envelope is, and what it is NOT known to be
 *
 * Stated precisely, because an earlier revision of this docblock overreached and
 * a review caught it. MEASURED: the plan permits at least 300s
 * (`season-transition/route.ts:58` declares `maxDuration = 300` and ships), and
 * the default envelope is at least 44.6s (a 44,596ms `schedule-refresh` run
 * completed in production). NOT MEASURED: the default itself. None of this
 * probe's callers declare `maxDuration`, so they take the platform default, and
 * nothing here establishes it exceeds 80s — which is what a 40s probe followed
 * by a 40s payload call would need. The earlier text asserted that anyway.
 *
 * So the 40s ceiling is justified by the LATENCY distribution above, not by
 * envelope headroom. If the default envelope is in fact 60s, a pathological
 * probe plus a pathological payload call still overruns it — but strictly less
 * often than before this item, when the probe alone could hold the invocation
 * for 300s. Declaring `maxDuration` on the probe's callers, or measuring the
 * default, is separate work and is reported rather than assumed here.
 *
 * What the deadline actually buys is that the refusal is CLEAN and ATTRIBUTABLE
 * and leaves budget to record itself, instead of the platform killing a hung
 * invocation with an unresolved attempt open.
 */
export const CFBD_USAGE_PROBE_TIMEOUT_MS = 40_000;
