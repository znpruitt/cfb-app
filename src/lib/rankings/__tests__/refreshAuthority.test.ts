import assert from 'node:assert/strict';
import test from 'node:test';

import { refreshSeasonRankings } from '../refreshAuthority.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateReadFailureForTests,
  getAppState,
} from '../../server/appStateStore.ts';
import {
  __resetSeasonRankingsCacheForTests,
  loadSeasonRankings,
  peekRankingsProcessMemo,
  POSTSEASON_SYNTHETIC_WEEK,
  type RankingsCacheEntry,
} from '../../server/rankings.ts';
import { getProviderRefreshStatus } from '../../server/providerRefreshStatus.ts';
import { yearScope } from '../../providerRefreshScope.ts';

const YEAR = 2035;
const T1 = Date.parse('2035-10-01T12:00:00.000Z');
const T2 = Date.parse('2035-10-08T12:00:00.000Z');
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

type RankTuple = [school: string, rank: number];

function poll(pollName: string, ranks: RankTuple[]) {
  return {
    poll: pollName,
    ranks: ranks.map(([school, rank]) => ({ rank, school, conference: null })),
  };
}

function regularWeek(week: number, polls: ReturnType<typeof poll>[]) {
  return { season: YEAR, seasonType: 'regular', week, polls };
}

function postseasonWeek(week: number, polls: ReturnType<typeof poll>[]) {
  return { season: YEAR, seasonType: 'postseason', week, polls };
}

/** A nonempty raw payload whose ranks carry no usable school → schema drift. */
const DRIFT_PAYLOAD = [regularWeek(1, [poll('AP Top 25', [['', 1] as unknown as RankTuple])])];

type PartitionStub = unknown[] | 'invalid' | 'fail';

function stubPartitions(opts: { regular: PartitionStub; postseason: PartitionStub }): {
  calls: () => number;
} {
  let calls = 0;
  globalThis.fetch = (async (input: URL | string | Request) => {
    calls += 1;
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const part =
      url.searchParams.get('seasonType') === 'postseason' ? opts.postseason : opts.regular;
    if (part === 'fail') {
      // 400 is outside the retry policy → a single failed attempt, no retries.
      return new Response('bad request', { status: 400 });
    }
    if (part === 'invalid') {
      return new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(part), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls: () => calls };
}

async function refresh(now: number, trigger: 'manual' | 'automatic' = 'manual') {
  return refreshSeasonRankings({ year: YEAR, trigger, now });
}

async function durableEntry(): Promise<RankingsCacheEntry | null> {
  const record = await getAppState<RankingsCacheEntry>('rankings', String(YEAR));
  return record?.value ?? null;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
});

test.after(() => {
  __setAppStateKeyLockFailureForTests(null);
  __setAppStateReadFailureForTests(null);
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

// ---------------------------------------------------------------------------
// Success paths (29, 28, 21) + memo-after-commit (15)
// ---------------------------------------------------------------------------

// 29 — changed content writes the complete aggregate.
test('written-clean: fresh weeks commit durably and publish the memo after commit', async () => {
  stubPartitions({
    regular: [
      regularWeek(1, [
        poll('AP Top 25', [
          ['Georgia', 1],
          ['Michigan', 2],
        ]),
      ]),
    ],
    postseason: [],
  });

  const result = await refresh(T1);
  assert.equal(result.status, 'success');
  assert.equal(result.reason, 'written-clean');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.trigger, 'manual');
  assert.deepEqual(result.attemptedSeasonTypes, ['regular', 'postseason']);
  assert.deepEqual(result.failedSeasonTypes, []);
  assert.equal(result.providerCallAttempted, true);
  assert.equal(result.rowsReceived, 1);
  assert.equal(result.rowsCommitted, 1);
  assert.equal(result.dataChanged, true);
  assert.equal(result.observedAt, new Date(T1).toISOString());
  assert.ok(result.committedAt, 'a confirmed commit instant is reported');
  assert.equal(result.response?.weeks.length, 1);
  assert.equal(result.response?.weeks[0]?.teams[0]?.teamName, 'Georgia');

  const durable = await durableEntry();
  assert.equal(durable?.at, T1);
  assert.equal(durable?.response.weeks.length, 1);

  // 15 — the memo is published only after the confirmed commit, and matches it.
  assert.deepEqual(peekRankingsProcessMemo(YEAR), durable);

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'succeeded');
});

// 28 — identical canonical content advances observation freshness only.
test('unchanged-clean: identical content bumps observation metadata without claiming rows', async () => {
  const payload = {
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [] as unknown[],
  };
  stubPartitions(payload);
  const first = await refresh(T1);
  assert.equal(first.reason, 'written-clean');

  stubPartitions(payload);
  const second = await refresh(T2);
  assert.equal(second.status, 'success');
  assert.equal(second.reason, 'unchanged-clean');
  assert.equal(second.rowsCommitted, 0);
  assert.equal(second.dataChanged, false);
  assert.equal(second.rowsReceived, 1);
  assert.ok(second.committedAt);

  const durable = await durableEntry();
  assert.equal(durable?.at, T2, 'observation freshness advanced');
  assert.equal(durable?.response.meta.generatedAt, new Date(T2).toISOString());
  assert.equal(durable?.response.weeks.length, 1, 'content unchanged');
});

// 21 — raw-empty postseason is valid absence when no prior postseason exists.
test('a raw-empty postseason partition commits cleanly when no prior postseason data exists', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  const first = await refresh(T1);
  assert.equal(first.reason, 'written-clean');

  // A later refresh adds a week; postseason still raw-empty — still committable.
  stubPartitions({
    regular: [
      regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])]),
      regularWeek(2, [poll('AP Top 25', [['Michigan', 1]])]),
    ],
    postseason: [],
  });
  const second = await refresh(T2);
  assert.equal(second.reason, 'written-clean');
  assert.equal((await durableEntry())?.response.weeks.length, 2);
});

