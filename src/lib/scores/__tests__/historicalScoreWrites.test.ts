import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHistoricalScoreWrites } from '../historicalScoreWrites.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — the pure durable-write classifier behind the historical
// score repair's truthful provider-status recording. Tested directly because
// the store's test seams are scope-level and cannot fail exactly one of the
// two same-scope score keys end-to-end. `attempted` lists only the partitions
// actually written (valid-absence empties are never written).
// ---------------------------------------------------------------------------

const ok: PromiseSettledResult<unknown> = { status: 'fulfilled', value: undefined };
const fail: PromiseSettledResult<unknown> = {
  status: 'rejected',
  reason: new Error('store outage'),
};

test('both writes committed → allOk, no failed partitions', () => {
  assert.deepEqual(classifyHistoricalScoreWrites(['regular', 'postseason'], [ok, ok]), {
    allOk: true,
    failedPartitions: [],
    partialFailure: false,
  });
});

test('regular committed, postseason failed → partial failure naming the exact partition', () => {
  assert.deepEqual(classifyHistoricalScoreWrites(['regular', 'postseason'], [ok, fail]), {
    allOk: false,
    failedPartitions: ['postseason'],
    partialFailure: true,
  });
});

test('regular failed, postseason committed → partial failure naming regular', () => {
  assert.deepEqual(classifyHistoricalScoreWrites(['regular', 'postseason'], [fail, ok]), {
    allOk: false,
    failedPartitions: ['regular'],
    partialFailure: true,
  });
});

test('both writes failed → full failure, not partial', () => {
  assert.deepEqual(classifyHistoricalScoreWrites(['regular', 'postseason'], [fail, fail]), {
    allOk: false,
    failedPartitions: ['regular', 'postseason'],
    partialFailure: false,
  });
});

test('a single attempted partition (valid-absence sibling skipped) classifies alone', () => {
  assert.deepEqual(classifyHistoricalScoreWrites(['regular'], [ok]), {
    allOk: true,
    failedPartitions: [],
    partialFailure: false,
  });
  assert.deepEqual(classifyHistoricalScoreWrites(['regular'], [fail]), {
    allOk: false,
    failedPartitions: ['regular'],
    partialFailure: false,
  });
});
