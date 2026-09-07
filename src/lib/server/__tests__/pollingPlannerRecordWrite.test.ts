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

test('a partial loss is COUNTED into the written value, not passed over in silence', async () => {
  // Owner decision on /code-review #6. Row-level tolerance stays — one bad row
  // must not stop the planner recording forever — but the write used to report
  // `recorded` while history shrank with no trace. A later read now shows that
  // loss happened and how much; roughly WHEN comes off the gap in the retained
  // rows' `at` values.
  await reset();
  const survivor = run('2026-09-04T04:00:00.000Z', '*/3 12 * * *');
  await setAppState(POLLING_PLANNER_RECORD_SCOPE, KEY, {
    runs: [{ at: 'not-a-date' }, survivor, { nope: true }],
  });

  assert.equal(
    await recordPollingPlannerRun(JOB, run('2026-09-06T04:00:00.000Z', '*/3 19 * * *')),
    'recorded'
  );

  const read = await readPollingPlannerRuns(JOB);
  assert.equal(read.kind, 'ok');
  assert.equal(read.kind === 'ok' && read.series.runs.length, 2, 'the readable rows survive');
  assert.equal(
    read.kind === 'ok' && read.series.droppedRuns,
    2,
    'and the two that did not are on the record'
  );

  // Cumulative across writes, so a second partial loss adds rather than replaces.
  assert.equal(
    await recordPollingPlannerRun(JOB, run('2026-09-05T16:00:00.000Z', '*/3 20 * * *')),
    'recorded'
  );
  const later = await readPollingPlannerRuns(JOB);
  assert.equal(
    later.kind === 'ok' && later.series.droppedRuns,
    2,
    'a clean write neither adds to the count nor resets it'
  );
});

