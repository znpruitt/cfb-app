import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import { mergeGameStatsPartitionDurable } from '../../gameStats/durableMerge.ts';
import { parseV2GameObservation } from '../../gameStats/contract.ts';
import { wireGame } from '../../gameStats/__tests__/fixtures.ts';
import {
  AppStateKeyLockAcquireError,
  AppStateTxnFinalizeError,
  __appStateKeyLockChainCountForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStatePoolForTests,
  withAppStateKeyTransaction,
} from '../appStateStore.ts';

// ---------------------------------------------------------------------------
// Fake pg pool/client harness (PLATFORM-086H2 remediation): proves the
// single-client advisory-lock transaction lifecycle without a live database.
// ---------------------------------------------------------------------------

type QueryKind = 'ddl' | 'exists' | 'begin' | 'lock' | 'read' | 'write' | 'commit' | 'rollback';

function classifyQuery(text: string): QueryKind {
  const sql = text.toLowerCase();
  if (sql.includes('create table')) return 'ddl';
  if (sql.includes('to_regclass')) return 'exists';
  if (sql.includes('pg_advisory_xact_lock')) return 'lock';
  if (sql.includes('select value')) return 'read';
  if (sql.includes('insert into app_state')) return 'write';
  if (sql.trim() === 'begin') return 'begin';
  if (sql.trim() === 'commit') return 'commit';
  if (sql.trim() === 'rollback') return 'rollback';
  throw new Error(`unclassified query in fake pool: ${text}`);
}

class FakeClient {
  readonly calls: QueryKind[] = [];
  released = false;

  constructor(
    private readonly pool: FakePool,
    private readonly index: number
  ) {}

  async query(text: string, params?: unknown[]) {
    if (this.released) throw new Error('query after release');
    const kind = classifyQuery(text);
    this.calls.push(kind);
    this.pool.log.push(`client${this.index}:${kind}`);
    const gate = this.pool.gates[`client${this.index}:${kind}`];
    if (gate) await gate;
    const failure = this.pool.failures[kind];
    if (failure) throw failure;
    if (kind === 'read') {
      return { rows: this.pool.storedRow ? [this.pool.storedRow] : [] };
    }
    if (kind === 'write') {
      this.pool.writtenValues.push(params?.[2]);
    }
    return { rows: [] };
  }

  release(): void {
    this.released = true;
    this.pool.log.push(`client${this.index}:release`);
  }
}

class FakePool {
  readonly log: string[] = [];
  readonly writtenValues: unknown[] = [];
  failures: Partial<Record<QueryKind, Error>> = {};
  gates: Record<string, Promise<void> | undefined> = {};
  storedRow: { value: unknown; updated_at: string } | null = null;
  connectCount = 0;
  connectFailure: Error | null = null;

  async connect() {
    if (this.connectFailure) throw this.connectFailure;
    this.connectCount += 1;
    this.log.push('pool:connect');
    return new FakeClient(this, this.connectCount);
  }

  // Ordinary pool queries (ensureDatabase DDL) — must never occur inside the
  // locked transaction.
  async query(text: string) {
    this.log.push(`pool:${classifyQuery(text)}`);
    return { rows: [{ present: true }] };
  }

  async end() {}
}

async function withFakePg(fn: (pool: FakePool) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  const pool = new FakePool();
  __setAppStatePoolForTests(pool as unknown as Pool);
  try {
    await fn(pool);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === PostgreSQL single-client transaction lifecycle (fake pool) ===

test('write path: one client runs begin → lock → read → write → commit, then release', async () => {
  await withFakePg(async (pool) => {
    const result = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      const existing = await txn.read();
      assert.equal(existing, null);
      await txn.write({ hello: 'world' });
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(pool.connectCount, 1);
    const clientLog = pool.log.filter((entry) => entry.startsWith('client1'));
    assert.deepEqual(clientLog, [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:write',
      'client1:commit',
      'client1:release',
    ]);
    // The only ordinary pool queries are the pre-transaction DDL bootstrap.
    const poolQueriesAfterBegin = pool.log
      .slice(pool.log.indexOf('client1:begin'))
      .filter((entry) => entry.startsWith('pool:') && entry !== 'pool:connect');
    assert.deepEqual(poolQueriesAfterBegin, []);
    assert.equal(pool.writtenValues.length, 1);
  });
});

test('read-only path: no write statement, still commits and releases', async () => {
  await withFakePg(async (pool) => {
    pool.storedRow = { value: { a: 1 }, updated_at: '2024-10-01T00:00:00.000Z' };
    const result = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      const record = await txn.read<{ a: number }>();
      return record?.value.a;
    });
    assert.equal(result, 1);
    assert.deepEqual(
      pool.log.filter((e) => e.startsWith('client1')),
      ['client1:begin', 'client1:lock', 'client1:read', 'client1:commit', 'client1:release']
    );
  });
});

