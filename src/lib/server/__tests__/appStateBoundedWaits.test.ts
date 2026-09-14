import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool } from 'pg';

import {
  __appStatePoolConfigForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateOpenerTimeoutForTests,
  __setAppStatePoolForTests,
  AppStateKeyLockAcquireError,
  AppStateOpenerTimeoutError,
  getAppState,
  setAppState,
  withAppStateKeyTransaction,
} from '../appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshSuccess,
} from '../providerRefreshStatus.ts';
import { yearScope } from '../../providerRefreshScope.ts';

/**
 * PLATFORM-625 — bounded database waits.
 *
 * `statement_timeout` and `lock_timeout` are delivered as `SET LOCAL` riding along
 * with each `BEGIN`, because production's `DATABASE_URL` is Neon's POOLED endpoint
 * and that is the only mechanism which survives a transaction pooler. The
 * derivation, the three rejected mechanisms, and the production measurements are
 * recorded on the constants in `appStateStore.ts`.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE. That the values actually bound a real
 * PostgreSQL wait was established against production, not here: `pg_sleep(25)`
 * completed in 25,056 ms unbounded and was cancelled at 15,044 ms with `57014`
 * once bounded, advisory-lock contention failed at 10,089 ms with `55P03`, and a
 * starved three-client pool was still waiting at 16,001 ms with no acquisition
 * timeout. A fake pool cannot re-derive any of that — it would only be asserting
 * that the fake implements a timeout. What IS provable in-process, and is what
 * these tests do, is that the bounds are DELIVERED on every path, that the two
 * are ordered so contention stays distinguishable, and that our own code responds
 * to a fired bound attributably rather than dropping it.
 */

type Recorded = { client: number; sql: string; params?: unknown[] };

// PLATFORM-625: a real pg client is an EventEmitter and a CHECKED-OUT one has no
// `'error'` listener of its own, so `appStateStore` attaches one for the client's
// checked-out lifetime. A fake without that surface cannot model the contract —
// and a fake that lacks it is exactly what let the missing listener ship.
class RecordingClient extends EventEmitter {
  constructor(
    private readonly pool: RecordingPool,
    readonly index: number
  ) {
    super();
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.pool.statements.push({ client: this.index, sql, params });
    // Observed WHILE checked out — after release the listener is expected to be gone.
    this.pool.observeClient?.(this);
    if (this.pool.emitErrorOn?.test(sql)) {
      // What `pg` does on any socket-level failure, via `_handleErrorEvent`.
      this.emit('error', new Error('socket reset'));
    }
    const injected = this.pool.takeInjected(sql);
    if (injected) throw injected;
    const normalized = sql.trim().toLowerCase();
    if (normalized.startsWith('select value')) return { rows: this.pool.rows };
    if (normalized.includes('to_regclass')) return { rows: [{ present: true }] };
    return { rows: [] };
  }

  release(error?: Error): void {
    this.pool.releases.push({ index: this.index, destroyed: error !== undefined });
  }
}

class RecordingPool {
  readonly statements: Recorded[] = [];
  /** Every client handed out, so a test can inspect listeners after release. */
  readonly clients: RecordingClient[] = [];
  /** Called with the client on each statement, while it is still checked out. */
  observeClient?: (client: RecordingClient) => void;
  /** Emit a socket-level 'error' on the client when a statement matches. */
  emitErrorOn?: RegExp;
  readonly releases: Array<{ index: number; destroyed: boolean }> = [];
  /** Statements issued through the POOL rather than a checked-out client. */
  readonly poolStatements: string[] = [];
  rows: unknown[] = [];
  connects = 0;
  private readonly injected: Array<{ match: RegExp; error: Error }> = [];

  /** Fail the next statement matching `match`, once. */
  failOnce(match: RegExp, error: Error): void {
    this.injected.push({ match, error });
  }

  takeInjected(sql: string): Error | null {
    const index = this.injected.findIndex((entry) => entry.match.test(sql));
    if (index < 0) return null;
    const [entry] = this.injected.splice(index, 1);
    return entry.error;
  }