test('a run reaching the durable write carries no surplus key', async () => {
  // Codex P1 end to end: the projection is on the path, not merely available to
  // a caller who remembers the constructor.
  await reset();
  const wide = {
    ...run('2026-09-06T04:00:00.000Z', '*/3 19 * * *'),
    headers: { Authorization: 'Bearer qstash-token-SECRET-VALUE' },
  } as PollingPlannerRun;

  assert.equal(await recordPollingPlannerRun(JOB, wide), 'recorded');

  const stored = await getAppState<unknown>(POLLING_PLANNER_RECORD_SCOPE, KEY);
  const serialized = JSON.stringify(stored?.value) ?? '';
  assert.equal(serialized.includes('SECRET-VALUE'), false);
  assert.equal(serialized.toLowerCase().includes('authorization'), false);
  assert.ok(
    (JSON.stringify(wide) ?? '').includes('SECRET-VALUE'),
    'positive control: the input really did carry it'
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

/**
 * A client whose stored row is CORRUPT (so the callback refuses) and whose
 * ROLLBACK then also fails — the one path that re-wraps our refusal.
 */
class RollbackFailingClient {
  async query(text: string): Promise<{ rows: unknown[] }> {
    const sql = String(text).trim().toLowerCase();
    if (sql.startsWith('rollback')) throw new Error('ROLLBACK failed');
    if (sql.startsWith('select value')) {
      return { rows: [{ value: { runs: [{ at: 'not-a-date' }] }, updated_at: new Date() }] };
    }
    return { rows: [{ present: true }] };
  }
  release(): void {}
}

class RollbackFailingPool {
  async connect(): Promise<RollbackFailingClient> {
    return new RollbackFailingClient();
  }
  async query(): Promise<{ rows: unknown[] }> {
    return { rows: [{ present: true }] };
  }
  async end(): Promise<void> {}
}

test('an unreadable prior stays UNREADABLE even when the rollback also fails', async () => {
  // `appStateStore` re-wraps a callback throw whose rollback failed as
  // `AppStateTxnCleanupError` (original on `cause`), and a coinciding lock
  // failure wraps it once more. A bare `instanceof` missed both and reported
  // `not-recorded` — "durably absent" — for a row that is present and corrupt,
  // losing the one signal that needs an operator. `providerUsageSeries` carries
  // the identical classifier and is filed separately rather than diverged here.
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  __setAppStatePoolForTests(new RollbackFailingPool() as unknown as Pool);
  try {
    const outcome = await recordPollingPlannerRun(
      JOB,
      run('2026-09-05T04:00:00.000Z', '*/3 19 * * *')
    );
    assert.equal(
      outcome,
      'unreadable',
      'a wrapped refusal is still a refusal, not a durable absence'
    );
    assert.notEqual(outcome, 'not-recorded');
  } finally {
    __setAppStatePoolForTests(null);
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
});

// ---------------------------------------------------------------------------
// Remediation round 3 (final)
// ---------------------------------------------------------------------------

test('the write path refuses what the read path would reject — same function', async () => {
  // The recurring root, third appearance. Round 1 moved the excess-property
  // allowlist to the sink; round 2 then added FIELD contracts on the read side
  // only, so the write path accepted values the read path rejects. `sortAndBound`
  // orders by the raw stored string, so `new Date().toString()` sorts above every
  // ISO instant ('S' > '2') and pins the newest end — the exact failure the
  // future-skew bound exists to prevent, through the door beside it.
  //
  // The gate is `parseRun` itself, so write and read cannot diverge.
  await reset();
  const good = run('2026-09-05T04:00:00.000Z', '*/3 19 * * *');

  const inadmissible: Array<[string, PollingPlannerRun]> = [
    ['a day start that is not UTC midnight', { ...good, dayStartMs: 1_764_028_800_001 }],
    ['an unparseable instant', { ...good, at: 'not-a-date' }],
    [
      'a destination carrying a line separator',
      {
        ...good,
        slow: {
          ...good.slow,
          intent: { ...good.slow.intent, destination: 'https://turfwar.games/a b' },
        },
      },
    ],
  ];

  for (const [name, candidate] of inadmissible) {
    assert.equal(await recordPollingPlannerRun(JOB, candidate), 'rejected', name);
  }
  assert.equal(
    (await readPollingPlannerRuns(JOB)).kind,
    'absent',
    'and none of them reached durable storage'
  );

  // Positive control on the same harness: the admissible run IS written.
  assert.equal(await recordPollingPlannerRun(JOB, good), 'recorded');
});

test('a rejected run is NOT reported as a durable failure', async () => {
  // `rejected` and `not-recorded` must stay distinguishable: one sends an
  // operator to the planner, the other to the database. Collapsing them is the
  // same class of mistake as reporting a store outage as a corrupt row.
  await reset();
  const outcome = await recordPollingPlannerRun(JOB, {
    ...run('2026-09-05T04:00:00.000Z', '*/3 19 * * *'),
    dayStartMs: 1_764_028_800_001,
  });

  assert.equal(outcome, 'rejected');
  assert.notEqual(outcome, 'not-recorded');
});

test('the stored `at` is NORMALIZED, so a raw form can never pin the ordering', async () => {
  // The half of the asymmetry that resolves by normalization rather than refusal,
  // and the distinction is worth stating because the review's scenario predicted
  // a rejection. `Date.parse` accepts JavaScript's own `Date.prototype.toString`
  // form, so `new Date().toString()` is ADMISSIBLE — but admission rewrites it to
  // the canonical ISO instant before the write. `sortAndBound` therefore never
  // sees `"Sat Sep 05 2026 …"`, which would have sorted above every ISO instant
  // ('S' > '2') and pinned the newest end of the series indefinitely.
  await reset();
  const good = run('2026-09-05T04:00:00.000Z', '*/3 19 * * *');
  const nonIso = new Date(Date.parse(good.at)).toString();
  // The property is that a weekday NAME outranks a digit, not that the name is
  // any particular one — `toString()` renders in local time, so the weekday
  // depends on the machine's zone and pinning it would make this pass or fail by
  // timezone rather than by the behaviour under test.
  assert.ok(
    (nonIso[0] ?? '') > '2',
    `the raw form must sort above an ISO instant; got ${JSON.stringify(nonIso)}`
  );

  await recordPollingPlannerRun(JOB, { ...good, at: nonIso });
  await recordPollingPlannerRun(JOB, run('2026-09-05T16:00:00.000Z', '*/3 20 * * *'));

  const stored = await getAppState<{ runs: Array<{ at: string }> }>(
    POLLING_PLANNER_RECORD_SCOPE,
    KEY
  );
  assert.deepEqual(
    stored?.value.runs.map((entry) => entry.at),
    ['2026-09-05T04:00:00.000Z', '2026-09-05T16:00:00.000Z'],
    'stored canonically and in true chronological order'
  );
});
