import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
} from '../appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '../providerRefreshStatus.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('empty status when never refreshed', async () => {
  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.dataset, 'scores');
  assert.equal(status.lastAttemptAt, null);
  assert.equal(status.lastAttemptId, null);
  assert.equal(status.lastSuccessAt, null);
  assert.equal(status.lastError, null);
});

test('successful refresh records attempt and success and clears error', async () => {
  const a = await beginProviderRefreshAttempt('scores', {
    startedAt: '2026-07-12T00:00:00.000Z',
    attemptId: 'A',
  });
  await recordProviderRefreshSuccess('scores', { attempt: a, source: 'cfbd', rowsCommitted: 42 });

  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.lastAttemptAt, '2026-07-12T00:00:00.000Z');
  assert.equal(status.lastAttemptId, 'A');
  assert.ok(status.lastSuccessAt);
  assert.equal(status.lastError, null);
  assert.equal(status.source, 'cfbd');
  assert.equal(status.rowsCommitted, 42);
});

test('failed refresh records error but preserves prior success (does not advance last-success)', async () => {
  const a = await beginProviderRefreshAttempt('schedule', { attemptId: 'A' });
  await recordProviderRefreshSuccess('schedule', {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 100,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule')).lastSuccessAt;
  assert.ok(priorSuccessAt);

  const b = await beginProviderRefreshAttempt('schedule', { attemptId: 'B' });
  await recordProviderRefreshFailure('schedule', {
    attempt: b,
    error: 'upstream 502',
    status: 502,
  });

  const status = await getProviderRefreshStatus('schedule');
  assert.equal(status.lastSuccessAt, priorSuccessAt, 'last-success is NOT advanced by a failure');
  assert.equal(status.source, 'cfbd', 'prior-good source preserved');
  assert.equal(status.rowsCommitted, 100, 'prior-good row count preserved');
  assert.equal(status.lastError?.message, 'upstream 502');
  assert.equal(status.lastError?.status, 502);
});

test('rejected partial refresh records failure with failedPartitions', async () => {
  const a = await beginProviderRefreshAttempt('schedule', { attemptId: 'A' });
  await recordProviderRefreshFailure('schedule', {
    attempt: a,
    error: 'partial upstream error',
    partialFailure: true,
    failedPartitions: ['postseason'],
  });
  const status = await getProviderRefreshStatus('schedule');
  assert.equal(status.partialFailure, true);
  assert.deepEqual(status.failedPartitions, ['postseason']);
});

// ---------------------------------------------------------------------------
// Finding #5 — concurrent same-dataset attempts resolve deterministically.
// In every permutation: A begins, then B begins (so B is the LATEST attempt).
// ---------------------------------------------------------------------------

test('concurrency: A begins, B begins, A succeeds, B fails', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshSuccess('scores', { attempt: a, source: 'cfbd', rowsCommitted: 5 });
  await recordProviderRefreshFailure('scores', { attempt: b, error: 'boom', status: 500 });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.lastAttemptId, 'B', 'latest attempt is B');
  assert.ok(s.lastSuccessAt, "A's success is recorded");
  assert.equal(s.source, 'cfbd');
  assert.equal(s.lastError?.message, 'boom', "B's failure owns the latest error");
});

test('concurrency: A begins, B begins, B succeeds, A fails', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshSuccess('scores', { attempt: b, source: 'cfbd', rowsCommitted: 9 });
  await recordProviderRefreshFailure('scores', { attempt: a, error: 'stale-fail', status: 500 });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.lastAttemptId, 'B');
  assert.ok(s.lastSuccessAt, "B's success stands");
  assert.equal(s.lastError, null, "older A failure must not overwrite newer B's cleared error");
});

test('concurrency: A begins, B begins, B fails, A succeeds', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshFailure('scores', { attempt: b, error: 'b-fail', status: 502 });
  await recordProviderRefreshSuccess('scores', { attempt: a, source: 'espn', rowsCommitted: 3 });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.lastAttemptId, 'B');
  assert.equal(s.lastError?.message, 'b-fail', 'B (latest) still owns the error');
  assert.ok(s.lastSuccessAt, "A's later commit still advances last-success");
  assert.equal(s.source, 'espn');
});

test('concurrency: A begins, B begins, A fails, B succeeds', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshFailure('scores', { attempt: a, error: 'a-fail', status: 500 });
  await recordProviderRefreshSuccess('scores', { attempt: b, source: 'cfbd', rowsCommitted: 7 });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.lastAttemptId, 'B');
  assert.ok(s.lastSuccessAt);
  assert.equal(s.lastError, null, 'older A failure dropped; B success cleared the error');
});

// ---------------------------------------------------------------------------
// Finding #4 — distinguish an absent record from a failed read.
// ---------------------------------------------------------------------------

test('absent status initializes normally on begin', async () => {
  const a = await beginProviderRefreshAttempt('rankings', { attemptId: 'A', startedAt: 't1' });
  assert.equal(a.attemptId, 'A');
  const s = await getProviderRefreshStatus('rankings');
  assert.equal(s.lastAttemptAt, 't1');
  assert.equal(s.lastAttemptId, 'A');
});

