import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getLegacyProviderRefreshStatus,
  getProviderRefreshStatus,
  nextProviderCommitSeq,
  PROVIDER_REFRESH_STATUS_SCOPE,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '../providerRefreshStatus.ts';
import { seasonPartitionScope, weekPartitionScope, yearScope } from '../../providerRefreshScope.ts';

// A single canonical scope used by the generic behavior tests below; the store
// keys by dataset+scope, so one scope value across datasets is fine.
const SCOPE = yearScope(2026);

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('empty status when never refreshed', async () => {
  const status = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(status.dataset, 'scores');
  assert.equal(status.lastAttemptAt, null);
  assert.equal(status.lastAttemptId, null);
  assert.equal(status.lastSuccessAt, null);
  assert.equal(status.lastError, null);
});

test('successful refresh records attempt and success and clears error', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, {
    startedAt: '2026-07-12T00:00:00.000Z',
    attemptId: 'A',
  });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 42,
  });

  const status = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(status.lastAttemptAt, '2026-07-12T00:00:00.000Z');
  assert.equal(status.lastAttemptId, 'A');
  assert.ok(status.lastSuccessAt);
  assert.equal(status.lastError, null);
  assert.equal(status.source, 'cfbd');
  assert.equal(status.rowsCommitted, 42);
});

test('failed refresh records error but preserves prior success (does not advance last-success)', async () => {
  const a = await beginProviderRefreshAttempt('schedule', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshSuccess('schedule', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 100,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule', SCOPE)).lastSuccessAt;
  assert.ok(priorSuccessAt);

  const b = await beginProviderRefreshAttempt('schedule', SCOPE, { attemptId: 'B' });
  await recordProviderRefreshFailure('schedule', SCOPE, {
    attempt: b,
    error: 'upstream 502',
    status: 502,
  });

  const status = await getProviderRefreshStatus('schedule', SCOPE);
  assert.equal(status.lastSuccessAt, priorSuccessAt, 'last-success is NOT advanced by a failure');
  assert.equal(status.source, 'cfbd', 'prior-good source preserved');
  assert.equal(status.rowsCommitted, 100, 'prior-good row count preserved');
  assert.equal(status.lastError?.message, 'upstream 502');
  assert.equal(status.lastError?.status, 502);
});

test('rejected partial refresh records failure with failedPartitions', async () => {
  const a = await beginProviderRefreshAttempt('schedule', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshFailure('schedule', SCOPE, {
    attempt: a,
    error: 'partial upstream error',
    partialFailure: true,
    failedPartitions: ['postseason'],
  });
  const status = await getProviderRefreshStatus('schedule', SCOPE);
  assert.equal(status.partialFailure, true);
  assert.deepEqual(status.failedPartitions, ['postseason']);
});

// ---------------------------------------------------------------------------
// Finding #5 — concurrent same-dataset attempts resolve deterministically.
// In every permutation: A begins, then B begins (so B is the LATEST attempt).
// ---------------------------------------------------------------------------

test('concurrency: A begins, B begins, A succeeds, B fails', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 5,
  });
  await recordProviderRefreshFailure('scores', SCOPE, { attempt: b, error: 'boom', status: 500 });

  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.lastAttemptId, 'B', 'latest attempt is B');
  assert.ok(s.lastSuccessAt, "A's success is recorded");
  assert.equal(s.source, 'cfbd');
  assert.equal(s.lastError?.message, 'boom', "B's failure owns the latest error");
});

test('concurrency: A begins, B begins, B succeeds, A fails', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: b,
    source: 'cfbd',
    rowsCommitted: 9,
  });
  await recordProviderRefreshFailure('scores', SCOPE, {
    attempt: a,
    error: 'stale-fail',
    status: 500,
  });

  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.lastAttemptId, 'B');
  assert.ok(s.lastSuccessAt, "B's success stands");
  assert.equal(s.lastError, null, "older A failure must not overwrite newer B's cleared error");
});

test('concurrency: A begins, B begins, B fails, A succeeds', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshFailure('scores', SCOPE, { attempt: b, error: 'b-fail', status: 502 });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    source: 'espn',
    rowsCommitted: 3,
  });

  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.lastAttemptId, 'B');
  assert.equal(s.lastError?.message, 'b-fail', 'B (latest) still owns the error');
  assert.ok(s.lastSuccessAt, "A's later commit still advances last-success");
  assert.equal(s.source, 'espn');
});