  async connect(): Promise<RecordingClient> {
    this.connects += 1;
    const client = new RecordingClient(this, this.connects);
    this.clients.push(client);
    return client;
  }

  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.poolStatements.push(sql);
    return { rows: [{ present: true }] };
  }

  async end(): Promise<void> {}
}

/** A client whose OPENER never settles — the stall `openBoundedTransaction` bounds. */
class StalledOpenerClient extends EventEmitter {
  readonly issued: string[] = [];
  released: { destroyed: boolean } | null = null;

  constructor(private readonly stall: boolean) {
    super();
  }

  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.issued.push(sql);
    if (this.stall && sql.trimStart().toLowerCase().startsWith('begin')) {
      return new Promise(() => {}); // never settles
    }
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    return { rows: [] };
  }

  release(error?: Error): void {
    this.released = { destroyed: error !== undefined };
  }
}

/**
 * Stalls the opener from the `stallFrom`-th client onward. `ensureDatabase`'s schema
 * transaction takes client 1, so letting it through is what puts the stall on the
 * TRANSACTION's own opener — otherwise the DDL stalls first and the rejection never
 * reaches `withAppStateKeyTransaction`'s wrapper at all. (It is still bounded there,
 * which is the second test below.)
 */
class StalledOpenerPool {
  readonly clients: StalledOpenerClient[] = [];
  constructor(private readonly stallFrom: number) {}
  async connect(): Promise<StalledOpenerClient> {
    const client = new StalledOpenerClient(this.clients.length + 1 >= this.stallFrom);
    this.clients.push(client);
    return client;
  }
  async query(): Promise<{ rows: unknown[] }> {
    return { rows: [{ present: true }] };
  }
  async end(): Promise<void> {}
}

