/**
 * PLATFORM-086H3E2 — CFBD quota-reserve policy (DORMANT, pure).
 *
 * The approved reserve semantics for game-stats automation (wired in E3):
 *
 *   - Usage truth is CFBD's OWN reported remaining-call count (the `/info`
 *     body's `remainingCalls`), fetched by the caller; this module never
 *     performs I/O and never fabricates usage.
 *   - Automation may fetch ONLY with trustworthy finite usage showing at
 *     least `CFBD_AUTOMATION_MIN_REMAINING` (1,002) calls remaining — the
 *     1,000-call monthly reserve plus a two-call margin that truthfully
 *     covers the usage check itself possibly spending a call plus the one
 *     partition fetch (whether `/info` counts against quota is verified
 *     empirically during the operator manual proof).
 *   - Missing, malformed, inconsistent, or otherwise untrustworthy usage
 *     FAILS CLOSED for automation — never fabricated as safe quota and never
 *     fabricated as zero remaining (the refusal reason states which).
 *   - The authenticated manual refresh ALSO blocks below the reserve or on
 *     untrustworthy usage (HTTP 429), unless the operator supplies the
 *     second explicit `quotaOverride=1` parameter — `bypassCache=1` alone is
 *     never sufficient. An override is recorded explicitly so the response
 *     and scoped status stay truthful.
 *
 * Attempt bookkeeping is the callers' contract, not this module's: once an
 * exact target is resolved, exactly one scoped attempt begins BEFORE
 * credential validation or any usage/provider request, and a quota refusal
 * resolves that attempt once as a truthful failure without advancing
 * prior-good success metadata. With no exact target (or automation paused
 * before target selection) no attempt exists — and no usage check runs.
 */

/** The monthly CFBD reserve automation must never eat into. */
export const CFBD_AUTOMATION_RESERVE_CALLS = 1000;
/** Reserve + 2-call margin (usage check may spend one; the fetch spends one). */
export const CFBD_AUTOMATION_MIN_REMAINING = CFBD_AUTOMATION_RESERVE_CALLS + 2;

/**
 * The provider-reported usage snapshot as the caller observed it — untyped at
 * the seam because upstream JSON proves nothing.
 */
export type CfbdUsageSnapshot = {
  /** CFBD's reported remaining monthly calls (`/info` body), verbatim. */
  remainingCalls: unknown;
  /** The reconciled monthly limit for the account tier, when known. */
  monthlyLimit?: unknown;
};

export type QuotaRefusalReason =
  | 'usage-unavailable' // remainingCalls missing entirely (null/undefined)
  | 'usage-untrustworthy' // present but non-numeric, non-integer, negative, unsafe, or > limit
  | 'below-reserve'; // trustworthy, but remaining < CFBD_AUTOMATION_MIN_REMAINING

export type AutomationQuotaDecision =
  | { kind: 'allowed'; remaining: number }
  | { kind: 'refused'; reason: QuotaRefusalReason; remaining: number | null };

export type ManualQuotaDecision =
  | { kind: 'allowed'; remaining: number }
  | {
      kind: 'allowed-with-override';
      reason: QuotaRefusalReason;
      remaining: number | null;
    }
  | {
      kind: 'refused';
      reason: QuotaRefusalReason;
      remaining: number | null;
      /** The manual route's refusal status. */
      httpStatus: 429;
    };

function isTrustworthyCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validate the snapshot into a trustworthy remaining count, or the refusal
 * reason. A remaining count exceeding a trustworthy known limit is
 * inconsistent (the provider cannot have more calls left than the tier
 * grants) and is untrustworthy — never clamped, never guessed.
 */
function resolveRemaining(
  usage: CfbdUsageSnapshot
):
  | { remaining: number }
  | { refusal: Exclude<QuotaRefusalReason, 'below-reserve'>; remaining: number | null } {
  const { remainingCalls, monthlyLimit } = usage;
  if (remainingCalls === null || remainingCalls === undefined) {
    return { refusal: 'usage-unavailable', remaining: null };
  }
  if (!isTrustworthyCount(remainingCalls)) {
    return { refusal: 'usage-untrustworthy', remaining: null };
  }
  if (monthlyLimit !== null && monthlyLimit !== undefined) {
    if (!isTrustworthyCount(monthlyLimit) || remainingCalls > monthlyLimit) {
      return { refusal: 'usage-untrustworthy', remaining: remainingCalls };
    }
  }
  return { remaining: remainingCalls };
}

/** The scheduled (automation) gate: trustworthy usage ≥ 1,002 or refuse. */
export function evaluateAutomationQuota(usage: CfbdUsageSnapshot): AutomationQuotaDecision {
  const resolved = resolveRemaining(usage);
  if ('refusal' in resolved) {
    return { kind: 'refused', reason: resolved.refusal, remaining: resolved.remaining };
  }
  if (resolved.remaining < CFBD_AUTOMATION_MIN_REMAINING) {
    return { kind: 'refused', reason: 'below-reserve', remaining: resolved.remaining };
  }
  return { kind: 'allowed', remaining: resolved.remaining };
}

/**
 * The authenticated manual gate. Above the reserve with trustworthy usage the
 * override is irrelevant (`allowed`). Below the reserve or on untrustworthy
 * usage the refresh refuses with 429 — unless `quotaOverride` is explicitly
 * set, in which case it proceeds as `allowed-with-override`, carrying the
 * exact reason and observed remaining so the response and scoped status
 * report the override truthfully.
 */
export function evaluateManualQuota(
  usage: CfbdUsageSnapshot,
  quotaOverride: boolean
): ManualQuotaDecision {
  const automation = evaluateAutomationQuota(usage);
  if (automation.kind === 'allowed') {
    return { kind: 'allowed', remaining: automation.remaining };
  }
  if (quotaOverride) {
    return {
      kind: 'allowed-with-override',
      reason: automation.reason,
      remaining: automation.remaining,
    };
  }
  return {
    kind: 'refused',
    reason: automation.reason,
    remaining: automation.remaining,
    httpStatus: 429,
  };
}
