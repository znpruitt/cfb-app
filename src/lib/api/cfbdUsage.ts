import { CFBD_USAGE_PROBE_TIMEOUT_MS } from './cfbdRequestPolicy.ts';
import { fetchUpstreamJson } from './fetchUpstream.ts';
import { cfbdCanonicalLimitForTier } from './providerQuota.ts';

type CfbdInfoResponse = {
  patronLevel?: unknown;
  remainingCalls?: unknown;
};

/**
 * Raw-but-validated CFBD usage observation (PLATFORM-086G1, deferred finding
 * #7). Every field is `null` when the provider did not supply a usable value —
 * missing, null, nonnumeric, non-finite, or negative fields are UNAVAILABLE,
 * never coerced to an authoritative number. In particular a missing
 * `remainingCalls` is never reported as 0 remaining (which downstream reads as
 * quota exhaustion). Reconciliation/display authority stays with
 * `normalizeProviderQuota` — this module only refuses to fabricate inputs.
 */
export type CfbdUsage = {
  patronLevel: number | null;
  used: number | null;
  remaining: number | null;
  limit: number | null;
};

function usableNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A usable patron tier is a non-negative integer; anything else is unknown. */
function usablePatronLevel(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function resolveCfbdUsage(data: CfbdInfoResponse): CfbdUsage {
  const patronLevel = usablePatronLevel(data.patronLevel);
  const remaining = usableNonNegativeNumber(data.remainingCalls);

  // The canonical tier→limit map is the single source of truth (unknown
  // INTEGER tiers fall back to Tier 0 per the existing canonical contract).
  // Tier 1 is 5,000 monthly calls. An unusable patronLevel yields NO limit —
  // never a guessed ceiling.
  const limit = patronLevel !== null ? cfbdCanonicalLimitForTier(patronLevel) : null;

  // `used` is derived, not provider-supplied: only trustworthy when both the
  // canonical limit and a plausible `remaining` (≤ limit) exist. A trustworthy
  // remaining of 0 still derives used === limit — genuine exhaustion is
  // preserved; only fabricated exhaustion is removed.
  const used =
    limit !== null && remaining !== null && remaining <= limit ? limit - remaining : null;

  return {
    patronLevel,
    used,
    remaining,
    limit,
  };
}

/**
 * Fetch the CFBD `/info` quota observation under a DEADLINE (PLATFORM-755).
 *
 * ## What changed and why
 *
 * This used to call `fetch` directly, with no `AbortController` and no timeout.
 * Measured against a TLS server that completed the handshake, received the
 * request and never answered: the call hung for **301.3 seconds** before
 * `undici`'s stock 300s `headersTimeout` ended it (`UND_ERR_HEADERS_TIMEOUT`),
 * and the same shape on Node's default dispatcher took 301.1s. So it was never
 * literally unbounded — it was bounded by two independent 300s `undici` timers
 * (headers, then body), either of which outlasts any invocation envelope. On a
 * serverless invocation that is not a slow probe: it is a cron that spends the
 * whole invocation here and never reaches the work this call gates.
 *
 * It now routes through {@link fetchUpstreamJson}, which reads the body INSIDE
 * the attempt's deadline (PLATFORM-662), so both phases are bounded by one
 * ceiling — {@link CFBD_USAGE_PROBE_TIMEOUT_MS}, whose derivation and the
 * measured latency distribution behind it live on that constant.
 *
 * ## No retry, deliberately
 *
 * `maxAttempts` stays the shared helper's default of 1. This is a quota
 * consideration, not a style one: the comment below records that the reserve's
 * 2-call margin accounts for exactly ONE `/info` call, so a retry would spend a
 * second billed call against the very reserve the probe exists to protect.
 *
 * ## A timed-out probe is not a provider-data failure
 *
 * It throws, and every caller's `catch` already maps a thrown probe to
 * "usage unavailable" — the same conservative path a probe that RETURNS
 * unavailable lands on. The gate's job is to decide whether to spend; a
 * deadline changes when that decision is reached, never what it is.
 */
export async function fetchCfbdUsage(options: { fresh?: boolean } = {}): Promise<CfbdUsage> {
  return probeCfbdUsage(options, CFBD_USAGE_PROBE_TIMEOUT_MS);
}

async function probeCfbdUsage(options: { fresh?: boolean }, timeoutMs: number): Promise<CfbdUsage> {
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  // Display surfaces tolerate a 600s-stale snapshot; QUOTA GATES must not — a
  // cached remaining-count would let a burst of refreshes (e.g. the admin
  // season backfill) reuse one pre-spend snapshot and collectively cross the
  // reserve. `fresh` bypasses the framework cache for exactly those callers
  // (its cost is the one /info call the reserve's 2-call margin accounts for).
  //
  // MEASURED (PLATFORM-755), because this split surviving the move to the shared
  // helper was the open question of the item: `next: { revalidate: 600 }` DOES
  // reach `fetch` through `fetchUpstreamJson` and Next honours it. Three
  // requests through the helper against a counting upstream, production build,
  // cold fetch cache => ONE upstream hit; the same three with `cache: 'no-store'`
  // => three. Neither the helper's unconditional `signal` nor the `Authorization`
  // header defeats it.
  const cacheInit = options.fresh
    ? ({ cache: 'no-store' } as const)
    : ({ next: { revalidate: 600 } } as const);

  const parsed = await fetchUpstreamJson<unknown>('https://api.collegefootballdata.com/info', {
    headers: { Authorization: `Bearer ${cfbdApiKey}`, Accept: 'application/json' },
    timeoutMs,
    ...cacheInit,
  });

  // A 200 with a non-object body is a MALFORMED payload, not a read failure:
  // resolve it to all-unavailable rather than throwing, keeping "unavailable"
  // distinct from the thrown provider-read-failure path. `null` is the case that
  // makes this guard load-bearing rather than decorative — an unguarded
  // `null.patronLevel` throws, which would report a payload problem as a read
  // failure.
  const data: CfbdInfoResponse =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CfbdInfoResponse)
      : {};
  return resolveCfbdUsage(data);
}

/**
 * Test-only: the production probe with an INJECTABLE deadline, following the
 * `__…ForTests` seam convention in `fetchUpstream.ts`. It exists because the
 * runner caps a test process at 30s (`scripts/run-tests.mjs`), so the real 40s
 * ceiling cannot be waited out; the deadline MECHANISM is proven here at a few
 * hundred milliseconds and the production value is pinned by assertion.
 * {@link fetchCfbdUsage} is a single delegation, so there is nothing between the
 * two but the constant. Never called in production paths.
 */
export function __fetchCfbdUsageWithTimeoutForTests(
  options: { fresh?: boolean },
  timeoutMs: number
): Promise<CfbdUsage> {
  return probeCfbdUsage(options, timeoutMs);
}