test('concurrency: A begins, B begins, A fails, B succeeds', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B', startedAt: 't2' });
  await recordProviderRefreshFailure('scores', SCOPE, { attempt: a, error: 'a-fail', status: 500 });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: b,
    source: 'cfbd',
    rowsCommitted: 7,
  });

  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.lastAttemptId, 'B');
  assert.ok(s.lastSuccessAt);
  assert.equal(s.lastError, null, 'older A failure dropped; B success cleared the error');
});

// ---------------------------------------------------------------------------
// Finding #4 — distinguish an absent record from a failed read.
// ---------------------------------------------------------------------------

test('absent status initializes normally on begin', async () => {
  const a = await beginProviderRefreshAttempt('rankings', SCOPE, {
    attemptId: 'A',
    startedAt: 't1',
  });
  assert.equal(a.attemptId, 'A');
  const s = await getProviderRefreshStatus('rankings', SCOPE);
  assert.equal(s.lastAttemptAt, 't1');
  assert.equal(s.lastAttemptId, 'A');
});

test('a durable READ failure causes no destructive status write (prior-good preserved)', async () => {
  const a = await beginProviderRefreshAttempt('odds', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshSuccess('odds', SCOPE, {
    attempt: a,
    source: 'odds-api',
    rowsCommitted: 12,
  });
  const good = await getProviderRefreshStatus('odds', SCOPE);
  assert.ok(good.lastSuccessAt);

  // Reads now fail; a failure/begin must NOT synthesize an empty record.
  __setAppStateReadFailureForTests(new Error('read down'));
  const b = await beginProviderRefreshAttempt('odds', SCOPE, { attemptId: 'B' });
  await recordProviderRefreshFailure('odds', SCOPE, { attempt: b, error: 'while blind' });
  __setAppStateReadFailureForTests(null);

  const after = await getProviderRefreshStatus('odds', SCOPE);
  assert.equal(after.lastSuccessAt, good.lastSuccessAt, 'prior-good last-success intact');
  assert.equal(after.source, 'odds-api', 'prior-good source intact');
  assert.equal(after.rowsCommitted, 12, 'prior-good rows intact');
  assert.equal(after.lastError, null, 'no error written blindly over prior-good');
});

test('status recording is best-effort: a durable WRITE failure never throws into the provider path', async () => {
  __setAppStateWriteFailureForTests(new Error('durable write down'));
  const a = await beginProviderRefreshAttempt('rankings', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshSuccess('rankings', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 5,
  });
  await recordProviderRefreshFailure('rankings', SCOPE, { attempt: a, error: 'boom' });
  __setAppStateWriteFailureForTests(null);
  const status = await getProviderRefreshStatus('rankings', SCOPE);
  assert.equal(status.lastSuccessAt, null, 'nothing persisted, but no throw occurred');
});

// ---------------------------------------------------------------------------
// Rereview finding #8 — explicit latest-attempt outcome (no inference).
// ---------------------------------------------------------------------------

test('begin marks the latest attempt in-progress and leaves it unresolved', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  assert.equal(a.attemptId, 'A');
  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.latestAttemptOutcome, 'in-progress');
  assert.equal(s.latestAttemptResolvedAt, null);
});

test('an interrupted (never-resolved) attempt keeps a prior success visible but is not itself success', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 4,
  });
  // A new attempt begins and never resolves (process dies mid-refresh).
  await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B' });
  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.latestAttemptOutcome, 'in-progress', 'newest attempt is unresolved');
  assert.ok(s.lastSuccessAt, 'prior success metadata is preserved');
  assert.equal(s.lastError, null, 'a prior success is not misreported as an error');
});

test('success resolves the latest attempt as succeeded; partial resolves as partial', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 4,
  });
  assert.equal((await getProviderRefreshStatus('scores', SCOPE)).latestAttemptOutcome, 'succeeded');

  const b = await beginProviderRefreshAttempt('schedule', SCOPE, { attemptId: 'B' });
  await recordProviderRefreshSuccess('schedule', SCOPE, {
    attempt: b,
    source: 'cfbd',
    rowsCommitted: 10,
    partialFailure: true,
    failedPartitions: ['postseason'],
  });
  const s = await getProviderRefreshStatus('schedule', SCOPE);
  assert.equal(s.latestAttemptOutcome, 'partial');
  assert.ok(s.lastSuccessAt, 'a flagged-partial success still advances last-success');
});

