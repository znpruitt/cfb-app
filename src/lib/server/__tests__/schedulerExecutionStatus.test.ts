import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateFileCommitFailureForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import {
  __setSchedulerReceiptDeferrerForTests,
  buildSchedulerExecutionReceipt,
  createSchedulerInvocationId,
  EXTERNAL_SCHEDULER_JOBS,
  parseSchedulerExecutionReceipt,
  rankingsYearsTarget,
  recordSchedulerExecutionReceipt,
  scheduleSchedulerExecutionReceipt,
  scheduleYearsTarget,
  seasonRolloverYearsTarget,
  seasonTransitionYearsTarget,
  schedulerSourceForJob,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
  type SchedulerExecutionReceipt,
  type SchedulerExecutionReceiptInput,
} from '@/lib/server/schedulerExecutionStatus';

import {
  installSchedulerReceiptDeferrer,
  RECEIPT_KEYS,
  readSchedulerReceipt,
} from '@/test/schedulerReceiptTestHarness';

// PLATFORM-086F2E1 — the shared receipt authority: exact allowlisted schema,
// all job-compatible target shapes, monotonic latest-only ordering,
// malformed/mismatched prior replacement, bounded multi-year summaries, and
// fully-swallowed store/deferrer failures. Route integration lives in each cron
// suite's receipts.test.ts.

const SCOPE = SCHEDULER_EXECUTION_STATUS_SCOPE;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};

// A base instant safely in the PAST relative to the real clock (fixtures whose
// startedAt sits in the future would trip the prior-receipt future-skew guard).
const SEC = 1_000;
const T0 = Date.now() - 24 * 60 * 60 * SEC;

const ID_A = '0a0a0a0a-0000-4000-8000-000000000000';
const ID_B = '0b0b0b0b-0000-4000-8000-000000000000';
const ID_C = '0c0c0c0c-0000-4000-8000-000000000000';

function liveScoresInput(
  overrides: Partial<SchedulerExecutionReceiptInput> = {}
): SchedulerExecutionReceiptInput {
  return {
    job: 'live-scores',
    invocationId: ID_A,
    startedAtMs: T0,
    completedAtMs: T0 + 250,
    result: 'skipped',
    reason: 'no-polling-target',
    providerCallAttempted: false,
    target: { kind: 'live-scores', year: 2026, mode: null, targetGames: 0, targetPartitions: 0 },
    ...overrides,
  };
}

