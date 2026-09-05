import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTATION_JOB_BY_DATASET,
  isHealthy,
  isPartitionScopedDataset,
  partitionScopedHealth,
  partitionScopedHealthByDataset,
  refreshExpectation,
  stallBoundaryMs,
} from '../partitionScopedRefreshHealth';
import { schedulerDeliveryPolicy } from '../schedulerDeliveryHealth';

const NOW = Date.UTC(2026, 8, 5, 20, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const base = {
  nowMs: NOW,
  receiptValidForMs: 30 * MIN,
  expectedWithinMs: stallBoundaryMs('scores')!,
  activity: { state: 'clean' as const, atMs: NOW - MIN },
};

test('the two partition-scoped datasets are marked, and nothing else is', () => {
  // Item 88: "fix it for the class, not for scores". game-stats reads null the
  // same way — measured three minutes after a successful run.
  assert.ok(isPartitionScopedDataset('scores'));
  assert.ok(isPartitionScopedDataset('game-stats'));
  assert.ok(!isPartitionScopedDataset('schedule'), 'schedule writes a year scope and is fine');
  assert.ok(!isPartitionScopedDataset('rankings'));
  assert.equal(EXPECTATION_JOB_BY_DATASET.scores, 'live-scores');
  assert.equal(EXPECTATION_JOB_BY_DATASET['game-stats'], 'game-stats');
});

test('`no-polling-target` means no refresh was due', () => {
  assert.equal(
    refreshExpectation({
      ...base,
      receipt: { reason: 'no-polling-target', startedAtMs: NOW - MIN },
    }),
    'not-expected'
  );
});

test('a paused job is not a stall', () => {
  assert.equal(
    refreshExpectation({
      ...base,
      receipt: { reason: 'automation-paused-or-disabled', startedAtMs: NOW - MIN },
    }),
    'not-expected'
  );
});

test('every OTHER reason means a refresh was expected — including failures', () => {
  // A failed attempt is still an attempt that should have produced activity.
  for (const reason of [
    'scoreboard-written-clean',
    'provider-fetch-failed',
    'scoreboard-targets-missing',
    'final-reconciliation-confirmed',
    'ingestion-failed',
    'a-reason-added-next-year',
  ]) {
    assert.equal(
      refreshExpectation({ ...base, receipt: { reason, startedAtMs: NOW - MIN } }),
      'expected',
      reason
    );
  }
});

test('an unfamiliar reason defaults to EXPECTED, so a new case cannot hide a stall', () => {
  // The allowlist is deliberate. A denylist would let a reason added later read as
  // "nothing was due" and silence a real outage.
  assert.equal(
    refreshExpectation({
      ...base,
      receipt: { reason: 'not-yet-invented', startedAtMs: NOW - MIN },
    }),
    'expected'
  );
});

test('a STALE receipt is indeterminate, never "nothing was due"', () => {
  // The case where a comforting answer is most dangerous: the scheduler itself
  // has stopped, so its last word must not keep the row green.
  const stale = refreshExpectation({
    ...base,
    receipt: { reason: 'no-polling-target', startedAtMs: NOW - 3 * HOUR },
  });
  assert.equal(stale, 'unknown');
  assert.ok(!isHealthy({ state: 'indeterminate' }), 'and indeterminate never reads healthy');
});

test('a future-dated receipt is also indeterminate', () => {
  assert.equal(
    refreshExpectation({
      ...base,
      receipt: { reason: 'no-polling-target', startedAtMs: NOW + HOUR },
    }),
    'unknown'
  );
});

test('no receipt at all is indeterminate', () => {
  assert.equal(refreshExpectation({ ...base, receipt: null }), 'unknown');
});

test('QUIET: nothing was due, so a multi-day gap raises nothing', () => {
  // Item 88's third acceptance bullet. This is the offseason, and it must be
  // healthy silence rather than a warning.
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'no-polling-target', startedAtMs: NOW - MIN },
    activity: { state: 'clean' as const, atMs: NOW - 40 * 24 * HOUR },
  });

  assert.deepEqual(health, { state: 'quiet' });
  assert.ok(isHealthy(health), 'a quiet offseason row is healthy');
});

test('ACTIVE: a refresh was due and recent activity followed it', () => {
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-written-clean', startedAtMs: NOW - MIN },
    activity: { state: 'clean' as const, atMs: NOW - 2 * MIN },
  });

  assert.equal(health.state, 'active');
  assert.ok(isHealthy(health));
});

test('STALLED: a refresh was due and the writer went silent', () => {
  // Item 88's second acceptance bullet, and the case that must NEVER read
  // healthy. Proven by suppressing the writer — activity stops while the cron
  // keeps reporting targets — not by reasoning about a freshness threshold.
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-written-clean', startedAtMs: NOW - MIN },
    activity: { state: 'clean' as const, atMs: NOW - 20 * MIN },
  });

  assert.equal(health.state, 'stalled');
  assert.ok(!isHealthy(health), 'a stalled row is never healthy');
});