test('failure resolves the latest attempt as failed', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshFailure('scores', SCOPE, { attempt: a, error: 'boom', status: 502 });
  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.latestAttemptOutcome, 'failed');
  assert.equal(s.lastError?.message, 'boom');
});

test('valid no-op resolves as no-op, distinct from failure, preserving prior-good success', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 20,
  });
  const priorSuccess = (await getProviderRefreshStatus('scores', SCOPE)).lastSuccessAt;

  // A later refresh finds a valid EMPTY partition (e.g. postseason not published).
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B' });
  await recordProviderRefreshNoop('scores', SCOPE, { attempt: b, source: 'cfbd' });

  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.latestAttemptOutcome, 'no-op', 'no-op is a distinct outcome, not a failure');
  assert.equal(s.lastError, null, 'a no-op is not an error');
  assert.equal(s.lastSuccessAt, priorSuccess, 'a no-op does not advance last-success');
  assert.equal(s.rowsCommitted, 20, 'prior-good rows preserved (no new commit)');
});

test('no-op clears a stale error from a prior failed attempt (latest attempt resolved clean)', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  await recordProviderRefreshFailure('scores', SCOPE, { attempt: a, error: 'earlier boom' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B' });
  await recordProviderRefreshNoop('scores', SCOPE, { attempt: b });
  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.latestAttemptOutcome, 'no-op');
  assert.equal(s.lastError, null, 'the newest (clean) attempt clears the prior error');
});

test('a stale no-op does not overwrite a newer attempt outcome', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B' });
  await recordProviderRefreshFailure('scores', SCOPE, { attempt: b, error: 'b failed' });
  // A resolves late as a no-op; it is not the latest attempt, so it is dropped.
  await recordProviderRefreshNoop('scores', SCOPE, { attempt: a });
  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.lastAttemptId, 'B');
  assert.equal(s.latestAttemptOutcome, 'failed', "B's failure outcome stands");
  assert.equal(s.lastError?.message, 'b failed');
});

// ---------------------------------------------------------------------------
// Rereview finding #3 — success metadata is ordered by durable COMMIT time,
// not by when the status helper happens to run.
// ---------------------------------------------------------------------------

test('a stalled older commit recording success LATE does not overwrite the newer commit', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B', startedAt: 't2' });
  // A committed FIRST (earlier commit time) but stalled in post-commit work.
  // B committed SECOND (later commit time) and records success first.
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: b,
    committedAt: '2026-07-12T00:00:02.000Z',
    source: 'cfbd',
    rowsCommitted: 200,
  });
  // A finally records — later in wall-clock, but its commit was EARLIER.
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    committedAt: '2026-07-12T00:00:01.000Z',
    source: 'cfbd',
    rowsCommitted: 100,
  });

  const s = await getProviderRefreshStatus('scores', SCOPE);
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
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B' });
  const seqA = nextProviderCommitSeq();
  const seqB = nextProviderCommitSeq(); // seqB > seqA → B is the newer commit
  // Newer (B) records FIRST, then older (A) records late — A must not overwrite B.
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: b,
    committedAt: ts,
    commitSeq: seqB,
    source: 'cfbd',
    rowsCommitted: 200,
  });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    committedAt: ts,
    commitSeq: seqA,
    source: 'cfbd',
    rowsCommitted: 100,
  });
  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(s.rowsCommitted, 200, 'higher-seq commit wins the same-ms tie');
});

test('same-millisecond commits: the higher commit sequence wins even when it records last', async () => {
  const ts = '2026-07-12T00:00:06.000Z';
  const a = await beginProviderRefreshAttempt('odds', SCOPE, { attemptId: 'A' });
  const b = await beginProviderRefreshAttempt('odds', SCOPE, { attemptId: 'B' });
  const seqA = nextProviderCommitSeq();
  const seqB = nextProviderCommitSeq();
  // Older (A) records FIRST, then newer (B) records — B must still win the tie.
  await recordProviderRefreshSuccess('odds', SCOPE, {
    attempt: a,
    committedAt: ts,
    commitSeq: seqA,
    source: 'odds-api',
    rowsCommitted: 10,
  });
  await recordProviderRefreshSuccess('odds', SCOPE, {
    attempt: b,
    committedAt: ts,
    commitSeq: seqB,
    source: 'odds-api',
    rowsCommitted: 20,
  });
  const s = await getProviderRefreshStatus('odds', SCOPE);
  assert.equal(s.rowsCommitted, 20, 'higher-seq commit wins even when it records last');
});