function receiptOf(input: SchedulerExecutionReceiptInput): SchedulerExecutionReceipt {
  const receipt = buildSchedulerExecutionReceipt(input);
  assert.ok(receipt, 'builder produces a receipt for a valid input');
  return receipt;
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  delete MUTABLE_ENV.DATABASE_URL;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  __setAppStateKeyLockFailureForTests(null);
  __setAppStateFileCommitFailureForTests(null);
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.afterEach(() => {
  __setSchedulerReceiptDeferrerForTests(null);
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  __setAppStateKeyLockFailureForTests(null);
  __setAppStateFileCommitFailureForTests(null);
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
});

// 1/12 — exact stored top-level keys, constants, valid instants, integer duration.
test('a stored receipt carries exactly the allowlisted keys with valid instants and duration', async () => {
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  const stored = await readSchedulerReceipt('live-scores');
  assert.ok(stored, 'missing prior record → the receipt writes');
  const value = stored.value;
  assert.deepEqual(Object.keys(value).slice().sort(), RECEIPT_KEYS);
  assert.equal(value.version, 1);
  assert.equal(value.job, 'live-scores');
  assert.equal(value.source, 'qstash');
  assert.equal(value.invocationId, ID_A);
  assert.equal(value.startedAt, new Date(T0).toISOString());
  assert.equal(value.completedAt, new Date(T0 + 250).toISOString());
  assert.ok(Number.isFinite(Date.parse(value.startedAt)), 'startedAt is a valid ISO instant');
  assert.ok(Number.isFinite(Date.parse(value.completedAt)), 'completedAt is a valid ISO instant');
  assert.ok(
    Number.isInteger(value.durationMs) && value.durationMs === 250,
    'durationMs is the exact nonnegative integer difference'
  );
  assert.equal(value.result, 'skipped');
  assert.equal(value.reason, 'no-polling-target');
  assert.equal(value.providerCallAttempted, false);
});

test('an inverted completion instant clamps durationMs to zero', () => {
  const receipt = receiptOf(liveScoresInput({ completedAtMs: T0 - 5_000 }));
  assert.equal(receipt.durationMs, 0);
});

test('createSchedulerInvocationId returns a UUID-shaped identity', () => {
  const id = createSchedulerInvocationId();
  assert.ok(id && /^[0-9a-f-]{36}$/.test(id));
});

// 2 — all six QStash job-compatible target shapes persist with exact target key sets.
test('all six QStash job target shapes persist with exact allowlisted target keys', async () => {
  const inputs: SchedulerExecutionReceiptInput[] = [
    liveScoresInput({
      result: 'success',
      reason: 'scoreboard-written-clean',
      providerCallAttempted: true,
      target: {
        kind: 'live-scores',
        year: 2026,
        mode: 'scoreboard',
        targetGames: 3,
        targetPartitions: 2,
      },
    }),
    liveScoresInput({
      job: 'team-records',
      result: 'no-op',
      reason: 'fresh-cache',
      target: { kind: 'team-records', year: 2026 },
    }),
    liveScoresInput({
      job: 'game-stats',
      result: 'success',
      reason: 'written-clean',
      providerCallAttempted: true,
      target: { kind: 'game-stats', year: 2026, week: 3, seasonType: 'regular' },
    }),
    liveScoresInput({
      job: 'odds',
      result: 'no-op',
      reason: 'empty-response',
      providerCallAttempted: true,
      target: { kind: 'odds', year: 2026, cadence: 'baseline', eligibleGames: 4 },
    }),
    liveScoresInput({
      job: 'schedule-refresh',
      result: 'success',
      reason: 'year-results',
      providerCallAttempted: true,
      target: scheduleYearsTarget(
        [
          {
            year: 2025,
            operation: 'postseason-boundary',
            scoreRepairs: 0,
            scoreDifferenceCount: 0,
            scoreSweepFailedPartitions: [],
            scoreSweepCannotTellCount: 0,
            kickoffsChanged: 0,
          },
          {
            year: 2026,
            operation: 'preseason-maintenance',
            scoreRepairs: 0,
            scoreDifferenceCount: 0,
            scoreSweepFailedPartitions: [],
            scoreSweepCannotTellCount: 0,
            kickoffsChanged: 0,
          },
        ],
        0
      ),
    }),
    liveScoresInput({
      job: 'rankings',
      result: 'success',
      reason: 'year-results',
      providerCallAttempted: true,
      target: rankingsYearsTarget([{ year: 2026, publicationWindow: 'weekly-ap-coaches' }], 0),
    }),
  ];
  for (const input of inputs) {
    await recordSchedulerExecutionReceipt(receiptOf(input));
  }

  const expectations: Array<{
    job: SchedulerExecutionReceiptInput['job'];
    kind: string;
    keys: string[];
  }> = [
    {
      job: 'live-scores',
      kind: 'live-scores',
      keys: ['kind', 'mode', 'targetGames', 'targetPartitions', 'year'].sort(),
    },
    { job: 'team-records', kind: 'team-records', keys: ['kind', 'year'].sort() },
    { job: 'game-stats', kind: 'game-stats', keys: ['kind', 'seasonType', 'week', 'year'].sort() },
    { job: 'odds', kind: 'odds', keys: ['cadence', 'eligibleGames', 'kind', 'year'].sort() },
    {
      job: 'schedule-refresh',
      kind: 'schedule-years',
      // PLATFORM-086F2H1R2 — present after a parse even when a legacy receipt
      // omits it, because the rebuild normalizes it to 0.
      keys: [
        'invalidLifecycleTargets',
        'kickoffsChanged',
        'kind',
        'scoreDifferences',
        'scoreRepairs',
        'scoreSweepCannotTellCount',
        'scoreSweepFailures',
        'totalYears',
        'truncated',
        'years',
      ].sort(),
    },
    {
      job: 'rankings',
      kind: 'rankings-years',
      keys: ['invalidLifecycleTargets', 'kind', 'totalYears', 'truncated', 'years'].sort(),
    },
  ];
  for (const expectation of expectations) {
    const stored = await readSchedulerReceipt(expectation.job);
    assert.ok(stored, `receipt persisted for ${expectation.job}`);
    assert.equal(stored.value.job, expectation.job);
    assert.equal(stored.value.target.kind, expectation.kind);
    assert.deepEqual(Object.keys(stored.value.target).slice().sort(), expectation.keys);
  }

  const schedule = await readSchedulerReceipt('schedule-refresh');
  assert.deepEqual(
    (schedule!.value.target as { years: unknown[] }).years.map((entry) =>
      Object.keys(entry as object)
        .slice()
        .sort()
    ),
    [
      ['operation', 'year'],
      ['operation', 'year'],
    ]
  );
  const rankings = await readSchedulerReceipt('rankings');
  assert.deepEqual(
    (rankings!.value.target as { years: unknown[] }).years.map((entry) =>
      Object.keys(entry as object)
        .slice()
        .sort()
    ),
    [['publicationWindow', 'year']]
  );
});

// The six QStash jobs keep source `qstash`; the two lifecycle jobs write
// `vercel-cron`; all eight job/target/source combinations validate and persist.
test('all eight jobs derive the correct source and persist their target shape', async () => {
  const inputs: SchedulerExecutionReceiptInput[] = [
    liveScoresInput(),
    liveScoresInput({
      job: 'team-records',
      reason: 'fresh-cache',
      target: { kind: 'team-records', year: 2026 },
    }),
    liveScoresInput({
      job: 'game-stats',
      target: { kind: 'game-stats', year: 2026, week: 3, seasonType: 'regular' },
    }),
    liveScoresInput({
      job: 'odds',
      target: { kind: 'odds', year: 2026, cadence: null, eligibleGames: 0 },
    }),
    liveScoresInput({
      job: 'schedule-refresh',
      target: scheduleYearsTarget(
        [
          {
            year: 2026,
            operation: null,
            scoreRepairs: 0,
            scoreDifferenceCount: 0,
            scoreSweepFailedPartitions: [],
            scoreSweepCannotTellCount: 0,
            kickoffsChanged: 0,
          },
        ],
        0
      ),
    }),
    liveScoresInput({
      job: 'rankings',
      target: rankingsYearsTarget([{ year: 2026, publicationWindow: null }], 0),
    }),
    liveScoresInput({
      job: 'season-transition',
      result: 'success',
      reason: 'season-transitioned',
      providerCallAttempted: true,
      target: seasonTransitionYearsTarget(
        [{ year: 2026, targetLeagues: 2, probed: true, transitionedLeagues: 2 }],
        0
      ),
    }),
    liveScoresInput({
      job: 'season-rollover',
      result: 'success',
      reason: 'rollover-complete',
      providerCallAttempted: false,
      target: seasonRolloverYearsTarget(
        [{ year: 2025, targetLeagues: 1, rolledOverLeagues: 1 }],
        0
      ),
    }),
  ];
  for (const input of inputs) {
    await recordSchedulerExecutionReceipt(receiptOf(input));
  }

  const expectations: Array<{
    job: SchedulerExecutionReceiptInput['job'];
    source: string;
    kind: string;
  }> = [
    { job: 'live-scores', source: 'qstash', kind: 'live-scores' },
    { job: 'team-records', source: 'qstash', kind: 'team-records' },
    { job: 'game-stats', source: 'qstash', kind: 'game-stats' },
    { job: 'odds', source: 'qstash', kind: 'odds' },
    { job: 'schedule-refresh', source: 'qstash', kind: 'schedule-years' },
    { job: 'rankings', source: 'qstash', kind: 'rankings-years' },
    { job: 'season-transition', source: 'vercel-cron', kind: 'season-transition-years' },
    { job: 'season-rollover', source: 'vercel-cron', kind: 'season-rollover-years' },
  ];
  for (const e of expectations) {
    const stored = await readSchedulerReceipt(e.job);
    assert.ok(stored, `receipt persisted for ${e.job}`);
    assert.equal(stored.value.source, e.source, `${e.job} source`);
    assert.equal(stored.value.target.kind, e.kind, `${e.job} target kind`);
  }

  const transition = await readSchedulerReceipt('season-transition');
  assert.deepEqual(
    (transition!.value.target as { years: unknown[] }).years.map((entry) =>
      Object.keys(entry as object)
        .slice()
        .sort()
    ),
    [
      [
        'alreadyInTargetSeasonLeagues',
        'probed',
        'refusedLeagues',
        'removedLeagues',
        'targetLeagues',
        'transitionedLeagues',
        'year',
      ].sort(),
    ]
  );
  const rollover = await readSchedulerReceipt('season-rollover');
  assert.deepEqual(
    (rollover!.value.target as { years: unknown[] }).years.map((entry) =>
      Object.keys(entry as object)
        .slice()
        .sort()
    ),
    [['rolledOverLeagues', 'targetLeagues', 'year'].sort()]
  );
});

// F2E2A — the source is DERIVED from the job, never accepted from the caller: an
// incoming receipt claiming the wrong source is normalized to the job's source.
test('a caller-claimed wrong source is normalized to the job source, never stored', async () => {
  const rollover = receiptOf(
    liveScoresInput({
      job: 'season-rollover',
      result: 'success',
      reason: 'rollover-complete',
      providerCallAttempted: false,
      target: seasonRolloverYearsTarget(
        [{ year: 2025, targetLeagues: 1, rolledOverLeagues: 1 }],
        0
      ),
    })
  );
  // The builder already derived the correct source; forcing a wrong one and
  // re-recording must normalize back (never persist a lifecycle job as qstash).
  await recordSchedulerExecutionReceipt({ ...rollover, source: 'qstash' });
  assert.equal((await readSchedulerReceipt('season-rollover'))?.value.source, 'vercel-cron');
});

// F2E2A — a stored prior with the WRONG source for its job is unusable/replaceable.
test('a stored prior with a mismatched source is replaceable', async () => {
  const good = receiptOf(
    liveScoresInput({
      job: 'season-transition',
      result: 'success',
      reason: 'season-transitioned',
      providerCallAttempted: true,
      startedAtMs: T0,
      target: seasonTransitionYearsTarget(
        [{ year: 2026, targetLeagues: 1, probed: true, transitionedLeagues: 1 }],
        0
      ),
    })
  );
  // Seed a NEWER-started but wrong-source (qstash) record; it must be replaceable
  // despite the later start instant, and an older-good incoming wins.
  await setAppState(SCOPE, 'season-transition', {
    ...good,
    invocationId: ID_C,
    startedAt: new Date(T0 + 60 * SEC).toISOString(),
    source: 'qstash',
  });
  await recordSchedulerExecutionReceipt(good);
  const stored = await readSchedulerReceipt('season-transition');
  assert.equal(stored?.value.invocationId, ID_A, 'the mismatched-source prior was replaceable');
  assert.equal(stored?.value.source, 'vercel-cron');
});

// F2E2A — a wrong target KIND for the job is unusable (buildSchedulerExecutionReceipt null).
test('a target kind that does not match the job yields no receipt', () => {
  const bad = buildSchedulerExecutionReceipt({
    ...liveScoresInput({ job: 'season-rollover' }),
    // live-scores target under the season-rollover job — incompatible.
  });
  assert.equal(bad, null, 'incompatible job/target kind builds no receipt');
});

// F2E2A — both lifecycle multi-year summaries cap at eight with truthful totals.
test('lifecycle multi-year targets cap at eight entries with truthful totalYears/truncated', () => {
  const manyTransition = Array.from({ length: 11 }, (_, i) => ({
    year: 2015 + i,
    targetLeagues: 1,
    probed: true,
    transitionedLeagues: 0,
  }));
  const t = seasonTransitionYearsTarget(manyTransition, 0);
  assert.equal(t.totalYears, 11);
  assert.equal(t.truncated, true);
  assert.equal(t.years.length, 8);
  assert.deepEqual(
    t.years.map((y) => y.year),
    [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022]
  );

  const r = seasonRolloverYearsTarget([{ year: 2025, targetLeagues: 3, rolledOverLeagues: 2 }], 0);
  assert.equal(r.totalYears, 1);
  assert.equal(r.truncated, false);
});

// 4 — malformed / mismatched / obsolete-version prior records are replaceable.
test('malformed, job-mismatched, and obsolete-version prior records are replaced', async () => {
  const incoming = receiptOf(liveScoresInput({ startedAtMs: T0 }));

  await setAppState(SCOPE, 'live-scores', { garbage: true });
  await recordSchedulerExecutionReceipt(incoming);
  assert.equal((await readSchedulerReceipt('live-scores'))?.value.invocationId, ID_A);

  // A NEWER-started but job-mismatched record stored under this key is unusable
  // and must be replaced despite its later start instant.
  const mismatched = receiptOf(
    liveScoresInput({
      job: 'game-stats',
      invocationId: ID_C,
      startedAtMs: T0 + 60 * SEC,
      target: { kind: 'game-stats', year: 2026, week: null, seasonType: null },
    })
  );
  await setAppState(SCOPE, 'live-scores', mismatched);
  await recordSchedulerExecutionReceipt(incoming);
  assert.equal((await readSchedulerReceipt('live-scores'))?.value.invocationId, ID_A);

  const obsolete = {
    ...receiptOf(liveScoresInput({ invocationId: ID_C, startedAtMs: T0 + 60 * SEC })),
    version: 2,
  };
  await setAppState(SCOPE, 'live-scores', obsolete);
  await recordSchedulerExecutionReceipt(incoming);
  assert.equal((await readSchedulerReceipt('live-scores'))?.value.invocationId, ID_A);

  // A corrupt target shape (wrong kind for the job) is also replaceable.
  const wrongTarget = {
    ...receiptOf(liveScoresInput({ invocationId: ID_C, startedAtMs: T0 + 60 * SEC })),
    target: { kind: 'odds', year: 2026, cadence: null, eligibleGames: 0 },
  };
  await setAppState(SCOPE, 'live-scores', wrongTarget);
  await recordSchedulerExecutionReceipt(incoming);
  assert.equal((await readSchedulerReceipt('live-scores'))?.value.invocationId, ID_A);
});

// A prior whose startedAt is implausibly in the FUTURE (corruption, a manual
// edit, or a foreign writer) is replaceable even though it is otherwise
// well-formed with a valid reason — otherwise its later startedAt would win the
// monotonic comparison and pin scheduler health to malformed data forever. A
// coincidentally-valid reason (`unexpected-error` is in every vocabulary) must
// not rescue it; the future-startedAt guard is what closes the vector.
test('a future-dated prior receipt is replaced despite an otherwise-valid shape', async () => {
  const futurePrior = receiptOf(
    liveScoresInput({
      invocationId: ID_C,
      startedAtMs: Date.now() + 10 * 24 * 60 * 60 * SEC, // ten days ahead
      result: 'failure',
      reason: 'unexpected-error', // a reason valid in every job vocabulary
    })
  );
  await setAppState(SCOPE, 'live-scores', futurePrior);
  // A normal, present-time incoming receipt must win and overwrite the corrupt
  // future-dated record even though its startedAt is "earlier".
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput({ invocationId: ID_A })));
  const stored = await readSchedulerReceipt('live-scores');
  assert.equal(stored?.value.invocationId, ID_A, 'the future-dated prior was replaceable');
  assert.equal(stored?.value.reason, 'no-polling-target');
});

