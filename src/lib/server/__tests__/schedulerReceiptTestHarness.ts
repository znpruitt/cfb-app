import { getAppState } from '@/lib/server/appStateStore';
import {
  __setSchedulerReceiptDeferrerForTests,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
  type ExternalSchedulerJob,
  type SchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

/**
 * PLATFORM-086F2E1 — shared receipt test seams for the cron route suites.
 *
 * Direct `node:test` route invocations have no Next.js request context, so the
 * production `after(...)` deferral cannot run. Tests install this capturing
 * deferrer instead: `flush()` executes (and awaits) every captured persistence
 * callback in registration order; `restore()` clears the injected seam and MUST
 * run after every test.
 */
export function installSchedulerReceiptDeferrer(): {
  count: () => number;
  flush: () => Promise<void>;
  restore: () => void;
} {
  const callbacks: Array<() => Promise<void>> = [];
  __setSchedulerReceiptDeferrerForTests((callback) => {
    callbacks.push(callback);
  });
  return {
    count: () => callbacks.length,
    flush: async () => {
      while (callbacks.length > 0) {
        const callback = callbacks.shift()!;
        await callback();
      }
    },
    restore: () => __setSchedulerReceiptDeferrerForTests(null),
  };
}

/** The stored receipt record for `job`, or null when absent. */
export async function readSchedulerReceipt(
  job: ExternalSchedulerJob
): Promise<{ value: SchedulerExecutionReceipt; updatedAt: string } | null> {
  const record = await getAppState<SchedulerExecutionReceipt>(
    SCHEDULER_EXECUTION_STATUS_SCOPE,
    job
  );
  return record ? { value: record.value, updatedAt: record.updatedAt } : null;
}

/** The exact allowlisted top-level receipt keys, sorted. */
export const RECEIPT_KEYS = [
  'buildCommitSha',
  'completedAt',
  'durationMs',
  'invocationId',
  'job',
  'providerCallAttempted',
  'reason',
  'result',
  'source',
  'startedAt',
  'target',
  'version',
].sort();