// Second-rereview finding #5 — attempt IDs are process-independent (UUIDs), so two
// instances beginning in the same millisecond cannot collide.
test('attempt IDs are unique across rapid begins and are not a timestamp-counter token', async () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    const attempt = await beginProviderRefreshAttempt('scores', SCOPE, {});
    ids.add(attempt.attemptId);
  }
  assert.equal(ids.size, 50, 'no attempt-ID collisions across rapid begins');
  assert.match([...ids][0], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i, 'IDs are UUIDs');
});

test('inverse ordering: a later commit recording success still advances last-success', async () => {
  const a = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'A', startedAt: 't1' });
  const b = await beginProviderRefreshAttempt('scores', SCOPE, { attemptId: 'B', startedAt: 't2' });
  // B commits first (earlier commit time) and records; A commits later.
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: b,
    committedAt: '2026-07-12T00:00:01.000Z',
    source: 'cfbd',
    rowsCommitted: 50,
  });
  await recordProviderRefreshSuccess('scores', SCOPE, {
    attempt: a,
    committedAt: '2026-07-12T00:00:03.000Z',
    source: 'cfbd',
    rowsCommitted: 75,
  });

  const s = await getProviderRefreshStatus('scores', SCOPE);
  assert.equal(
    s.lastSuccessAt,
    '2026-07-12T00:00:03.000Z',
    'the newer commit advances last-success'
  );
  assert.equal(s.rowsCommitted, 75);
});

// ---------------------------------------------------------------------------
// PLATFORM-086A-SCOPED — target-scope storage isolation.
// A refresh for one target must never establish success/freshness for another.
// ---------------------------------------------------------------------------

test('a record is self-describing (persists its scope + scopeKey)', async () => {
  const a = await beginProviderRefreshAttempt('schedule', yearScope(2026), { attemptId: 'A' });
  await recordProviderRefreshSuccess('schedule', yearScope(2026), {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 3,
  });
  const s = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.deepEqual(s.scope, { kind: 'year', year: 2026 });
  assert.equal(s.scopeKey, 'schedule:year:2026');
});

test('cross-year isolation: 2025 schedule success and 2026 schedule failure are independent', async () => {
  const a25 = await beginProviderRefreshAttempt('schedule', yearScope(2025), { attemptId: 'A25' });
  await recordProviderRefreshSuccess('schedule', yearScope(2025), {
    attempt: a25,
    source: 'cfbd',
    rowsCommitted: 120,
  });
  const a26 = await beginProviderRefreshAttempt('schedule', yearScope(2026), { attemptId: 'A26' });
  await recordProviderRefreshFailure('schedule', yearScope(2026), {
    attempt: a26,
    error: 'upstream 502',
    status: 502,
  });

  const s25 = await getProviderRefreshStatus('schedule', yearScope(2025));
  const s26 = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.equal(s25.latestAttemptOutcome, 'succeeded', '2025 stays successful');
  assert.ok(s25.lastSuccessAt);
  assert.equal(s25.lastError, null, "2026's failure never touched 2025");
  assert.equal(s26.latestAttemptOutcome, 'failed', '2026 failed independently');
  assert.equal(s26.lastSuccessAt, null, "2026 never inherited 2025's success");
  assert.equal(s26.lastError?.status, 502);
});

test('cross-partition isolation: 2026 regular scores success and postseason failure are independent', async () => {
  const reg = seasonPartitionScope(2026, 'regular');
  const post = seasonPartitionScope(2026, 'postseason');
  const a = await beginProviderRefreshAttempt('scores', reg, { attemptId: 'REG' });
  await recordProviderRefreshSuccess('scores', reg, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 60,
  });
  const b = await beginProviderRefreshAttempt('scores', post, { attemptId: 'POST' });
  await recordProviderRefreshFailure('scores', post, {
    attempt: b,
    error: 'no bowls yet',
    status: 502,
  });

  const sReg = await getProviderRefreshStatus('scores', reg);
  const sPost = await getProviderRefreshStatus('scores', post);
  assert.equal(sReg.latestAttemptOutcome, 'succeeded');
  assert.equal(sReg.rowsCommitted, 60);
  assert.equal(sReg.lastError, null, 'postseason failure never touched regular');
  assert.equal(sPost.latestAttemptOutcome, 'failed');
  assert.equal(sPost.lastSuccessAt, null);
});

