import {
  rankingsYearsTarget,
  scheduleYearsTarget,
  type SchedulerFailedPartition,
  type SchedulerReceiptSeasonType,
} from '@/lib/server/schedulerExecutionStatus';

/**
 * PLATFORM-126B — the per-year outcome fields the two multi-year receipt target
 * builders now REQUIRE.
 *
 * Shared because the call sites span subsystems (`src/lib/server/__tests__`, and
 * both cron route suites) and because the fields are required on purpose: a
 * defaulted parameter would let a caller reconstruct a target with a year whose
 * result nothing can establish, which is the exact loss this item closes. A
 * suite that does not care about the outcome says so by spreading this helper; a
 * suite that does care overrides only the fields it asserts on.
 *
 * The default is a CLEAN year — `success / written-clean`, nothing attempted or
 * failed at the partition level — so a suite that opts in without overriding can
 * never accidentally assert against a fabricated failure.
 *
 * Both shapes are derived from the builders' own parameter types, so a future
 * field added there is a compile error here rather than a silently missing one.
 */
type OutcomeField =
  | 'result'
  | 'reason'
  | 'providerCallAttempted'
  | 'rowsReceived'
  | 'rowsCommitted'
  | 'dataChanged'
  | 'attemptedSeasonTypes'
  | 'failedPartitions';

type ScheduleYearOutcome = Pick<Parameters<typeof scheduleYearsTarget>[0][number], OutcomeField>;
type RankingsYearOutcome = Pick<Parameters<typeof rankingsYearsTarget>[0][number], OutcomeField>;

const BASE = {
  providerCallAttempted: true,
  rowsReceived: 0,
  rowsCommitted: 0,
  dataChanged: false,
  attemptedSeasonTypes: [],
  failedPartitions: [],
} as const;

export function cleanScheduleYearOutcome(
  overrides: Partial<ScheduleYearOutcome> = {}
): ScheduleYearOutcome {
  return { ...BASE, result: 'success', reason: 'written-clean', ...overrides };
}

export function cleanRankingsYearOutcome(
  overrides: Partial<RankingsYearOutcome> = {}
): RankingsYearOutcome {
  return { ...BASE, result: 'success', reason: 'written-clean', ...overrides };
}

/**
 * The shape a LEGACY stored year entry parses to: the writer that produced it
 * knew none of these fields, so the rebuild normalizes them to `null`/`[]`.
 * Never `0`/`false` — see `SchedulerYearOutcome`. Use this wherever a suite
 * asserts that a pre-widening receipt still renders and reads exactly as before.
 */
export function legacyYearOutcome(): {
  result: null;
  reason: null;
  providerCallAttempted: null;
  rowsReceived: null;
  rowsCommitted: null;
  dataChanged: null;
  attemptedSeasonTypes: SchedulerReceiptSeasonType[];
  failedPartitions: SchedulerFailedPartition[];
} {
  return {
    result: null,
    reason: null,
    providerCallAttempted: null,
    rowsReceived: null,
    rowsCommitted: null,
    dataChanged: null,
    attemptedSeasonTypes: [],
    failedPartitions: [],
  };
}
