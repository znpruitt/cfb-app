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
  __resetGameStatsProvenanceForTests,
  type GameStatsRefreshAttempt,
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

// === Terminal attempt-handle ownership (PLATFORM-086H3B-STATUS-ATTEMPT-OWNERSHIP) ===

// Bypass the compile-time `attempt` requirement to exercise the RUNTIME guard.
const noSuccessHandle = (r: Omit<Parameters<typeof recordGameStatsRefreshSuccess>[1], 'attempt'>) =>
  r as unknown as Parameters<typeof recordGameStatsRefreshSuccess>[1];
const noNoopHandle = (r: Omit<Parameters<typeof recordGameStatsRefreshNoop>[1], 'attempt'>) =>
  r as unknown as Parameters<typeof recordGameStatsRefreshNoop>[1];
const noFailureHandle = (r: Omit<Parameters<typeof recordGameStatsRefreshFailure>[1], 'attempt'>) =>
  r as unknown as Parameters<typeof recordGameStatsRefreshFailure>[1];

test('tokenless terminal mutations (success/no-op/failure/partial) refuse and mutate nothing', async () => {
  // Seed a newer in-progress attempt so any overwrite would be visible.
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  await recordGameStatsRefreshFailure(SCOPE, { attempt: a, error: 'seed' });
  await beginGameStatsRefreshAttempt(SCOPE); // newer attempt, in-progress
  const before = await read();
  assert.equal(before.latestAttemptOutcome, 'in-progress');

  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, noSuccessHandle({ commitStamp: stamp('L', 5) })),
    'game-stats-refresh-attempt-required'
  );
  assert.equal(
    await recordGameStatsRefreshSuccess(
      SCOPE,
      noSuccessHandle({ commitStamp: stamp('L', 5), partialFailure: true }) // partial success
    ),
    'game-stats-refresh-attempt-required'
  );
  assert.equal(
    await recordGameStatsRefreshNoop(SCOPE, noNoopHandle({})),
    'game-stats-refresh-attempt-required'
  );
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, noFailureHandle({ error: 'boom' })),
    'game-stats-refresh-attempt-required'
  );

  assert.deepEqual(await read(), before); // nothing mutated by any tokenless terminal
});

test('a tokenless terminal never counts as the latest attempt merely for lacking a handle', async () => {
  // No prior attempt at all: the record is absent. A tokenless terminal must still
  // refuse (not silently initialize / own the chronology).
  assert.equal(
    await recordGameStatsRefreshNoop(SCOPE, noNoopHandle({})),
    'game-stats-refresh-attempt-required'
  );
  assert.equal((await read()).latestAttemptOutcome, null); // untouched, still absent
});

test('ownership requires BOTH a matching token AND ordinal', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE); // stored latest: ord 1, token a
  // Correct ordinal AND token → owns.
  assert.equal(await recordGameStatsRefreshNoop(SCOPE, { attempt: a }), 'persisted');
  assert.equal((await read()).latestAttemptOutcome, 'no-op');

  // Correct ordinal, WRONG token → does not own.
  const wrongToken: GameStatsRefreshAttempt = { ...a, attemptId: `${a.attemptId}-x` };
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: wrongToken, error: 'x' }),
    'skipped-older'
  );
  assert.equal((await read()).latestAttemptOutcome, 'no-op'); // unchanged

  // Correct token, UNKNOWN FUTURE ordinal → does not own (both must match).
  const futureOrdinal: GameStatsRefreshAttempt = { ...a, ordinal: a.ordinal + 50 };
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: futureOrdinal, error: 'x' }),
    'skipped-older'
  );
  assert.equal((await read()).latestAttemptOutcome, 'no-op'); // unchanged
});

test('a stale attempt (older ordinal, valid old token) cannot overwrite newer diagnostics', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE); // ord 1
  const b = await beginGameStatsRefreshAttempt(SCOPE); // ord 2 supersedes a
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: a, error: 'late' }),
    'skipped-older'
  );
  const after = await read();
  assert.equal(after.lastAttemptId, b.attemptId); // b still latest
  assert.equal(after.latestAttemptOutcome, 'in-progress'); // b's outcome unchanged
  assert.equal(after.lastError, null); // stale failure not recorded
});