// 25 — new weeks, new sources, and corrected ranks are accepted.
test('new weeks and corrected ranks are accepted as a clean replacement', async () => {
  stubPartitions({
    regular: [
      regularWeek(1, [
        poll('AP Top 25', [
          ['Georgia', 1],
          ['Michigan', 2],
        ]),
      ]),
    ],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({
    regular: [
      regularWeek(1, [
        poll('AP Top 25', [
          ['Michigan', 1],
          ['Georgia', 2],
        ]),
        poll('Coaches Poll', [['Georgia', 1]]),
      ]),
      regularWeek(2, [poll('AP Top 25', [['Georgia', 1]])]),
    ],
    postseason: [postseasonWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
  });
  const result = await refresh(T2);
  assert.equal(result.reason, 'written-clean');
  assert.equal(result.rowsCommitted, 3, 'two regular weeks + the synthetic final poll');

  const durable = await durableEntry();
  const week1 = durable?.response.weeks.find((w) => w.week === 1);
  assert.equal(week1?.polls.ap[0]?.teamName, 'Michigan', 'corrected ranks accepted');
  assert.equal(week1?.polls.coaches.length, 1, 'a NEW poll source is accepted');
  assert.ok(
    durable?.response.weeks.some((w) => w.week === POSTSEASON_SYNTHETIC_WEEK),
    'postseason remapped to the synthetic final poll'
  );
});

// ---------------------------------------------------------------------------
// Observation ordering (12, 13)
// ---------------------------------------------------------------------------

// 12 — a prior entry with a LATER observation rejects an older observation.
test('a fresher committed observation wins over an older refresh (stale-observation)', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  await refresh(T2);

  // An older observation now arrives with DIFFERENT content — it must not win.
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Michigan', 1]])])],
    postseason: [],
  });
  const result = await refresh(T1);
  assert.equal(result.status, 'no-op');
  assert.equal(result.reason, 'stale-observation');
  assert.equal(result.response?.weeks[0]?.teams[0]?.teamName, 'Georgia', 'fresher entry served');

  const durable = await durableEntry();
  assert.equal(durable?.at, T2, 'fresher durable observation preserved');
  assert.equal(durable?.response.weeks[0]?.teams[0]?.teamName, 'Georgia');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'no-op');
});

// 13 — an EQUAL observation timestamp preserves the prior winner.
test('an equal observation timestamp preserves the prior committed entry', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Michigan', 1]])])],
    postseason: [],
  });
  const result = await refresh(T1);
  assert.equal(result.reason, 'stale-observation');
  assert.equal((await durableEntry())?.response.weeks[0]?.teams[0]?.teamName, 'Georgia');
});

// ---------------------------------------------------------------------------
// Partition validation (16, 17, 18, 19, 20)
// ---------------------------------------------------------------------------

