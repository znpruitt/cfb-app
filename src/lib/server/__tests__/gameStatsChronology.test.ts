import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginGameStatsRefreshAttempt,
  composeGameStatsStatusPublication,
  getProviderRefreshStatus,
  recordGameStatsRefreshFailure,
  recordGameStatsRefreshNoop,
  recordGameStatsRefreshSuccess,
  recordProviderRefreshSuccess,
  beginProviderRefreshAttempt,
} from '../providerRefreshStatus.ts';
import {
  providerRefreshScopeKey,
  weekPartitionScope,
  yearScope,
} from '../../providerRefreshScope.ts';
import type { CommitStamp } from '../../gameStats/revisionStamp.ts';
import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateFileCommitFailureForTests,
  __setAppStateReadFailureForTests,
} from '../appStateStore.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const SCOPE = weekPartitionScope(2024, 6, 'regular');
const SCOPE_KEY = providerRefreshScopeKey('game-stats', SCOPE);
const read = () => getProviderRefreshStatus('game-stats', SCOPE);
const stamp = (lineage: string, revision: number): CommitStamp => ({ lineage, revision });

// === Attempt chronology (ordinal + token) ===

test('begin allocates a monotonic per-scope attempt ordinal and unique token', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  const b = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(a.ordinal, 1);
  assert.equal(b.ordinal, 2);
  assert.notEqual(a.attemptId, b.attemptId);
  assert.equal(a.persistence, 'persisted');
  const status = await read();
  assert.equal(status.lastAttemptOrdinal, 2);
  assert.equal(status.lastAttemptId, b.attemptId);
  assert.equal(status.latestAttemptOutcome, 'in-progress');
});

test('a stale terminal never overwrites a newer attempt diagnostics', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  const b = await beginGameStatsRefreshAttempt(SCOPE); // b supersedes a
  // A's late failure is stale (b is the latest attempt).
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: a, error: 'late' }),
    'skipped-older'
  );
  assert.equal((await read()).latestAttemptOutcome, 'in-progress'); // still b's
  // B's terminal owns.
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, { attempt: b, commitStamp: stamp('L', 1) }),
    'persisted'
  );
  assert.equal((await read()).latestAttemptOutcome, 'succeeded');
});

// === Committed-evidence chronology (commit stamp) ===

test('committed evidence advances only via a valid same-lineage stamp; lower is skipped', async () => {
  const a1 = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, {
      attempt: a1,
      commitStamp: stamp('L', 1),
      source: 'cfbd',
      rowsCommitted: 5,
    }),
    'persisted'
  );
  const a2 = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, {
      attempt: a2,
      commitStamp: stamp('L', 2),
      source: 'cfbd',
      rowsCommitted: 6,
    }),
    'persisted'
  );
  assert.deepEqual((await read()).lastCommittedStamp, stamp('L', 2));

  // A stale attempt carrying a LOWER revision is skipped.
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, { attempt: a1, commitStamp: stamp('L', 1) }),
    'skipped-older'
  );
  assert.deepEqual((await read()).lastCommittedStamp, stamp('L', 2));
});

test('equal revision is idempotent only when committed metadata agrees, else a conflict', async () => {
  const a1 = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshSuccess(SCOPE, {
    attempt: a1,
    commitStamp: stamp('L', 2),
    source: 'cfbd',
    rowsCommitted: 6,
  });
  await beginGameStatsRefreshAttempt(SCOPE); // supersede a1 so it can't own the attempt chronology

  // Equal revision, SAME metadata → idempotent (no change).
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, {
      attempt: a1,
      commitStamp: stamp('L', 2),
      source: 'cfbd',
      rowsCommitted: 6,
    }),
    'idempotent'
  );
  // Equal revision, DIVERGENT metadata → conflict (committed evidence untouched).
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, {
      attempt: a1,
      commitStamp: stamp('L', 2),
      source: 'cfbd',
      rowsCommitted: 99,
    }),
    'conflict'
  );
  assert.deepEqual((await read()).lastCommittedStamp, stamp('L', 2));
});

test('a foreign lineage is a typed conflict (never numerically ordered)', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshSuccess(SCOPE, { attempt: a, commitStamp: stamp('L1', 3) });
  await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, { attempt: a, commitStamp: stamp('L2', 1) }),
    'conflict'
  );
  assert.deepEqual((await read()).lastCommittedStamp, stamp('L1', 3));
});

test('no-op and failure never advance committed evidence', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshSuccess(SCOPE, {
    attempt: a,
    commitStamp: stamp('L', 4),
    source: 'cfbd',
  });
  const b = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(await recordGameStatsRefreshNoop(SCOPE, { attempt: b }), 'persisted');
  assert.deepEqual((await read()).lastCommittedStamp, stamp('L', 4));
  assert.equal((await read()).latestAttemptOutcome, 'no-op');
  const c = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshFailure(SCOPE, { attempt: c, error: 'boom' });
  assert.deepEqual((await read()).lastCommittedStamp, stamp('L', 4)); // preserved
  assert.equal((await read()).latestAttemptOutcome, 'failed');
});

// === Composite publication ===

test('composeGameStatsStatusPublication reports complete only when both halves persisted', () => {
  assert.deepEqual(composeGameStatsStatusPublication('persisted', 'persisted'), {
    begin: 'persisted',
    terminal: 'persisted',
    complete: true,
  });
  assert.equal(composeGameStatsStatusPublication('failed', 'persisted').complete, false);
  assert.equal(composeGameStatsStatusPublication('persisted', 'failed').complete, false);
  assert.equal(composeGameStatsStatusPublication('idempotent', 'idempotent').complete, true);
});