test('a structurally invalid or misrouted handle is refused as malformed (no mutation)', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE);
  const before = await read();
  const invalid: GameStatsRefreshAttempt[] = [
    { ...a, attemptId: '' }, // empty token
    { ...a, ordinal: 0 }, // zero ordinal
    { ...a, ordinal: -1 }, // negative ordinal
    { ...a, ordinal: 1.5 }, // fractional ordinal
    { ...a, ordinal: Number.MAX_SAFE_INTEGER + 1 }, // unsafe ordinal
    { ...a, startedAt: '' }, // empty start timestamp
    {
      ...a,
      scopeKey: providerRefreshScopeKey('game-stats', weekPartitionScope(2024, 7, 'regular')),
    }, // scope mismatch
  ];
  for (const handle of invalid) {
    assert.equal(
      await recordGameStatsRefreshFailure(SCOPE, { attempt: handle, error: 'x' }),
      'game-stats-refresh-attempt-malformed',
      JSON.stringify(handle)
    );
  }
  assert.deepEqual(await read(), before); // no malformed handle mutated anything
});

test('concurrency regression: a tokenless terminal cannot disturb a newer in-progress attempt', async () => {
  await beginGameStatsRefreshAttempt(SCOPE); // attempt A
  const b = await beginGameStatsRefreshAttempt(SCOPE); // newer attempt B, in-progress
  const before = await read();
  assert.equal(before.lastAttemptId, b.attemptId);
  assert.equal(before.latestAttemptOutcome, 'in-progress');

  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, noFailureHandle({ error: 'ghost' })),
    'game-stats-refresh-attempt-required'
  );
  assert.equal(
    await recordGameStatsRefreshNoop(SCOPE, noNoopHandle({})),
    'game-stats-refresh-attempt-required'
  );

  const after = await read();
  assert.equal(after.lastAttemptId, b.attemptId); // B remains latest
  assert.equal(after.latestAttemptOutcome, 'in-progress'); // B's outcome unchanged
  assert.equal(after.lastError, null); // no ghost error recorded
  assert.deepEqual(after, before); // committed evidence unchanged
});

// === Failed-begin exception (explicit handle only) ===

test('the failed-begin exception is honored only through its explicit handle', async () => {
  const persisted = await beginGameStatsRefreshAttempt(SCOPE); // ord 1, persisted
  assert.equal(persisted.persistence, 'persisted');

  // A begin whose durable write fails returns a bounded failed-begin handle (ord 2).
  __setAppStateFileCommitFailureForTests(new Error('commit down'));
  const failedBegin = await beginGameStatsRefreshAttempt(SCOPE);
  __setAppStateFileCommitFailureForTests(null);
  assert.equal(failedBegin.persistence, 'failed');
  assert.equal(failedBegin.ordinal, 2);

  // (a) the failed-begin handle may record its bounded failure (ordinal > stored 1).
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: failedBegin, error: 'bounded' }),
    'persisted'
  );
  const afterFailed = await read();
  assert.equal(afterFailed.latestAttemptOutcome, 'failed');
  assert.equal(afterFailed.lastAttemptOrdinal, 2);

  // (b) a MISSING handle cannot impersonate a failed begin.
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, noFailureHandle({ error: 'ghost' })),
    'game-stats-refresh-attempt-required'
  );

  // (c) a failed-begin handle cannot overwrite a LATER successfully persisted attempt.
  // Its one-shot provenance was consumed in (a), so once a later begin supersedes it
  // the handle is no longer authentic — refused nonmutatingly, never overwriting.
  const later = await beginGameStatsRefreshAttempt(SCOPE); // ord 3, persisted, in-progress
  assert.equal(later.ordinal, 3);
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: failedBegin, error: 'late' }),
    'game-stats-failed-begin-handle-invalid'
  );
  assert.equal((await read()).latestAttemptOutcome, 'in-progress'); // later still latest
  assert.equal((await read()).lastAttemptId, later.attemptId);
});

