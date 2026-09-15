import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateScheduleCronReason,
  aggregateScheduleCronResult,
  createScheduleRefreshCronExecutionState,
  emitScheduleRefreshCronExecutionEvent,
  type ScheduleRefreshCronYearExecution,
} from '../cronExecutionLog.ts';
import { completeStandingsInvalidation } from '../../selectors/leagueStandings.ts';

// PLATFORM-086E1B1 — unit coverage for the weekly cron's aggregate result/reason
// rules, including the transition-owner deferral semantics (an intentional skip,
// never a failure/no-op, never a partial-maker).

function entry(
  over: Partial<ScheduleRefreshCronYearExecution> & {
    result: ScheduleRefreshCronYearExecution['result'];
    reason: ScheduleRefreshCronYearExecution['reason'];
  }
): ScheduleRefreshCronYearExecution {
  return {
    year: 2031,
    operation: null,
    providerCallAttempted: false,
    attemptedSeasonTypes: [],
    failedPartitions: [],
    rowsReceived: 0,
    rowsCommitted: 0,
    dataChanged: false,
    scoreRepairs: 0,
    scoreDifferenceCount: 0,
    scoreDifferences: [],
    scoreDifferencesTruncated: false,
    scoreSweepFailedPartitions: [],
    standingsInvalidation: completeStandingsInvalidation(),
    scoreSweepCannotTellCount: 0,
    kickoffsChanged: 0,
    ...over,
  };
}

const TRANSITION_SKIP = entry({ result: 'skipped', reason: 'season-transition-owner' });
const GATED_SKIP = entry({
  result: 'skipped',
  reason: 'automation-paused-or-disabled',
  operation: 'preseason-maintenance',
});
const SUCCESS = entry({
  result: 'success',
  reason: 'written-clean',
  operation: 'postseason-boundary',
  providerCallAttempted: true,
  rowsReceived: 5,
  rowsCommitted: 5,
  dataChanged: true,
});
const NOOP = entry({
  result: 'no-op',
  reason: 'stale-observation',
  operation: 'ordinary-maintenance',
  providerCallAttempted: true,
});
const FAILURE = entry({
  result: 'failure',
  reason: 'partition-fetch-failed',
  operation: 'ordinary-maintenance',
  providerCallAttempted: true,
});

test('aggregate result: no entries and all-skipped are skipped', () => {
  assert.equal(aggregateScheduleCronResult([]), 'skipped');
  assert.equal(aggregateScheduleCronResult([TRANSITION_SKIP, GATED_SKIP]), 'skipped');
});

// Test 27 — a transition-owned skip plus successful work is NOT partial.
test('aggregate result: deferrals/skips plus successful work follow the executed work', () => {
  assert.equal(aggregateScheduleCronResult([TRANSITION_SKIP, SUCCESS]), 'success');
  assert.equal(aggregateScheduleCronResult([GATED_SKIP, SUCCESS]), 'success');
  assert.equal(aggregateScheduleCronResult([TRANSITION_SKIP, NOOP]), 'no-op');
});

test('aggregate result: failures mix to partial, uniform failures to failure', () => {
  assert.equal(aggregateScheduleCronResult([SUCCESS, FAILURE]), 'partial');
  assert.equal(aggregateScheduleCronResult([NOOP, FAILURE]), 'partial');
  assert.equal(aggregateScheduleCronResult([TRANSITION_SKIP, FAILURE]), 'failure');
  assert.equal(aggregateScheduleCronResult([FAILURE, FAILURE]), 'failure');
});

// Test 28 — every candidate deferred → season-transition-owner.
test('aggregate reason: uniform transition deferral reports season-transition-owner', () => {
  assert.equal(
    aggregateScheduleCronReason([TRANSITION_SKIP, TRANSITION_SKIP]),
    'season-transition-owner'
  );
});

// Test 29 — every executable year gated → automation-paused-or-disabled.
test('aggregate reason: uniform gating reports automation-paused-or-disabled', () => {
  assert.equal(
    aggregateScheduleCronReason([GATED_SKIP, GATED_SKIP]),
    'automation-paused-or-disabled'
  );
});

test('aggregate reason: mixed lifecycle outcomes report year-results', () => {
  assert.equal(aggregateScheduleCronReason([TRANSITION_SKIP, GATED_SKIP]), 'year-results');
  assert.equal(aggregateScheduleCronReason([TRANSITION_SKIP, SUCCESS]), 'year-results');
  assert.equal(aggregateScheduleCronReason([SUCCESS]), 'year-results');
});

// Tests 30/31 — the schema accepts the E1B1 additions (compile-time via the
// fixtures above) and the emitter serializes exactly the allowlisted keys.
test('the emitted event carries only allowlisted keys, including E1B1 values', () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = ((line: string) => lines.push(String(line))) as typeof console.log;
  try {
    const state = createScheduleRefreshCronExecutionState();
    state.result = 'skipped';
    state.reason = 'season-transition-owner';
    state.years = [TRANSITION_SKIP, GATED_SKIP];
    emitScheduleRefreshCronExecutionEvent(state, Date.now());
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(event).sort(), [
    'durationMs',
    'event',
    'invalidLifecycleTargets',
    'reason',
    'result',
    'years',
  ]);
  assert.equal(event.reason, 'season-transition-owner');
  const years = event.years as Array<Record<string, unknown>>;
  assert.equal(years[1]!.operation, 'preseason-maintenance');
  assert.ok(Number.isInteger(event.durationMs) && (event.durationMs as number) >= 0);
});

// === PLATFORM-693 — the per-year `partial` result must reach the run level ===

test('a run whose every year is partial reports partial, never skipped', () => {
  // THE REGRESSION. `partial` was added to the per-year union for a committed
  // refresh whose standings bust did not complete. Before the aggregator learned
  // it, such a year matched no branch here and the run fell through to `skipped` —
  // reporting that NOTHING RAN for a run that committed rows for every target year.
  const years = [
    entry({ result: 'partial', reason: 'standings-invalidation-incomplete' }),
    entry({ result: 'partial', reason: 'standings-invalidation-incomplete' }),
  ];
  assert.equal(aggregateScheduleCronResult(years), 'partial');
});

test('a partial year is not hidden by a sibling success', () => {
  const years = [
    entry({ result: 'success', reason: 'written-clean' }),
    entry({ result: 'partial', reason: 'standings-invalidation-incomplete' }),
  ];
  // Would have reported a clean `success` before the aggregator counted partial.
  assert.equal(aggregateScheduleCronResult(years), 'partial');
});

test('a genuine failure still outranks a partial', () => {
  const years = [
    entry({ result: 'failure', reason: 'partition-fetch-failed' }),
    entry({ result: 'partial', reason: 'standings-invalidation-incomplete' }),
  ];
  // A failed fetch is a data-integrity failure; a stale cache is not. Mixed stays
  // `partial` by the existing rule, but the failure must never be downgraded away.
  assert.equal(aggregateScheduleCronResult(years), 'partial');
  assert.equal(
    aggregateScheduleCronResult([entry({ result: 'failure', reason: 'partition-fetch-failed' })]),
    'failure'
  );
});

test('a skipped-only run is still skipped once partial exists', () => {
  // Positive control that the new clause did not swallow the skipped path.
  assert.equal(
    aggregateScheduleCronResult([entry({ result: 'skipped', reason: 'season-transition-owner' })]),
    'skipped'
  );
});
