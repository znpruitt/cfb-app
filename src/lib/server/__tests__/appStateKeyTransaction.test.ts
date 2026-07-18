import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import { mergeGameStatsPartitionDurable } from '../../gameStats/durableMerge.ts';
import { parseV2GameObservation } from '../../gameStats/contract.ts';
import { wireGame } from '../../gameStats/__tests__/fixtures.ts';
import {
  AppStateKeyLockAcquireError,
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  __appStateKeyLockChainCountForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStatePoolForTests,
  withAppStateKeyTransaction,
} from '../appStateStore.ts';

// ---------------------------------------------------------------------------
// Stateful fake pg harness (PLATFORM-086H2): models advisory-lock ownership by
// key (same-key waiters BLOCK at the lock query), transaction staging (writes
// visible only after COMMIT, discarded on ROLLBACK or destroy), committed-state
// visibility to the next lock owner, pool capacity, and release-vs-destroy
// disposal — not merely recorded SQL with preconfigured rows.
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

type LockEntry = { owner: FakeClient; waiters: Array<{ client: FakeClient; grant: () => void }> };

class FakeClient {
  readonly calls: QueryKind[] = [];
  released = false;
  destroyed = false;
  private staged: Map<string, string> | null = null;
  private readonly heldLocks = new Set<string>();

  constructor(
    private readonly pool: FakePool,
    readonly index: number
  ) {}

  async query(text: string, params?: unknown[]) {
    if (this.released) throw new Error(`query after release (client ${this.index})`);
    const kind = classifyQuery(text);
    this.calls.push(kind);
    this.pool.log.push(`client${this.index}:${kind}`);
    const gate = this.pool.gates[`client${this.index}:${kind}`];
    if (gate) await gate;
    const failure = this.pool.takeFailure(this.index, kind);
    if (failure) throw failure;

    switch (kind) {
      case 'begin':
        this.staged = new Map();
        return { rows: [] };
      case 'lock': {
        const lockKey = String(params?.[0]);
        const entry = this.pool.locks.get(lockKey);
        if (!entry) {
          this.pool.locks.set(lockKey, { owner: this, waiters: [] });
          this.heldLocks.add(lockKey);
          return { rows: [] };
        }
        if (entry.owner === this) return { rows: [] };
        await new Promise<void>((grant) => entry.waiters.push({ client: this, grant }));
        this.heldLocks.add(lockKey);
        return { rows: [] };
      }
      case 'read': {
        const compositeKey = `${String(params?.[0])}::${String(params?.[1])}`;
        const stagedValue = this.staged?.get(compositeKey);
        const committedValue = this.pool.committed.get(compositeKey);
        const raw = stagedValue ?? committedValue;
        if (raw === undefined) return { rows: [] };
        return { rows: [{ value: JSON.parse(raw), updated_at: '2024-01-01T00:00:00.000Z' }] };
      }
      case 'write': {
        const compositeKey = `${String(params?.[0])}::${String(params?.[1])}`;
        this.staged!.set(compositeKey, String(params?.[2]));
        return { rows: [] };
      }
      case 'commit': {
        for (const [compositeKey, value] of this.staged ?? []) {
          this.pool.committed.set(compositeKey, value);
        }
        this.endTransaction();
        return { rows: [] };
      }
      case 'rollback': {
        this.endTransaction();
        return { rows: [] };
      }
      default:
        return { rows: [] };
    }
  }

  /** Server-side transaction end: discard staging, free advisory locks. */
  private endTransaction(): void {
    this.staged = null;
    for (const lockKey of this.heldLocks) {
      const entry = this.pool.locks.get(lockKey);
      if (!entry || entry.owner !== this) continue;
      const next = entry.waiters.shift();
      if (next) {
        entry.owner = next.client;
        next.grant();
      } else {
        this.pool.locks.delete(lockKey);
      }
    }
    this.heldLocks.clear();
  }