// 16 — regular schema drift rejects the aggregate even when postseason is usable.
test('regular schema drift rejects the aggregate and retains prior-good', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({
    regular: DRIFT_PAYLOAD,
    postseason: [postseasonWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
  });
  const result = await refresh(T2);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'rankings-partition-schema-drift');
  assert.equal(result.httpStatus, 200, 'prior-good is served');
  assert.deepEqual(result.failedSeasonTypes, ['regular']);
  assert.equal(result.rowsReceived, 1, 'the usable postseason rows are still counted');
  assert.equal(result.response?.meta.stale, true);
  assert.equal(result.response?.weeks.length, 1, 'prior-good served, not a partial commit');
  assert.equal((await durableEntry())?.at, T1, 'durable prior-good untouched');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-partition-schema-drift');
  assert.deepEqual(status.failedPartitions, ['regular']);
});

// 17 — postseason schema drift rejects even when regular is usable; with no
// prior-good there is nothing to serve (HTTP 500, no response).
test('postseason schema drift with no prior-good is a hard failure with nothing committed', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: DRIFT_PAYLOAD,
  });
  const result = await refresh(T1);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'rankings-partition-schema-drift');
  assert.equal(result.httpStatus, 500, 'no prior-good to serve');
  assert.equal(result.response, null);
  assert.deepEqual(result.failedSeasonTypes, ['postseason']);
  assert.equal(await durableEntry(), null, 'nothing committed');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.lastError?.code, 'rankings-partition-schema-drift');
  assert.deepEqual(status.failedPartitions, ['postseason']);
});

// 18 — a non-array top-level payload rejects the aggregate.
test('a non-array partition payload rejects the aggregate as invalid-provider-payload', async () => {
  stubPartitions({
    regular: 'invalid',
    postseason: [],
  });
  const result = await refresh(T1);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'invalid-provider-payload');
  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.failedSeasonTypes, ['regular']);
  assert.equal(await durableEntry(), null);

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.lastError?.code, 'rankings-invalid-provider-payload');
});

// 19/20 — a transport failure rejects the aggregate; rowsReceived still counts
// the sibling partition's fulfilled rows.
test('a transport failure rejects the aggregate while rowsReceived counts the fulfilled sibling', async () => {
  stubPartitions({
    regular: [
      regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])]),
      regularWeek(2, [poll('AP Top 25', [['Michigan', 1]])]),
    ],
    postseason: 'fail',
  });
  const result = await refresh(T1);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'provider-fetch-failed');
  assert.equal(result.providerCallAttempted, true);
  assert.deepEqual(result.failedSeasonTypes, ['postseason']);
  assert.equal(result.rowsReceived, 2, 'fulfilled regular rows are still counted');
  assert.equal(result.rowsCommitted, 0);
  assert.equal(await durableEntry(), null, 'nothing committed from a rejected aggregate');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-provider-fetch-failed');
});

// ---------------------------------------------------------------------------
// Prior-relative completeness (22, 23, 24) and empties (26, 27)
// ---------------------------------------------------------------------------

// 22 — a raw-empty regular partition cannot erase prior regular rankings.
test('a raw-empty regular partition over prior regular rankings is rejected as incomplete', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({
    regular: [],
    postseason: [postseasonWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
  });
  const result = await refresh(T2);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'rankings-partition-incomplete');
  assert.equal(result.httpStatus, 200, 'prior-good is served');
  assert.deepEqual(result.failedSeasonTypes, ['regular']);
  assert.equal(result.response?.meta.stale, true);

  const durable = await durableEntry();
  assert.equal(durable?.at, T1, 'prior-good retained');
  assert.equal(durable?.response.weeks[0]?.week, 1);

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.lastError?.code, 'rankings-partition-incomplete');
  assert.deepEqual(status.failedPartitions, ['regular']);
});

// 23 — a previously cached week missing from the incoming partition is rejected.
test('a missing prior week is rejected as rankings-partition-incomplete', async () => {
  stubPartitions({
    regular: [
      regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])]),
      regularWeek(2, [poll('AP Top 25', [['Michigan', 1]])]),
    ],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({
    regular: [regularWeek(2, [poll('AP Top 25', [['Michigan', 1]])])],
    postseason: [],
  });
  const result = await refresh(T2);
  assert.equal(result.reason, 'rankings-partition-incomplete');
  assert.deepEqual(result.failedSeasonTypes, ['regular']);
  assert.equal((await durableEntry())?.response.weeks.length, 2, 'both prior weeks retained');
});