test('read failure rolls back (never commits a failed transaction)', async () => {
  await withFakePg(async (pool) => {
    pool.failures.read = new Error('read down');
    const result = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      try {
        await txn.read();
        return 'unexpected';
      } catch {
        return 'handled';
      }
    });
    assert.equal(result, 'handled');
    const clientLog = pool.log.filter((e) => e.startsWith('client1'));
    assert.deepEqual(clientLog, [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:rollback',
      'client1:release',
    ]);
  });
});

test('write failure rolls back; callback failure rolls back and rethrows', async () => {
  await withFakePg(async (pool) => {
    pool.failures.write = new Error('write down');
    await withAppStateKeyTransaction('s', 'k', async (txn) => {
      try {
        await txn.write({ x: 1 });
      } catch {
        // handled by caller
      }
      return null;
    });
    assert.ok(pool.log.includes('client1:rollback'));
    assert.ok(!pool.log.includes('client1:commit'));

    pool.failures = {};
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => {
        throw new Error('callback exploded');
      }),
      /callback exploded/
    );
    const secondClientLog = pool.log.filter((e) => e.startsWith('client2'));
    assert.deepEqual(secondClientLog, [
      'client2:begin',
      'client2:lock',
      'client2:rollback',
      'client2:release',
    ]);
  });
});

test('commit failure surfaces AppStateTxnFinalizeError with didWrite', async () => {
  await withFakePg(async (pool) => {
    pool.failures.commit = new Error('commit lost');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async (txn) => {
        await txn.write({ x: 1 });
        return 'never-surfaced';
      }),
      (error: unknown) => error instanceof AppStateTxnFinalizeError && error.didWrite === true
    );
    // Release still happens after a finalize failure.
    assert.ok(pool.log.includes('client1:release'));

    pool.failures.commit = new Error('commit lost again');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => 'read-only'),
      (error: unknown) => error instanceof AppStateTxnFinalizeError && error.didWrite === false
    );
  });
});

test('acquisition failures throw AppStateKeyLockAcquireError', async () => {
  await withFakePg(async (pool) => {
    pool.connectFailure = new Error('pool exhausted');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => 'x'),
      (error: unknown) => error instanceof AppStateKeyLockAcquireError
    );

    pool.connectFailure = null;
    pool.failures.lock = new Error('lock query failed');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => 'x'),
      (error: unknown) => error instanceof AppStateKeyLockAcquireError
    );
    // The failed-acquisition client is rolled back and released.
    const clientLog = pool.log.filter((e) => e.startsWith('client1'));
    assert.deepEqual(clientLog, [
      'client1:begin',
      'client1:lock',
      'client1:rollback',
      'client1:release',
    ]);
  });
});

test('the accessor is dead after the transaction finishes', async () => {
  await withFakePg(async () => {
    let leaked: { read: () => Promise<unknown> } | null = null;
    await withAppStateKeyTransaction('s', 'k', async (txn) => {
      leaked = txn;
      return null;
    });
    await assert.rejects(leaked!.read(), /already finished/);
  });
});