  release(error?: Error): void {
    if (this.released) throw new Error(`double release (client ${this.index})`);
    const destroyed = error !== undefined;
    // Release-failure injection fires BEFORE any successful-disposal
    // bookkeeping: the client is neither marked released, idled, nor
    // slot-freed — a healthy release that throws did NOT complete.
    if (!destroyed && this.pool.releaseFailure) {
      const failure = this.pool.releaseFailure;
      this.pool.releaseFailure = null;
      throw failure;
    }
    this.released = true;
    this.destroyed = destroyed;
    if (destroyed) {
      // Connection teardown: the server discards the open transaction and
      // frees any advisory locks still attached to it. Destroyed clients
      // never enter the idle pool.
      this.endTransaction();
      this.pool.destroyedIds.add(this.index);
    } else {
      this.pool.idle.push(this);
    }
    this.pool.releases.push({ index: this.index, destroyed });
    this.pool.log.push(`client${this.index}:release${destroyed ? ':destroy' : ''}`);
    this.pool.freeSlot();
  }
}

class FakePool {
  readonly log: string[] = [];
  readonly releases: Array<{ index: number; destroyed: boolean }> = [];
  readonly committed = new Map<string, string>();
  readonly locks = new Map<string, LockEntry>();
  /** Healthy released clients, available for reuse by later connects. */
  readonly idle: FakeClient[] = [];
  readonly destroyedIds = new Set<number>();
  gates: Record<string, Promise<void> | undefined> = {};
  failures: Partial<Record<QueryKind, Error>> = {};
  perClientFailures: Record<string, Error | undefined> = {};
  releaseFailure: Error | null = null;
  connectFailure: Error | null = null;
  capacity = Number.POSITIVE_INFINITY;
  outstanding = 0;
  connectCount = 0;
  private readonly connectQueue: Array<() => void> = [];

  takeFailure(clientIndex: number, kind: QueryKind): Error | null {
    const perClient = this.perClientFailures[`client${clientIndex}:${kind}`];
    if (perClient) {
      this.perClientFailures[`client${clientIndex}:${kind}`] = undefined;
      return perClient;
    }
    return this.failures[kind] ?? null;
  }

  freeSlot(): void {
    this.outstanding -= 1;
    const next = this.connectQueue.shift();
    if (next) next();
  }

  async connect() {
    if (this.connectFailure) throw this.connectFailure;
    if (this.outstanding >= this.capacity) {
      await new Promise<void>((grant) => this.connectQueue.push(grant));
    }
    this.outstanding += 1;
    // Healthy idle clients are genuinely reused; destroyed clients can never
    // be offered again (loudly, so a containment bug fails the test).
    const reused = this.idle.pop();
    if (reused) {
      if (reused.destroyed || this.destroyedIds.has(reused.index)) {
        throw new Error(`destroyed client ${reused.index} offered for reuse`);
      }
      reused.released = false;
      this.log.push(`pool:connect:reuse:${reused.index}`);
      return reused;
    }
    this.connectCount += 1;
    this.log.push('pool:connect');
    return new FakeClient(this, this.connectCount);
  }

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

function clientLog(pool: FakePool, index: number): string[] {
  return pool.log.filter((entry) => entry.startsWith(`client${index}:`));
}

const MERGE_BASE = { year: 2024, week: 6, seasonType: 'regular' as const };
const MERGE_KEY = 'game-stats::2024:6:regular';

function mergeObservation(id: number) {
  const parsed = parseV2GameObservation(wireGame({ id }));
  assert.ok(parsed.ok);
  return parsed.ok ? parsed.observation : (null as never);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === Single-client transaction lifecycle ===

test('write path: one client runs begin → lock → read → write → commit; staged writes become visible only at commit', async () => {
  await withFakePg(async (pool) => {
    const result = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      assert.equal(await txn.read(), null);
      await txn.write({ hello: 'world' });
      // Staged, not yet committed: durable state is still empty.
      assert.equal(pool.committed.size, 0);
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(pool.connectCount, 1);
    assert.deepEqual(clientLog(pool, 1), [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:write',
      'client1:commit',
      'client1:release',
    ]);
    assert.deepEqual(JSON.parse(pool.committed.get('s::k')!), { hello: 'world' });
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: false }]);
    const poolQueriesAfterBegin = pool.log
      .slice(pool.log.indexOf('client1:begin'))
      .filter((entry) => entry.startsWith('pool:') && entry !== 'pool:connect');
    assert.deepEqual(poolQueriesAfterBegin, []);
  });
});

