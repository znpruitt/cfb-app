import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../appStateStore';
import {
  admitPollingPlannerHoldRun,
  appendPollingPlannerHoldRun,
  buildPollingPlannerHoldRun,
  MAX_HOLD_REASON_LENGTH,
  parsePollingPlannerHoldRuns,
  POLLING_PLANNER_MAX_RUNS,
  POLLING_PLANNER_RECORD_SCOPE,
  pollingPlannerHoldRecordKey,
  pollingPlannerRecordKey,
  projectPollingPlannerHoldRun,
  readPollingPlannerHoldRuns,
  readPollingPlannerHoldRunsForWrite,
  readPollingPlannerRuns,
  recordPollingPlannerHoldRun,
  recordPollingPlannerHoldRunSafely,
  recordPollingPlannerRun,
  type PlannerScheduleIntent,
  type PollingPlannerHoldRun,
  type PollingPlannerHoldRunSeries,
  type PollingPlannerRun,
} from '../pollingPlannerRecord';
import { readSchedulerDeliveryHealth } from '../schedulerDeliveryHealth';
import { SAFE_CHARACTER_SAMPLES, UNSAFE_CHARACTER_CODES } from './unsafeCharacterTable';

/**
 * PLATFORM-732 — the HELD series: a durable trace for a planner run that planned
 * nothing, under its own key.
 *
 * WHAT THESE TESTS ARE FOR, stated precisely. The shape was chosen so the
 * applied series is untouched, which means the timeline guarantee holds BY
 * CONSTRUCTION rather than by assertion — so the boundary test at the bottom
 * documents a guarantee instead of being the only thing defending it, and would
 * pass even if it were written badly. The tests that carry real weight are the
 * two INDEPENDENCE ones (a refusal on either key cannot reach the other) and the
 * TOTALITY one (a throwing writer cannot escape into the planner's job loop).
 */

const JOB = 'live-scores' as const;
const OTHER_JOB = 'game-stats' as const;
const HELD_KEY = pollingPlannerHoldRecordKey(JOB);
const DAY_START_MS = 1_764_028_800_000;
const INVOCATION_ID = '6f1b3c02-9c1a-4f4e-8f2b-1f2a3b4c5d6e';

function heldRun(
  at: string,
  reason: 'plan-held' | 'settings-unavailable' = 'settings-unavailable'
): PollingPlannerHoldRun {
  return buildPollingPlannerHoldRun({
    at: new Date(at),
    invocationId: INVOCATION_ID,
    dayStartMs: DAY_START_MS,
    reason,
  });
}

function intent(overrides: Partial<PlannerScheduleIntent> = {}): PlannerScheduleIntent {
  return {
    scheduleId: 'turfwar-live-scores-3m',
    destination: 'https://turfwar.games/api/cron/live-scores',
    cron: '*/3 * * * *',
    method: 'GET',
    retries: 0,
    ...overrides,
  };
}

function appliedRun(at: string, cron: string): PollingPlannerRun {
  return {
    at,
    invocationId: INVOCATION_ID,
    dayStartMs: DAY_START_MS,
    windows: [{ startMs: 0, denseEndMs: 10, slowEndMs: 20, kickoffCount: 2 }],
    dense: {
      intent: intent({ cron }),
      previousCron: '*/3 * * * *',
      action: 'applied',
      outcome: 'confirmed',
    },
    slow: {
      intent: intent({ scheduleId: 'turfwar-live-scores-slow', cron: '1 * * * *' }),
      previousCron: null,
      action: 'skipped',
      outcome: 'unchanged',
    },
  };
}

async function reset(): Promise<void> {
  __setAppStateWriteFailureForTests(null);
  __setAppStateReadFailureForTests(null);
  // PLATFORM-207: the reset clears pools and seams but NOT the backing file, and
  // under `APP_STATE_TEST_ISOLATION` that file is keyed by `process.pid` and never
  // removed — so a recycled pid hands this process an earlier run's durable store.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
}

// ---------------------------------------------------------------------------
// The key, and why it is prefixed rather than scoped separately
// ---------------------------------------------------------------------------

test('the held key is prefixed and cannot collide with an applied one', () => {
  assert.equal(pollingPlannerHoldRecordKey(JOB), 'held:live-scores');
  assert.notEqual(pollingPlannerHoldRecordKey(JOB), pollingPlannerRecordKey(JOB));
  // Every scheduler job identifier is a bare slug, so no job name can ever parse
  // as a held key and no held key can ever be read as a job's applied series.
  assert.equal(pollingPlannerRecordKey(JOB).includes(':'), false);
});