// === Stored-ordinal state machine (absent / valid / malformed / exhausted) ===

test('stored-ordinal validity: absent→1, zero/negative/fractional/unsafe/non-number→malformed, MAX→exhausted', async () => {
  const seed = (lastAttemptOrdinal: unknown) =>
    setAppState('provider-refresh-status', SCOPE_KEY, {
      dataset: 'game-stats',
      scope: SCOPE,
      scopeKey: SCOPE_KEY,
      lastAttemptOrdinal,
    });
  const storedOrdinal = async () =>
    (
      (await getAppState('provider-refresh-status', SCOPE_KEY))?.value as {
        lastAttemptOrdinal: unknown;
      }
    ).lastAttemptOrdinal;

  // Absent ordinal (fresh scope) → genuine first attempt, ordinal 1.
  assert.equal((await beginGameStatsRefreshAttempt(SCOPE)).ordinal, 1);

  const cases: Array<[unknown, string]> = [
    [0, 'refresh-attempt-ordinal-malformed'], // zero is malformed history, NOT absence
    [-3, 'refresh-attempt-ordinal-malformed'],
    [1.5, 'refresh-attempt-ordinal-malformed'],
    [Number.MAX_SAFE_INTEGER + 1, 'refresh-attempt-ordinal-malformed'], // unsafe
    ['7', 'refresh-attempt-ordinal-malformed'], // non-number
    [null, 'refresh-attempt-ordinal-malformed'], // non-number
    [Number.MAX_SAFE_INTEGER, 'refresh-attempt-ordinal-exhausted'], // valid but exhausted
  ];
  for (const [value, expected] of cases) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await seed(value);
    assert.equal(
      (await beginGameStatsRefreshAttempt(SCOPE)).persistence,
      expected,
      `persistence for ${String(value)}`
    );
    assert.deepEqual(await storedOrdinal(), value, `durable state unchanged for ${String(value)}`);
  }
});

test('a malformed stored ordinal remains a refusal across a simulated process restart', async () => {
  await setAppState('provider-refresh-status', SCOPE_KEY, {
    dataset: 'game-stats',
    scope: SCOPE,
    scopeKey: SCOPE_KEY,
    lastAttemptOrdinal: 0, // malformed
  });
  // Simulate a fresh process: drop in-memory init state but KEEP the durable record.
  __resetAppStateForTests();
  assert.equal(
    (await beginGameStatsRefreshAttempt(SCOPE)).persistence,
    'refresh-attempt-ordinal-malformed'
  );
  const stored = (await getAppState('provider-refresh-status', SCOPE_KEY))?.value as {
    lastAttemptOrdinal: number;
  };
  assert.equal(stored.lastAttemptOrdinal, 0); // still malformed — never restarted at 1
});

// ===========================================================================
// PLATFORM-086H3B-FAILED-BEGIN-PROVENANCE — the failed-begin exception is
// authorized ONLY by the EXACT runtime-issued handle (a module-private WeakMap),
// never by structural fields; it authorizes the FAILURE terminal only; it is
// one-shot with a bounded retry; a later persisted attempt supersedes it; and a
// process restart (provenance reset) invalidates a nonpersisted handle.
// ===========================================================================

// Obtain a GENUINE failed-begin handle: begin whose own durable write fails.
async function failedBeginHandle(): Promise<GameStatsRefreshAttempt> {
  __setAppStateFileCommitFailureForTests(new Error('begin commit down'));
  const handle = await beginGameStatsRefreshAttempt(SCOPE);
  __setAppStateFileCommitFailureForTests(null);
  assert.equal(handle.persistence, 'failed');
  return handle;
}