test('a partition success does not populate a sibling week partition', async () => {
  const w1 = weekPartitionScope(2026, 1, 'regular');
  const w2 = weekPartitionScope(2026, 2, 'regular');
  const a = await beginProviderRefreshAttempt('game-stats', w1, { attemptId: 'W1' });
  await recordProviderRefreshSuccess('game-stats', w1, {
    attempt: a,
    source: 'cfbd',
    rowsCommitted: 8,
  });

  const s2 = await getProviderRefreshStatus('game-stats', w2);
  assert.equal(s2.lastSuccessAt, null, 'week 2 has no success from week 1');
  assert.equal(s2.latestAttemptOutcome, null, 'week 2 has no attempt history');
});

test('a late completion for one scope cannot overwrite another scope', async () => {
  // Two independent targets, each with its own attempt. Resolving one late must
  // land on ONLY its own record.
  const a25 = await beginProviderRefreshAttempt('schedule', yearScope(2025), { attemptId: 'A25' });
  const a26 = await beginProviderRefreshAttempt('schedule', yearScope(2026), { attemptId: 'A26' });
  await recordProviderRefreshSuccess('schedule', yearScope(2026), {
    attempt: a26,
    source: 'cfbd',
    rowsCommitted: 200,
  });
  // A25 resolves late as a failure — it must land on the 2025 record only.
  await recordProviderRefreshFailure('schedule', yearScope(2025), { attempt: a25, error: 'boom' });

  const s26 = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.equal(s26.latestAttemptOutcome, 'succeeded', "2026 untouched by 2025's late failure");
  assert.equal(s26.lastError, null);
  const s25 = await getProviderRefreshStatus('schedule', yearScope(2025));
  assert.equal(s25.latestAttemptOutcome, 'failed');
});

// ---------------------------------------------------------------------------
// PLATFORM-086A-SCOPED — legacy unscoped records.
// A pre-scoped record keyed only by dataset must not be selected-year truth.
// ---------------------------------------------------------------------------

test('a legacy dataset-only record is NOT read as a scoped year status', async () => {
  // Seed a legacy record under the bare dataset key (the pre-scoped shape).
  await setAppState(PROVIDER_REFRESH_STATUS_SCOPE, 'schedule', {
    dataset: 'schedule',
    lastAttemptAt: '2025-01-01T00:00:00.000Z',
    lastAttemptId: 'legacy',
    latestAttemptOutcome: 'succeeded',
    latestAttemptResolvedAt: '2025-01-01T00:00:00.000Z',
    lastSuccessAt: '2025-01-01T00:00:00.000Z',
    lastError: null,
    source: 'cfbd',
    rowsCommitted: 999,
    partialFailure: false,
  });

  // The selected-year (2025) scoped read must NOT see the legacy success.
  const scoped = await getProviderRefreshStatus('schedule', yearScope(2025));
  assert.equal(scoped.lastSuccessAt, null, 'legacy success is not year-2025 truth');
  assert.equal(scoped.latestAttemptOutcome, null);
  assert.equal(scoped.rowsCommitted, null);

  // But it remains readable via the explicit legacy accessor for deep diagnostics.
  const legacy = await getLegacyProviderRefreshStatus('schedule');
  assert.equal(legacy.lastSuccessAt, '2025-01-01T00:00:00.000Z', 'legacy record is not discarded');
  assert.equal(legacy.rowsCommitted, 999);
  assert.deepEqual(legacy.scope, { kind: 'legacy-unscoped' });
});

// ---------------------------------------------------------------------------
// PLATFORM-086A-SCOPED review remediation (finding 4) — a completion token may
// resolve ONLY the exact dataset + scope it was begun for.
// ---------------------------------------------------------------------------

test('a success token from scope A cannot advance scope B (and A stays in-progress)', async () => {
  const tokenFor2025 = await beginProviderRefreshAttempt('schedule', yearScope(2025), {
    attemptId: 'A25',
  });
  // Misroute the completion: resolve 2026 with 2025's token.
  await recordProviderRefreshSuccess('schedule', yearScope(2026), {
    attempt: tokenFor2025,
    source: 'cfbd',
    rowsCommitted: 999,
  });

  const s26 = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.equal(s26.lastSuccessAt, null, '2026 never received the misrouted success');
  assert.equal(s26.rowsCommitted, null, '2026 rows not advanced by a foreign token');
  assert.equal(s26.latestAttemptOutcome, null, '2026 has no attempt at all');

  const s25 = await getProviderRefreshStatus('schedule', yearScope(2025));
  assert.equal(s25.latestAttemptOutcome, 'in-progress', "A's own scope is untouched (still open)");
  assert.equal(s25.lastError, null, 'the helper did not synthesize a failure for A');
});

