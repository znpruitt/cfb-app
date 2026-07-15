import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __corruptAppStateFileForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  deleteAppState,
  getAppState,
  isReadOnlyTransactionError,
  setAppState,
} from '@/lib/server/appStateStore';

// Regression for the PLATFORM-081b dry-run hotfix: a dry-run inspection against
// a read-only connection (e.g. a production read replica) must tolerate the
// `create table if not exists` bootstrap failing with SQLSTATE 25006
// (read_only_sql_transaction) so reads can still proceed. This isolates the
// exact-code detector that gates that tolerance — it must match ONLY 25006 so
// no genuine failure is ever swallowed.

test('isReadOnlyTransactionError matches SQLSTATE 25006', () => {
  assert.equal(isReadOnlyTransactionError({ code: '25006' }), true);
  assert.equal(
    isReadOnlyTransactionError(
      Object.assign(new Error('cannot execute CREATE TABLE in a read-only transaction'), {
        code: '25006',
      })
    ),
    true
  );
});

test('isReadOnlyTransactionError rejects other errors', () => {
  assert.equal(isReadOnlyTransactionError({ code: '42P01' }), false); // undefined_table
  assert.equal(isReadOnlyTransactionError({ code: 25006 }), false); // numeric, not the pg string code
  assert.equal(isReadOnlyTransactionError(new Error('connection refused')), false);
  assert.equal(isReadOnlyTransactionError(null), false);
  assert.equal(isReadOnlyTransactionError(undefined), false);
  assert.equal(isReadOnlyTransactionError('25006'), false);
});

// ---------------------------------------------------------------------------
// SCOPED-STATUS review v2 #3 — the file fallback must serialize the whole-file
// read-modify-write so concurrent writers touching DIFFERENT keys cannot each
// read the same snapshot and drop one another's update on the final atomic
// rename. These run ONLY in file-fallback mode (no DATABASE_URL); the Postgres
// path relies on the database for concurrency and is never serialized here.
// ---------------------------------------------------------------------------

const FILE_MODE = !process.env.DATABASE_URL?.trim();

test.beforeEach(async () => {
  if (!FILE_MODE) return;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test(
  'concurrent writes to different keys all survive (no lost update)',
  { skip: !FILE_MODE },
  async () => {
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) => setAppState('concurrency', `key-${i}`, { i }))
    );
    for (let i = 0; i < N; i += 1) {
      const rec = await getAppState<{ i: number }>('concurrency', `key-${i}`);
      assert.equal(rec?.value.i, i, `key-${i} must survive concurrent writes`);
    }
  }
);

test(
  'concurrent provider-status writes for different scopes both survive',
  { skip: !FILE_MODE },
  async () => {
    await Promise.all([
      setAppState('provider-refresh-status', 'schedule:year:2025', { outcome: '2025' }),
      setAppState('provider-refresh-status', 'schedule:year:2026', { outcome: '2026' }),
      setAppState('scores', '2026-all-regular', { rows: 3 }),
    ]);
    assert.equal(
      (await getAppState<{ outcome: string }>('provider-refresh-status', 'schedule:year:2025'))
        ?.value.outcome,
      '2025'
    );
    assert.equal(
      (await getAppState<{ outcome: string }>('provider-refresh-status', 'schedule:year:2026'))
        ?.value.outcome,
      '2026'
    );
    assert.equal(
      (await getAppState<{ rows: number }>('scores', '2026-all-regular'))?.value.rows,
      3,
      'an unrelated app-state write is not dropped by concurrent status writes'
    );
  }
);

test(
  'interleaved distinct-key writes and a delete: the final snapshot contains every mutation',
  { skip: !FILE_MODE },
  async () => {
    await Promise.all([setAppState('mix', 'a', 1), setAppState('mix', 'b', 1)]);
    await Promise.all([
      setAppState('mix', 'a', 2),
      setAppState('mix', 'c', 3),
      setAppState('mix', 'd', 4),
      deleteAppState('mix', 'b'),
    ]);
    assert.equal((await getAppState<number>('mix', 'a'))?.value, 2);
    assert.equal(await getAppState('mix', 'b'), null, 'the concurrent delete survived');
    assert.equal((await getAppState<number>('mix', 'c'))?.value, 3);
    assert.equal((await getAppState<number>('mix', 'd'))?.value, 4);
  }
);

test(
  'a failed write releases the lock so subsequent writes still succeed',
  { skip: !FILE_MODE },
  async () => {
    __setAppStateWriteFailureForTests(new Error('disk full'));
    await assert.rejects(() => setAppState('lockrelease', 'x', 1), /disk full/);
    __setAppStateWriteFailureForTests(null);
    // If the mutex stranded on the in-lock failure, these would hang (timeout).
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => setAppState('lockrelease', `y-${i}`, i))
    );
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await getAppState<number>('lockrelease', `y-${i}`))?.value, i);
    }
  }
);

// ---------------------------------------------------------------------------
// PLATFORM-086G2 P2 remediation #3 — file-fallback reads: only a genuinely
// MISSING file is absence; a corrupt/unreadable store propagates instead of
// masquerading as "nothing stored" (which also protected the next RMW write
// from silently rebuilding the store and discarding every other key).
// ---------------------------------------------------------------------------

test('file fallback: a missing app-state file is genuine absence (null read)', async () => {
  await __deleteAppStateFileForTests();
  assert.equal(await getAppState('read-absence', 'missing'), null);
});

test('file fallback: a corrupt app-state file PROPAGATES instead of reading as empty', async () => {
  await __deleteAppStateFileForTests();
  await __corruptAppStateFileForTests();
  try {
    await assert.rejects(
      () => getAppState('read-absence', 'any-key'),
      'a corrupt store must never be indistinguishable from an empty one'
    );
  } finally {
    await __deleteAppStateFileForTests();
  }
});