test('read failure and write failure roll back (confirmed) with a healthy release', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:read'] = new Error('read down');
    const readResult = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      try {
        await txn.read();
        return 'unexpected';
      } catch {
        return 'handled';
      }
    });
    assert.equal(readResult, 'handled');
    assert.deepEqual(clientLog(pool, 1), [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:rollback',
      'client1:release',
    ]);
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: false }]);
  });

  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:write'] = new Error('write down');
    await withAppStateKeyTransaction('s', 'k', async (txn) => {
      try {
        await txn.write({ x: 1 });
      } catch {
        // handled
      }
      return null;
    });
    assert.ok(clientLog(pool, 1).includes('client1:rollback'));
    assert.ok(!clientLog(pool, 1).includes('client1:commit'));
    assert.equal(pool.committed.size, 0);
  });
});

test('healthy clients are reused; destroyed clients never reappear', async () => {
  await withFakePg(async (pool) => {
    // Two sequential healthy transactions share ONE client via the idle pool.
    await withAppStateKeyTransaction('s', 'k', async (txn) => txn.write({ a: 1 }));
    await withAppStateKeyTransaction('s', 'k', async (txn) => txn.read());
    assert.equal(pool.connectCount, 1);
    assert.ok(pool.log.includes('pool:connect:reuse:1'), 'healthy client 1 reused');

    // A destroyed client (failed commit) never re-enters the idle pool: the
    // next connect creates a fresh client instead. (The failing transaction
    // itself legitimately reused idle client 1 BEFORE destroying it.)
    pool.perClientFailures['client1:commit'] = new Error('commit lost');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async (txn) => txn.write({ b: 2 })),
      (error: unknown) => error instanceof AppStateTxnFinalizeError
    );
    assert.ok(pool.destroyedIds.has(1));
    const reusesBeforeDestruction = pool.log.filter((e) => e === 'pool:connect:reuse:1').length;
    await withAppStateKeyTransaction('s', 'k', async (txn) => txn.read());
    assert.equal(pool.connectCount, 2, 'fresh client created after destruction');
    assert.equal(
      pool.log.filter((e) => e === 'pool:connect:reuse:1').length,
      reusesBeforeDestruction,
      'destroyed client 1 never reused again'
    );

    // Confirmed rollback keeps the client healthy and reusable.
    pool.perClientFailures['client2:read'] = new Error('read down');
    await withAppStateKeyTransaction('s', 'k', async (txn) => {
      try {
        await txn.read();
      } catch {
        // handled
      }
      return null;
    });
    await withAppStateKeyTransaction('s', 'k', async (txn) => txn.read());
    assert.equal(pool.connectCount, 2, 'confirmed-rollback client reused');
    assert.ok(pool.log.includes('pool:connect:reuse:2'));
  });
});

test('callback failure: confirmed rollback rethrows the callback error with a healthy client', async () => {
  await withFakePg(async (pool) => {
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => {
        throw new Error('callback exploded');
      }),
      /callback exploded/
    );
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: false }]);
    // Lock freed by the rollback: a successor completes.
    const next = await withAppStateKeyTransaction('s', 'k', async () => 'next');
    assert.equal(next, 'next');
  });
});

// === Uncertain-client containment ===

test('rollback failure before any write: typed cleanup error, client destroyed', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:rollback'] = new Error('rollback down');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => {
        throw new Error('callback failed first');
      }),
      (error: unknown) =>
        error instanceof AppStateTxnCleanupError &&
        error.writeAttempted === false &&
        String((error.cause as Error).message) === 'callback failed first' &&
        String((error.cleanupCause as Error).message) === 'rollback down'
    );
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
    // The destroyed connection released its advisory lock: a successor with a
    // fresh healthy client completes.
    const next = await withAppStateKeyTransaction('s', 'k', async () => 'recovered');
    assert.equal(next, 'recovered');
    assert.deepEqual(pool.releases[1], { index: 2, destroyed: false });
  });
});

test('rollback failure after an acknowledged write: cleanup error is write-attempted', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:rollback'] = new Error('rollback down');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async (txn) => {
        await txn.write({ x: 1 });
        throw new Error('after write');
      }),
      (error: unknown) =>
        error instanceof AppStateTxnCleanupError &&
        error.writeAttempted === true &&
        error.writeAcknowledged === true
    );
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
  });
});