// === Mandatory confirmed commit stamp on success ===

test('success without a confirmed commit stamp is refused and persists nothing', async () => {
  // Seed a prior failure so we can prove the refusal does NOT clear the error or
  // mark the attempt succeeded.
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshFailure(SCOPE, { attempt: a, error: 'earlier failure' });
  const before = await read();

  for (const bad of [
    undefined, // missing
    { lineage: '', revision: 1 }, // malformed lineage
    { lineage: 'L', revision: 0 }, // malformed revision
    { lineage: 'L', revision: Number.MAX_SAFE_INTEGER + 1 }, // unsafe revision
  ]) {
    const res = await recordGameStatsRefreshSuccess(
      SCOPE,
      // Intentionally bypass the compile-time requirement to exercise the runtime guard.
      { attempt: a, commitStamp: bad } as unknown as Parameters<
        typeof recordGameStatsRefreshSuccess
      >[1]
    );
    assert.equal(res, 'game-stats-success-commit-stamp-required', JSON.stringify(bad));
  }

  const after = await read();
  assert.deepEqual(after.lastError, before.lastError); // error NOT cleared
  assert.notEqual(after.lastError, null);
  assert.equal(after.latestAttemptOutcome, 'failed'); // NOT marked succeeded
  assert.equal(after.lastCommittedStamp, undefined); // committed evidence untouched
});

test('the composite publication is never complete when success refused for a missing stamp', () => {
  const pub = composeGameStatsStatusPublication(
    'persisted',
    'game-stats-success-commit-stamp-required'
  );
  assert.equal(pub.complete, false);
});

test('explicit no-op remains the only stamp-free successful terminal path', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(await recordGameStatsRefreshNoop(SCOPE, { attempt: a }), 'persisted');
  assert.equal((await read()).latestAttemptOutcome, 'no-op');
});

// === Attempt-ordinal exhaustion / malformed ===

test('an attempt ordinal at MAX_SAFE_INTEGER refuses (never resets to 1)', async () => {
  await setAppState('provider-refresh-status', SCOPE_KEY, {
    dataset: 'game-stats',
    scope: SCOPE,
    scopeKey: SCOPE_KEY,
    lastAttemptOrdinal: Number.MAX_SAFE_INTEGER,
    latestAttemptOutcome: 'succeeded',
  });
  const attempt = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(attempt.persistence, 'refresh-attempt-ordinal-exhausted');
  // The stored ordinal was NOT reset.
  const stored = (await getAppState('provider-refresh-status', SCOPE_KEY))?.value as {
    lastAttemptOrdinal: number;
  };
  assert.equal(stored.lastAttemptOrdinal, Number.MAX_SAFE_INTEGER);
});

test('a malformed stored ordinal refuses (never silently restarts at 1)', async () => {
  await setAppState('provider-refresh-status', SCOPE_KEY, {
    dataset: 'game-stats',
    scope: SCOPE,
    scopeKey: SCOPE_KEY,
    lastAttemptOrdinal: -7, // present but invalid → revision-era corruption
  });
  const attempt = await beginGameStatsRefreshAttempt(SCOPE);
  assert.equal(attempt.persistence, 'refresh-attempt-ordinal-malformed');
  const stored = (await getAppState('provider-refresh-status', SCOPE_KEY))?.value as {
    lastAttemptOrdinal: number;
  };
  assert.equal(stored.lastAttemptOrdinal, -7); // unchanged — not restarted at 1
});

// === Storage failures ===

test('a read failure skips; a commit failure reports failed — never a false success', async () => {
  __setAppStateReadFailureForTests(new Error('read down'), 'provider-refresh-status');
  assert.equal((await beginGameStatsRefreshAttempt(SCOPE)).persistence, 'skipped');
  __setAppStateReadFailureForTests(null);

  __setAppStateFileCommitFailureForTests(new Error('commit down'));
  assert.equal((await beginGameStatsRefreshAttempt(SCOPE)).persistence, 'failed');
  __setAppStateFileCommitFailureForTests(null);
});

// === Unrelated provider-status datasets are not regressed ===

test('generic (non-game-stats) status writers are unchanged and independent', async () => {
  const scoresScope = yearScope(2024);
  const attempt = await beginProviderRefreshAttempt('scores', scoresScope);
  await recordProviderRefreshSuccess('scores', scoresScope, {
    attempt,
    committedAt: '2024-10-07T00:00:00.000Z',
    source: 'cfbd',
    rowsCommitted: 12,
  });
  const scores = await getProviderRefreshStatus('scores', scoresScope);
  assert.equal(scores.latestAttemptOutcome, 'succeeded');
  assert.equal(scores.rowsCommitted, 12);
  // The generic path never sets the game-stats lineage chronology fields.
  assert.equal(scores.lastCommittedStamp, undefined);
  assert.equal(scores.lastAttemptOrdinal, undefined);

  // A game-stats chronology write on a different scope does not collide.
  const gs = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshSuccess(SCOPE, { attempt: gs, commitStamp: stamp('L', 1) });
  const stillScores = await getProviderRefreshStatus('scores', scoresScope);
  assert.equal(stillScores.rowsCommitted, 12); // untouched
});
