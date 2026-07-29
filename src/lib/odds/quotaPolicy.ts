/**
 * PLATFORM-086C1 — reusable AUTOMATIC Odds quota gate + cost estimator (DORMANT:
 * built and tested for the FUTURE PLATFORM-086C2 cron, called from NO production
 * code in C1). The authorized MANUAL refresh keeps its existing retry/pacing and
 * low-quota warnings and is never subject to this hard reserve.
 *
 * The automatic flow (C2):
 *   exact target selected + refresh due + lease acquired
 *   → validate ODDS_API_KEY
 *   → GET `/v4/sports` with ONE attempt (quota-free; returns usage headers)
 *   → read trustworthy usage headers
 *   → require remaining >= estimated request cost + 50 (the reserve)
 *   → issue at most ONE `/odds` request (no transport retry)
 *
 * `/v4/sports` does not consume quota and is NOT an Odds data-provider call, so
 * `providerCallAttempted` refers only to `/odds`. Missing/malformed usage FAILS
 * CLOSED (`quota-usage-untrustworthy`); a probe transport/HTTP failure is
 * `quota-probe-failed`; trustworthy usage below the reserve is `quota-reserve` and
 * issues no `/odds` request.
 */

import {
  parseOddsUsageHeaders,
  type OddsUsageContext,
  type OddsUsageSnapshot,
} from '../api/oddsUsage.ts';

/** The Odds-automation reserve credits (never eaten into by automation). */
export const ODDS_AUTOMATION_RESERVE_CREDITS = 50;
/** The quota-free usage probe endpoint (returns `x-requests-*` headers). */
export const ODDS_SPORTS_ENDPOINT = 'https://api.the-odds-api.com/v4/sports';
/** Odds usage limit (mirrors `oddsUsage`'s fixed tier limit). */
const ODDS_USAGE_LIMIT = 500;

/**
 * The exact `/odds` request cost from the canonical markets/bookmakers contract:
 * unique market count × explicit-bookmaker groups of up to ten. For the canonical
 * three markets over the seven canonical bookmakers this is `3 × ceil(7/10) = 3`.
 * `/odds` costs one credit per returned market per region-equivalent, and each
 * group of up to ten explicit bookmakers is one region-equivalent.
 */
export function estimateOddsRequestCost(
  markets: readonly string[],
  bookmakers: readonly string[]
): number {
  const uniqueMarkets = new Set(markets.map((m) => m.trim().toLowerCase()).filter(Boolean)).size;
  const bookmakerGroups = Math.max(1, Math.ceil(bookmakers.length / 10));
  return uniqueMarkets * bookmakerGroups;
}

/** The minimum remaining credits automation requires: cost + the 50 reserve. */
export function oddsAutomationMinRemaining(requestCost: number): number {
  return requestCost + ODDS_AUTOMATION_RESERVE_CREDITS;
}

export type AutomaticOddsQuotaDecision =
  | { kind: 'allowed'; remaining: number }
  | {
      kind: 'refused';
      reason: 'quota-usage-untrustworthy' | 'quota-reserve';
      remaining: number | null;
    };

function isTrustworthyRemaining(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The automation gate: trustworthy usage at or above `requestCost + 50`, else
 * refuse. Missing/malformed remaining FAILS CLOSED (`quota-usage-untrustworthy`);
 * trustworthy-but-below-reserve is `quota-reserve`. For the canonical cost 3 the
 * threshold is 53 — remaining 53 permits, remaining 52 refuses.
 */
export function evaluateAutomaticOddsQuota(params: {
  remaining: unknown;
  requestCost: number;
}): AutomaticOddsQuotaDecision {
  const { remaining, requestCost } = params;
  if (!isTrustworthyRemaining(remaining)) {
    return { kind: 'refused', reason: 'quota-usage-untrustworthy', remaining: null };
  }
  if (remaining < oddsAutomationMinRemaining(requestCost)) {
    return { kind: 'refused', reason: 'quota-reserve', remaining };
  }
  return { kind: 'allowed', remaining };
}

export type OddsQuotaProbeResult =
  | { kind: 'usage'; used: number; remaining: number; lastCost: number }
  | { kind: 'quota-usage-untrustworthy' }
  | { kind: 'quota-probe-failed' };

/**
 * Issue the quota-free `/v4/sports` probe ONCE (no transport retry) and read the
 * usage headers. A transport error or non-OK HTTP status is `quota-probe-failed`;
 * present-but-unparseable headers are `quota-usage-untrustworthy`. `fetchImpl` is
 * injectable for tests; nothing in C1 production calls this.
 */
export async function probeOddsQuota(params: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<OddsQuotaProbeResult> {
  const url = `${ODDS_SPORTS_ENDPOINT}?apiKey=${encodeURIComponent(params.apiKey)}`;
  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    // Bounded like the `/odds` request, so a hung probe cannot hold the refresh
    // lease until the platform function timeout (review remediation).
    response = await doFetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  } catch {
    return { kind: 'quota-probe-failed' };
  }
  if (!response.ok) return { kind: 'quota-probe-failed' };
  const parsed = parseOddsUsageHeaders(response.headers);
  if (!parsed) return { kind: 'quota-usage-untrustworthy' };
  // Fail CLOSED on out-of-range values: the shared header parser accepts any
  // finite number, but a negative or non-integer credit count is malformed usage
  // that must never be trusted as quota (review remediation) — e.g. a valid
  // `remaining` alongside a `-1` used/last must not permit an automatic request.
  if (
    ![parsed.used, parsed.remaining, parsed.lastCost].every(
      (v) => Number.isSafeInteger(v) && v >= 0
    )
  ) {
    return { kind: 'quota-usage-untrustworthy' };
  }
  return {
    kind: 'usage',
    used: parsed.used,
    remaining: parsed.remaining,
    lastCost: parsed.lastCost,
  };
}

function clampNonNegative(value: number): number {
  return value < 0 || !Number.isFinite(value) ? 0 : value;
}

/**
 * Build a conservative usage snapshot when the `/odds` response omitted usage
 * headers, from the FRESH pre-`/odds` probe values:
 *   - an exact empty array spent ZERO credits — preserve the pre-probe balance;
 *   - a nonempty/malformed/uncertain response, or an HTTP failure after `/odds`
 *     was attempted, conservatively deducts the maximum estimated cost.
 * The snapshot carries the stable `odds-automation-estimate` source; a later
 * zero-cost `/sports` probe corrects it. Never leaves a stale pre-call snapshot
 * presented as post-call truth after an uncertain billed request.
 */
export function estimatePostOddsUsage(params: {
  preProbe: { used: number; remaining: number };
  outcome: 'empty-zero-cost' | 'uncertain-billed';
  requestCost: number;
  context?: OddsUsageContext;
}): OddsUsageSnapshot {
  const deduction = params.outcome === 'empty-zero-cost' ? 0 : params.requestCost;
  return {
    used: clampNonNegative(params.preProbe.used + deduction),
    remaining: clampNonNegative(params.preProbe.remaining - deduction),
    lastCost: deduction,
    limit: ODDS_USAGE_LIMIT,
    capturedAt: new Date().toISOString(),
    source: 'odds-automation-estimate',
    sportKey: params.context?.sportKey,
    markets: params.context?.markets,
    regions: params.context?.regions,
    endpointType: params.context?.endpointType,
    cacheStatus: params.context?.cacheStatus,
  };
}