test('STALLED: a refresh was due and there has never been any activity', () => {
  // The production shape Item 88 was filed from: the row reads "No refresh
  // history" while games are in window. That is a stall, not silence.
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-written-clean', startedAtMs: NOW - MIN },
    activity: { state: 'absent' as const },
  });

  assert.equal(health.state, 'stalled');
  assert.ok(!isHealthy(health));
});

test('the stall boundary is one polling window, not a freshness threshold', () => {
  // Positive control for the two stall tests: the SAME inputs one tick inside the
  // window are healthy, so "stalled" is not simply what this function always says.
  const inside = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-written-clean', startedAtMs: NOW - MIN },
    activity: { state: 'clean' as const, atMs: NOW - base.expectedWithinMs + 1 },
  });
  const outside = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-written-clean', startedAtMs: NOW - MIN },
    activity: { state: 'clean' as const, atMs: NOW - base.expectedWithinMs - 1 },
  });

  assert.equal(inside.state, 'active');
  assert.equal(outside.state, 'stalled');
});

test('the stall boundary is DERIVED from the job cadence, never written down here', () => {
  // Owner ruling: two poll windows, not a hardcoded six minutes — scores polling
  // may tighten as CPU and call-usage understanding improve (Items 130/102), and
  // a literal would silently go wrong the moment it does.
  assert.equal(stallBoundaryMs('scores'), schedulerDeliveryPolicy('live-scores').graceMs);
  assert.equal(stallBoundaryMs('game-stats'), schedulerDeliveryPolicy('game-stats').graceMs);
  assert.equal(stallBoundaryMs('schedule'), null, 'a year-scoped dataset has no boundary here');
});

test('and that derived boundary is two poll windows for both jobs today', () => {
  // Pins the CURRENT values so a change is deliberate rather than incidental. If
  // a cadence changes, this test fails and whoever changed it confirms the
  // boundary still means "two windows" — it does not hardcode the boundary into
  // the model.
  assert.equal(stallBoundaryMs('scores'), 2 * 3 * MIN, '3-minute cron');
  assert.equal(stallBoundaryMs('game-stats'), 2 * 15 * MIN, '15-minute cron');
});

test('a clean NO-OP poll is activity — the P1 both reviewers found', () => {
  // `recordProviderRefreshNoop` deliberately preserves `lastSuccessAt` ("clears
  // the latest error but preserves the prior-good success"), and live-scores
  // records a no-op on every poll that found nothing to commit. Reading success
  // therefore called every halftime, every scoreless stretch and the minutes
  // between arming and kickoff a stall — while polling worked perfectly.
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-unchanged-clean', startedAtMs: NOW - MIN },
    activity: { state: 'clean', atMs: NOW - MIN },
  });

  assert.equal(health.state, 'active');
  assert.ok(isHealthy(health), 'a working poll with nothing to write is healthy');
});

test('an UNCLEAN writer is stalled even when it resolved seconds ago', () => {
  // The other half: failed/partial/in-progress is running and achieving nothing.
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'provider-fetch-failed', startedAtMs: NOW - MIN },
    activity: { state: 'unclean' },
  });

  assert.equal(health.state, 'stalled');
  assert.ok(!isHealthy(health));
});

test('an UNREADABLE status store is indeterminate, not a definite stall', () => {
  // "Refresh overdue" claims a due refresh did not happen. When the store cannot
  // be read, the honest answer is that nothing about the writer is knowable — and
  // the issue list already says the status is unavailable.
  const health = partitionScopedHealth({
    ...base,
    receipt: { reason: 'scoreboard-written-clean', startedAtMs: NOW - MIN },
    activity: { state: 'unknown' },
  });

  assert.deepEqual(health, { state: 'indeterminate' });
  assert.ok(!isHealthy(health), 'and it still never reads healthy');
});

test('a receipt for a DIFFERENT season is not evidence about this one', () => {
  // The dashboard can show an older stored season or a future preseason while
  // both crons target today's. Applying a current-year receipt to an unrelated
  // year would mark it overdue, or idle, on evidence about a different season.
  const plan = partitionScopedHealthByDataset({
    nowMs: NOW,
    modelYear: 2024,
    receiptFor: () => ({
      reason: 'no-polling-target',
      startedAt: new Date(NOW - MIN).toISOString(),
      year: 2026,
    }),
    activityFor: () => ({ state: 'clean', atMs: NOW - MIN }),
  });

  assert.deepEqual(
    plan.scores,
    { state: 'indeterminate' },
    'a 2026 receipt says nothing about 2024'
  );

  // Positive control: the same receipt for the MATCHING year does speak.
  const matched = partitionScopedHealthByDataset({
    nowMs: NOW,
    modelYear: 2026,
    receiptFor: () => ({
      reason: 'no-polling-target',
      startedAt: new Date(NOW - MIN).toISOString(),
      year: 2026,
    }),
    activityFor: () => ({ state: 'clean', atMs: NOW - MIN }),
  });
  assert.deepEqual(matched.scores, { state: 'quiet' });
});