// ---------------------------------------------------------------------------
// Field contracts — the SAME ones the applied parser enforces
// ---------------------------------------------------------------------------

test('the held parser enforces the applied series field contracts verbatim', () => {
  const nowMs = Date.parse('2026-09-07T12:00:00.000Z');
  const good = heldRun('2026-09-07T11:00:00.000Z');

  assert.equal(parsePollingPlannerHoldRuns({ runs: [good] }, nowMs).runs.length, 1);

  // `at` — parseable, and not implausibly future: one future-dated row would pin
  // the newest end of the series forever while valid rows trim off the old end.
  assert.equal(
    parsePollingPlannerHoldRuns({ runs: [{ ...good, at: 'nope' }] }, nowMs).runs.length,
    0
  );
  const beyond = { ...good, at: '2026-09-07T12:06:00.000Z' };
  assert.equal(parsePollingPlannerHoldRuns({ runs: [beyond] }, nowMs).runs.length, 0);
  assert.equal(
    parsePollingPlannerHoldRuns({ runs: [beyond] }, nowMs + 10 * 60_000).runs.length,
    1,
    'the same row is admissible once real time reaches it — the bound is skew, not a fixture date'
  );

  // `dayStartMs` — an exact UTC midnight. An offset day is corruption, not evidence.
  for (const offset of [1, -1, 3_600_000]) {
    assert.equal(
      parsePollingPlannerHoldRuns({ runs: [{ ...good, dayStartMs: DAY_START_MS + offset }] }, nowMs)
        .runs.length,
      0,
      `dayStartMs offset by ${offset} must be refused`
    );
  }

  // `at` is NORMALIZED, so lexicographic ordering is chronological.
  const parsed = parsePollingPlannerHoldRuns(
    { runs: [{ ...good, at: '2026-09-07T11:00:00Z' }] },
    nowMs
  );
  assert.equal(parsed.runs[0]?.at, '2026-09-07T11:00:00.000Z');

  // `invocationId` DEGRADES rather than costing the row: correlation is
  // best-effort, and losing the trace costs more than losing the link.
  const degraded = parsePollingPlannerHoldRuns({ runs: [{ ...good, invocationId: 42 }] }, nowMs);
  assert.equal(degraded.runs.length, 1);
  assert.equal(degraded.runs[0]?.invocationId, null);
});

test('the reason is the row, so an unusable one drops it — but an UNKNOWN one survives', () => {
  const nowMs = Date.parse('2026-09-07T12:00:00.000Z');
  const good = heldRun('2026-09-07T11:00:00.000Z');

  for (const reason of [undefined, null, '', 42, 'x'.repeat(MAX_HOLD_REASON_LENGTH + 1)]) {
    assert.equal(
      parsePollingPlannerHoldRuns({ runs: [{ ...good, reason }] }, nowMs).runs.length,
      0,
      `reason ${JSON.stringify(reason)} must drop the row — "held for some cause" answers nothing`
    );
  }

  // PINNED TO THE SHARED TABLE, not to a hand-written list. This field is the one
  // part of a held row an operator reads, so it passes the same consumer-derived
  // character class the applied intent's printable fields do — and
  // `unsafeCharacterTable.ts` exists because two hand-maintained copies of that
  // list had already drifted. An escape is used rather than a literal: a raw
  // U+2028 in source is indistinguishable from a space to the next reader.
  for (const code of UNSAFE_CHARACTER_CODES) {
    const reason = `plan${String.fromCharCode(code)}held`;
    assert.equal(
      parsePollingPlannerHoldRuns({ runs: [{ ...good, reason }] }, nowMs).runs.length,
      0,
      `U+${code.toString(16).padStart(4, '0')} must drop the row`
    );
  }

  // THE POSITIVE CONTROL. Without it the table above is satisfiable by a
  // validator that refuses everything non-ASCII, which is a different defect
  // wearing a passing badge.
  for (const sample of SAFE_CHARACTER_SAMPLES) {
    const reason = `plan-${sample}`;
    assert.equal(
      parsePollingPlannerHoldRuns({ runs: [{ ...good, reason }] }, nowMs).runs.length,
      1,
      `${sample} must be admitted`
    );
  }

  // THE SHAPING CONSTRAINT, and the reason `reason` is a string on the row rather
  // than the writer's union. A value this build never writes — the
  // `schedule-unreadable` day is the known next candidate — must survive a
  // rollback to this build instead of being dropped as corruption, so that day
  // costs no second durable-schema change.
  const future = parsePollingPlannerHoldRuns(
    { runs: [{ ...good, reason: 'schedule-unreadable' }] },
    nowMs
  );
  assert.equal(future.runs.length, 1);
  assert.equal(future.runs[0]?.reason, 'schedule-unreadable');
});

