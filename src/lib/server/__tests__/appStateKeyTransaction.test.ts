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
  AppStateTxnLockOrderError,
  __appStateKeyLockChainCountForTests,
  __corruptAppStateFileForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateFileCommitFailureForTests,
  __setAppStatePoolForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
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

// ===========================================================================
// PLATFORM-086H3A — multi-key transactions (readKey/writeKey/lockKey), staged
// file-fallback atomicity, and accessor lifetime. Every key of a transaction
// commits together or not at all, on BOTH backends.
// ===========================================================================

// --- File fallback (no DATABASE_URL): staged, atomic single replacement ---

test('file multi-key: a two-key transaction commits both keys atomically', async () => {
  await withAppStateKeyTransaction('primary', 'p', async (txn) => {
    await txn.write({ n: 1 });
    await txn.writeKey('ledger', 'p', { revision: 1 });
  });
  assert.deepEqual((await getAppState('primary', 'p'))?.value, { n: 1 });
  assert.deepEqual((await getAppState('ledger', 'p'))?.value, { revision: 1 });
});

test('file multi-key: a three-key transaction commits all keys atomically', async () => {
  await withAppStateKeyTransaction('primary', 't', async (txn) => {
    await txn.write({ n: 3 });
    await txn.writeKey('ledger', 't', { revision: 3 });
    await txn.writeKey('audit', 't', { at: 'x' });
  });
  assert.deepEqual((await getAppState('primary', 't'))?.value, { n: 3 });
  assert.deepEqual((await getAppState('ledger', 't'))?.value, { revision: 3 });
  assert.deepEqual((await getAppState('audit', 't'))?.value, { at: 'x' });
});

test('file multi-key: primary and secondary read-your-writes; latest staged value wins; untouched from snapshot', async () => {
  await setAppState('primary', 'ryw', { stored: 1 });
  await setAppState('other', 'untouched', { stored: 'other' });
  await withAppStateKeyTransaction('primary', 'ryw', async (txn) => {
    assert.deepEqual((await txn.read())?.value, { stored: 1 }, 'snapshot read');
    await txn.write({ stored: 2 });
    assert.deepEqual((await txn.read())?.value, { stored: 2 }, 'primary read-your-writes');
    await txn.write({ stored: 3 });
    assert.deepEqual((await txn.read())?.value, { stored: 3 }, 'latest staged value wins');
    assert.equal(await txn.readKey('ledger', 'ryw'), null, 'unstaged secondary absent');
    await txn.writeKey('ledger', 'ryw', { revision: 9 });
    assert.deepEqual(
      (await txn.readKey('ledger', 'ryw'))?.value,
      { revision: 9 },
      'secondary read-your-writes'
    );
    assert.deepEqual(
      (await txn.readKey('other', 'untouched'))?.value,
      { stored: 'other' },
      'untouched key served from the snapshot'
    );
  });
  assert.deepEqual((await getAppState('primary', 'ryw'))?.value, { stored: 3 });
});

test('file multi-key: a callback throw AFTER staged writes rolls back every key', async () => {
  await setAppState('primary', 'rb', { before: true });
  await setAppState('ledger', 'rb', { revision: 7 });
  await assert.rejects(
    withAppStateKeyTransaction('primary', 'rb', async (txn) => {
      await txn.write({ after: true });
      await txn.writeKey('ledger', 'rb', { revision: 8 });
      throw new Error('late failure');
    }),
    /late failure/
  );
  assert.deepEqual((await getAppState('primary', 'rb'))?.value, { before: true });
  assert.deepEqual((await getAppState('ledger', 'rb'))?.value, { revision: 7 });
});

