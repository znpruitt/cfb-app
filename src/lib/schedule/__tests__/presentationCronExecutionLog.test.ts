import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateSchedulePresentationCron,
  createSchedulePresentationCronExecutionState,
  emitSchedulePresentationCronExecutionEvent,
  type SchedulePresentationYearExecution,
} from '../presentationCronExecutionLog.ts';

/**
 * PLATFORM-757a — the standalone job's run classification.
 *
 * The rule worth testing is the ORDERING between a budget stop and the refresh
 * aggregate, because it is the one place this job could quietly tell an
 * operator the wrong thing.
 */

function year(
  y: number,
  result: SchedulePresentationYearExecution['result'],
  media: SchedulePresentationYearExecution['media'] = 'written-clean'
): SchedulePresentationYearExecution {
  return { year: y, result, media, venues: 'fresh-cache', providerCallAttempted: true };
}

test('a clean run over every selected year is a success', () => {
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'success')], 0, 0), {
    result: 'success',
    reason: 'presentation-refreshed',
  });
});

test('A BUDGET STOP OUTRANKS A CLEAN REFRESH — the rule this job exists to get right', () => {
  // Refreshing year 1 cleanly and never reaching year 2 is NOT a success: year
  // 2's media is exactly as stale as if nothing had run. A receipt that reported
  // success here would be #804's defect in a new place — a count whose failure
  // and whose real zero look identical — and System Health raises issues only
  // for `failure` and `partial`, so `success` would make a job that is
  // chronically unable to reach its later years render green forever.
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'success')], 1, 0), {
    result: 'partial',
    reason: 'budget-exhausted',
  });
});

test('a budget stop takes the REASON but never SOFTENS the result — review finding 8', () => {
  // Both facts have to survive. The budget stop owns the REASON, because it is
  // the actionable one: without it an operator reads `presentation-failed` and
  // goes looking at the provider, when the run actually ran out of time before
  // starting a year.
  //
  // But the first version returned `partial` OUTRIGHT here, before looking at
  // the executed years, so a run where EVERY executed year failed and one was
  // skipped reported `partial` and understated itself. The result is now the
  // worse of the two: the reason says budget, the result still says failure.
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'failure')], 2, 0), {
    result: 'failure',
    reason: 'budget-exhausted',
  });
  // The other direction is unchanged: a clean run still DEGRADES to partial.
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'success')], 1, 0), {
    result: 'partial',
    reason: 'budget-exhausted',
  });
});

test('mixed success and failure across years is partial, not success', () => {
  assert.deepEqual(
    aggregateSchedulePresentationCron([year(2026, 'success'), year(2027, 'failure')], 0, 0),
    { result: 'partial', reason: 'presentation-partial' }
  );
});

test('a PARTIAL year counts as a failure for the run aggregate', () => {
  // A year whose media failed while venues no-opped is `partial`. Treating that
  // as a success would let a permanently broken media refresh sit behind a green
  // row for as long as the venue TTL keeps returning `fresh-cache`.
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'partial')], 0, 0), {
    result: 'failure',
    reason: 'presentation-failed',
  });
});

test('every year failing is a failure, not a partial', () => {
  assert.deepEqual(
    aggregateSchedulePresentationCron([year(2026, 'failure'), year(2027, 'failure')], 0, 0),
    { result: 'failure', reason: 'presentation-failed' }
  );
});

test('years that were all no-ops or lease losers are a no-op, never a failure', () => {
  // Nothing was due, or another holder had the lease. Neither is an error and
  // neither committed anything — and `no-op` raises no System Health issue,
  // which is correct: an overlap with the inline call is the EXPECTED state
  // during 757a, not something to page an operator about.
  assert.deepEqual(
    aggregateSchedulePresentationCron(
      [year(2026, 'no-op', 'no-eligible-games'), year(2027, 'in-progress', 'refresh-in-progress')],
      0,
      0
    ),
    { result: 'no-op', reason: 'presentation-no-op' }
  );
});

test('no selected years at all is a skip, not a success', () => {
  assert.deepEqual(aggregateSchedulePresentationCron([], 0, 0), {
    result: 'skipped',
    reason: 'no-maintenance-target',
  });
});