test('a FABRICATED failed-begin handle cannot use the exception (failure/no-op/success refuse, mutate nothing)', async () => {
  const real = await beginGameStatsRefreshAttempt(SCOPE); // durable ordinal N = 1
  await recordGameStatsRefreshFailure(SCOPE, { attempt: real, error: 'seed' });
  const before = await read();
  const fabricated: GameStatsRefreshAttempt = {
    attemptId: 'fabricated-token',
    ordinal: 2, // N + 1
    startedAt: '2024-10-07T00:00:00.000Z',
    scopeKey: SCOPE_KEY,
    persistence: 'failed',
  };
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: fabricated, error: 'x' }),
    'game-stats-failed-begin-handle-invalid'
  );
  assert.equal(
    await recordGameStatsRefreshNoop(SCOPE, { attempt: fabricated }),
    'game-stats-failed-begin-terminal-not-allowed'
  );
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, { attempt: fabricated, commitStamp: stamp('L', 1) }),
    'game-stats-failed-begin-terminal-not-allowed'
  );
  const after = await read();
  assert.equal(after.latestAttemptOutcome, before.latestAttemptOutcome); // unchanged
  assert.deepEqual(after.lastError, before.lastError); // unchanged
  assert.equal(after.lastCommittedStamp, before.lastCommittedStamp); // never advanced
});

test('copied / serialized / reconstructed / mutated failed-begin handles have no exception authority', async () => {
  await beginGameStatsRefreshAttempt(SCOPE); // durable ordinal 1
  const authentic = await failedBeginHandle(); // ordinal 2, authentic, registered
  const before = await read();

  const spread = { ...authentic };
  const json = JSON.parse(JSON.stringify(authentic)) as GameStatsRefreshAttempt;
  const reconstructed: GameStatsRefreshAttempt = {
    attemptId: authentic.attemptId,
    ordinal: authentic.ordinal,
    startedAt: authentic.startedAt,
    scopeKey: authentic.scopeKey,
    persistence: 'failed',
  };
  for (const copy of [spread, json, reconstructed]) {
    assert.equal(
      await recordGameStatsRefreshFailure(SCOPE, { attempt: copy, error: 'x' }),
      'game-stats-failed-begin-handle-invalid'
    );
  }

  // FRESH authentic handles with a single mutated field lose authority (field
  // disagreement with the immutable snapshot); a mutated scope is caught earlier.
  const mutatedToken = await failedBeginHandle();
  mutatedToken.attemptId = `${mutatedToken.attemptId}-x`;
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: mutatedToken, error: 'x' }),
    'game-stats-failed-begin-handle-invalid'
  );
  const mutatedOrdinal = await failedBeginHandle();
  mutatedOrdinal.ordinal = mutatedOrdinal.ordinal + 40;
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: mutatedOrdinal, error: 'x' }),
    'game-stats-failed-begin-handle-invalid'
  );
  const mutatedScope = await failedBeginHandle();
  mutatedScope.scopeKey = `${mutatedScope.scopeKey}::tampered`;
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: mutatedScope, error: 'x' }),
    'game-stats-refresh-attempt-malformed'
  );
  assert.deepEqual(await read(), before); // nothing mutated by any inauthentic handle

  // The EXACT authentic object still carries authority (positive control).
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: authentic, error: 'real' }),
    'persisted'
  );
  assert.equal((await read()).latestAttemptOutcome, 'failed');
});

test('an AUTHENTIC failed-begin handle authorizes ONLY failure (never success / no-op / committed evidence)', async () => {
  await beginGameStatsRefreshAttempt(SCOPE); // durable ordinal 1
  const authentic = await failedBeginHandle(); // ordinal 2
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, { attempt: authentic, commitStamp: stamp('L', 1) }),
    'game-stats-failed-begin-terminal-not-allowed'
  );
  assert.equal((await read()).lastCommittedStamp, undefined); // never advanced
  assert.equal(
    await recordGameStatsRefreshNoop(SCOPE, { attempt: authentic }),
    'game-stats-failed-begin-terminal-not-allowed'
  );
  // Failure remains allowed — the success/no-op refusals did not consume the handle.
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: authentic, error: 'boom' }),
    'persisted'
  );
  assert.equal((await read()).latestAttemptOutcome, 'failed');
});

