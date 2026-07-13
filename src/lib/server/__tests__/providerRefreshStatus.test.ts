import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
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
  assert.equal(status.lastSuccessAt, null);
  assert.equal(status.lastError, null);
  assert.equal(status.partialFailure, false);
});

test('successful refresh records attempt and success and clears error', async () => {
  const attemptStartedAt = '2026-07-12T00:00:00.000Z';
  await beginProviderRefreshAttempt('scores', attemptStartedAt);
  await recordProviderRefreshSuccess('scores', {
    attemptStartedAt,
    source: 'cfbd',
    rowsCommitted: 42,
  });

  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.lastAttemptAt, attemptStartedAt);
  assert.ok(status.lastSuccessAt, 'lastSuccessAt is set');
  assert.equal(status.lastError, null);
  assert.equal(status.source, 'cfbd');
  assert.equal(status.rowsCommitted, 42);
  assert.equal(status.partialFailure, false);
});

test('failed refresh records error but preserves prior success (does not advance last-success)', async () => {
  // Seed a prior success.
  await recordProviderRefreshSuccess('schedule', {
    attemptStartedAt: '2026-07-10T00:00:00.000Z',
    source: 'cfbd',
    rowsCommitted: 100,
  });
  const afterSuccess = await getProviderRefreshStatus('schedule');
  const priorSuccessAt = afterSuccess.lastSuccessAt;
  assert.ok(priorSuccessAt);

  // Now a failing attempt.
  await recordProviderRefreshFailure('schedule', {
    attemptStartedAt: '2026-07-11T00:00:00.000Z',
    error: 'upstream 502',
    status: 502,
  });

  const status = await getProviderRefreshStatus('schedule');
  assert.equal(status.lastSuccessAt, priorSuccessAt, 'last-success is NOT advanced by a failure');
  assert.equal(status.source, 'cfbd', 'prior-good source preserved');
  assert.equal(status.rowsCommitted, 100, 'prior-good row count preserved');
  assert.equal(status.lastAttemptAt, '2026-07-11T00:00:00.000Z');
  assert.equal(status.lastError?.message, 'upstream 502');
  assert.equal(status.lastError?.status, 502);
});

test('rejected partial refresh records failure with failedPartitions and does not advance success', async () => {
  await recordProviderRefreshSuccess('schedule', {
    attemptStartedAt: '2026-07-10T00:00:00.000Z',
    source: 'cfbd',
    rowsCommitted: 100,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule')).lastSuccessAt;

  await recordProviderRefreshFailure('schedule', {
    attemptStartedAt: '2026-07-11T00:00:00.000Z',
    error: 'partial upstream error',
    partialFailure: true,
    failedPartitions: ['postseason'],
  });

  const status = await getProviderRefreshStatus('schedule');
  assert.equal(status.lastSuccessAt, priorSuccessAt);
  assert.equal(status.partialFailure, true);
  assert.deepEqual(status.failedPartitions, ['postseason']);
});

test('a later success clears a prior error', async () => {
  await recordProviderRefreshFailure('odds', {
    attemptStartedAt: '2026-07-11T00:00:00.000Z',
    error: 'quota exhausted',
    status: 429,
  });
  assert.ok((await getProviderRefreshStatus('odds')).lastError);

  await recordProviderRefreshSuccess('odds', { source: 'odds-api', rowsCommitted: 10 });
  const status = await getProviderRefreshStatus('odds');
  assert.equal(status.lastError, null);
  assert.ok(status.lastSuccessAt);
});

test('status recording is best-effort: a durable write failure never throws into the provider path', async () => {
  __setAppStateWriteFailureForTests(new Error('durable write down'));
  // None of these should reject — the provider commit must not be poisoned by a
  // status-write failure.
  await beginProviderRefreshAttempt('rankings', '2026-07-12T00:00:00.000Z');
  await recordProviderRefreshSuccess('rankings', { source: 'cfbd', rowsCommitted: 5 });
  await recordProviderRefreshFailure('rankings', { error: 'boom' });
  __setAppStateWriteFailureForTests(null);
  // Nothing was persisted, so status is still empty — but no throw occurred.
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.lastSuccessAt, null);
});
