import {
  PARTITION_SCOPED_DATASETS,
  isPartitionScopedDataset,
  type ProviderDataset,
} from '../providerDatasets.ts';
import { schedulerDeliveryPolicy } from './schedulerDeliveryHealth.ts';
import type { ExternalSchedulerJob } from './schedulerExecutionStatus.ts';

/**
 * Item 88 — health for datasets whose refresh is recorded per PARTITION.
 *
 * THE DEFECT. Provider data asks "how long since this dataset refreshed". For a
 * fixed-cadence dataset that is answerable. Scores and game-stats are
 * schedule-armed and write `weekPartitionScope(year, week, seasonType)`, so the
 * YEAR-scoped record they are read through is never written at all — verified in
 * production, where `provider-refresh-status` holds
 * `scores:week:2026:1:regular` and no `scores:year:2026`. The row therefore reads
 * "No refresh history" while the dataset is working, and `staleAfterMs` is
 * meaningless for it: a two-day gap is correct in the offseason and catastrophic
 * mid-slate.
 *
 * WHY NOT A SYNTHETIC YEAR RECORD. Item 88 rules it out, and rightly — it would
 * populate the row while still answering the wrong question. What the row needs
 * is EXPECTATION.
 *
 * WHERE EXPECTATION COMES FROM. The cron already records it. Every scheduled run
 * files a receipt, and `no-polling-target` is exactly the job saying "nothing was
 * due". Reading that is cheaper than re-deriving windows from the schedule — the
 * season record is ~2.7 MB and an admin page should not load it — and it is the
 * authority rather than a second opinion about it. Both facts already reach the
 * same snapshot builder in `systemHealth.ts`.
 *
 * FIXED FOR THE CLASS, not for scores. Item 88 measured `game-stats:year:2026`
 * reading null three minutes after a successful run, so this covers both.
 */

export { PARTITION_SCOPED_DATASETS, isPartitionScopedDataset };

/** The scheduled job whose receipt carries a dataset's expectation. */
export const EXPECTATION_JOB_BY_DATASET: Partial<Record<ProviderDataset, ExternalSchedulerJob>> = {
  scores: 'live-scores',
  'game-stats': 'game-stats',
};

/**
 * Reasons that mean NO refresh was due. Everything else means one was expected —
 * including outright failures, because a failed attempt is still an attempt that
 * should have produced activity.
 *
 * Deliberately a closed allowlist rather than a denylist: a reason added later
 * defaults to "expected", so a new not-due case shows as a warning until someone
 * classifies it. The opposite default would hide a real stall behind an unfamiliar
 * string.
 */
const NOT_EXPECTED_REASONS: ReadonlySet<string> = new Set([
  // Nothing was in the kickoff window.
  'no-polling-target',
  // Deliberately switched off — not a stall.
  'automation-paused-or-disabled',
]);

/**
 * How long after an expected refresh the absence of activity becomes a stall,
 * DERIVED from the job's delivery policy rather than written down here.
 *
 * `graceMs` is already the job's delivery tolerance and is already two poll
 * windows for both of these jobs — 6 minutes on a 3-minute cron, 30 on a
 * 15-minute one — and `DELIVERY_POLICIES` is the single place a cadence lives.
 * Hardcoding six minutes would silently go wrong the moment scores polling is
 * tightened, which Item 130 exists to do; deriving it means this follows the
 * planner automatically once Item 102 makes those policies dynamic (its
 * collision 2 requires exactly that).
 *
 * CAVEAT worth knowing: grace is not universally two periods. Item 129 records
 * `usage-sample` sitting at exactly one, which would make this boundary tight
 * enough to call a single missed tick a stall. It is two for both jobs here; if
 * that changes for one of them, this follows it down.
 */
export function stallBoundaryMs(dataset: ProviderDataset): number | null {
  const job = EXPECTATION_JOB_BY_DATASET[dataset];
  if (!job) return null;
  return schedulerDeliveryPolicy(job).graceMs;
}

export type RefreshExpectation = 'expected' | 'not-expected' | 'unknown';

export type ExpectationInput = {
  /** The job's latest receipt, or null when none has been filed. */
  receipt: { reason: string; startedAtMs: number } | null;
  nowMs: number;
  /**
   * How stale a receipt may be before it stops speaking for the present. Beyond
   * this the answer is `unknown`, NEVER `not-expected`: an absent scheduler is
   * exactly the case where "nothing was due" would be a comforting lie.
   */
  receiptValidForMs: number;
};

export function refreshExpectation(input: ExpectationInput): RefreshExpectation {
  const { receipt, nowMs, receiptValidForMs } = input;
  if (!receipt) return 'unknown';
  if (!Number.isFinite(receipt.startedAtMs)) return 'unknown';
  const age = nowMs - receipt.startedAtMs;
  // A future-dated receipt is as untrustworthy as a stale one.
  if (age < 0 || age > receiptValidForMs) return 'unknown';
  return NOT_EXPECTED_REASONS.has(receipt.reason) ? 'not-expected' : 'expected';
}

/**
 * What the row should say about a partition-scoped dataset.
 *
 * `quiet` is the healthy silence Item 88 asks for — no refresh was due, so a
 * multi-day gap raises nothing. `stalled` is the case that must never read
 * healthy: a refresh WAS due and no activity followed it.
 */