test('the projection is an allowlist at the sink, so a wider object stores nothing extra', () => {
  const wide = {
    ...heldRun('2026-09-07T11:00:00.000Z'),
    headers: { Authorization: 'Bearer SECRET-VALUE' },
  } as PollingPlannerHoldRun;

  assert.deepEqual(Object.keys(projectPollingPlannerHoldRun(wide)).sort(), [
    'at',
    'dayStartMs',
    'invocationId',
    'reason',
  ]);
  const appended = appendPollingPlannerHoldRun({ runs: [], droppedRuns: 0 }, wide);
  assert.equal(JSON.stringify(appended).includes('SECRET-VALUE'), false);
  // The WRITE gate is the read parser itself, so the two cannot diverge.
  assert.equal(JSON.stringify(admitPollingPlannerHoldRun(wide)).includes('SECRET-VALUE'), false);
});

test('rows sort by time, the bound is enforced, and dropped rows are counted forward', () => {
  const nowMs = Date.parse('2027-01-01T00:00:00.000Z');
  const out = appendPollingPlannerHoldRun(
    { runs: [heldRun('2026-09-08T11:00:00.000Z')], droppedRuns: 3 },
    heldRun('2026-09-07T11:00:00.000Z')
  );
  assert.deepEqual(
    out.runs.map((run) => run.at),
    ['2026-09-07T11:00:00.000Z', '2026-09-08T11:00:00.000Z']
  );
  assert.equal(out.droppedRuns, 3, 'appending discards nothing, so the count carries through');

  let series: PollingPlannerHoldRunSeries = { runs: [], droppedRuns: 0 };
  for (let day = 0; day < POLLING_PLANNER_MAX_RUNS + 5; day += 1) {
    series = appendPollingPlannerHoldRun(
      series,
      heldRun(new Date(Date.parse('2025-01-01T00:00:00.000Z') + day * 86_400_000).toISOString())
    );
  }
  assert.equal(series.runs.length, POLLING_PLANNER_MAX_RUNS);
  assert.equal(series.runs[0]?.at, '2025-01-06T00:00:00.000Z', 'the OLDEST rows are trimmed');
  assert.equal(series.droppedRuns, 0, 'trimming to the bound is retention, never a loss signal');

  const mixed = parsePollingPlannerHoldRuns(
    { runs: [{ at: 'not-a-date' }, heldRun('2026-09-07T11:00:00.000Z'), { nope: true }] },
    nowMs
  );
  assert.equal(mixed.runs.length, 1);
  assert.equal(mixed.droppedRuns, 2);
  assert.equal(
    parsePollingPlannerHoldRuns({ runs: [{ at: 'not-a-date' }], droppedRuns: 40 }, nowMs)
      .droppedRuns,
    41,
    'the count carried forward from earlier writes plus what this parse discarded'
  );
});

test('the write-path read refuses a present value that yields nothing, and only that', () => {
  const nowMs = Date.parse('2026-09-08T00:00:00.000Z');
  // Absent is a FIRST WRITE, not a refusal.
  assert.equal(readPollingPlannerHoldRunsForWrite(undefined, nowMs).ok, true);
  assert.equal(readPollingPlannerHoldRunsForWrite(null, nowMs).ok, true);
  // Present and unusable: refuse, or the append writes one row over the history.
  assert.equal(
    readPollingPlannerHoldRunsForWrite('a string where an object belongs', nowMs).ok,
    false
  );
  assert.equal(readPollingPlannerHoldRunsForWrite({ runs: 'not an array' }, nowMs).ok, false);
  assert.equal(readPollingPlannerHoldRunsForWrite({ runs: [{ at: 'nope' }] }, nowMs).ok, false);
  // An empty stored series is a real, readable state.
  assert.equal(readPollingPlannerHoldRunsForWrite({ runs: [] }, nowMs).ok, true);
  // Individual damaged rows stay TOLERATED, or one bad row stops recording forever.
  const partial = readPollingPlannerHoldRunsForWrite(
    { runs: [{ at: 'nope' }, heldRun('2026-09-07T11:00:00.000Z')] },
    nowMs
  );
  assert.equal(partial.ok, true);
  assert.equal(partial.ok ? partial.series.runs.length : null, 1);
  assert.equal(partial.ok ? partial.series.droppedRuns : null, 1);
});