test('a failure token from one partition cannot mutate a sibling partition', async () => {
  const regularToken = await beginProviderRefreshAttempt(
    'scores',
    seasonPartitionScope(2026, 'regular'),
    {
      attemptId: 'REG',
    }
  );
  await recordProviderRefreshFailure('scores', seasonPartitionScope(2026, 'postseason'), {
    attempt: regularToken,
    error: 'misrouted boom',
    status: 500,
  });
  const post = await getProviderRefreshStatus('scores', seasonPartitionScope(2026, 'postseason'));
  assert.equal(post.lastError, null, 'postseason not mutated by regular token');
  assert.equal(post.latestAttemptOutcome, null);
  const reg = await getProviderRefreshStatus('scores', seasonPartitionScope(2026, 'regular'));
  assert.equal(reg.latestAttemptOutcome, 'in-progress', 'regular remains its own open attempt');
});

test('a token from one dataset cannot resolve another dataset', async () => {
  const scoresToken = await beginProviderRefreshAttempt('scores', yearScope(2026), {
    attemptId: 'SC',
  });
  await recordProviderRefreshSuccess('schedule', yearScope(2026), {
    attempt: scoresToken,
    source: 'cfbd',
    rowsCommitted: 5,
  });
  const schedule = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.equal(schedule.lastSuccessAt, null, 'schedule not mutated by a scores token');
  assert.equal(schedule.latestAttemptOutcome, null);
});

test('a misrouted no-op token mutates nothing and does not throw', async () => {
  const tokenA = await beginProviderRefreshAttempt(
    'scores',
    weekPartitionScope(2026, 1, 'regular'),
    {
      attemptId: 'W1',
    }
  );
  // Resolve a different week with W1's token — must be a no-op on both.
  await recordProviderRefreshNoop('scores', weekPartitionScope(2026, 2, 'regular'), {
    attempt: tokenA,
  });
  const w2 = await getProviderRefreshStatus('scores', weekPartitionScope(2026, 2, 'regular'));
  assert.equal(w2.latestAttemptOutcome, null, 'week 2 untouched');
  const w1 = await getProviderRefreshStatus('scores', weekPartitionScope(2026, 1, 'regular'));
  assert.equal(w1.latestAttemptOutcome, 'in-progress', 'week 1 still open');
});

test('a matching token still resolves normally (rejection does not break the happy path)', async () => {
  const token = await beginProviderRefreshAttempt('schedule', yearScope(2026), { attemptId: 'OK' });
  await recordProviderRefreshSuccess('schedule', yearScope(2026), {
    attempt: token,
    source: 'cfbd',
    rowsCommitted: 3,
  });
  const s = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.equal(s.latestAttemptOutcome, 'succeeded');
  assert.equal(s.rowsCommitted, 3);
});

test('a stored record whose scopeKey disagrees with its key is ignored (treated as absent)', async () => {
  // Corrupt/mislabeled: stored under schedule:year:2026 but self-describes a
  // different scopeKey. It must not be presented as authoritative.
  await setAppState(PROVIDER_REFRESH_STATUS_SCOPE, 'schedule:year:2026', {
    dataset: 'schedule',
    scope: { kind: 'year', year: 2099 },
    scopeKey: 'schedule:year:2099',
    lastAttemptAt: '2099-01-01T00:00:00.000Z',
    lastAttemptId: 'x',
    latestAttemptOutcome: 'succeeded',
    latestAttemptResolvedAt: '2099-01-01T00:00:00.000Z',
    lastSuccessAt: '2099-01-01T00:00:00.000Z',
    lastError: null,
    source: 'cfbd',
    rowsCommitted: 5,
    partialFailure: false,
  });
  const s = await getProviderRefreshStatus('schedule', yearScope(2026));
  assert.equal(s.lastSuccessAt, null, 'mismatched record is not authoritative');
  assert.equal(s.scopeKey, 'schedule:year:2026', 'the requested identity is authoritative');
});
