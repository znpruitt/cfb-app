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
  recordProviderRefreshFailure,
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