test('file multi-key: a SECOND staged write failing rolls back the first (neither commits)', async () => {
  await setAppState('primary', 'sw', { before: true });
  __setAppStateWriteFailureForTests(new Error('ledger write refused'), 'ledger');
  try {
    await assert.rejects(
      withAppStateKeyTransaction('primary', 'sw', async (txn) => {
        await txn.write({ after: true }); // stages fine (primary scope unaffected)
        await txn.writeKey('ledger', 'sw', { revision: 1 }); // throws
      }),
      /ledger write refused/
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.deepEqual(
    (await getAppState('primary', 'sw'))?.value,
    { before: true },
    'first discarded'
  );
  assert.equal(await getAppState('ledger', 'sw'), null);
});

test('file multi-key: a failed FINAL replacement preserves the prior snapshot and types the failure', async () => {
  await setAppState('primary', 'fc', { before: true });
  __setAppStateFileCommitFailureForTests(new Error('disk full'));
  try {
    await assert.rejects(
      withAppStateKeyTransaction('primary', 'fc', async (txn) => {
        await txn.write({ after: true });
        await txn.writeKey('ledger', 'fc', { revision: 1 });
        return 'callback-ok';
      }),
      (err: unknown) => {
        assert.ok(err instanceof AppStateTxnFinalizeError);
        assert.equal(err.writeAttempted, false, 'atomic rename proves nothing applied');
        assert.match(String(err.cause), /disk full/);
        return true;
      }
    );
  } finally {
    __setAppStateFileCommitFailureForTests(null);
  }
  assert.deepEqual((await getAppState('primary', 'fc'))?.value, { before: true });
  assert.equal(await getAppState('ledger', 'fc'), null);

  // Retry after the failure commits cleanly (nothing was half-applied).
  await withAppStateKeyTransaction('primary', 'fc', async (txn) => {
    await txn.write({ after: true });
    await txn.writeKey('ledger', 'fc', { revision: 1 });
  });
  assert.deepEqual((await getAppState('primary', 'fc'))?.value, { after: true });
  assert.deepEqual((await getAppState('ledger', 'fc'))?.value, { revision: 1 });
});

test('file multi-key: staged values are invisible to plain reads before commit', async () => {
  const midTxn = deferred();
  const proceed = deferred();
  let observed: unknown = 'unread';
  const txnDone = withAppStateKeyTransaction('primary', 'vis', async (txn) => {
    await txn.write({ committed: true });
    midTxn.resolve();
    await proceed.promise;
  });
  await midTxn.promise;
  observed = (await getAppState('primary', 'vis'))?.value ?? null;
  proceed.resolve();
  await txnDone;
  assert.equal(observed, null, 'staged write invisible before the atomic commit');
  assert.deepEqual((await getAppState('primary', 'vis'))?.value, { committed: true });
});

test('file multi-key: an unrelated key written AFTER the snapshot is preserved by the commit', async () => {
  await setAppState('primary', 'u', { before: true });
  const staged = deferred();
  const proceed = deferred();
  const txnDone = withAppStateKeyTransaction('primary', 'u', async (txn) => {
    await txn.read(); // loads the snapshot now
    await txn.write({ after: true });
    staged.resolve();
    await proceed.promise;
  });
  await staged.promise;
  // A concurrent unrelated-key write lands AFTER this transaction's snapshot.
  await setAppState('unrelated', 'k', { concurrent: true });
  proceed.resolve();
  await txnDone;
  assert.deepEqual(
    (await getAppState('primary', 'u'))?.value,
    { after: true },
    'txn key committed'
  );
  assert.deepEqual(
    (await getAppState('unrelated', 'k'))?.value,
    { concurrent: true },
    'unrelated concurrent write NOT clobbered by the transaction commit'
  );
});

test('file accessor lifetime: readKey/writeKey/lockKey reject after the callback settles', async () => {
  let leaked: {
    readKey: (s: string, k: string) => Promise<unknown>;
    writeKey: (s: string, k: string, v: unknown) => Promise<void>;
    lockKey: (s: string, k: string) => Promise<void>;
  } | null = null;
  await withAppStateKeyTransaction('primary', 'life', async (txn) => {
    leaked = txn;
    await txn.write({ ok: true });
  });
  await assert.rejects(leaked!.readKey('ledger', 'life'), /already finished/);
  await assert.rejects(leaked!.writeKey('ledger', 'life', { x: 1 }), /already finished/);
  await assert.rejects(leaked!.lockKey('ledger', 'life'), /already finished/);
});

test('file lockKey: an explicit secondary lock serializes an independent writer of that key', async () => {
  await setAppState('status', 's', { floor: 10 });
  const acquired = deferred();
  const proceed = deferred();
  // Transaction A holds the status key's slot mid-flight.
  const runA = withAppStateKeyTransaction('primary', 'a', async (txn) => {
    await txn.lockKey('status', 's');
    acquired.resolve();
    await proceed.promise;
    await txn.writeKey('status', 's', { floor: 12 });
    await txn.write({ done: true });
  });
  await acquired.promise;
  // A transaction rooted at the status key cannot enter until A releases.
  let bEntered = false;
  const runB = withAppStateKeyTransaction('status', 's', async (txn) => {
    bEntered = true;
    const seen = (await txn.read()) as { value: { floor: number } } | null;
    return seen?.value.floor;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(bEntered, false, 'B is excluded while A holds the status slot');
  proceed.resolve();
  await runA;
  const bFloor = await runB;
  assert.equal(bEntered, true);
  assert.equal(bFloor, 12, 'B observed the value A committed under the lock');
});

// --- PostgreSQL: one client, one BEGIN/COMMIT, multi-key + multi-lock ---

test('pg multi-key: two keys commit on ONE client inside one begin/commit; visible only at commit', async () => {
  await withFakePg(async (pool) => {
    await withAppStateKeyTransaction('primary', 'p', async (txn) => {
      await txn.write({ n: 1 });
      await txn.writeKey('ledger', 'p', { revision: 1 });
      assert.equal(pool.committed.size, 0, 'staged, not yet committed');
    });
    assert.equal(pool.connectCount, 1, 'a single client served both keys');
    assert.deepEqual(JSON.parse(pool.committed.get('primary::p')!), { n: 1 });
    assert.deepEqual(JSON.parse(pool.committed.get('ledger::p')!), { revision: 1 });
  });
});

test('pg multi-key: read-your-writes across primary and secondary on the same client', async () => {
  await withFakePg(async (pool) => {
    await withAppStateKeyTransaction('primary', 'r', async (txn) => {
      await txn.write({ n: 2 });
      assert.deepEqual((await txn.read())?.value, { n: 2 }, 'primary RYW pre-commit');
      await txn.writeKey('ledger', 'r', { revision: 5 });
      assert.deepEqual((await txn.readKey('ledger', 'r'))?.value, { revision: 5 }, 'secondary RYW');
    });
    assert.deepEqual(JSON.parse(pool.committed.get('ledger::r')!), { revision: 5 });
  });
});

test('pg multi-key: a callback throw rolls back EVERY key (nothing commits)', async () => {
  await withFakePg(async (pool) => {
    await assert.rejects(
      withAppStateKeyTransaction('primary', 'x', async (txn) => {
        await txn.write({ n: 9 });
        await txn.writeKey('ledger', 'x', { revision: 9 });
        throw new Error('callback failed');
      }),
      /callback failed/
    );
    assert.equal(pool.committed.size, 0, 'no key committed');
    const log = clientLog(pool, 1);
    assert.ok(log.includes('client1:rollback'), 'the transaction rolled back');
    assert.ok(!log.includes('client1:commit'), 'nothing committed');
  });
});

test('pg multi-key: lockKey takes a deterministic set of advisory locks on the same client', async () => {
  await withFakePg(async (pool) => {
    await withAppStateKeyTransaction('primary', 'p', async (txn) => {
      // Explicit secondary lock — acquired on the SAME client.
      await txn.lockKey('status', 'p');
      await txn.writeKey('status', 'p', { floor: 1 });
      await txn.write({ n: 1 });
    });
    // Two advisory locks were taken by the one client (primary + status), both
    // released at commit.
    const locks = clientLog(pool, 1).filter((e) => e === 'client1:lock');
    assert.equal(locks.length, 2, 'primary + explicit secondary lock, same client');
    assert.equal(pool.connectCount, 1, 'no second client acquired');
    assert.equal(pool.locks.size, 0, 'all advisory locks released at commit');
  });
});

test('pg multi-key uncertainty: a lost COMMIT with staged multi-key writes is indeterminate (write-attempted)', async () => {
  await withFakePg(async (pool) => {
    pool.failures.commit = new Error('commit confirmation lost');
    await assert.rejects(
      withAppStateKeyTransaction('primary', 'u', async (txn) => {
        await txn.write({ n: 1 });
        await txn.writeKey('ledger', 'u', { revision: 1 });
      }),
      (err: unknown) => {
        assert.ok(err instanceof AppStateTxnFinalizeError);
        assert.equal(err.writeAttempted, true, 'mutation SQL was submitted → durability unknown');
        return true;
      }
    );
    // The uncertain client is destroyed, never returned to the pool as healthy.
    assert.ok(pool.destroyedIds.has(1));
  });
});

// ===========================================================================
// PLATFORM-086H3A-LOCK-ORDER — enforced monotonic canonical lock acquisition.
// `lockKey` rejects a backward acquisition FAIL-FAST (before any wait/query),
// so opposite-root transactions cannot deadlock (Postgres) or wedge the file
// chain. Ordering compares the canonical (scope, key) identity identically on
// both backends. Reacquiring a held lock is idempotent.
// ===========================================================================

// --- Generic comparator semantics (file backend; fast) ---

test('lock order: a forward secondary acquisition is accepted', async () => {
  await withAppStateKeyTransaction('lk', 'a', async (txn) => {
    await txn.lockKey('lk', 'b'); // lk::b > lk::a → forward
    await txn.write({ ok: true });
  });
  assert.deepEqual((await getAppState('lk', 'a'))?.value, { ok: true });
});

test('lock order: a BACKWARD secondary acquisition returns the typed error', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('lk', 'b', async (txn) => {
      await txn.lockKey('lk', 'a'); // lk::a < lk::b → backward
    }),
    (err: unknown) => {
      assert.ok(err instanceof AppStateTxnLockOrderError, String(err));
      assert.equal(err.attempted, JSON.stringify(['lk', 'a']));
      assert.equal(err.highestAcquired, JSON.stringify(['lk', 'b']));
      return true;
    }
  );
});

test('lock order: the typed error is DISTINCT from unavailability/finalize/cleanup', async () => {
  assert.ok(
    !(new AppStateTxnLockOrderError('lk::a', 'lk::b') instanceof AppStateKeyLockAcquireError)
  );
  assert.ok(!(new AppStateTxnLockOrderError('lk::a', 'lk::b') instanceof AppStateTxnFinalizeError));
  assert.ok(!(new AppStateTxnLockOrderError('lk::a', 'lk::b') instanceof AppStateTxnCleanupError));
});

test('lock order: a rejected backward acquisition persists NOTHING', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('lk', 'b', async (txn) => {
      await txn.write({ primary: true }); // staged
      await txn.lockKey('lk', 'a'); // backward → throws, rolling back the stage
    }),
    (err: unknown) => err instanceof AppStateTxnLockOrderError
  );
  assert.equal(await getAppState('lk', 'b'), null, 'no staged change committed');
});