test('pool starvation by construction: the lock owner never needs a second connection', async () => {
  await withFakePg(async (pool) => {
    // Writer B's advisory-lock query blocks (a queued same-key waiter) while
    // writer A — already inside the critical section — completes read + write
    // + commit using ONLY its own already-held client.
    const waiterGate = deferred();
    pool.gates['client2:lock'] = waiterGate.promise;

    const a = withAppStateKeyTransaction('s', 'k', async (txn) => {
      await txn.read();
      await txn.write({ from: 'A' });
      return 'A';
    });
    assert.equal(await a, 'A');
    const b = withAppStateKeyTransaction('s', 'k', async () => 'B');

    assert.equal(pool.connectCount <= 2, true);
    const aLog = pool.log.filter((e) => e.startsWith('client1'));
    assert.deepEqual(aLog, [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:write',
      'client1:commit',
      'client1:release',
    ]);

    waiterGate.resolve();
    assert.equal(await b, 'B');
  });
});

test('service level: commit failure yields a typed indeterminate outcome', async () => {
  await withFakePg(async (pool) => {
    const parsed = parseV2GameObservation(wireGame({ id: 300 }));
    assert.ok(parsed.ok);
    const observation = parsed.ok ? parsed.observation : (null as never);

    pool.failures.commit = new Error('commit lost');
    const result = await mergeGameStatsPartitionDurable({
      year: 2024,
      week: 6,
      seasonType: 'regular',
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [observation],
    });
    assert.equal(result.outcome, 'indeterminate');
    assert.deepEqual(result.indeterminate, {
      reason: 'transaction-finalize-failed',
      durability: 'unknown',
      partitionKey: 'game-stats/2024:6:regular',
    });
    assert.equal(pool.connectCount, 1);

    // A no-write finalize failure is certainly-untouched `unavailable`.
    pool.storedRow = null;
    const noWrite = await mergeGameStatsPartitionDurable({
      year: 2024,
      week: 6,
      seasonType: 'regular',
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [],
    });
    assert.equal(noWrite.outcome, 'unavailable');
    assert.equal(noWrite.unavailableReason, 'transaction-finalize-failed');
  });
});

test('service level: the merge runs entirely on the lock-owning client', async () => {
  await withFakePg(async (pool) => {
    const parsed = parseV2GameObservation(wireGame({ id: 301 }));
    assert.ok(parsed.ok);
    const observation = parsed.ok ? parsed.observation : (null as never);

    const result = await mergeGameStatsPartitionDurable({
      year: 2024,
      week: 6,
      seasonType: 'regular',
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [observation],
    });
    assert.equal(result.outcome, 'written');
    assert.equal(pool.connectCount, 1);
    assert.deepEqual(
      pool.log.filter((e) => e.startsWith('client1')),
      [
        'client1:begin',
        'client1:lock',
        'client1:read',
        'client1:write',
        'client1:commit',
        'client1:release',
      ]
    );
    const written = JSON.parse(pool.writtenValues[0] as string) as {
      games: Array<{ providerGameId: number }>;
    };
    assert.equal(written.games[0]!.providerGameId, 301);
  });
});

// === File-fallback barrier behavior (dev/test serialization only) ===

test('barrier: same-key callbacks are mutually exclusive; unrelated keys are concurrent', async () => {
  const aInside = deferred();
  const aRelease = deferred();
  let bEntered = false;
  let unrelatedEntered = false;

  const a = withAppStateKeyTransaction('s', 'k', async () => {
    aInside.resolve();
    await aRelease.promise;
    return 'A';
  });
  await aInside.promise;

  const b = withAppStateKeyTransaction('s', 'k', async () => {
    bEntered = true;
    return 'B';
  });
  const unrelated = withAppStateKeyTransaction('s', 'other-key', async () => {
    unrelatedEntered = true;
    return 'U';
  });

  await unrelated;
  assert.equal(unrelatedEntered, true, 'unrelated key entered while A held its key');
  assert.equal(bEntered, false, 'same-key writer B excluded while A holds the key');

  aRelease.resolve();
  assert.equal(await a, 'A');
  assert.equal(await b, 'B');
  assert.equal(bEntered, true);
});

test('a rejected same-key callback does not poison the next; settled chains are released', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('s', 'k', async () => {
      throw new Error('first fails');
    }),
    /first fails/
  );
  const second = await withAppStateKeyTransaction('s', 'k', async () => 'second ok');
  assert.equal(second, 'second ok');

  // Exercise several historical keys, then prove the chain map drains.
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      withAppStateKeyTransaction('s', `historic-${i}`, async () => i)
    )
  );
  // Cleanup runs on the tail's microtask — yield once.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});
