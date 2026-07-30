/**
 * PLATFORM-086E2A — pure, dormant AUTOMATIC rankings CFBD quota gate (built and
 * tested for the FUTURE PLATFORM-086E2B cron; called from NO production code in
 * E2A). The authorized MANUAL rankings refresh is never subject to this gate.
 *
 * One automatic rankings refresh may spend, worst case:
 *
 *   1 possible `/info` usage request
 *   + up to 3 attempts for the regular partition
 *   + up to 3 attempts for the postseason partition
 *   = 7 calls
 *
 * so automation requires trustworthy CFBD usage showing at least the 1,000-call
 * monthly reserve plus that 7-call allowance. Usage-trust semantics (missing,
 * malformed, inconsistent, negative, unsafe, above-limit → fail closed with the
 * stable `usage-unavailable` / `usage-untrustworthy` / `below-reserve`
 * vocabulary) are the SHARED CFBD evaluator's — this module supplies only the
 * rankings-specific allowance, never a second trust algorithm.
 *
 * No `/info` request is issued in E2A; E2B performs the fresh probe and passes
 * its snapshot here.
 */

import {
  CFBD_AUTOMATION_RESERVE_CALLS,
  evaluateAutomationQuota,
  type AutomationQuotaDecision,
  type CfbdUsageSnapshot,
} from '../gameStats/quotaPolicy.ts';

/** Worst-case CFBD calls one automatic rankings refresh may spend (1 + 3 + 3). */
export const RANKINGS_AUTOMATION_CALL_ALLOWANCE = 7;

/** Reserve + rankings allowance: automation requires remaining ≥ 1,007. */
export const RANKINGS_AUTOMATION_MIN_REMAINING =
  CFBD_AUTOMATION_RESERVE_CALLS + RANKINGS_AUTOMATION_CALL_ALLOWANCE;

/**
 * The automatic-rankings gate: trustworthy usage at or above 1,007, else refuse
 * with the shared refusal vocabulary. Remaining 1,007 permits; 1,006 refuses.
 */
export function evaluateRankingsAutomationQuota(usage: CfbdUsageSnapshot): AutomationQuotaDecision {
  return evaluateAutomationQuota(usage, RANKINGS_AUTOMATION_MIN_REMAINING);
}