// 5/6 — a newer prior start instant is never overwritten by a stale completion,
// even when the older invocation commits last with a later completedAt.
test('an older invocation that completes late cannot overwrite a newer delivery', async () => {
  const older = receiptOf(
    liveScoresInput({
      invocationId: ID_A,
      startedAtMs: T0,
      completedAtMs: T0 + 120 * SEC, // completes AFTER the newer invocation
      result: 'failure',
      reason: 'provider-fetch-failed',
    })
  );
  const newer = receiptOf(
    liveScoresInput({
      invocationId: ID_B,
      startedAtMs: T0 + 30 * SEC,
      completedAtMs: T0 + 31 * SEC,
    })
  );

  // The newer invocation commits first; the older one finishes late.
  await recordSchedulerExecutionReceipt(newer);
  await recordSchedulerExecutionReceipt(older);

  const stored = await readSchedulerReceipt('live-scores');
  assert.equal(stored?.value.invocationId, ID_B, 'the newer delivery remains');
  assert.equal(stored?.value.result, 'skipped');
});

// 7 — equal start instants tie-break deterministically on lexical invocationId.
test('equal start instants use the lexical invocationId tie-break', async () => {
  const a = receiptOf(liveScoresInput({ invocationId: ID_A }));
  const b = receiptOf(liveScoresInput({ invocationId: ID_B }));
  const c = receiptOf(liveScoresInput({ invocationId: ID_C }));

  await recordSchedulerExecutionReceipt(b);
  await recordSchedulerExecutionReceipt(a); // lexically lower → preserved prior
  assert.equal((await readSchedulerReceipt('live-scores'))?.value.invocationId, ID_B);

  await recordSchedulerExecutionReceipt(c); // lexically higher → wins
  assert.equal((await readSchedulerReceipt('live-scores'))?.value.invocationId, ID_C);
});

