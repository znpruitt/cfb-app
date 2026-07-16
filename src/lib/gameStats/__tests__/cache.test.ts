import assert from 'node:assert/strict';
import test from 'node:test';

import { withGameStatsWeekLock } from '../cache.ts';

// PLATFORM-086H review remediation — the per-week critical section serializing
// the read→merge→write sequence shared by the cron and manual refresh paths.

test('operations on the same week run strictly one at a time, in order', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = withGameStatsWeekLock(2026, 3, 'regular', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = withGameStatsWeekLock(2026, 3, 'regular', async () => {
    events.push('second:start');
  });

  // Give the second operation every chance to start early — it must not.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start'], 'the second operation waits for the first');

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('different weeks do not serialize against each other', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const held = withGameStatsWeekLock(2026, 3, 'regular', async () => {
    await firstGate;
    events.push('week3');
  });
  await withGameStatsWeekLock(2026, 4, 'regular', async () => {
    events.push('week4');
  });

  assert.deepEqual(events, ['week4'], 'the other week proceeds while week 3 is held');
  releaseFirst();
  await held;
});

test('a failed operation propagates its error but does not poison later refreshes', async () => {
  await assert.rejects(
    withGameStatsWeekLock(2026, 5, 'regular', async () => {
      throw new Error('durable write failed');
    }),
    /durable write failed/
  );

  const result = await withGameStatsWeekLock(2026, 5, 'regular', async () => 'recovered');
  assert.equal(result, 'recovered', 'the lock is released after a failure');
});