test('lock order: reacquiring an already-held lock is idempotent (primary and secondary)', async () => {
  await withAppStateKeyTransaction('lk', 'a', async (txn) => {
    await txn.lockKey('lk', 'a'); // the primary itself — held, no-op
    await txn.lockKey('lk', 'b'); // forward
    await txn.lockKey('lk', 'b'); // held — no-op, no error
    await txn.write({ ok: true });
  });
  assert.deepEqual((await getAppState('lk', 'a'))?.value, { ok: true });
});

test('lock order: multiple forward secondary acquisitions succeed in ascending order', async () => {
  await withAppStateKeyTransaction('lk', 'a', async (txn) => {
    await txn.lockKey('lk', 'b');
    await txn.lockKey('lk', 'c');
    await txn.writeKey('lk', 'c', { v: 3 });
    await txn.write({ v: 1 });
  });
  assert.deepEqual((await getAppState('lk', 'c'))?.value, { v: 3 });
});

test('lock order: a backward acquisition AFTER multiple locks is rejected', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('lk', 'a', async (txn) => {
      await txn.lockKey('lk', 'c'); // forward (highest = lk::c)
      await txn.lockKey('lk', 'b'); // lk::b < lk::c, not held → backward
    }),
    (err: unknown) => {
      assert.ok(err instanceof AppStateTxnLockOrderError);
      assert.equal(err.attempted, JSON.stringify(['lk', 'b']));
      assert.equal(err.highestAcquired, JSON.stringify(['lk', 'c']));
      return true;
    }
  );
});