// 8 — an exact duplicate identity never rewrites the stored record.
test('an exact duplicate identity is preserved without a rewrite', async () => {
  const receipt = receiptOf(liveScoresInput());
  await recordSchedulerExecutionReceipt(receipt);
  const before = await readSchedulerReceipt('live-scores');
  assert.ok(before);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  const after = await readSchedulerReceipt('live-scores');
  assert.deepEqual(after?.value, before.value);
  assert.equal(after?.updatedAt, before.updatedAt, 'no rewrite occurred');
});

// 9 — bounded multi-year summaries: cap of eight, truthful totals, order.
test('multi-year targets cap at eight entries with truthful totalYears and truncated', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    year: 2020 + i,
    operation: 'ordinary-maintenance' as const,
    scoreRepairs: 0,
    scoreDifferenceCount: 0,
    scoreSweepFailedPartitions: [],
    scoreSweepCannotTellCount: 0,
    kickoffsChanged: 0,
  }));
  const capped = scheduleYearsTarget(many, 0);
  assert.equal(capped.totalYears, 10);
  assert.equal(capped.truncated, true);
  assert.equal(capped.years.length, 8);
  assert.deepEqual(
    capped.years.map((entry) => entry.year),
    [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027],
    'ascending order preserved, first eight kept'
  );

  const few = rankingsYearsTarget(
    [
      { year: 2025, publicationWindow: null },
      { year: 2026, publicationWindow: 'cfp-publication' },
    ],
    0
  );
  assert.equal(few.totalYears, 2);
  assert.equal(few.truncated, false);
  assert.equal(few.years.length, 2);
});