// 24 — a previously populated poll source may not vanish from a matching week.
test('a missing prior populated poll source is rejected as rankings-partition-incomplete', async () => {
  stubPartitions({
    regular: [
      regularWeek(1, [poll('AP Top 25', [['Georgia', 1]]), poll('Coaches Poll', [['Georgia', 1]])]),
    ],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  const result = await refresh(T2);
  assert.equal(result.reason, 'rankings-partition-incomplete');
  assert.deepEqual(result.failedSeasonTypes, ['regular']);

  const durable = await durableEntry();
  assert.equal(durable?.at, T1);
  assert.equal(durable?.response.weeks[0]?.polls.coaches.length, 1, 'coaches source retained');
});

// 26 — all-empty with no prior data is a genuine pre-poll no-op.
test('both partitions empty with no prior data is empty-response with no write', async () => {
  stubPartitions({ regular: [], postseason: [] });
  const result = await refresh(T1);
  assert.equal(result.status, 'no-op');
  assert.equal(result.reason, 'empty-response');
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.response?.weeks, []);
  assert.equal(result.response?.meta.stale, undefined, 'a clean no-op, not a fallback');
  assert.equal(await durableEntry(), null, 'nothing durable was written');
  assert.equal(peekRankingsProcessMemo(YEAR), null, 'nothing memoized');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null, 'a no-op does not advance last-success');
});

// 27 — all-empty over prior-good is an empty replacement, rejected.
test('both partitions empty over prior-good is rejected with prior-good retained', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  await refresh(T1);

  stubPartitions({ regular: [], postseason: [] });
  const result = await refresh(T2);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'rankings-empty-replacement-rejected');
  assert.equal(result.httpStatus, 200, 'prior-good is served');
  assert.equal(result.response?.weeks.length, 1);
  assert.equal(result.response?.meta.stale, true);
  assert.equal((await durableEntry())?.at, T1, 'prior-good retained');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-empty-replacement-rejected');
});

// ---------------------------------------------------------------------------
// Store failures (14) and credentials
// ---------------------------------------------------------------------------

// 14 — a rankings-commit transaction failure publishes neither memo nor success.
test('a durable transaction failure preserves prior state and publishes no memo', async () => {
  stubPartitions({
    regular: [regularWeek(1, [poll('AP Top 25', [['Georgia', 1]])])],
    postseason: [],
  });
  // Fail ONLY the rankings-data transaction; the lease control scope still works.
  __setAppStateKeyLockFailureForTests(new Error('rankings store down'), 'rankings');
  try {
    const result = await refresh(T1);
    assert.equal(result.status, 'failure');
    assert.equal(result.reason, 'durable-commit-failed');
    assert.equal(result.httpStatus, 500);
    assert.equal(result.providerCallAttempted, true);
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }

  assert.equal(await durableEntry(), null, 'durable store unchanged');
  assert.equal(peekRankingsProcessMemo(YEAR), null, 'no memo published without a commit');
  await assert.rejects(() => loadSeasonRankings(YEAR), /admin refresh required/);

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-durable-commit-failed');
  assert.equal(status.lastSuccessAt, null, 'no fabricated success');
});

// A prior-state durable read outage fails closed BEFORE any provider work.
test('a prior-state read outage fails closed as store-unavailable before provider work', async () => {
  const stub = stubPartitions({ regular: [], postseason: [] });
  __setAppStateReadFailureForTests(new Error('read outage'), 'rankings');
  try {
    const result = await refresh(T1);
    assert.equal(result.status, 'failure');
    assert.equal(result.reason, 'store-unavailable');
    assert.equal(result.providerCallAttempted, false);
    assert.equal(stub.calls(), 0, 'no provider request after a failed prior-state read');
  } finally {
    __setAppStateReadFailureForTests(null);
  }

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-store-unavailable');
});

// Missing credentials resolve the year attempt exactly once as failed.
test('a missing CFBD key records a failed attempt without provider work', async () => {
  const stub = stubPartitions({ regular: [], postseason: [] });
  delete MUTABLE_ENV.CFBD_API_KEY;
  const result = await refresh(T1);
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'cfbd-api-key-missing');
  assert.equal(result.providerCallAttempted, false);
  assert.equal(stub.calls(), 0);

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});