test('rejected write + failed rollback: attempted-but-unacknowledged, both causes retained', async () => {
  await withFakePg(async (pool) => {
    // The mutation SQL was SUBMITTED, its acknowledgement was lost, and the
    // rollback also failed — the write may still have executed server-side.
    pool.perClientFailures['client1:write'] = new Error('connection reset');
    pool.perClientFailures['client1:rollback'] = new Error('rollback failed');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async (txn) => {
        try {
          await txn.write({ x: 1 });
        } catch {
          // handled by the caller — the bounded result path
        }
        return null;
      }),
      (error: unknown) =>
        error instanceof AppStateTxnCleanupError &&
        error.writeAttempted === true &&
        error.writeAcknowledged === false &&
        String((error.cause as Error).message) === 'connection reset' &&
        String((error.cleanupCause as Error).message) === 'rollback failed'
    );
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
  });
});

test('acquisition failure with failed cleanup retains both causes and destroys the client', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:lock'] = new Error('lock query failed');
    pool.perClientFailures['client1:rollback'] = new Error('rollback down');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => 'x'),
      (error: unknown) =>
        error instanceof AppStateKeyLockAcquireError &&
        String((error.cause as Error).message) === 'lock query failed' &&
        String((error.cleanupCause as Error).message) === 'rollback down'
    );
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
  });
});

test('commit failure destroys the uncertain client (with and without attempted write)', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:commit'] = new Error('commit lost');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async (txn) => {
        await txn.write({ x: 1 });
        return 'never-surfaced';
      }),
      (error: unknown) =>
        error instanceof AppStateTxnFinalizeError &&
        error.writeAttempted === true &&
        error.writeAcknowledged === true
    );
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);

    pool.perClientFailures['client2:commit'] = new Error('commit lost again');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => 'read-only'),
      (error: unknown) =>
        error instanceof AppStateTxnFinalizeError && error.writeAttempted === false
    );
    assert.deepEqual(pool.releases[1], { index: 2, destroyed: true });
    const destroyedIndexes = pool.releases.filter((r) => r.destroyed).map((r) => r.index);
    assert.deepEqual(destroyedIndexes, [1, 2]);
  });
});

test('a post-commit release failure never replaces the confirmed result (client destroyed)', async () => {
  await withFakePg(async (pool) => {
    pool.releaseFailure = new Error('release exploded');
    const result = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      await txn.write({ committed: true });
      return 'confirmed';
    });
    assert.equal(result, 'confirmed');
    assert.deepEqual(JSON.parse(pool.committed.get('s::k')!), { committed: true });
    // Healthy disposal did not complete → the client was destroyed, not idled.
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
    assert.ok(pool.destroyedIds.has(1));
    // A later connect receives a fresh client.
    await withAppStateKeyTransaction('s', 'k', async (txn) => txn.read());
    assert.equal(pool.connectCount, 2);
  });
});

test('a confirmed-rollback release failure preserves the original result (client destroyed)', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:read'] = new Error('read down');
    pool.releaseFailure = new Error('release exploded');
    const result = await withAppStateKeyTransaction('s', 'k', async (txn) => {
      try {
        await txn.read();
        return 'unexpected';
      } catch {
        return 'handled';
      }
    });
    // The bounded original result survives; the client is contained.
    assert.equal(result, 'handled');
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
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
    pool.perClientFailures['client1:lock'] = new Error('lock query failed');
    await assert.rejects(
      withAppStateKeyTransaction('s', 'k', async () => 'x'),
      (error: unknown) => error instanceof AppStateKeyLockAcquireError
    );
    assert.deepEqual(clientLog(pool, 1), [
      'client1:begin',
      'client1:lock',
      'client1:rollback',
      'client1:release',
    ]);
  });
});

test('the accessor is dead after the transaction finishes (postgres mode)', async () => {
  await withFakePg(async () => {
    let leaked: { read: () => Promise<unknown> } | null = null;
    await withAppStateKeyTransaction('s', 'k', async (txn) => {
      leaked = txn;
      return null;
    });
    await assert.rejects(leaked!.read(), /already finished/);
  });
});

// === Real same-key overlap, reread-after-commit, starvation ===