// ---------------------------------------------------------------------------
// Durable write and read
// ---------------------------------------------------------------------------

test('holds append across runs, and the four read states are distinct', async () => {
  await reset();
  assert.equal((await readPollingPlannerHoldRuns(JOB)).kind, 'absent');

  assert.equal(
    await recordPollingPlannerHoldRun(JOB, heldRun('2026-09-05T04:00:00.000Z', 'plan-held')),
    'recorded'
  );
  assert.equal(
    await recordPollingPlannerHoldRun(
      JOB,
      heldRun('2026-09-06T04:00:00.000Z', 'settings-unavailable')
    ),
    'recorded'
  );

  const read = await readPollingPlannerHoldRuns(JOB);
  assert.equal(read.kind, 'ok');
  assert.deepEqual(
    read.kind === 'ok' ? read.series.runs.map((run) => run.reason) : null,
    ['plan-held', 'settings-unavailable'],
    'HISTORY is the deliverable — the receipt is latest-only and cannot answer "has one ever"'
  );

  // A present-but-unusable value is `unreadable`, never `absent`: reading a
  // corrupt trace as "no hold ever happened" is the false negative this exists
  // to prevent.
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, HELD_KEY, { runs: [{ at: 'not-a-date' }] });
  assert.equal((await readPollingPlannerHoldRuns(JOB)).kind, 'unreadable');

  __setAppStateReadFailureForTests(new Error('replica unreachable'), POLLING_PLANNER_RECORD_SCOPE);
  assert.equal((await readPollingPlannerHoldRuns(JOB)).kind, 'failed');
  __setAppStateReadFailureForTests(null);
});

test('a corrupt held value is refused rather than clobbered, and a bad run is rejected', async () => {
  await reset();
  const corrupt = { runs: [{ at: 'not-a-date' }, { totally: 'wrong' }] };
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, HELD_KEY, corrupt);

  assert.equal(
    await recordPollingPlannerHoldRun(JOB, heldRun('2026-09-06T04:00:00.000Z')),
    'unreadable'
  );
  assert.deepEqual(
    (await getAppState<unknown>(POLLING_PLANNER_RECORD_SCOPE, HELD_KEY))?.value,
    corrupt,
    'the transaction rolls back, so an operator inspects exactly what was found'
  );

  await reset();
  // `rejected` is a defect in what the CALLER handed the store, not a durable
  // failure — reporting it as `not-recorded` would send an operator to the
  // database instead of to the planner.
  assert.equal(
    await recordPollingPlannerHoldRun(JOB, {
      ...heldRun('2026-09-06T04:00:00.000Z'),
      dayStartMs: DAY_START_MS + 1,
    }),
    'rejected'
  );
  assert.equal((await readPollingPlannerHoldRuns(JOB)).kind, 'absent');
});

// ---------------------------------------------------------------------------
// TOTALITY — the guarantee the planner's job loop depends on
// ---------------------------------------------------------------------------

test('recordPollingPlannerHoldRunSafely absorbs a throwing writer', async () => {
  // THE MUTATION CONTROL FOR THE WHOLE ITEM. The held write sits on the
  // `continue` branch of the planner's per-job loop; a throw there escapes to the
  // route's outer catch and the job that was NOT held loses its whole day. Delete
  // the try/catch in `recordPollingPlannerHoldRunSafely` and this test REJECTS
  // rather than failing an assertion.
  //
  // It is driven by an injected writer because `recordPollingPlannerHoldRun`
  // catches everything it can reach today — so no store seam can produce the
  // throw, and a test written through the store would pass without the guard
  // existing at all. The guard is defence in depth against another function's
  // totality invariant, and this is what gives it a red state.
  const outcome = await recordPollingPlannerHoldRunSafely(
    JOB,
    heldRun('2026-09-06T04:00:00.000Z'),
    async () => {
      throw new Error('writer exploded with a SECRET-VALUE in the message');
    }
  );
  assert.equal(
    outcome,
    'not-recorded',
    'nothing is known to have been submitted, so this is a durable failure and not `indeterminate`'
  );

  const rejection = await recordPollingPlannerHoldRunSafely(
    JOB,
    heldRun('2026-09-06T04:00:00.000Z'),
    () => Promise.reject(new Error('async rejection'))
  );
  assert.equal(rejection, 'not-recorded');

  // The default writer is the real one, and a normal outcome passes through
  // untouched — the wrapper adds totality and nothing else.
  await reset();
  assert.equal(
    await recordPollingPlannerHoldRunSafely(JOB, heldRun('2026-09-06T04:00:00.000Z')),
    'recorded'
  );
});