// 10 — read / advisory-lock / transaction / write failures resolve harmlessly.
test('a prior-record read failure writes nothing and preserves the stored receipt', async () => {
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  const before = await readSchedulerReceipt('live-scores');
  __setAppStateReadFailureForTests(new Error('receipt read boom'), SCOPE);
  await recordSchedulerExecutionReceipt(
    receiptOf(liveScoresInput({ invocationId: ID_B, startedAtMs: T0 + 60 * SEC }))
  );
  __setAppStateReadFailureForTests(null);
  const after = await readSchedulerReceipt('live-scores');
  assert.deepEqual(after, before, 'a genuine read failure writes nothing');
});

test('advisory-lock, write, and transaction-commit failures resolve harmlessly', async () => {
  __setAppStateKeyLockFailureForTests(new Error('lock boom'), SCOPE);
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  __setAppStateKeyLockFailureForTests(null);
  assert.equal(await readSchedulerReceipt('live-scores'), null);

  __setAppStateWriteFailureForTests(new Error('write boom'), SCOPE);
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('live-scores'), null);

  __setAppStateFileCommitFailureForTests(new Error('commit boom'));
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  __setAppStateFileCommitFailureForTests(null);
  assert.equal(await readSchedulerReceipt('live-scores'), null);

  // With every seam cleared the same receipt persists (nothing was poisoned).
  await recordSchedulerExecutionReceipt(receiptOf(liveScoresInput()));
  assert.ok(await readSchedulerReceipt('live-scores'));
});

