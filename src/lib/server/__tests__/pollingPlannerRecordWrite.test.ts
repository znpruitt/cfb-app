import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';

import {
  __resetAppStateForTests,
  __setAppStatePoolForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../appStateStore';
import {
  POLLING_PLANNER_RECORD_SCOPE,
  pollingPlannerRecordKey,
  readPollingPlannerRuns,
  recordPollingPlannerRun,
  type PlannerScheduleIntent,
  type PollingPlannerRun,
} from '../pollingPlannerRecord';

/**
 * PLATFORM-102 slice 3a — the DURABLE half: the transactional append, the
 * fail-closed refusal that protects an unreadable prior, and the four-state read
 * slice 3b consumes.
 *
 * Nothing in production calls `recordPollingPlannerRun`. These tests are the only
 * writers until slice 4 activates the planner.
 */

const JOB = 'live-scores' as const;
const KEY = pollingPlannerRecordKey(JOB);

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

function run(at: string, cron: string): PollingPlannerRun {
  return {
    at,
    invocationId: '6f1b3c02-9c1a-4f4e-8f2b-1f2a3b4c5d6e',
    dayStartMs: 1_764_028_800_000,
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
  __resetAppStateForTests();
  // `__resetAppStateForTests` clears pools and seams but NOT the backing file, so
  // a row survives between tests in this file unless it is cleared explicitly.
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, KEY, null);
}

test('a first run is recorded, and a second appends rather than replacing', async () => {
  await reset();

  assert.equal(
    await recordPollingPlannerRun(JOB, run('2026-09-05T04:00:00.000Z', '*/3 12 * * *')),
    'recorded'
  );
  assert.equal(
    await recordPollingPlannerRun(JOB, run('2026-09-06T04:00:00.000Z', '*/3 19 * * *')),
    'recorded'
  );

  const read = await readPollingPlannerRuns(JOB);
  assert.equal(read.kind, 'ok');
  assert.deepEqual(
    read.kind === 'ok' ? read.series.runs.map((entry) => entry.dense?.intent.cron) : null,
    ['*/3 12 * * *', '*/3 19 * * *'],
    'six months of history is the point; latest-only cannot answer when a cron started diverging'
  );
});

test('an unreadable prior is REFUSED and the stored value is left exactly as found', async () => {
  // The mutation target for the fail-closed read. Make
  // `readPollingPlannerRunsForWrite` tolerant — return `{ok: true, series: {runs: []}}`
  // for a present-but-unusable value — and this test goes red twice over: the
  // outcome becomes `recorded`, and the corrupt row is overwritten by a
  // one-entry array, which is the history loss the guard exists to prevent.
  await reset();
  const corrupt = { runs: [{ at: 'not-a-date' }, { nope: true }] };
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, KEY, corrupt);

  const outcome = await recordPollingPlannerRun(
    JOB,
    run('2026-09-06T04:00:00.000Z', '*/3 19 * * *')
  );

  assert.equal(outcome, 'unreadable');
  const stored = await getAppState<unknown>(POLLING_PLANNER_RECORD_SCOPE, KEY);
  assert.deepEqual(stored?.value, corrupt, 'the transaction rolled back, leaving the row intact');
});

test('a durable WRITE failure is reported as not-recorded, never as success', async () => {
  await reset();
  __setAppStateWriteFailureForTests(new Error('durable down'), POLLING_PLANNER_RECORD_SCOPE);

  const outcome = await recordPollingPlannerRun(
    JOB,
    run('2026-09-06T04:00:00.000Z', '*/3 19 * * *')
  );

  __setAppStateWriteFailureForTests(null);
  assert.equal(outcome, 'not-recorded');
});

// ---------------------------------------------------------------------------
// The four-state read
// ---------------------------------------------------------------------------

