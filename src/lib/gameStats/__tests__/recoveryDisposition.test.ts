import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gameStatsRecoveryKey,
  isRecoveryEligible,
  readGameStatsRecoveryDisposition,
  readGameStatsRecoveryDispositions,
  recordGameStatsRecoveryAttempt,
  RECOVERY_BACKOFF_TIERS_MS,
} from '../recoveryDisposition.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('an unresolved attempt persists a disposition with base backoff', async () => {
  const record = await recordGameStatsRecoveryAttempt({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    reason: 'empty-unexpected',
    meaningfulChange: false,
    now: NOW,
  });
  assert.ok(record);
  assert.equal(record!.attemptCount, 1);
  assert.equal(record!.backoffTier, 0);
  assert.equal(record!.lastReason, 'empty-unexpected');
  assert.equal(record!.nextEligibleAt, new Date(NOW + RECOVERY_BACKOFF_TIERS_MS[0]!).toISOString());
  assert.equal(isRecoveryEligible(record, NOW), false, 'immediately repeated runs are ineligible');
  assert.equal(isRecoveryEligible(record, NOW + RECOVERY_BACKOFF_TIERS_MS[0]!), true);
});

test('repeated unresolved attempts escalate deterministic tiers and cap', async () => {
  let at = NOW;
  for (let i = 0; i < RECOVERY_BACKOFF_TIERS_MS.length + 2; i++) {
    const record = await recordGameStatsRecoveryAttempt({
      year: 2026,
      week: 3,
      seasonType: 'regular',
      reason: 'provider-unavailable',
      meaningfulChange: false,
      now: at,
    });
    const expectedTier = Math.min(i, RECOVERY_BACKOFF_TIERS_MS.length - 1);
    assert.equal(record!.backoffTier, expectedTier, `attempt ${i + 1}`);
    assert.equal(record!.attemptCount, i + 1);
    at = Date.parse(record!.nextEligibleAt!);
  }
});

test('meaningful durable progress resets the tier (but keeps base bounding)', async () => {
  for (let i = 0; i < 3; i++) {
    await recordGameStatsRecoveryAttempt({
      year: 2026,
      week: 3,
      seasonType: 'regular',
      reason: 'schema-drift',
      meaningfulChange: false,
      now: NOW + i,
    });
  }
  const progressed = await recordGameStatsRecoveryAttempt({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    reason: 'partial-coverage',
    meaningfulChange: true,
    now: NOW + 10,
  });
  assert.equal(progressed!.backoffTier, 0, 'progress resets escalation');
  assert.equal(progressed!.lastMeaningfulChangeAt, new Date(NOW + 10).toISOString());
  assert.equal(isRecoveryEligible(progressed, NOW + 11), false, 'base backoff still bounds');
});

test('a satisfied partition clears its disposition entirely', async () => {
  await recordGameStatsRecoveryAttempt({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    reason: 'empty-unexpected',
    meaningfulChange: false,
    now: NOW,
  });
  const cleared = await recordGameStatsRecoveryAttempt({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    reason: 'satisfied',
    meaningfulChange: true,
    now: NOW + 1,
  });
  assert.equal(cleared, null);
  assert.equal(await readGameStatsRecoveryDisposition(2026, 3, 'regular'), null);
  assert.equal(isRecoveryEligible(null, NOW + 2), true);
});

test('terminal dispositions are never eligible until state changes', () => {
  assert.equal(
    isRecoveryEligible(
      {
        partitionKey: gameStatsRecoveryKey(2026, 3, 'regular'),
        attemptCount: 4,
        lastAttemptAt: new Date(NOW).toISOString(),
        lastReason: 'merge-conflict',
        backoffTier: 3,
        nextEligibleAt: null,
        terminal: 'manual-action',
        lastMeaningfulChangeAt: null,
      },
      NOW + 365 * 24 * 60 * 60 * 1000
    ),
    false
  );
});

test('dispositions read back per year and never leak across partitions', async () => {
  await recordGameStatsRecoveryAttempt({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    reason: 'empty-unexpected',
    meaningfulChange: false,
    now: NOW,
  });
  await recordGameStatsRecoveryAttempt({
    year: 2026,
    week: 1,
    seasonType: 'postseason',
    reason: 'merge-conflict',
    meaningfulChange: false,
    now: NOW,
  });
  const byKey = await readGameStatsRecoveryDispositions(2026);
  assert.deepEqual([...byKey.keys()].sort(), ['2026:1:postseason', '2026:3:regular']);
  assert.equal(byKey.get('2026:3:regular')!.lastReason, 'empty-unexpected');
  assert.equal((await readGameStatsRecoveryDispositions(2025)).size, 0);
});