// ---------------------------------------------------------------------------
// INDEPENDENCE — the property a variant row could not offer
// ---------------------------------------------------------------------------

test('a permanently unreadable held key cannot stop the applied series recording', async () => {
  await reset();
  // Obstacle 3's shape, aimed at the held key: a value that is present and yields
  // nothing refuses every subsequent write to THAT key, forever.
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, HELD_KEY, { runs: [{ at: 'not-a-date' }] });
  assert.equal(
    await recordPollingPlannerHoldRun(JOB, heldRun('2026-09-06T04:00:00.000Z')),
    'unreadable'
  );

  // And the applied series — the one delivery health reads and the one the
  // operator CLI diffs against — is untouched by it. Under a variant row these
  // were ONE value and ONE refusal, so this is the property the separate key buys.
  assert.equal(
    await recordPollingPlannerRun(JOB, appliedRun('2026-09-06T04:00:00.000Z', '*/3 19 * * *')),
    'recorded'
  );
  const applied = await readPollingPlannerRuns(JOB);
  assert.equal(applied.kind, 'ok');
  assert.equal(applied.kind === 'ok' ? applied.series.runs.length : null, 1);
});

test('a permanently unreadable applied key cannot stop the held series recording', async () => {
  await reset();
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, pollingPlannerRecordKey(JOB), {
    runs: [{ at: 'not-a-date' }],
  });
  assert.equal(
    await recordPollingPlannerRun(JOB, appliedRun('2026-09-06T04:00:00.000Z', '*/3 19 * * *')),
    'unreadable'
  );

  // The trace still lands. A planner whose applied record is corrupt is exactly
  // when an operator most needs to know whether the run was held.
  assert.equal(
    await recordPollingPlannerHoldRun(JOB, heldRun('2026-09-06T04:00:00.000Z')),
    'recorded'
  );
  assert.equal((await readPollingPlannerHoldRuns(JOB)).kind, 'ok');
});

test('one job holding writes nothing under any other job key', async () => {
  await reset();
  assert.equal(
    await recordPollingPlannerHoldRun(JOB, heldRun('2026-09-06T04:00:00.000Z')),
    'recorded'
  );

  assert.equal((await readPollingPlannerHoldRuns(OTHER_JOB)).kind, 'absent');
  assert.equal((await readPollingPlannerRuns(JOB)).kind, 'absent');
  assert.equal((await readPollingPlannerRuns(OTHER_JOB)).kind, 'absent');
});

// ---------------------------------------------------------------------------
// THE BOUNDARY — byte-identical delivery health, documented not defended
// ---------------------------------------------------------------------------

test('writing a held trace leaves delivery health byte-identical', async () => {
  await reset();
  // A real applied series for both planner-owned jobs, read through the DEFAULT
  // planner loader — so this exercises the real keys rather than a fixture.
  for (const job of [JOB, OTHER_JOB] as const) {
    assert.equal(
      await recordPollingPlannerRun(job, appliedRun('2026-09-06T04:00:00.000Z', '*/3 19 * * *')),
      'recorded'
    );
  }
  const nowMs = Date.parse('2026-09-06T06:00:00.000Z');
  const before = await readSchedulerDeliveryHealth({ nowMs });

  for (const job of [JOB, OTHER_JOB] as const) {
    assert.equal(
      await recordPollingPlannerHoldRun(job, heldRun('2026-09-06T05:00:00.000Z')),
      'recorded'
    );
  }
  const after = await readSchedulerDeliveryHealth({ nowMs });

  // BY CONSTRUCTION, not by filtering: `scheduleTimeline`, `installedState`,
  // `spanState`, `sortAndBound`, `parsePollingPlannerRuns` and
  // `readPollingPlannerRunsForWrite` never see this key, so the applied series'
  // input is bit-for-bit what it was. This documents that guarantee; it is not
  // the only thing defending it, which is why it is allowed to be this simple.
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(after) === JSON.stringify(before), true);
});