async function withFakePg(fn: (pool: RecordingPool) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  const pool = new RecordingPool();
  __setAppStatePoolForTests(pool as unknown as Pool);
  try {
    await fn(pool);
  } finally {
    __setAppStatePoolForTests(null);
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
}

/** Every transaction opener the store issued, verbatim. */
function begins(pool: RecordingPool): string[] {
  return pool.statements
    .map((entry) => entry.sql)
    .filter((sql) => sql.trimStart().toLowerCase().startsWith('begin'));
}

/**
 * Exercise BOTH delivery paths in one run: the advisory-locked transaction and a
 * plain read, which is NOT transactional in the caller's eyes and had to be given
 * a transaction of its own precisely so it could carry the bounds.
 */
async function bothPaths(pool: RecordingPool): Promise<void> {
  await withAppStateKeyTransaction('bounds', 'k', async () => undefined);
  await getAppState('bounds', 'k');
  // `begin` for the schema DDL, one for the transaction, one for the plain read.
  assert.ok(begins(pool).length >= 3, `expected at least 3 BEGINs, saw ${begins(pool).length}`);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === The bounds are delivered, each separately provable ===

test('statement_timeout rides with EVERY begin — the locked transaction and the plain read alike', async () => {
  await withFakePg(async (pool) => {
    await bothPaths(pool);
    for (const begin of begins(pool)) {
      assert.match(
        begin,
        /set local statement_timeout = 15000/,
        `a BEGIN carried no statement_timeout: ${begin}`
      );
    }
  });
});

test('lock_timeout rides with EVERY begin — the locked transaction and the plain read alike', async () => {
  await withFakePg(async (pool) => {
    await bothPaths(pool);
    for (const begin of begins(pool)) {
      assert.match(
        begin,
        /set local lock_timeout = 10000/,
        `a BEGIN carried no lock_timeout: ${begin}`
      );
    }
  });
});

test('lock_timeout is strictly BELOW statement_timeout, so contention stays distinguishable', async () => {
  await withFakePg(async (pool) => {
    await bothPaths(pool);
    for (const begin of begins(pool)) {
      const statement = Number(/statement_timeout = (\d+)/.exec(begin)?.[1]);
      const lock = Number(/lock_timeout = (\d+)/.exec(begin)?.[1]);
      assert.ok(Number.isFinite(statement) && Number.isFinite(lock));
      // If the lock bound were the looser one it would never fire first, and a
      // stuck holder would surface as `57014` — indistinguishable from a slow
      // statement. That ordering IS the reason the two values differ.
      assert.ok(lock < statement, `lock_timeout ${lock} must be below statement ${statement}`);
    }
  });
});

test('a plain read cannot bypass the bounds by using the pool directly', async () => {
  await withFakePg(async (pool) => {
    await getAppState('bounds', 'k');
    // A bare `pool.query` would be unbounded on a transaction pooler: there is no
    // transaction for `SET LOCAL` to attach to. Nothing may take that route.
    assert.deepEqual(pool.poolStatements, []);
    assert.ok(pool.connects > 0, 'the read should have checked out a client');
  });
});

test('connectionTimeoutMillis is configured on the pool, finite, and clears a cold wake', async () => {
  // GUARD 1 refuses to construct a real pool under isolation, so the configuration
  // object is the only observable. This asserts wiring; that pg-pool honours the
  // value for BOTH the connect and the pool-queue wait was measured separately.
  const config = __appStatePoolConfigForTests();
  assert.equal(typeof config.connectionTimeoutMillis, 'number');
  const bound = config.connectionTimeoutMillis as number;
  assert.ok(Number.isFinite(bound) && bound > 0, 'any finite value breaks a permanent wait');
  // The measured cold Neon autosuspend wake is 1,468 ms here and 1,333 ms in
  // `docs/deployment-runbook.md`; a bound near either would fire on ordinary traffic.
  assert.ok(bound >= 10_000, `${bound} ms leaves too little room over a ~1.5 s cold wake`);
});

// === A fired bound is attributable, and the two are told apart ===

test('a statement timeout inside the transaction rolls back and surfaces 57014 to the caller', async () => {
  await withFakePg(async (pool) => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
    pool.failOnce(/select value/, timeout);

    await assert.rejects(
      withAppStateKeyTransaction('bounds', 'k', async (txn) => {
        await txn.read();
      }),
      (error: unknown) => {
        // Attributable: the SQLSTATE reaches the caller rather than being collapsed
        // into a bare "store unavailable".
        assert.equal((error as { code?: string }).code, '57014');
        return true;
      }
    );

    // Scoped to the client that actually took the timeout. `ensureDatabase`'s schema
    // transaction runs on its own client and commits legitimately — asserting over
    // every statement in the pool would read ITS commit and call the aborted
    // transaction committed.
    const failed = pool.statements.find((entry) => /select value/.test(entry.sql))?.client;
    assert.ok(failed !== undefined, 'the read under test never ran');
    const issued = pool.statements
      .filter((entry) => entry.client === failed)
      .map((entry) => entry.sql.trim().toLowerCase());
    assert.ok(issued.includes('rollback'), 'a failed statement must roll the transaction back');
    assert.ok(!issued.includes('commit'), 'an aborted transaction must never commit');
  });
});

test('a lock timeout at acquisition surfaces as AppStateKeyLockAcquireError carrying 55P03', async () => {
  await withFakePg(async (pool) => {
    const contention = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    });
    pool.failOnce(/pg_advisory_xact_lock/, contention);

    await assert.rejects(
      withAppStateKeyTransaction('bounds', 'k', async () => undefined),
      (error: unknown) => {
        // A DIFFERENT typed outcome from the statement-timeout test above, carrying a
        // DIFFERENT SQLSTATE. If both bounds produced the same shape, an operator
        // could not tell a stuck lock holder from a slow query — which is the entire
        // reason `lock_timeout` is set below `statement_timeout`.
        assert.ok(error instanceof AppStateKeyLockAcquireError);
        assert.equal((error.cause as { code?: string }).code, '55P03');
        return true;
      }
    );
  });
});

// === CARRIES: what the RECORDER does with a bound's identity once it has it ===