// 11 — deferrer registration/callback failures are harmless.
test('a throwing deferrer registration is swallowed and writes nothing', async () => {
  __setSchedulerReceiptDeferrerForTests(() => {
    throw new Error('registration boom');
  });
  assert.doesNotThrow(() => scheduleSchedulerExecutionReceipt(liveScoresInput()));
  __setSchedulerReceiptDeferrerForTests(null);
  assert.equal(await readSchedulerReceipt('live-scores'), null);
});

test('a failing persistence callback resolves harmlessly through the deferrer', async () => {
  const deferrer = installSchedulerReceiptDeferrer();
  try {
    __setAppStateWriteFailureForTests(new Error('write boom'), SCOPE);
    scheduleSchedulerExecutionReceipt(liveScoresInput());
    assert.equal(deferrer.count(), 1);
    await deferrer.flush(); // must not reject
    __setAppStateWriteFailureForTests(null);
    assert.equal(await readSchedulerReceipt('live-scores'), null);
  } finally {
    deferrer.restore();
  }
});

test('without an injected deferrer, scheduling outside a request scope is a no-op', async () => {
  // Production uses Next.js `after`; under node:test there is no request scope,
  // so registration fails and is swallowed — never an untracked promise.
  assert.doesNotThrow(() => scheduleSchedulerExecutionReceipt(liveScoresInput()));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await readSchedulerReceipt('live-scores'), null);
});