test('a durable READ failure causes no destructive status write (prior-good preserved)', async () => {
  const a = await beginProviderRefreshAttempt('odds', { attemptId: 'A' });
  await recordProviderRefreshSuccess('odds', { attempt: a, source: 'odds-api', rowsCommitted: 12 });
  const good = await getProviderRefreshStatus('odds');
  assert.ok(good.lastSuccessAt);

  // Reads now fail; a failure/begin must NOT synthesize an empty record.
  __setAppStateReadFailureForTests(new Error('read down'));
  const b = await beginProviderRefreshAttempt('odds', { attemptId: 'B' });
  await recordProviderRefreshFailure('odds', { attempt: b, error: 'while blind' });
  __setAppStateReadFailureForTests(null);

  const after = await getProviderRefreshStatus('odds');
  assert.equal(after.lastSuccessAt, good.lastSuccessAt, 'prior-good last-success intact');
  assert.equal(after.source, 'odds-api', 'prior-good source intact');
  assert.equal(after.rowsCommitted, 12, 'prior-good rows intact');
  assert.equal(after.lastError, null, 'no error written blindly over prior-good');
});

test('status recording is best-effort: a durable WRITE failure never throws into the provider path', async () => {
  __setAppStateWriteFailureForTests(new Error('durable write down'));
  const a = await beginProviderRefreshAttempt('rankings', { attemptId: 'A' });
  await recordProviderRefreshSuccess('rankings', { attempt: a, source: 'cfbd', rowsCommitted: 5 });
  await recordProviderRefreshFailure('rankings', { attempt: a, error: 'boom' });
  __setAppStateWriteFailureForTests(null);
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.lastSuccessAt, null, 'nothing persisted, but no throw occurred');
});

// ---------------------------------------------------------------------------
// Rereview finding #8 — explicit latest-attempt outcome (no inference).
// ---------------------------------------------------------------------------

test('begin marks the latest attempt in-progress and leaves it unresolved', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  assert.equal(a.attemptId, 'A');
  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.latestAttemptOutcome, 'in-progress');
  assert.equal(s.latestAttemptResolvedAt, null);
});

test('an interrupted (never-resolved) attempt keeps a prior success visible but is not itself success', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  await recordProviderRefreshSuccess('scores', { attempt: a, source: 'cfbd', rowsCommitted: 4 });
  // A new attempt begins and never resolves (process dies mid-refresh).
  await beginProviderRefreshAttempt('scores', { attemptId: 'B' });
  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.latestAttemptOutcome, 'in-progress', 'newest attempt is unresolved');
  assert.ok(s.lastSuccessAt, 'prior success metadata is preserved');
  assert.equal(s.lastError, null, 'a prior success is not misreported as an error');
});

test('success resolves the latest attempt as succeeded; partial resolves as partial', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  await recordProviderRefreshSuccess('scores', { attempt: a, source: 'cfbd', rowsCommitted: 4 });
  assert.equal((await getProviderRefreshStatus('scores')).latestAttemptOutcome, 'succeeded');

  const b = await beginProviderRefreshAttempt('schedule', { attemptId: 'B' });
  await recordProviderRefreshSuccess('schedule', {
    attempt: b,
    source: 'cfbd',
    rowsCommitted: 10,
    partialFailure: true,
    failedPartitions: ['postseason'],
  });
  const s = await getProviderRefreshStatus('schedule');
  assert.equal(s.latestAttemptOutcome, 'partial');
  assert.ok(s.lastSuccessAt, 'a flagged-partial success still advances last-success');
});

test('failure resolves the latest attempt as failed', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  await recordProviderRefreshFailure('scores', { attempt: a, error: 'boom', status: 502 });
  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.latestAttemptOutcome, 'failed');
  assert.equal(s.lastError?.message, 'boom');
});

test('valid no-op resolves as no-op, distinct from failure, preserving prior-good success', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  await recordProviderRefreshSuccess('scores', { attempt: a, source: 'cfbd', rowsCommitted: 20 });
  const priorSuccess = (await getProviderRefreshStatus('scores')).lastSuccessAt;

  // A later refresh finds a valid EMPTY partition (e.g. postseason not published).
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B' });
  await recordProviderRefreshNoop('scores', { attempt: b, source: 'cfbd' });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.latestAttemptOutcome, 'no-op', 'no-op is a distinct outcome, not a failure');
  assert.equal(s.lastError, null, 'a no-op is not an error');
  assert.equal(s.lastSuccessAt, priorSuccess, 'a no-op does not advance last-success');
  assert.equal(s.rowsCommitted, 20, 'prior-good rows preserved (no new commit)');
});

test('no-op clears a stale error from a prior failed attempt (latest attempt resolved clean)', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  await recordProviderRefreshFailure('scores', { attempt: a, error: 'earlier boom' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B' });
  await recordProviderRefreshNoop('scores', { attempt: b });
  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.latestAttemptOutcome, 'no-op');
  assert.equal(s.lastError, null, 'the newest (clean) attempt clears the prior error');
});

