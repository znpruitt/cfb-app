import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryNothingDue,
  deliveryRowStatus,
  deliveryStateDisplay,
} from '../systemHealthPresentation';
import { readSchedulerDeliveryHealth } from '@/lib/server/schedulerDeliveryHealth';
import type {
  SchedulerDeliveryHealthRow,
  SchedulerDeliveryState,
  SchedulerPlanUnavailableReason,
} from '@/lib/server/schedulerDeliveryHealth';
import type { SchedulerExecutionReceipt } from '@/lib/server/schedulerExecutionStatus';

/**
 * PLATFORM-102 slice 4 — a healthy idle job must not read as a fault, and a real
 * fault must not read as healthy.
 *
 * The discriminator is the RECEIPT, not the reason. `unavailable` is reached by
 * four branches and TWO of them carry a null `planUnavailableReason`: nothing-due,
 * and the receipt-scope read failing. Keying on the reason alone paints an OUTAGE
 * green. Every case below names its branch.
 */

const RECEIPT: SchedulerExecutionReceipt = {
  version: 1,
  job: 'live-scores',
  source: 'qstash',
  invocationId: 'inv-1',
  startedAt: '2026-10-03T19:24:00.000Z',
  completedAt: '2026-10-03T19:24:01.000Z',
  durationMs: 1_000,
  buildCommitSha: null,
  result: 'no-op',
  reason: 'no-polling-target',
  providerCallAttempted: false,
  target: { kind: 'live-scores', year: 2026, mode: null, targetGames: 0, targetPartitions: 0 },
};

function row(
  deliveryState: SchedulerDeliveryState,
  planUnavailableReason: SchedulerPlanUnavailableReason | null,
  receipt: SchedulerExecutionReceipt | null
): Pick<SchedulerDeliveryHealthRow, 'deliveryState' | 'planUnavailableReason' | 'receipt'> {
  return { deliveryState, planUnavailableReason, receipt };
}

test('NOTHING DUE renders gray and says so, instead of a yellow “Unavailable”', () => {
  const idle = row('unavailable', null, RECEIPT);

  assert.equal(deliveryNothingDue(idle), true);
  assert.equal(deliveryRowStatus(idle), 'gray');
  assert.deepEqual(deliveryStateDisplay(idle), { label: 'Nothing due', tone: 'muted' });
});

test('THE OUTAGE THAT WOULD HAVE GONE GRAY: a failed receipt-scope read stays yellow', () => {
  // The branch the reason-only discriminator gets wrong. When the durable receipt
  // scope cannot be read, EVERY row is `unavailable` with a `null` receipt — and
  // `planUnavailableReason` is null too whenever the planner record resolved fine.
  // Mutation target: drop `receipt !== null` from `deliveryNothingDue` and this
  // test names a real outage rendered as healthy.
  const outage = row('unavailable', null, null);

  assert.equal(deliveryNothingDue(outage), false);
  assert.equal(deliveryRowStatus(outage), 'yellow');
  assert.deepEqual(deliveryStateDisplay(outage), { label: 'Unavailable', tone: 'muted' });
});

test('a genuinely unreadable plan still renders as a fault, whatever the receipt', () => {
  for (const reason of [
    'plan-unreadable',
    'plan-store-failed',
    'plan-incomplete',
    'plan-indeterminate',
  ] as const) {
    for (const receipt of [RECEIPT, null]) {
      const faulted = row('unavailable', reason, receipt);
      assert.equal(deliveryNothingDue(faulted), false, reason);
      assert.equal(deliveryRowStatus(faulted), 'yellow', reason);
      assert.deepEqual(deliveryStateDisplay(faulted), { label: 'Unavailable', tone: 'muted' });
    }
  }
});

test('`missing` is UNTOUCHED — "no receipt at all" must keep warning', () => {
  // A job that has never delivered is not idle, and the two states are different
  // facts. Mutation target: widen `deliveryNothingDue` to any null-reason row and
  // this goes red.
  const missing = row('missing', null, null);
  assert.equal(deliveryNothingDue(missing), false);
  assert.equal(deliveryRowStatus(missing), 'yellow');
  assert.deepEqual(deliveryStateDisplay(missing), { label: 'No recent delivery', tone: 'warn' });
});

test('every other state keeps exactly the colour and word it had', () => {
  const cases: Array<[SchedulerDeliveryState, string, string]> = [
    ['on-time', 'green', 'On time'],
    ['late', 'yellow', 'Late'],
    ['missing', 'yellow', 'No recent delivery'],
    ['invalid', 'yellow', 'Receipt invalid'],
  ];
  for (const [state, colour, label] of cases) {
    // Asserted with a receipt AND without, so nothing but `unavailable` can be
    // reached by the new branch.
    for (const receipt of [RECEIPT, null]) {
      assert.equal(deliveryRowStatus(row(state, null, receipt)), colour, state);
      assert.equal(deliveryStateDisplay(row(state, null, receipt)).label, label, state);
    }
  }
});

test('the classification reads the ROW, so no caller can pass a bare state', async () => {
  // REACHABILITY for the gray dot is asserted where the reachable row is built —
  // `schedulerDeliveryPlanned.test.ts`, "nothing due never reads on-time", which
  // now carries the presentation assertions against a row the real reader
  // produced. What this pins is that the plumbing takes the row: a snapshot from
  // the live reader classifies without a state ever being passed on its own.
  const snapshot = await readSchedulerDeliveryHealth({
    nowMs: Date.parse('2026-10-03T19:26:00Z'),
    loadEntries: async () => [{ key: 'live-scores', value: RECEIPT }],
  });

  for (const job of snapshot.jobs) {
    const status = deliveryRowStatus(job);
    assert.ok(['green', 'yellow', 'gray'].includes(status), `${job.job} → ${status}`);
    // Gray is reserved: it may only appear where nothing is due.
    assert.equal(status === 'gray', deliveryNothingDue(job), job.job);
  }

  // A job with no receipt at all in the same snapshot still warns.
  const stats = snapshot.jobs.find((job) => job.job === 'game-stats')!;
  assert.equal(stats.deliveryState, 'missing');
  assert.equal(deliveryRowStatus(stats), 'yellow');
});