export type PartitionScopedHealth =
  | { state: 'quiet' }
  | { state: 'active'; lastActivityAtMs: number }
  /**
   * `staleSinceMs` is WHEN THE WRITER WAS LAST CLEAN, or null when it has never
   * been observed clean. An earlier field named `expectedSinceMs` was assigned
   * the receipt time in one branch and the activity time in another, so the first
   * consumer to render "expected since …" would have printed whichever the branch
   * happened to carry.
   */
  | { state: 'stalled'; staleSinceMs: number | null }
  | { state: 'indeterminate' };

/**
 * The writer's most recent observable state.
 *
 * `clean` covers `succeeded` AND `no-op`. A no-op is a HEALTHY poll that found
 * nothing to commit, and `recordProviderRefreshNoop` deliberately preserves
 * `lastSuccessAt` — "clears the latest error but preserves the prior-good
 * success". Reading `lastSuccessAt` therefore marked every halftime, every
 * scoreless stretch, and the minutes between arming and kickoff as a stall,
 * because polling was working perfectly and simply had nothing to write.
 */
export type PartitionActivity =
  | { state: 'clean'; atMs: number }
  | { state: 'unclean' }
  | { state: 'absent' }
  | { state: 'unknown' };

export type PartitionScopedHealthInput = ExpectationInput & {
  activity: PartitionActivity;
  /**
   * The stall boundary. Callers pass `stallBoundaryMs(dataset)` — it is a
   * parameter only so this function stays pure and testable, NOT so each caller
   * can choose a number.
   */
  expectedWithinMs: number;
};

export function partitionScopedHealth(input: PartitionScopedHealthInput): PartitionScopedHealth {
  const expectation = refreshExpectation(input);
  if (expectation === 'unknown') return { state: 'indeterminate' };
  if (expectation === 'not-expected') return { state: 'quiet' };

  const { activity, nowMs, expectedWithinMs } = input;
  switch (activity.state) {
    case 'unknown':
      // The status store could not be read. "Refresh overdue" is a specific claim
      // that a due refresh did not happen; the actual fact is that nothing about
      // the writer is knowable, and the issue list already says so.
      return { state: 'indeterminate' };
    case 'absent':
      return { state: 'stalled', staleSinceMs: null };
    case 'unclean':
      // Failed, partial, or still in progress past its window: the writer is
      // running and achieving nothing, which is not health.
      return { state: 'stalled', staleSinceMs: null };
    case 'clean':
      return nowMs - activity.atMs > expectedWithinMs
        ? { state: 'stalled', staleSinceMs: activity.atMs }
        : { state: 'active', lastActivityAtMs: activity.atMs };
  }
}

/** Only `active` and `quiet` are healthy. `indeterminate` never reads healthy. */
export function isHealthy(health: PartitionScopedHealth): boolean {
  return health.state === 'active' || health.state === 'quiet';
}

/**
 * Compute partition-scoped health for every dataset that has it, from facts the
 * health snapshot already holds. Returns a sparse map: datasets without a
 * partition scope are simply absent, so `deriveDatasetFreshness` receives
 * `undefined` for them and behaves exactly as before.
 *
 * `receiptValidForMs` is the job's own delivery grace. Beyond it,
 * `schedulerDeliveryHealth` already calls the job `late`, so treating its last
 * receipt as still speaking for the present would contradict the row directly
 * above it on the same page.
 */
export function partitionScopedHealthByDataset(input: {
  nowMs: number;
  /** The season year this dashboard is describing. */
  modelYear: number;
  /**
   * Latest receipt per job, WITH the year it targeted. The year matters: the
   * dashboard can be showing an older stored season or a future preseason while
   * both crons target today's season, and applying a current-year receipt to an
   * unrelated year would mark it overdue (or idle) on evidence about a different
   * season entirely.
   */
  receiptFor: (
    job: ExternalSchedulerJob
  ) => { reason: string; startedAt: string; year: number | null } | null;
  /** The writer's latest observable state for this dataset. */
  activityFor: (dataset: ProviderDataset) => PartitionActivity;
}): Partial<Record<ProviderDataset, PartitionScopedHealth>> {
  const out: Partial<Record<ProviderDataset, PartitionScopedHealth>> = {};
  for (const dataset of PARTITION_SCOPED_DATASETS) {
    const job = EXPECTATION_JOB_BY_DATASET[dataset];
    const boundary = stallBoundaryMs(dataset);
    if (!job || boundary === null) continue;

    const raw = input.receiptFor(job);
    // A receipt about a different season says nothing about this one.
    const sameYear = raw !== null && raw.year !== null && raw.year === input.modelYear;
    const startedAtMs = raw ? Date.parse(raw.startedAt) : Number.NaN;

    out[dataset] = partitionScopedHealth({
      nowMs: input.nowMs,
      receipt: raw && sameYear ? { reason: raw.reason, startedAtMs } : null,
      receiptValidForMs: boundary,
      activity: input.activityFor(dataset),
      expectedWithinMs: boundary,
    });
  }
  return out;
}