test('lock order: after a rejection, forward transactions still complete and canonical-order retries succeed', async () => {
  // A rejected backward transaction leaves nothing behind…
  await assert.rejects(
    withAppStateKeyTransaction('lk', 'b', async (txn) => txn.lockKey('lk', 'a')),
    (err: unknown) => err instanceof AppStateTxnLockOrderError
  );
  // …and both keys can then be driven successfully in canonical order (root at
  // the lower key, lock the higher one forward).
  await withAppStateKeyTransaction('lk', 'a', async (txn) => {
    await txn.lockKey('lk', 'b');
    await txn.write({ retried: 'a' });
    await txn.writeKey('lk', 'b', { retried: 'b' });
  });
  assert.deepEqual((await getAppState('lk', 'a'))?.value, { retried: 'a' });
  assert.deepEqual((await getAppState('lk', 'b'))?.value, { retried: 'b' });
});

// --- Prerequisite-B lock path (generic comparator; no B implementation) ---

test('lock order: the prereq-B path game-stats partition -> provider-refresh-status is forward; reverse is rejected', async () => {
  const PARTITION = ['game-stats', '2026:3:regular'] as const;
  const STATUS = ['provider-refresh-status', 'game-stats:2026:3:regular'] as const;
  // game-stats::… sorts BELOW provider-refresh-status::… ('g' < 'p'), so
  // partition -> status is the accepted forward direction.
  await withAppStateKeyTransaction(PARTITION[0], PARTITION[1], async (txn) => {
    await txn.lockKey(STATUS[0], STATUS[1]); // forward — accepted
    await txn.write({ committed: true });
  });
  assert.deepEqual((await getAppState(PARTITION[0], PARTITION[1]))?.value, { committed: true });

  // The reverse (root at status, lock the partition) is a backward violation.
  await assert.rejects(
    withAppStateKeyTransaction(STATUS[0], STATUS[1], async (txn) => {
      await txn.lockKey(PARTITION[0], PARTITION[1]);
    }),
    (err: unknown) => {
      assert.ok(err instanceof AppStateTxnLockOrderError);
      assert.equal(err.attempted, JSON.stringify(['game-stats', '2026:3:regular']));
      assert.equal(
        err.highestAcquired,
        JSON.stringify(['provider-refresh-status', 'game-stats:2026:3:regular'])
      );
      return true;
    }
  );
});

// --- Opposite-root deadlock scenario: FILE backend ---