/**
 * NAMED FOR WHAT IT PROVES, after review caught the earlier name claiming more. This
 * runs on the FILE fallback and hands the recorder a `57014` directly — it does NOT
 * fire a bound, and it would pass unchanged with the whole `SET LOCAL` change
 * reverted. What it does prove is the CARRIES half: given a bound's identity, the
 * recorder preserves prior-good, never advances `lastSuccessAt`, and keeps the code.
 *
 * The other half — that a fired bound's identity SURVIVES THE JOURNEY to the record —
 * is NOT proven anywhere, because it is not true today: every transactional caller
 * does `catch { return 'store-unavailable' }` (e.g.
 * `src/lib/schedule/fullSeasonScheduleRefresh.ts:182`) and then records the fixed
 * string `schedule-durable-commit-failed`, so a `55P03` and a `57014` record
 * IDENTICALLY. The store surfaces them distinguishably — that IS proven, by the two
 * tests above — and the flattening happens in callers this slice's scope excludes.
 *
 * PLATFORM-625's third acceptance bullet is therefore recorded UNMET, not relaxed:
 * the bounds end the hang, but the diagnostic value stays latent until a caller
 * preserves the SQLSTATE. Filed as #785.
 */
test('the recorder preserves prior-good and keeps the bound code, given a failure carrying one', async () => {
  // Guarded like `appStateStore.test.ts`: an ambient DATABASE_URL would put this on
  // the live store, and `beforeEach`'s `__deleteAppStateFileForTests()` would issue
  // `delete from app_state` through `queryBounded`.
  assert.equal(
    process.env.DATABASE_URL ?? '',
    '',
    'this test is file-fallback only — unset DATABASE_URL'
  );
  const scope = yearScope(2026);

  const first = await beginProviderRefreshAttempt('schedule', scope, {
    startedAt: '2026-09-14T00:00:00.000Z',
    attemptId: 'A',
  });
  await recordProviderRefreshSuccess('schedule', scope, {
    attempt: first,
    committedAt: '2026-09-14T00:00:01.000Z',
    commitSeq: nextProviderCommitSeq(),
    source: 'provider',
    rowsCommitted: 812,
  });
  const good = await getProviderRefreshStatus('schedule', scope);
  assert.equal(good.lastSuccessAt, '2026-09-14T00:00:01.000Z');
  assert.equal(good.rowsCommitted, 812);

  // The next attempt's durable commit is killed by `statement_timeout`.
  const second = await beginProviderRefreshAttempt('schedule', scope, {
    startedAt: '2026-09-14T01:00:00.000Z',
    attemptId: 'B',
  });
  await recordProviderRefreshFailure('schedule', scope, {
    attempt: second,
    error: 'canceling statement due to statement timeout',
    code: '57014',
  });

  const after = await getProviderRefreshStatus('schedule', scope);
  // Prior-good is exactly what is still being served, so it must survive verbatim.
  assert.equal(after.lastSuccessAt, '2026-09-14T00:00:01.000Z');
  assert.equal(after.source, good.source);
  assert.equal(after.rowsCommitted, 812);
  assert.equal(after.latestAttemptOutcome, 'failed');
  // Attributable: the bound is identifiable in the record, not just "it failed".
  assert.equal(after.lastError?.code, '57014');
});

// === The file fallback is a different backend and must not be touched ===

test('with no DATABASE_URL the file fallback never reaches the pool at all', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const pool = new RecordingPool();
  __setAppStatePoolForTests(pool as unknown as Pool);
  try {
    await setAppState('bounds', 'k', { v: 1 });
    assert.deepEqual((await getAppState<{ v: number }>('bounds', 'k'))?.value, { v: 1 });
    await withAppStateKeyTransaction('bounds', 'k', async (txn) => {
      await txn.write({ v: 2 });
    });
    assert.deepEqual((await getAppState<{ v: number }>('bounds', 'k'))?.value, { v: 2 });

    // Confirmed, not assumed: the bounds are pool settings, and the file backend
    // never opens a connection for them to apply to.
    assert.equal(pool.connects, 0);
    assert.deepEqual(pool.statements, []);
    assert.deepEqual(pool.poolStatements, []);
  } finally {
    __setAppStatePoolForTests(null);
    if (previous !== undefined) process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
});