test('the read distinguishes absent from unreadable — the ruling this slice turns on', async () => {
  // `absent` is the ONLY state that licenses a fallback to a fixed constant.
  // Collapsing `unreadable` into it would let a broken record read as a
  // permanent false "correct" on the job that most needs a tampering signal.
  await reset();
  assert.equal((await readPollingPlannerRuns(JOB)).kind, 'absent');

  await setAppState(POLLING_PLANNER_RECORD_SCOPE, KEY, { runs: [{ at: 'not-a-date' }] });
  assert.equal((await readPollingPlannerRuns(JOB)).kind, 'unreadable');

  await setAppState(POLLING_PLANNER_RECORD_SCOPE, KEY, 'a string where an object belongs');
  assert.equal((await readPollingPlannerRuns(JOB)).kind, 'unreadable');

  await reset();
  await recordPollingPlannerRun(JOB, run('2026-09-06T04:00:00.000Z', '*/3 19 * * *'));
  assert.equal(
    (await readPollingPlannerRuns(JOB)).kind,
    'ok',
    'positive control: the same harness reports a readable series as readable'
  );
});

test('a store READ FAILURE is its own state, and never reads as absence', async () => {
  // The other half of the ruling. "The record could not be read" and "there is no
  // record" are different facts, and only the second may fall back to a constant.
  await reset();
  await recordPollingPlannerRun(JOB, run('2026-09-06T04:00:00.000Z', '*/3 19 * * *'));
  __setAppStateReadFailureForTests(new Error('replica unreachable'), POLLING_PLANNER_RECORD_SCOPE);

  const failed = await readPollingPlannerRuns(JOB);
  __setAppStateReadFailureForTests(null);

  assert.equal(failed.kind, 'failed');
  assert.equal(
    (await readPollingPlannerRuns(JOB)).kind,
    'ok',
    'positive control: the same row reads cleanly once the seam is cleared'
  );
});

test('an empty stored series is a readable state, not an absent one', async () => {
  // A planner that ran and recorded nothing is a different fact from a planner
  // that has never run, and only the second may fall back.
  await reset();
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, KEY, { runs: [] });

  const read = await readPollingPlannerRuns(JOB);
  assert.equal(read.kind, 'ok');
  assert.deepEqual(read.kind === 'ok' ? read.series.runs : null, []);
});

// ---------------------------------------------------------------------------
// The indeterminate outcome (Postgres path only)
// ---------------------------------------------------------------------------

/**
 * The file store's atomic rename leaves the prior file intact, so it throws
 * `writeAttempted: false` — the CERTAIN case. A lost COMMIT acknowledgement is
 * reachable only through the Postgres path.
 */
class FakeClient {
  async query(text: string): Promise<{ rows: unknown[] }> {
    const sql = String(text).trim().toLowerCase();
    if (sql.startsWith('commit')) throw new Error('COMMIT acknowledgement lost');
    if (sql.startsWith('select value')) return { rows: [] };
    return { rows: [{ present: true }] };
  }
  release(): void {}
}

class FakePool {
  async connect(): Promise<FakeClient> {
    return new FakeClient();
  }
  async query(): Promise<{ rows: unknown[] }> {
    return { rows: [{ present: true }] };
  }
  async end(): Promise<void> {}
}

test('an uncertain COMMIT is reported as INDETERMINATE, never as a loss', async () => {
  // A COMMIT failing after the mutation was submitted leaves durability unknown;
  // `appStateStore` sets the threshold at `writeAttempted` because a submitted
  // mutation may have executed server-side. The uncertainty is reported, not
  // guessed at — a planner that recorded "not written" for a run that did land
  // would have `inspect` diff against the wrong intent.
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  __setAppStatePoolForTests(new FakePool() as unknown as Pool);
  try {
    const outcome = await recordPollingPlannerRun(
      JOB,
      run('2026-09-06T04:00:00.000Z', '*/3 19 * * *')
    );
    assert.equal(outcome, 'indeterminate');
  } finally {
    __setAppStatePoolForTests(null);
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
});