// Snapshot immutability — the callback never closes over mutable route state.
test('the receipt snapshot is immutable: later mutations never reach durable state', async () => {
  const deferrer = installSchedulerReceiptDeferrer();
  try {
    const input = liveScoresInput({
      result: 'success',
      reason: 'scoreboard-written-clean',
      providerCallAttempted: true,
      target: {
        kind: 'live-scores',
        year: 2026,
        mode: 'scoreboard',
        targetGames: 2,
        targetPartitions: 1,
      },
    });
    scheduleSchedulerExecutionReceipt(input);
    // Mutate the tracker-shaped input AFTER scheduling, BEFORE persistence.
    input.result = 'failure';
    input.reason = 'unexpected-error';
    (input.target as { targetGames: number }).targetGames = 99;
    await deferrer.flush();
    const stored = await readSchedulerReceipt('live-scores');
    assert.equal(stored?.value.result, 'success');
    assert.equal(stored?.value.reason, 'scoreboard-written-clean');
    assert.equal(
      (stored?.value.target as { targetGames: number }).targetGames,
      2,
      'the pre-mutation snapshot persisted'
    );
  } finally {
    deferrer.restore();
  }
});

// 13 — secret canaries and arbitrary attached properties never persist.
test('secret canaries and arbitrary attached properties never reach durable state', async () => {
  const SECRET_MARKER = 'sekret-cron-MARKER';
  const HEADER_MARKER = 'Bearer sekret-header-MARKER';
  const deferrer = installSchedulerReceiptDeferrer();
  try {
    const input = {
      ...liveScoresInput(),
      cronSecret: SECRET_MARKER,
      authorization: HEADER_MARKER,
      target: {
        kind: 'live-scores',
        year: 2026,
        mode: null,
        targetGames: 0,
        targetPartitions: 0,
        upstreamUrl: 'https://api.example.com/?apiKey=sekret-url-MARKER',
        error: new Error(SECRET_MARKER),
      },
    } as unknown as Parameters<typeof scheduleSchedulerExecutionReceipt>[0];
    scheduleSchedulerExecutionReceipt(input);
    await deferrer.flush();
    const stored = await readSchedulerReceipt('live-scores');
    assert.ok(stored);
    const serialized = JSON.stringify(stored.value);
    assert.ok(!serialized.includes('MARKER'), 'no canary appears in durable state');
    assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
    assert.deepEqual(
      Object.keys(stored.value.target).slice().sort(),
      ['kind', 'mode', 'targetGames', 'targetPartitions', 'year'].sort()
    );
  } finally {
    deferrer.restore();
  }
});

// ── F2E2B — exported job list, source helper, and safe read parser ───────────

test('EXTERNAL_SCHEDULER_JOBS is the canonical eight jobs and derives each source', () => {
  assert.deepEqual(
    [...EXTERNAL_SCHEDULER_JOBS],
    [
      'live-scores',
      'team-records',
      'game-stats',
      'odds',
      'schedule-refresh',
      'rankings',
      'season-transition',
      'season-rollover',
    ]
  );
  for (const job of EXTERNAL_SCHEDULER_JOBS) {
    const expected =
      job === 'season-transition' || job === 'season-rollover' ? 'vercel-cron' : 'qstash';
    assert.equal(schedulerSourceForJob(job), expected, `${job} source`);
  }
});