test('overlap: B blocks at the advisory lock while A owns it, then rereads A’s committed value', async () => {
  await withFakePg(async (pool) => {
    const aInside = deferred();
    const aRelease = deferred();
    let bEntered = false;
    let bSaw: unknown = 'unset';

    const a = withAppStateKeyTransaction('s', 'k', async (txn) => {
      await txn.read();
      aInside.resolve();
      await aRelease.promise;
      await txn.write({ from: 'A' });
      return 'A';
    });
    await aInside.promise;

    // B starts while A still owns the lock and parks INSIDE its lock query.
    const b = withAppStateKeyTransaction('s', 'k', async (txn) => {
      bEntered = true;
      bSaw = (await txn.read())?.value ?? null;
      await txn.write({ from: 'B' });
      return 'B';
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(clientLog(pool, 2).includes('client2:lock'), 'B reached its lock query');
    assert.equal(bEntered, false, 'B cannot enter while A owns the lock');

    aRelease.resolve();
    assert.equal(await a, 'A');
    assert.equal(await b, 'B');
    assert.equal(bEntered, true);
    // B reread durable state AFTER A committed — never a stale pre-lock view.
    assert.deepEqual(bSaw, { from: 'A' });
    assert.deepEqual(JSON.parse(pool.committed.get('s::k')!), { from: 'B' });
    // A performed its whole lifecycle on client 1 only.
    assert.deepEqual(clientLog(pool, 1), [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:write',
      'client1:commit',
      'client1:release',
    ]);
  });
});

test('small-pool starvation scenario: the owner completes with only its own client', async () => {
  await withFakePg(async (pool) => {
    pool.capacity = 3;
    const aInside = deferred();
    const aRelease = deferred();
    const completionOrder: string[] = [];

    const run = (name: string, hold?: { inside: () => void; release: Promise<void> }) =>
      withAppStateKeyTransaction('s', 'k', async (txn) => {
        if (hold) {
          hold.inside();
          await hold.release;
        }
        await txn.write({ last: name });
        completionOrder.push(name);
        return name;
      });

    const a = run('A', { inside: aInside.resolve, release: aRelease.promise });
    await aInside.promise;
    const b = run('B');
    const c = run('C');
    await new Promise((resolve) => setImmediate(resolve));

    // A owns client 1; B and C each hold a client parked at the lock query.
    assert.equal(pool.outstanding, 3);
    assert.equal(pool.connectCount, 3);

    aRelease.resolve();
    assert.equal(await a, 'A');
    // A finished without ever requesting a fourth connection.
    assert.equal(pool.connectCount, 3);
    await Promise.all([b, c]);
    // Waiters proceed in deterministic FIFO lock order after A commits.
    assert.deepEqual(completionOrder, ['A', 'B', 'C']);
    assert.deepEqual(JSON.parse(pool.committed.get('s::k')!), { last: 'C' });
  });
});

// === Service-level behavior over the transactional backend ===

test('service: overlapping same-partition writers preserve disjoint updates', async () => {
  await withFakePg(async (pool) => {
    const gate = deferred();
    // Writer A parks on its WRITE statement while holding the advisory lock.
    pool.gates['client1:write'] = gate.promise;

    const a = mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(1)],
    });
    const b = mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T01:00:00.000Z',
      observations: [mergeObservation(2)],
    });
    await new Promise((resolve) => setImmediate(resolve));
    gate.resolve();

    const [aResult, bResult] = await Promise.all([a, b]);
    assert.equal(aResult.outcome, 'written');
    assert.equal(bResult.outcome, 'written');
    // B merged against A's COMMITTED partition: both games survive.
    assert.deepEqual(bResult.retainedExisting, [1]);
    const stored = JSON.parse(pool.committed.get(MERGE_KEY)!) as {
      games: Array<{ providerGameId: number }>;
    };
    assert.deepEqual(
      stored.games.map((g) => g.providerGameId).sort((x, y) => x - y),
      [1, 2]
    );

    // A late older observation is rejected against the committed newer state.
    const late = await mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-06T00:00:00.000Z',
      observations: [mergeObservation(1)],
    });
    assert.equal(late.outcome, 'stale');
  });
});

test('service: unrelated partitions proceed while a lock is held', async () => {
  await withFakePg(async (pool) => {
    const gate = deferred();
    pool.gates['client1:write'] = gate.promise;
    const held = mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(1)],
    });
    const other = await mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      week: 7,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(9)],
    });
    assert.equal(other.outcome, 'written', 'different partition key is not serialized');
    gate.resolve();
    assert.equal((await held).outcome, 'written');
  });
});

