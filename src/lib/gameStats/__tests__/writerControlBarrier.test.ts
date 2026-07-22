import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppStateTxnLockOrderError,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  withAppStateKeyTransaction,
} from '../../server/appStateStore.ts';
import { getCachedGameStats, writeLegacyGameStatsPartition } from '../cache.ts';
import { parseV2GameObservation } from '../contract.ts';
import { mergeGameStatsPartitionDurable } from '../durableMerge.ts';
import { transitionWriterControl } from '../writerControlTransition.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_SCOPE,
  classifyLegacyWrite,
  toWriterControlRead,
} from '../writerFence.ts';
import type { WeeklyGameStats } from '../types.ts';
import { seedActiveWriterControl, seedWriterControlState } from './writerControlSeed.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

// PLATFORM-086H3D — the two rollout serialization barriers, proven
// DETERMINISTICALLY on the file fallback's in-process lock chains (the fake-pg
// harness in `src/lib/server/__tests__/appStateKeyTransaction.test.ts` proves
// the same barriers over the PostgreSQL branch with the real writers gated at
// their write statements):
//
//   1. `legacy → armed` cannot commit while a legacy write holds the control
//      lock; the write completes FIRST, and a writer arriving after the
//      completed transition rereads `armed` and refuses.
//   2. `active → read-only-safe` cannot commit while an H2 write holds the
//      control lock; the H2 write completes FIRST, and an H2 writer arriving
//      after the completed stop rereads `read-only-safe` and refuses — an
//      earlier out-of-transaction observation of `active` grants nothing.
//
// The held critical sections below reproduce the writers' EXACT lock shape
// (transaction rooted on the partition key E(P), control key G taken EXCLUSIVE
// via `lockKey`, control reread under both locks), held open under test
// control — the real writers cannot be paused mid-transaction on this backend.

const BASE = { year: 2024, week: 6, seasonType: 'regular' as const };
const PARTITION_KEY = `${BASE.year}:${BASE.week}:${BASE.seasonType}`;
const T1 = '2024-10-07T00:00:00.000Z';
const T2 = '2024-10-08T00:00:00.000Z';

function legacyPartition(id: number, fetchedAt: string): WeeklyGameStats {
  return { ...BASE, fetchedAt, games: [legacyRowFromWire(wireGame({ id }))] };
}

function observation(id: number) {
  const parsed = parseV2GameObservation(wireGame({ id }));
  assert.ok(parsed.ok);
  return parsed.ok ? parsed.observation : (null as never);
}