// === Client containment: a checked-out client has no error listener of its own ===

test('a checked-out client carries an error listener for its whole lifetime, and hands it back', async () => {
  await withFakePg(async (pool) => {
    let duringOperation = -1;
    pool.observeClient = (client) => {
      duringOperation = Math.max(duringOperation, client.listenerCount('error'));
    };
    await getAppState('bounds', 'k');
    // `pg-pool` REMOVES its idle listener at checkout and adds nothing back, so
    // without our guard this is 0 and any socket error is an uncaught exception.
    assert.ok(duringOperation > 0, 'no error listener was attached while checked out');
    // And it must come OFF at release, or it accumulates on every pooled reuse.
    for (const client of pool.clients) {
      assert.equal(client.listenerCount('error'), 0, 'the listener outlived the checkout');
    }
  });
});

test('an error emitted on a checked-out client does not become an uncaught exception', async () => {
  await withFakePg(async (pool) => {
    // The production shape: Neon reaps the connection, or a TLS reset lands, while the
    // client is checked out. `pg` emits 'error' on the client regardless of whether a
    // query is in flight; an emit with no listener is ERR_UNHANDLED_ERROR.
    pool.emitErrorOn = /select value/;
    await assert.doesNotReject(getAppState('bounds', 'k'));
    assert.ok(pool.clients.length > 0);
  });
});

// === The opener is the one statement no server-side bound can cover ===

test('an opener that never settles is bounded, and the client is DESTROYED rather than rolled back', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  const pool = new StalledOpenerPool(2); // let the schema DDL through
  __setAppStatePoolForTests(pool as unknown as Pool);
  __setAppStateOpenerTimeoutForTests(150);
  try {
    await assert.rejects(
      withAppStateKeyTransaction('bounds', 'k', async () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof AppStateKeyLockAcquireError);
        assert.ok(
          error.cause instanceof AppStateOpenerTimeoutError,
          'the opener deadline should be the identified cause'
        );
        return true;
      }
    );

    // Client 1 is `ensureDatabase`'s schema transaction, which completed normally and
    // is released HEALTHY; client 2 is the one whose opener stalled. Selecting by
    // "first released client" would read the schema client and prove nothing.
    assert.equal(pool.clients.length, 2, 'expected a schema client and a stalled one');
    const stalled = pool.clients[1];
    assert.ok(stalled.released, 'the stalled client was never released');
    // DESTROYED, not returned healthy: a client-side timeout leaves the wire protocol
    // desynchronised, and a timed-out client put back in the pool poisons every later
    // query on it (measured against production).
    assert.equal(stalled.released?.destroyed, true, 'the client must be destroyed');
    // And no ROLLBACK was attempted — that would be an unbounded wait inside the
    // cleanup for an unbounded wait.
    assert.ok(
      !stalled.issued.some((sql) => sql.trim().toLowerCase() === 'rollback'),
      'no rollback may be issued on a client whose opener never completed'
    );
  } finally {
    __setAppStateOpenerTimeoutForTests(null);
    __setAppStatePoolForTests(null);
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
});

test('an opener stall on the schema transaction is bounded too, and destroys that client', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  const pool = new StalledOpenerPool(1); // the very first opener stalls
  __setAppStatePoolForTests(pool as unknown as Pool);
  __setAppStateOpenerTimeoutForTests(150);
  try {
    // `ensureDatabase` runs before the transaction takes its own client, so this is
    // the first opener in the process and nothing has installed a bound yet.
    await assert.rejects(getAppState('bounds', 'k'), (error: unknown) => {
      assert.ok(error instanceof AppStateOpenerTimeoutError);
      return true;
    });
    const stalled = pool.clients.find((client) => client.released !== null);
    assert.ok(stalled, 'the stalled client was never released');
    assert.equal(stalled.released?.destroyed, true, 'the client must be destroyed');
  } finally {
    __setAppStateOpenerTimeoutForTests(null);
    __setAppStatePoolForTests(null);
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
});