test('file opposite-root race: reverse lockKey is rejected before waiting; A completes, no deadlock', async () => {
  const aInside = deferred();
  const aProceed = deferred();
  const bInside = deferred();
  const bProceed = deferred();
  let bError: unknown = null;
  let aResolved = false;

  // A is rooted at lk::a and will acquire lk::b FORWARD (waiting for B to release it).
  const runA = withAppStateKeyTransaction('lk', 'a', async (txn) => {
    aInside.resolve();
    await aProceed.promise;
    await txn.lockKey('lk', 'b'); // forward — queues behind B on lk::b's chain
    await txn.write({ who: 'A' });
    return 'A-done';
  });
  runA.then(() => (aResolved = true)).catch(() => (aResolved = true));
  await aInside.promise;

  // B is rooted at lk::b and will attempt lk::a BACKWARD.
  const runB = withAppStateKeyTransaction('lk', 'b', async (txn) => {
    bInside.resolve();
    await bProceed.promise;
    try {
      await txn.lockKey('lk', 'a'); // backward → rejected fail-fast
    } catch (err) {
      bError = err;
      throw err;
    }
  });
  await bInside.promise;

  // Let A park on lk::b (held by B's in-flight transaction).
  aProceed.resolve();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(aResolved, false, 'A is blocked waiting for lk::b held by B');

  // B attempts its backward lock: rejected immediately, never enqueues on lk::a.
  bProceed.resolve();
  await assert.rejects(runB, (err: unknown) => err instanceof AppStateTxnLockOrderError);
  assert.ok(bError instanceof AppStateTxnLockOrderError);

  // B released lk::b on rollback, so A's forward wait resolves and A commits.
  assert.equal(await runA, 'A-done');
  assert.deepEqual((await getAppState('lk', 'a'))?.value, { who: 'A' });
  assert.equal(await getAppState('lk', 'b'), null, 'B persisted nothing');
  // No file-fallback chain remains wedged.
  await new Promise((r) => setImmediate(r));
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

// --- Opposite-root deadlock scenario: PostgreSQL backend ---

test('pg opposite-root race: reverse lockKey is rejected before any advisory-lock query; A completes', async () => {
  await withFakePg(async (pool) => {
    const aInside = deferred();
    const aProceed = deferred();
    const bInside = deferred();
    const bProceed = deferred();
    let bError: unknown = null;
    let aResolved = false;

    const runA = withAppStateKeyTransaction('lock', 'a', async (txn) => {
      aInside.resolve();
      await aProceed.promise;
      await txn.lockKey('lock', 'b'); // forward — client parks on lock/b (held by B)
      await txn.write({ who: 'A' });
      return 'A-done';
    });
    runA.then(() => (aResolved = true)).catch(() => (aResolved = true));
    await aInside.promise;

    const runB = withAppStateKeyTransaction('lock', 'b', async (txn) => {
      bInside.resolve();
      await bProceed.promise;
      try {
        await txn.lockKey('lock', 'a'); // backward → rejected before the query
      } catch (err) {
        bError = err;
        throw err;
      }
    });
    await bInside.promise;

    // A parks as a waiter on lock/b.
    aProceed.resolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(aResolved, false, 'A parked waiting for lock/b held by B');
    assert.equal(
      clientLog(pool, 1).filter((e) => e === 'client1:lock').length,
      2,
      'A issued its primary + forward secondary lock'
    );

    // B attempts backward: rejected fail-fast, so it issues NO second lock query.
    bProceed.resolve();
    await assert.rejects(runB, (err: unknown) => err instanceof AppStateTxnLockOrderError);
    assert.ok(bError instanceof AppStateTxnLockOrderError);
    assert.equal(
      clientLog(pool, 2).filter((e) => e === 'client2:lock').length,
      1,
      'B issued ONLY its primary lock — never the backward one'
    );

    // B rolled back and released lock/b; A was granted it and committed.
    assert.equal(await runA, 'A-done');
    assert.deepEqual(JSON.parse(pool.committed.get('lock::a')!), { who: 'A' });
    assert.equal(pool.committed.has('lock::b'), false, 'B persisted nothing');
    // All advisory locks released — nothing wedged.
    assert.equal(pool.locks.size, 0);
  });
});

// ===========================================================================
// PLATFORM-086H3A-LOCK-IDENTITY-OVERLAP — injective lock identity (distinct
// tuples never collide) and per-transaction serialization of `lockKey` (so
// overlapping calls acquire monotonically in invocation order, never
// classifying independently).
// ===========================================================================

// --- Collision safety: distinct tuples a delimiter-only encoding would fuse ---

test('collision safety (file): ("a::b","c") and ("a","b::c") are DISTINCT, never idempotently held', async () => {
  // A delimiter-only identity would treat ('a','b::c') as already held here.
  // Injective identities make it a genuinely different lock — a backward
  // rejection (never an idempotent no-op) proves the two are DISTINCT. The
  // failed acquisition also POISONS the transaction: catching it does not let
  // the transaction commit.
  let caught: unknown = null;
  await assert.rejects(
    withAppStateKeyTransaction('a::b', 'c', async (txn) => {
      try {
        await txn.lockKey('a', 'b::c');
      } catch (err) {
        caught = err; // deliberately swallow — the transaction stays poisoned
      }
      await txn.write({ ok: true }); // staged, but must never commit
      return 'callback-success';
    }),
    (err: unknown) => {
      assert.ok(err instanceof AppStateTxnLockOrderError, String(err));
      assert.equal(err.attempted, JSON.stringify(['a', 'b::c']));
      assert.equal(err.highestAcquired, JSON.stringify(['a::b', 'c']));
      return true;
    }
  );
  assert.ok(caught instanceof AppStateTxnLockOrderError, 'the lockKey promise rejected distinctly');
  assert.notEqual(
    (caught as AppStateTxnLockOrderError).attempted,
    (caught as AppStateTxnLockOrderError).highestAcquired,
    'distinct identities, not a collision'
  );
  assert.equal(await getAppState('a::b', 'c'), null, 'poisoned transaction persisted nothing');
});

test('collision safety: delimiter/quote/unicode characters yield distinct injective identities', async () => {
  const pairs: Array<[string, string]> = [
    ['a::b', 'c'],
    ['a', 'b::c'],
    ['x/y', 'z'],
    ['x', 'y/z'],
    ['has"quote', 'k'],
    ['k', 'has"quote'],
    ['emoji-⚽', 'kन'],
  ];
  const ids = pairs.map(([s, k]) => JSON.stringify([s, k]));
  assert.equal(new Set(ids).size, ids.length, 'every distinct tuple has a distinct identity');

  // Root sorts below every fixture scope; acquiring the pairs in ascending
  // tuple order makes each a forward acquisition and none is mistaken for
  // already-held (a collision-fused pair would either no-op or reject here).
  const ascending = [...pairs].sort((x, y) =>
    x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0
  );
  await withAppStateKeyTransaction('  root', 'first', async (txn) => {
    for (const [s, k] of ascending) await txn.lockKey(s, k);
    await txn.write({ locked: ascending.length });
  });
  assert.deepEqual((await getAppState('  root', 'first'))?.value, { locked: pairs.length });
});

// --- Overlapping acquisition: serialized in invocation order ---

test('overlapping (file): two overlapping forward requests acquire in invocation order', async () => {
  const acquired: string[] = [];
  await withAppStateKeyTransaction('ov', 'a', async (txn) => {
    const b = txn.lockKey('ov', 'b').then(() => acquired.push('b'));
    const c = txn.lockKey('ov', 'c').then(() => acquired.push('c'));
    await Promise.all([b, c]);
    await txn.write({ ok: true });
  });
  assert.deepEqual(acquired, ['b', 'c'], 'invocation order preserved despite overlap');
});

test('overlapping (file): a later lock cannot acquire while an earlier lock is still pending', async () => {
  const holderIn = deferred();
  const holderRelease = deferred();
  const holder = withAppStateKeyTransaction('ov2', 'b', async () => {
    holderIn.resolve();
    await holderRelease.promise;
  });
  await holderIn.promise;

  const order: string[] = [];
  const main = withAppStateKeyTransaction('ov2', 'a', async (txn) => {
    const b = txn.lockKey('ov2', 'b').then(() => order.push('b')); // parks behind holder
    const c = txn.lockKey('ov2', 'c').then(() => order.push('c')); // queued behind b
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, [], 'c did not jump ahead while b is pending');
    holderRelease.resolve();
    await Promise.all([b, c]);
    await txn.write({ ok: true });
  });
  await holder;
  await main;
  assert.deepEqual(order, ['b', 'c'], 'serialized invocation order after b resolved');
});

test('overlapping (file): a queued BACKWARD request rejects; held/highest advance only on success', async () => {
  // The rejected backward 'a' never becomes held (a later forward 'd' still
  // acquires because the highest is 'c', proving state advanced only on
  // success), AND the failed acquisition POISONS the transaction even though the
  // callback caught it and continued — no staged write commits.
  let dAcquired = false;
  await assert.rejects(
    withAppStateKeyTransaction('ov3', 'b', async (txn) => {
      const c = txn.lockKey('ov3', 'c'); // forward
      const a = txn.lockKey('ov3', 'a'); // backward — poisons the transaction
      await c;
      await assert.rejects(a, (err: unknown) => err instanceof AppStateTxnLockOrderError);
      await txn.lockKey('ov3', 'd'); // forward 'd' > 'c' still succeeds
      dAcquired = true;
      await txn.write({ ok: true }); // staged, but must never commit
      return 'callback-success';
    }),
    (err: unknown) => err instanceof AppStateTxnLockOrderError
  );
  assert.equal(dAcquired, true, "'d' acquired: held/highest advanced only on success");
  assert.equal(await getAppState('ov3', 'b'), null, 'poisoned transaction persisted nothing');
});

test('overlapping (pg): overlapping forward requests serialize; no independent classification', async () => {
  await withFakePg(async (pool) => {
    const acquired: string[] = [];
    await withAppStateKeyTransaction('ov', 'a', async (txn) => {
      const b = txn.lockKey('ov', 'b').then(() => acquired.push('b'));
      const c = txn.lockKey('ov', 'c').then(() => acquired.push('c'));
      await Promise.all([b, c]);
      await txn.write({ ok: true });
    });
    assert.deepEqual(acquired, ['b', 'c']);
    assert.equal(
      clientLog(pool, 1).filter((e) => e === 'client1:lock').length,
      3,
      'primary + two ordered secondary advisory locks on one client'
    );
    assert.deepEqual(JSON.parse(pool.committed.get('ov::a')!), { ok: true });
  });
});

test('overlapping cannot recreate the opposite-root deadlock; canonical-order retry succeeds', async () => {
  const aIn = deferred();
  const aGo = deferred();
  const bIn = deferred();
  const bGo = deferred();
  let aResolved = false;

  const runA = withAppStateKeyTransaction('or', 'a', async (txn) => {
    aIn.resolve();
    await aGo.promise;
    await txn.lockKey('or', 'b'); // forward — waits for B
    await txn.write({ who: 'A' });
    return 'A';
  });
  runA.then(() => (aResolved = true)).catch(() => (aResolved = true));
  await aIn.promise;

  const runB = withAppStateKeyTransaction('or', 'b', async (txn) => {
    bIn.resolve();
    await bGo.promise;
    // Overlapping backward requests — all reject, none waits.
    const r1 = txn.lockKey('or', 'a');
    const r2 = txn.lockKey('or', 'a');
    await assert.rejects(r1, (e: unknown) => e instanceof AppStateTxnLockOrderError);
    await assert.rejects(r2, (e: unknown) => e instanceof AppStateTxnLockOrderError);
    throw new Error('B abandons'); // release B's primary
  });
  await bIn.promise;

  aGo.resolve();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(aResolved, false, 'A blocked on B (waiting, not deadlocked)');
  bGo.resolve();
  await assert.rejects(runB, /B abandons/);
  assert.equal(await runA, 'A', 'A completed once B released its primary');
  assert.deepEqual((await getAppState('or', 'a'))?.value, { who: 'A' });
  await new Promise((r) => setImmediate(r));
  assert.equal(__appStateKeyLockChainCountForTests(), 0, 'no wedged chains remain');

  await withAppStateKeyTransaction('or', 'a', async (txn) => {
    await txn.lockKey('or', 'b');
    await txn.write({ retried: true });
    await txn.writeKey('or', 'b', { retried: true });
  });
  assert.deepEqual((await getAppState('or', 'b'))?.value, { retried: true });
});

test('finalization does not race a lockKey invoked during the callback (drain before commit)', async () => {
  await withAppStateKeyTransaction('fin', 'a', async (txn) => {
    await txn.write({ committed: true });
    void txn.lockKey('fin', 'b'); // in flight at callback return — must be drained
  });
  assert.deepEqual((await getAppState('fin', 'a'))?.value, { committed: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

// ===========================================================================
// PLATFORM-086H3A-LOCK-FAILURE-POISON — a failed `lockKey` is a REQUIRED-lock
// failure that poisons the enclosing transaction (noncommittable) even when its
// promise was un-awaited, caught, or discarded; a successful un-awaited
// acquisition still drains and commits.
// ===========================================================================

type WithLockFailure = {
  lockFailure?: { kind: string; scope: string; key: string; error: unknown };
};

test('poison (file): an un-awaited backward lockKey poisons a returning callback; nothing commits, slots released', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('un', 'b', async (txn) => {
      await txn.write({ staged: true });
      void txn.lockKey('un', 'a'); // backward, un-awaited — poisons
      return 'callback-success'; // must never escape
    }),
    (err: unknown) => err instanceof AppStateTxnLockOrderError
  );
  assert.equal(await getAppState('un', 'b'), null, 'no staged write persisted');
  await new Promise((r) => setImmediate(r));
  assert.equal(__appStateKeyLockChainCountForTests(), 0, 'all chain slots released');
});

test('poison (pg): an un-awaited backward lockKey rolls back a returning callback; client released, locks freed', async () => {
  await withFakePg(async (pool) => {
    await assert.rejects(
      withAppStateKeyTransaction('un', 'b', async (txn) => {
        await txn.write({ staged: true });
        void txn.lockKey('un', 'a'); // backward, un-awaited
        return 'callback-success';
      }),
      (err: unknown) => err instanceof AppStateTxnLockOrderError
    );
    assert.equal(pool.committed.size, 0, 'rolled back — nothing committed');
    assert.ok(clientLog(pool, 1).includes('client1:rollback'));
    assert.deepEqual(pool.releases, [{ index: 1, destroyed: false }], 'client released healthy');
    assert.equal(pool.locks.size, 0, 'advisory locks released');
  });
});

test('poison (pg): a backend advisory-lock failure (un-awaited, caught, then a valid lock) still rejects, persists nothing', async () => {
  await withFakePg(async (pool) => {
    await assert.rejects(
      withAppStateKeyTransaction('bk', 'a', async (txn) => {
        // Fail the NEXT advisory-lock query (the secondary 'b'); the primary was
        // already acquired at begin.
        pool.perClientFailures['client1:lock'] = new Error('advisory lock acquisition failed');
        try {
          await txn.lockKey('bk', 'b'); // backend acquisition failure
        } catch {
          /* explicitly caught — the transaction stays poisoned */
        }
        await txn.lockKey('bk', 'c'); // another valid queued acquisition succeeds
        await txn.write({ ok: true });
        return 'callback-success';
      }),
      (err: unknown) => err instanceof Error && /advisory lock acquisition failed/.test(String(err))
    );
    assert.equal(pool.committed.size, 0, 'poisoned: nothing committed');
    assert.ok(clientLog(pool, 1).includes('client1:rollback'));
  });
});

test('poison (file): a backend acquisition failure (readFileStore) — caught, followed by staging — still rejects, persists nothing', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('pf', 'a', async (txn) => {
      await txn.write({ staged: true });
      await __corruptAppStateFileForTests(); // next acquireKeySlot readFileStore throws
      try {
        await txn.lockKey('pf', 'b'); // forward → backend (file read) failure
      } catch {
        /* explicitly caught */
      }
      return 'callback-success';
    }),
    (err: unknown) => err instanceof Error
  );
  await __deleteAppStateFileForTests(); // remove the corrupted store
  assert.equal(await getAppState('pf', 'a'), null, 'nothing persisted');
});

test('poison: callback error stays PRIMARY with the lock failure attached as typed secondary context', async () => {
  await assert.rejects(
    withAppStateKeyTransaction('cb', 'b', async (txn) => {
      await txn.write({ staged: true });
      void txn.lockKey('cb', 'a'); // backward, un-awaited → poisons
      throw new Error('callback boom'); // callback ALSO fails
    }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(String(err), /callback boom/, 'callback error is primary');
      const secondary = (err as WithLockFailure).lockFailure;
      assert.ok(secondary, 'lock failure attached as secondary context');
      assert.equal(secondary.kind, 'ordering');
      assert.equal(secondary.scope, 'cb');
      assert.equal(secondary.key, 'a');
      assert.ok(
        secondary.error instanceof AppStateTxnLockOrderError,
        'original lock error class preserved'
      );
      return true;
    }
  );
  assert.equal(await getAppState('cb', 'b'), null, 'nothing committed');
});

test('poison (pg): callback error PRIMARY + lock secondary; rollback completes, nothing commits', async () => {
  await withFakePg(async (pool) => {
    await assert.rejects(
      withAppStateKeyTransaction('cb', 'b', async (txn) => {
        void txn.lockKey('cb', 'a'); // backward → poisons
        await txn.write({ ok: true });
        throw new Error('callback boom');
      }),
      (err: unknown) => {
        assert.match(String(err), /callback boom/);
        assert.ok((err as WithLockFailure).lockFailure, 'lock failure attached');
        return true;
      }
    );
    assert.equal(pool.committed.size, 0);
    assert.ok(clientLog(pool, 1).includes('client1:rollback'));
    assert.equal(pool.locks.size, 0);
  });
});

test('drain success: a SUCCESSFUL un-awaited acquisition drains and commits normally (no false failure)', async () => {
  // Regression for RC 14: an un-awaited FORWARD lock completes before
  // finalization and does NOT poison — the transaction commits.
  await withAppStateKeyTransaction('ok', 'a', async (txn) => {
    await txn.write({ committed: true });
    void txn.lockKey('ok', 'b'); // forward, un-awaited — succeeds
  });
  assert.deepEqual((await getAppState('ok', 'a'))?.value, { committed: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(__appStateKeyLockChainCountForTests(), 0);

  await withFakePg(async (pool) => {
    await withAppStateKeyTransaction('ok', 'a', async (txn) => {
      await txn.write({ committed: true });
      void txn.lockKey('ok', 'b'); // forward, un-awaited — succeeds
    });
    assert.deepEqual(JSON.parse(pool.committed.get('ok::a')!), { committed: true });
    assert.equal(pool.locks.size, 0);
  });
});