async function controlState(): Promise<string> {
  const row = await getAppState<{ state: string }>(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY);
  assert.ok(row, 'control row present');
  return row!.value.state;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('barrier: legacy→armed waits for a legacy write holding control; the next writer rereads armed and refuses', async () => {
  await seedWriterControlState('legacy');
  let transitionPromise: ReturnType<typeof transitionWriterControl> | null = null;
  let transitionSettled = false;

  // The fenced legacy writer's exact critical section, held open: root on the
  // partition, take control EXCLUSIVE, gate-check `legacy`, then write.
  await withAppStateKeyTransaction('game-stats', PARTITION_KEY, async (txn) => {
    await txn.lockKey(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY);
    const gate = classifyLegacyWrite(
      toWriterControlRead(await txn.readKey<unknown>(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY))
    );
    assert.ok(gate.allow, 'the held write passed its gate under legacy');

    // The operator transition arrives WHILE the write holds the control lock:
    // it roots on the control key and queues behind this transaction.
    transitionPromise = transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
    void transitionPromise.then(() => {
      transitionSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(transitionSettled, false, 'the transition is queued, not committed');
    assert.equal(await controlState(), 'legacy', 'control is still legacy mid-hold');

    await txn.write(legacyPartition(401_000_001, T1));
  });

  // The held write committed FIRST; only then does the queued transition run.
  assert.deepEqual(await transitionPromise!, {
    kind: 'transitioned',
    from: 'legacy',
    to: 'armed',
  });
  assert.equal(await controlState(), 'armed');
  const written = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
  assert.equal(written!.games[0]!.providerGameId, 401_000_001);

  // A REAL legacy writer arriving after the completed transition rereads
  // `armed` under both locks and refuses without mutation.
  const after = await writeLegacyGameStatsPartition(legacyPartition(401_000_002, T2));
  assert.deepEqual(after, { ok: false, reason: 'writer-control-not-legacy', state: 'armed' });
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), written);
});

test('barrier: active→read-only-safe waits for an H2 write holding control; the next H2 write rereads and refuses', async () => {
  await seedActiveWriterControl();
  let stopPromise: ReturnType<typeof transitionWriterControl> | null = null;
  let stopSettled = false;

  // H2's exact lock shape, held open: root on the partition, take control
  // EXCLUSIVE, authorization-check `active`, then write.
  await withAppStateKeyTransaction('game-stats', PARTITION_KEY, async (txn) => {
    await txn.lockKey(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY);
    const control = toWriterControlRead(
      await txn.readKey<unknown>(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY)
    );
    assert.ok(control.present && control.record?.state === 'active');

    stopPromise = transitionWriterControl({
      expected: 'active',
      to: 'read-only-safe',
      apply: true,
    });
    void stopPromise.then(() => {
      stopSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopSettled, false, 'the stop transition is queued, not committed');
    assert.equal(await controlState(), 'active', 'control is still active mid-hold');

    await txn.write({ ...BASE, fetchedAt: T1, games: [] });
  });

  assert.deepEqual(await stopPromise!, {
    kind: 'transitioned',
    from: 'active',
    to: 'read-only-safe',
  });
  const afterHold = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
  assert.ok(afterHold, 'the held write committed before the stop');

  // A REAL H2 write arriving after the completed stop rereads
  // `read-only-safe` under both locks and refuses without mutation.
  const late = await mergeGameStatsPartitionDurable({
    ...BASE,
    fetchStartedAt: T2,
    observations: [observation(77)],
  });
  assert.equal(late.outcome, 'unavailable');
  assert.equal(late.unavailableReason, 'control-not-active');
  assert.equal(late.controlState, 'read-only-safe');
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), afterHold);
});

test('barrier: no H2 write commits on an earlier out-of-transaction observation of active', async () => {
  await seedActiveWriterControl();
  // A hypothetical orchestrator observes `active` OUTSIDE any transaction…
  assert.equal(await controlState(), 'active');
  // …then a stop transition COMPLETES…
  assert.equal(
    (await transitionWriterControl({ expected: 'active', to: 'read-only-safe', apply: true })).kind,
    'transitioned'
  );
  // …and the write based on that stale observation still refuses, because the
  // permission check rereads the control INSIDE the partition transaction.
  const result = await mergeGameStatsPartitionDurable({
    ...BASE,
    fetchStartedAt: T1,
    observations: [observation(88)],
  });
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'control-not-active');
  assert.equal(result.controlState, 'read-only-safe');
  assert.equal(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), null);
});

test('lock order: partition-before-control remains the canonical forward order; the reverse is rejected', async () => {
  await seedActiveWriterControl();
  // Forward: a REAL H2 merge (partition primary → control lockKey) succeeds —
  // a violated order would throw AppStateTxnLockOrderError loudly instead.
  const merge = await mergeGameStatsPartitionDurable({
    ...BASE,
    fetchStartedAt: T1,
    observations: [observation(99)],
  });
  assert.equal(merge.outcome, 'written');

  // Reverse: a transaction rooted on the CONTROL key must NOT be able to take
  // a partition lock afterwards — the primitive rejects it fail-fast, which is
  // exactly why the transition authority takes no secondary locks at all.
  await assert.rejects(
    withAppStateKeyTransaction(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY, async (txn) => {
      await txn.lockKey('game-stats', PARTITION_KEY);
    }),
    (error) => error instanceof AppStateTxnLockOrderError
  );
});
