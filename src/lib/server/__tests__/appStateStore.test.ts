import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __corruptAppStateFileForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  APP_STATE_TEST_ISOLATION_POOL_REFUSAL,
  APP_STATE_TEST_SEAM_REFUSAL,
  assertAppStateWritable,
  deleteAppState,
  getAppState,
  getAppStateStorageStatus,
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

test(
  'file fallback: a missing app-state file is genuine absence (null read)',
  { skip: !FILE_MODE },
  async () => {
    await __deleteAppStateFileForTests();
    assert.equal(await getAppState('read-absence', 'missing'), null);
  }
);

test(
  'file fallback: a corrupt app-state file PROPAGATES instead of reading as empty',
  { skip: !FILE_MODE },
  async () => {
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
  }
);

// ---------------------------------------------------------------------------
// PLATFORM-210 — the isolation flag must prevent a real database connection.
//
// It never did. `APP_STATE_TEST_ISOLATION` was read in exactly one place, inside
// `appStateFilePath()`, which only the FILE fallback consults — and a configured
// `DATABASE_URL` is exactly what stops that branch running. So an ambient
// `DATABASE_URL` in the shell running `npm test` put all 5,105 tests on the live
// store. `delete from app_state` is the audible failure; `setAppState` upserting
// fixtures over real rows for a whole run is the common one.
//
// TWO guards, asserted separately, because neither implies the other:
//   1. isolation is ON  -> never construct a real pool
//   2. isolation is OFF -> a destructive test-only seam must not execute at all
// A single assertion covering both would prove neither.
// ---------------------------------------------------------------------------

/** Refused instantly by the kernel, so nothing here can hang on DNS or a socket. */
const UNREACHABLE_DATABASE_URL = 'postgres://user:pw@127.0.0.1:1/nowhere';

async function withEnvironment(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  __resetAppStateForTests();
  try {
    await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    __resetAppStateForTests();
  }
}

test('GUARD 1: under isolation, a configured DATABASE_URL cannot open a real pool', async () => {
  await withEnvironment(
    { APP_STATE_TEST_ISOLATION: '1', DATABASE_URL: UNREACHABLE_DATABASE_URL },
    async () => {
      // `assertAppStateWritable` is the shortest exported path to pool
      // construction: it selects the Postgres branch on `DATABASE_URL` alone and
      // immediately issues DDL through `getPool()`.
      await assert.rejects(
        () => assertAppStateWritable(),
        // The MESSAGE is the assertion. Without the guard this still rejects —
        // with ECONNREFUSED, having opened a connection to whatever DATABASE_URL
        // names — so a bare `assert.rejects` would pass on the defect it exists
        // to catch. Mutation target: delete the guard in `getPool()` and this
        // test goes red while everything else stays green.
        (error: unknown) =>
          error instanceof Error && error.message === APP_STATE_TEST_ISOLATION_POOL_REFUSAL
      );
    }
  );
});

test('GUARD 2: the destructive seam refuses to run outside an isolated test process', async () => {
  // The condition under test is the FLAG, not the URL. Guard 1 is conditioned on
  // isolation being ON, so a bare `node --test src/...` — flag unset — is
  // indistinguishable to it from ordinary application startup, and this helper
  // would transact against whatever DATABASE_URL names. The condition here is the
  // inverse one, which is why the two assertions are independent rather than one
  // restated.
  //
  // DATABASE_URL IS PINNED TO AN UNREACHABLE HOST, and that is not incidental. A
  // test is safe only while the code it tests is correct: if this guard regresses
  // — or during the mutation the next comment prescribes — the helper RUNS with
  // the flag unset. With an ambient DATABASE_URL that is `delete from app_state`
  // against the live database, the exact environment Item 210 exists for; with no
  // DATABASE_URL, `appStateFilePath()` returns the durable `data/app-state.json`
  // rather than the pid-keyed temp file, and the helper unlinks the developer's
  // dev store. Pinning costs nothing and removes data loss from the failure mode.
  // (Round 1 finding. When it was measured, the mutation had already been run —
  // no store existed in that worktree, so nothing was lost. That is luck.)
  //
  // Mutation target: delete the guard and this rejects with ECONNREFUSED instead
  // of the refusal message.
  await withEnvironment(
    { APP_STATE_TEST_ISOLATION: undefined, DATABASE_URL: UNREACHABLE_DATABASE_URL },
    async () => {
      await assert.rejects(
        () => __deleteAppStateFileForTests(),
        (error: unknown) => error instanceof Error && error.message === APP_STATE_TEST_SEAM_REFUSAL
      );
    }
  );
});

test('GUARD 2 is not satisfied by a merely truthy flag', async () => {
  // Same pinning, same reason: a regression here must not be able to delete.
  await withEnvironment(
    { APP_STATE_TEST_ISOLATION: 'true', DATABASE_URL: UNREACHABLE_DATABASE_URL },
    async () => {
      await assert.rejects(
        () => __deleteAppStateFileForTests(),
        (error: unknown) => error instanceof Error && error.message === APP_STATE_TEST_SEAM_REFUSAL
      );
    }
  );
});

test('PRODUCTION UNCHANGED: with the flag absent, a configured DATABASE_URL still selects postgres and still connects', async () => {
  await withEnvironment(
    { APP_STATE_TEST_ISOLATION: undefined, DATABASE_URL: UNREACHABLE_DATABASE_URL },
    async () => {
      const status = getAppStateStorageStatus();
      assert.equal(status.mode, 'postgres');
      assert.equal(status.databaseConfigured, true);
      // Not a temp file: the isolation branch of `appStateFilePath()` is unchanged
      // and still unreachable when a database is configured.
      assert.ok(
        status.filePath.endsWith('data/app-state.json'),
        `expected the durable file path, got ${status.filePath}`
      );

      // And the guard does NOT fire: this reaches pool construction and fails for
      // a CONNECTION reason. Asserted POSITIVELY on `ECONNREFUSED` (measured:
      // `connect ECONNREFUSED 127.0.0.1:1`), not as "rejected with something other
      // than the refusal message" — round 1 finding. That negative was satisfied
      // by `APP_STATE_PRODUCTION_CONFIG_ERROR` too, which `assertAppStateWritable`
      // throws when `hasDatabaseConfig()` is false, so a regression that stopped
      // seeing DATABASE_URL at all — never constructing a pool — would have passed
      // this test green while its stated claim was false.
      await assert.rejects(
        () => assertAppStateWritable(),
        (error: unknown) => (error as { code?: string })?.code === 'ECONNREFUSED'
      );
    }
  );
});