test('parseSchedulerExecutionReceipt accepts a valid record and REBUILDS it (no cast, no extras)', () => {
  const now = Date.now();
  const built = receiptOf(liveScoresInput({ startedAtMs: now - 60_000 }));
  // Attach canary fields at every level; the parser must strip them.
  const withCanaries = {
    ...built,
    LEAK: 'x-MARKER',
    target: {
      ...built.target,
      LEAK: 'y-MARKER',
    },
  };
  const parsed = parseSchedulerExecutionReceipt(withCanaries, 'live-scores', now);
  assert.ok(parsed, 'a valid record parses');
  assert.notEqual(parsed, withCanaries, 'never returns the raw stored object by cast');
  assert.deepEqual(Object.keys(parsed!).slice().sort(), RECEIPT_KEYS);
  assert.ok(!JSON.stringify(parsed).includes('MARKER'), 'canaries stripped');
  // Ordering-relevant fields are preserved verbatim.
  assert.equal(parsed!.startedAt, built.startedAt);
  assert.equal(parsed!.invocationId, built.invocationId);
});

test('parseSchedulerExecutionReceipt rejects wrong job, wrong source, and future-dated starts', () => {
  const now = Date.now();
  const good = receiptOf(
    liveScoresInput({
      job: 'season-transition',
      result: 'success',
      reason: 'season-transitioned',
      providerCallAttempted: true,
      startedAtMs: now - 60_000,
      target: seasonTransitionYearsTarget(
        [{ year: 2026, targetLeagues: 1, probed: true, transitionedLeagues: 1 }],
        0
      ),
    })
  );
  // Wrong expected job.
  assert.equal(parseSchedulerExecutionReceipt(good, 'season-rollover', now), null);
  // Wrong derived source stored on the record.
  assert.equal(
    parseSchedulerExecutionReceipt({ ...good, source: 'qstash' }, 'season-transition', now),
    null
  );
  // Obsolete version.
  assert.equal(
    parseSchedulerExecutionReceipt({ ...good, version: 2 }, 'season-transition', now),
    null
  );
  // Materially future-dated startedAt.
  assert.equal(
    parseSchedulerExecutionReceipt(
      { ...good, startedAt: new Date(now + 10 * 60_000).toISOString() },
      'season-transition',
      now
    ),
    null
  );
  // A correct record still parses.
  assert.ok(parseSchedulerExecutionReceipt(good, 'season-transition', now));
});

test('PLATFORM-089: the odds cadence set admits `early` and still rejects anything outside it', () => {
  // The reader validates and REBUILDS, so an unrecognized cadence does not degrade
  // gracefully — `parse` returns null and System Health reports the Odds job as
  // having no recent authenticated invocation. Adding a cadence to the route
  // without adding it here would have produced exactly that, silently.
  const now = Date.now();
  const built = receiptOf(
    liveScoresInput({
      job: 'odds',
      result: 'success',
      reason: 'written-clean',
      providerCallAttempted: true,
      startedAtMs: now - 60_000,
      target: { kind: 'odds', year: 2026, cadence: 'baseline', eligibleGames: 1 },
    })
  );
  // The builder only accepts the typed union, so the wire values under test are
  // substituted onto a built record — exactly the shape the reader sees coming
  // back off a durable store written by an older or newer deploy.
  const withCadence = (cadence: unknown) => ({
    ...built,
    target: { ...built.target, cadence },
  });

  for (const cadence of ['early', 'baseline', 'pregame', null]) {
    assert.ok(
      parseSchedulerExecutionReceipt(withCadence(cadence), 'odds', now),
      `cadence ${JSON.stringify(cadence)} must survive the reader`
    );
  }
  for (const cadence of ['hourly', 'EARLY', '', 7]) {
    assert.equal(
      parseSchedulerExecutionReceipt(withCadence(cadence), 'odds', now),
      null,
      `cadence ${JSON.stringify(cadence)} must be rejected`
    );
  }
});