test('a later persisted attempt supersedes an authentic failed-begin handle (never overwrites)', async () => {
  await beginGameStatsRefreshAttempt(SCOPE); // durable ordinal 1
  const failed = await failedBeginHandle(); // authentic, ordinal 2, NOT yet recorded
  const b1 = await beginGameStatsRefreshAttempt(SCOPE); // persists ordinal 2
  assert.equal(b1.ordinal, 2);
  // Its ordinal no longer strictly exceeds the stored ordinal → stale, never wins.
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: failed, error: 'late' }),
    'skipped-older'
  );
  assert.equal((await read()).latestAttemptOutcome, 'in-progress'); // b1 unchanged
  assert.equal((await read()).lastAttemptId, b1.attemptId);
  // A further begin — the stale handle stays nonmutating.
  await beginGameStatsRefreshAttempt(SCOPE); // ordinal 3
  const beforeStale = await read();
  const res = await recordGameStatsRefreshFailure(SCOPE, { attempt: failed, error: 'late2' });
  assert.ok(res === 'skipped-older' || res === 'game-stats-failed-begin-handle-invalid', res);
  assert.deepEqual(await read(), beforeStale); // no chronology field changed
});

test('failed-begin is retry-eligible after an UNCONFIRMED terminal write, then consumed one-shot', async () => {
  await beginGameStatsRefreshAttempt(SCOPE); // durable ordinal 1
  const authentic = await failedBeginHandle(); // ordinal 2
  // Terminal write itself fails → 'failed', no durable mutation → retry eligible.
  __setAppStateFileCommitFailureForTests(new Error('terminal write down'));
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: authentic, error: 'x' }),
    'failed'
  );
  __setAppStateFileCommitFailureForTests(null);
  // Retry succeeds (no later attempt persisted).
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: authentic, error: 'x' }),
    'persisted'
  );
  assert.equal((await read()).latestAttemptOutcome, 'failed');
  // One-shot: provenance consumed after confirmed success — a third invocation
  // writes nothing (a failed-begin handle never owns normally).
  const before = await read();
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: authentic, error: 'again' }),
    'game-stats-failed-begin-handle-invalid'
  );
  assert.deepEqual(await read(), before);
});

test('a process restart (provenance reset) invalidates a nonpersisted failed-begin handle', async () => {
  await beginGameStatsRefreshAttempt(SCOPE); // durable ordinal 1
  const authentic = await failedBeginHandle(); // ordinal 2
  __resetGameStatsProvenanceForTests(); // simulate a process restart — in-memory provenance gone
  const before = await read();
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: authentic, error: 'x' }),
    'game-stats-failed-begin-handle-invalid'
  );
  assert.deepEqual(await read(), before); // durable status survives the "restart"; handle does not
});

test('normally persisted handles remain authorized after a provenance reset (durable ownership)', async () => {
  const a = await beginGameStatsRefreshAttempt(SCOPE); // ordinal 1, persisted → owns durably
  __resetGameStatsProvenanceForTests(); // failed-begin provenance is irrelevant to normal ownership
  assert.equal(
    await recordGameStatsRefreshFailure(SCOPE, { attempt: a, error: 'boom' }),
    'persisted'
  );
  assert.equal((await read()).latestAttemptOutcome, 'failed');
  // And a normal success still owns after reset.
  const b = await beginGameStatsRefreshAttempt(SCOPE); // ordinal 2
  __resetGameStatsProvenanceForTests();
  assert.equal(
    await recordGameStatsRefreshSuccess(SCOPE, { attempt: b, commitStamp: stamp('L', 1) }),
    'persisted'
  );
  assert.equal((await read()).latestAttemptOutcome, 'succeeded');
});

test('composite publication is never complete for failed-begin refusals', () => {
  for (const code of [
    'game-stats-failed-begin-terminal-not-allowed',
    'game-stats-failed-begin-handle-invalid',
  ] as const) {
    assert.equal(composeGameStatsStatusPublication('persisted', code).complete, false);
    assert.equal(composeGameStatsStatusPublication(code, 'persisted').complete, false);
  }
});