test('service: commit failure is indeterminate; retry afterwards is safe', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:commit'] = new Error('commit lost');
    const input = {
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(300)],
    };
    const first = await mergeGameStatsPartitionDurable(input);
    assert.equal(first.outcome, 'indeterminate');
    assert.deepEqual(first.indeterminate, {
      reason: 'transaction-finalize-failed',
      durability: 'unknown',
      partitionKey: 'game-stats/2024:6:regular',
    });
    // The retry re-runs against whatever actually committed (here: nothing).
    const retry = await mergeGameStatsPartitionDurable(input);
    assert.equal(retry.outcome, 'written');
    const retryAgain = await mergeGameStatsPartitionDurable(input);
    assert.equal(retryAgain.outcome, 'unchanged');
  });
});

test('service: rejected write + failed rollback is INDETERMINATE (mutation SQL was submitted)', async () => {
  await withFakePg(async (pool) => {
    // The write statement was SUBMITTED and rejected, and the rollback also
    // failed: the mutation may still have executed server-side, so durability
    // is unknown — never "certainly untouched".
    pool.perClientFailures['client1:write'] = new Error('write down');
    pool.perClientFailures['client1:rollback'] = new Error('rollback down');
    const result = await mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(301)],
    });
    assert.equal(result.outcome, 'indeterminate');
    assert.deepEqual(result.indeterminate, {
      reason: 'transaction-cleanup-failed',
      durability: 'unknown',
      partitionKey: 'game-stats/2024:6:regular',
    });
    // The uncertain client was destroyed, never returned as healthy.
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
  });
});

test('service: no-write cleanup failure stays a bounded unavailable (no mutation SQL submitted)', async () => {
  await withFakePg(async (pool) => {
    pool.perClientFailures['client1:read'] = new Error('read down');
    pool.perClientFailures['client1:rollback'] = new Error('rollback down');
    const result = await mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(304)],
    });
    assert.equal(result.outcome, 'unavailable');
    assert.equal(result.unavailableReason, 'transaction-cleanup-failed');
    assert.equal(result.partitionKey, 'game-stats/2024:6:regular');
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: true }]);
  });
});

test('service: merge-computation failure rolls back and is not labeled a lock failure', async () => {
  await withFakePg(async (pool) => {
    // Structurally invalid durable partition: a null game row.
    pool.committed.set(MERGE_KEY, JSON.stringify({ ...MERGE_BASE, fetchedAt: 'x', games: [null] }));
    const result = await mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(302)],
    });
    assert.equal(result.outcome, 'unavailable');
    assert.equal(result.unavailableReason, 'merge-computation-failed');
    assert.equal(result.partitionKey, 'game-stats/2024:6:regular');
    // The transaction rolled back on the lock-owning client before returning.
    assert.deepEqual(clientLog(pool, 1), [
      'client1:begin',
      'client1:lock',
      'client1:read',
      'client1:rollback',
      'client1:release',
    ]);
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: false }]);
  });
});

test('service: a post-commit release failure preserves the written outcome', async () => {
  await withFakePg(async (pool) => {
    pool.releaseFailure = new Error('release exploded');
    const result = await mergeGameStatsPartitionDurable({
      ...MERGE_BASE,
      fetchStartedAt: '2024-10-07T00:00:00.000Z',
      observations: [mergeObservation(303)],
    });
    assert.equal(result.outcome, 'written');
    assert.ok(pool.committed.has(MERGE_KEY));
  });
});

// === File-fallback behavior (dev/test serialization only) ===

test('file accessor is dead after the callback settles (success and failure)', async () => {
  let leakedSuccess: { read: () => Promise<unknown>; write: (v: unknown) => Promise<void> } | null =
    null;
  await withAppStateKeyTransaction('s', 'k', async (txn) => {
    leakedSuccess = txn;
    return 'ok';
  });
  await assert.rejects(leakedSuccess!.read(), /already finished/);
  await assert.rejects(leakedSuccess!.write({ late: true }), /already finished/);

  let leakedFailure: { read: () => Promise<unknown> } | null = null;
  await assert.rejects(
    withAppStateKeyTransaction('s', 'k', async (txn) => {
      leakedFailure = txn;
      throw new Error('callback failed');
    }),
    /callback failed/
  );
  await assert.rejects(leakedFailure!.read(), /already finished/);
});

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

  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      withAppStateKeyTransaction('s', `historic-${i}`, async () => i)
    )
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});