test('the initial state is pessimistic, so a run that throws before deciding files a failure', () => {
  const state = createSchedulePresentationCronExecutionState();
  assert.equal(state.result, 'failure');
  assert.equal(state.reason, 'unexpected-error');
  assert.equal(state.yearsSkippedForBudget, 0);
  assert.deepEqual(state.years, []);
});

test('the emitted event carries only allowlisted primitives, and never throws', () => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (line: unknown) => {
    lines.push(String(line));
  };
  try {
    const state = createSchedulePresentationCronExecutionState();
    state.result = 'partial';
    state.reason = 'budget-exhausted';
    state.totalYears = 2;
    state.yearsSkippedForBudget = 1;
    state.years = [year(2026, 'success')];
    emitSchedulePresentationCronExecutionEvent(state, Date.now() - 1_000);
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1, 'exactly one line per invocation');
  const event = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(event.event, 'schedule-presentation-cron');
  assert.equal(event.reason, 'budget-exhausted');
  assert.equal(event.yearsSkippedForBudget, 1);
  assert.deepEqual(Object.keys(event).sort(), [
    'durationMs',
    'event',
    'invalidLifecycleTargets',
    'reason',
    'result',
    'totalYears',
    'years',
    'yearsSkippedForBudget',
  ]);
  // The per-year copy is field-by-field, so an extra property attached to a
  // year object cannot ride into the serialized line.
  assert.deepEqual((event.years as Array<Record<string, unknown>>)[0], {
    year: 2026,
    result: 'success',
    media: 'written-clean',
    venues: 'fresh-cache',
    providerCallAttempted: true,
  });
});

test('a year carrying an extra property does not leak it into the event', () => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (line: unknown) => {
    lines.push(String(line));
  };
  try {
    const state = createSchedulePresentationCronExecutionState();
    state.years = [
      {
        ...year(2026, 'success'),
        apiKey: 'must-never-appear',
      } as SchedulePresentationYearExecution,
    ];
    emitSchedulePresentationCronExecutionEvent(state, Date.now());
  } finally {
    console.log = original;
  }
  assert.ok(!lines[0].includes('must-never-appear'), 'the explicit copy strips unknown fields');
});

test('CODEX P2: a refused production target degrades a run whose valid years succeeded', () => {
  // The registry held one usable active league and one whose `status.year` was
  // structurally invalid. The valid year refreshed cleanly — but a PRODUCTION
  // league was refused, and `success` raises no System Health issue at all, so
  // nothing would ever tell an operator the refusal happened.
  //
  // AGENTS.md: refusals plus executed years classify `partial` when the executed
  // aggregate is success or partial, and the executed years KEEP their reason —
  // the receipt's year entries carry no reason field, so overwriting it would
  // erase the only durable record of what those years did.
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'success')], 0, 1), {
    result: 'partial',
    reason: 'presentation-refreshed',
  });
});

test('a refusal must not UPGRADE a run whose valid years did nothing', () => {
  // `no-op` is not success, so the refusal degrades it to `failure`, not to
  // `partial`. Mapping it to `partial` would make a run that refreshed nothing
  // AND refused a league read better than one that merely refreshed nothing.
  // Mirrors `schedule-refresh/route.ts:612-622`.
  assert.deepEqual(
    aggregateSchedulePresentationCron([year(2026, 'no-op', 'no-eligible-games')], 0, 1),
    { result: 'failure', reason: 'presentation-no-op' }
  );
});

test('refusals with NO executed years own the reason too', () => {
  // The one case where the refusal names the reason: there are no executed
  // years whose reason it could erase.
  assert.deepEqual(aggregateSchedulePresentationCron([], 0, 2), {
    result: 'failure',
    reason: 'unusable-lifecycle-year',
  });
});

test('a refusal and a budget stop together keep both facts', () => {
  assert.deepEqual(aggregateSchedulePresentationCron([year(2026, 'success')], 1, 1), {
    result: 'partial',
    reason: 'budget-exhausted',
  });
});