test('a stale no-op does not overwrite a newer attempt outcome', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B' });
  await recordProviderRefreshFailure('scores', { attempt: b, error: 'b failed' });
  // A resolves late as a no-op; it is not the latest attempt, so it is dropped.
  await recordProviderRefreshNoop('scores', { attempt: a });
  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.lastAttemptId, 'B');
  assert.equal(s.latestAttemptOutcome, 'failed', "B's failure outcome stands");
  assert.equal(s.lastError?.message, 'b failed');
});

// ---------------------------------------------------------------------------
// Rereview finding #3 — success metadata is ordered by durable COMMIT time,
// not by when the status helper happens to run.
// ---------------------------------------------------------------------------

test('a stalled older commit recording success LATE does not overwrite the newer commit', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B', startedAt: 't2' });
  // A committed FIRST (earlier commit time) but stalled in post-commit work.
  // B committed SECOND (later commit time) and records success first.
  await recordProviderRefreshSuccess('scores', {
    attempt: b,
    committedAt: '2026-07-12T00:00:02.000Z',
    source: 'cfbd',
    rowsCommitted: 200,
  });
  // A finally records — later in wall-clock, but its commit was EARLIER.
  await recordProviderRefreshSuccess('scores', {
    attempt: a,
    committedAt: '2026-07-12T00:00:01.000Z',
    source: 'cfbd',
    rowsCommitted: 100,
  });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(
    s.lastSuccessAt,
    '2026-07-12T00:00:02.000Z',
    "B's newer commit remains last-success"
  );
  assert.equal(s.rowsCommitted, 200, "B's row metadata is not overwritten by the older commit");
});

// Second-rereview finding #6 — a per-process commit sequence breaks a tie when
// two commits share the same millisecond `committedAt`, so TRUE commit order wins
// regardless of which attempt records status first.

test('same-millisecond commits: the higher commit sequence wins when it records first', async () => {
  const ts = '2026-07-12T00:00:05.000Z';
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B' });
  const seqA = nextProviderCommitSeq();
  const seqB = nextProviderCommitSeq(); // seqB > seqA → B is the newer commit
  // Newer (B) records FIRST, then older (A) records late — A must not overwrite B.
  await recordProviderRefreshSuccess('scores', {
    attempt: b,
    committedAt: ts,
    commitSeq: seqB,
    source: 'cfbd',
    rowsCommitted: 200,
  });
  await recordProviderRefreshSuccess('scores', {
    attempt: a,
    committedAt: ts,
    commitSeq: seqA,
    source: 'cfbd',
    rowsCommitted: 100,
  });
  const s = await getProviderRefreshStatus('scores');
  assert.equal(s.rowsCommitted, 200, 'higher-seq commit wins the same-ms tie');
});

test('same-millisecond commits: the higher commit sequence wins even when it records last', async () => {
  const ts = '2026-07-12T00:00:06.000Z';
  const a = await beginProviderRefreshAttempt('odds', { attemptId: 'A' });
  const b = await beginProviderRefreshAttempt('odds', { attemptId: 'B' });
  const seqA = nextProviderCommitSeq();
  const seqB = nextProviderCommitSeq();
  // Older (A) records FIRST, then newer (B) records — B must still win the tie.
  await recordProviderRefreshSuccess('odds', {
    attempt: a,
    committedAt: ts,
    commitSeq: seqA,
    source: 'odds-api',
    rowsCommitted: 10,
  });
  await recordProviderRefreshSuccess('odds', {
    attempt: b,
    committedAt: ts,
    commitSeq: seqB,
    source: 'odds-api',
    rowsCommitted: 20,
  });
  const s = await getProviderRefreshStatus('odds');
  assert.equal(s.rowsCommitted, 20, 'higher-seq commit wins even when it records last');
});

// Second-rereview finding #5 — attempt IDs are process-independent (UUIDs), so two
// instances beginning in the same millisecond cannot collide.
test('attempt IDs are unique across rapid begins and are not a timestamp-counter token', async () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    const attempt = await beginProviderRefreshAttempt('scores', {});
    ids.add(attempt.attemptId);
  }
  assert.equal(ids.size, 50, 'no attempt-ID collisions across rapid begins');
  assert.match([...ids][0], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i, 'IDs are UUIDs');
});

test('inverse ordering: a later commit recording success still advances last-success', async () => {
  const a = await beginProviderRefreshAttempt('scores', { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', { attemptId: 'B', startedAt: 't2' });
  // B commits first (earlier commit time) and records; A commits later.
  await recordProviderRefreshSuccess('scores', {
    attempt: b,
    committedAt: '2026-07-12T00:00:01.000Z',
    source: 'cfbd',
    rowsCommitted: 50,
  });
  await recordProviderRefreshSuccess('scores', {
    attempt: a,
    committedAt: '2026-07-12T00:00:03.000Z',
    source: 'cfbd',
    rowsCommitted: 75,
  });

  const s = await getProviderRefreshStatus('scores');
  assert.equal(
    s.lastSuccessAt,
    '2026-07-12T00:00:03.000Z',
    'the newer commit advances last-success'
  );
  assert.equal(s.rowsCommitted, 75);
});
