import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVATION_CONTROL_KEY,
  ACTIVATION_CONTROL_SCOPE,
  REVISIONED_EVIDENCE_WITNESS_KEY,
  setActivationState,
  validateActivationRecord,
} from '../activationControl.ts';
import { getGameStatsKey, writeLegacyGameStatsPartition } from '../cache.ts';
import { mergeGameStatsPartitionRevisioned, type DurableMergeInput } from '../durableMerge.ts';
import { parseV2GameObservation, type ParsedV2Observation } from '../contract.ts';
import type { WeeklyGameStats } from '../types.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';
import {
  getAppState,
  setAppState,
  withAppStateKeyTransaction,
  __appStateKeyLockChainCountForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';

// PLATFORM-086H3B-ACTIVATION-FENCE-CONCURRENCY — the activation-control fence is
// held SHARED by writers (legacy + revisioned) so unrelated partitions commit
// concurrently, and EXCLUSIVELY by activation transitions and repair CAS. These
// tests exercise that at the fence level (transactions replicating the exact
// writer / transition / repair lock orders) and with the real writers.

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const AC_SCOPE = ACTIVATION_CONTROL_SCOPE; // 'game-stats-activation-control'
const AC_KEY = ACTIVATION_CONTROL_KEY; // 'global'
const GS = 'game-stats'; // the partition (E) scope — sorts below AC_SCOPE

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise<void>((r) => setImmediate(r));
};

// A WRITER holds E(P) EXCLUSIVE (the primary root) then the activation fence SHARED
// — the exact lock order of both the legacy and revisioned writers.
function writerHoldingSharedFence(
  partitionKey: string,
  held: { resolve: () => void },
  release: Promise<void>,
  onEnter?: () => void
): Promise<void> {
  return withAppStateKeyTransaction(GS, partitionKey, async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
    onEnter?.();
    held.resolve();
    await release;
  });
}

async function activate(): Promise<void> {
  assert.ok((await setActivationState('armed')).ok);
  assert.ok((await setActivationState('active')).ok);
}

function obs(id: number): ParsedV2Observation {
  const parsed = parseV2GameObservation(wireGame({ id }));
  assert.ok(parsed.ok);
  return parsed.ok ? parsed.observation : (null as never);
}
function revInput(week: number): DurableMergeInput {
  return {
    year: 2024,
    week,
    seasonType: 'regular',
    fetchStartedAt: '2024-10-07T00:00:00.000Z',
    observations: [obs(week * 100 + 1)],
  };
}
function legacyStats(week: number): WeeklyGameStats {
  return {
    year: 2024,
    week,
    seasonType: 'regular',
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: week * 100 + 2 }))],
  };
}

// === Unrelated partitions are concurrent; same partition serializes (req 29) ===

test('unrelated partitions hold the SHARED activation fence concurrently', async () => {
  const aHeld = deferred();
  const releaseA = deferred();
  let aOpen = true;
  let bAcquiredWhileAHeld = false;
  const A = writerHoldingSharedFence('p1', aHeld, releaseA.promise).then(() => {
    aOpen = false;
  });
  await aHeld.promise;
  await withAppStateKeyTransaction(GS, 'p2', async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY); // must NOT block on p1's shared fence
    bAcquiredWhileAHeld = aOpen;
  });
  assert.equal(bAcquiredWhileAHeld, true, 'p2 held the shared fence while p1 still held it');
  releaseA.resolve();
  await A;
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

test('same-partition writers serialize on E(P) even with a shared fence', async () => {
  const aHeld = deferred();
  const releaseA = deferred();
  let bStarted = false;
  const A = writerHoldingSharedFence('same', aHeld, releaseA.promise);
  await aHeld.promise;
  const B = withAppStateKeyTransaction(GS, 'same', async (txn) => {
    bStarted = true; // reachable only once A releases the exclusive primary E(P)
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
  });
  await flush();
  assert.equal(bStarted, false, 'B blocked on the exclusive primary while A held it');
  releaseA.resolve();
  await Promise.all([A, B]);
  assert.equal(bStarted, true);
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

// === Transition fairness (req 30) ===

test('transition fairness: shared writer finishes, transition runs next, later shared cannot bypass and re-reads', async () => {
  await activate();
  const aHeld = deferred();
  const releaseA = deferred();
  const order: string[] = [];
  const A = writerHoldingSharedFence('pA', aHeld, releaseA.promise).then(() => order.push('A'));
  await aHeld.promise;

  // Transition queues EXCLUSIVE on the fence (it roots at activation-control).
  const T = setActivationState('read-only-safe').then((r) => {
    order.push('T');
    return r;
  });
  await flush(); // ensure the exclusive transition is enqueued before B arrives

  // Writer B requests the SHARED fence AFTER the transition queued — no bypass.
  let bObservedState = '';
  const B = withAppStateKeyTransaction(GS, 'pB', async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
    order.push('B');
    const record = validateActivationRecord((await txn.readKey<unknown>(AC_SCOPE, AC_KEY))?.value);
    bObservedState = record?.state ?? 'none';
  });
  await flush();
  assert.deepEqual(order, [], 'transition and B both wait behind the live shared writer');

  releaseA.resolve();
  const [transition] = await Promise.all([T, B, A]);
  assert.ok(transition.ok, 'the transition committed');
  assert.deepEqual(order, ['A', 'T', 'B'], 'A finished, transition ran next, B did not bypass it');
  assert.equal(bObservedState, 'read-only-safe', 'B re-read the transitioned state');
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

test('a writer already holding the shared fence commits before a queued transition', async () => {
  await activate();
  const aHeld = deferred();
  const releaseA = deferred();
  let wroteUnderActive = false;
  // Writer A holds the shared fence and writes its partition BEFORE releasing.
  const A = withAppStateKeyTransaction(GS, getGameStatsKey(2024, 9, 'regular'), async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
    aHeld.resolve();
    await releaseA.promise;
    await txn.write({ committed: true });
    wroteUnderActive = true;
  });
  await aHeld.promise;
  const T = setActivationState('read-only-safe');
  await flush();
  // A commits first (it already holds the shared fence); the transition runs after.
  releaseA.resolve();
  const [, transition] = await Promise.all([A, T]);
  assert.equal(wroteUnderActive, true, 'the in-flight shared writer committed');
  assert.ok(transition.ok);
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

// === Repair CAS holds the fence EXCLUSIVE (req 31) ===

test('repair holds the activation fence EXCLUSIVE: transitions, first-witness writes, and shared writers all block', async () => {
  const repairHeld = deferred();
  const releaseRepair = deferred();
  // Repair pattern: E(P) exclusive → activation-control EXCLUSIVE (lockKey).
  const R = withAppStateKeyTransaction(GS, 'pRepair', async (txn) => {
    await txn.lockKey(AC_SCOPE, AC_KEY);
    repairHeld.resolve();
    await releaseRepair.promise;
  });
  await repairHeld.promise;

  let transitionDone = false;
  let sharedWriterDone = false;
  let witnessWriteDone = false;
  const T = setActivationState('armed').then((r) => {
    transitionDone = true;
    return r;
  });
  const W = withAppStateKeyTransaction(GS, 'pShared', async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
    sharedWriterDone = true;
  });
  const Wit = withAppStateKeyTransaction(GS, 'pWitness', async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
    // A first-witness mutation is only reachable through the shared fence, which
    // repair's exclusive hold excludes.
    await txn.writeKey(AC_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY, { everExisted: true });
    witnessWriteDone = true;
  });
  await flush();
  assert.equal(transitionDone, false, 'transition blocked by repair’s exclusive fence');
  assert.equal(sharedWriterDone, false, 'shared writer blocked by repair’s exclusive fence');
  assert.equal(witnessWriteDone, false, 'first-witness write blocked by repair’s exclusive fence');

  releaseRepair.resolve();
  await Promise.all([R, T, W, Wit]);
  assert.ok(transitionDone && sharedWriterDone && witnessWriteDone, 'all proceeded after release');
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

// === Failure paths release the fence (req 32) ===

test('failure paths release the activation fence (no leak, never wedged)', async () => {
  // (1) shared writer callback failure
  await assert.rejects(
    withAppStateKeyTransaction(GS, 'f1', async (txn) => {
      await txn.lockKeyShared(AC_SCOPE, AC_KEY);
      throw new Error('writer boom');
    }),
    /writer boom/
  );
  assert.equal(__appStateKeyLockChainCountForTests(), 0);

  // (2) a transition that refuses (malformed record) leaks nothing
  await setAppState(AC_SCOPE, AC_KEY, { schemaVersion: 9 });
  const refused = await setActivationState('armed');
  assert.equal(refused.ok, false);
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();

  // (3) exclusive (repair-style) callback failure
  await assert.rejects(
    withAppStateKeyTransaction(GS, 'f2', async (txn) => {
      await txn.lockKey(AC_SCOPE, AC_KEY);
      throw new Error('repair boom');
    }),
    /repair boom/
  );
  assert.equal(__appStateKeyLockChainCountForTests(), 0);

  // The fence is usable afterward (both shared and exclusive).
  await withAppStateKeyTransaction(GS, 'f3', async (txn) => {
    await txn.lockKeyShared(AC_SCOPE, AC_KEY);
  });
  await withAppStateKeyTransaction(GS, 'f4', async (txn) => {
    await txn.lockKey(AC_SCOPE, AC_KEY);
  });
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

// === Real writers, run concurrently (req 29 / witness determinism) ===

test('real legacy writers for different partitions all commit concurrently', async () => {
  const results = await Promise.all(
    [1, 2, 3].map((w) => writeLegacyGameStatsPartition(legacyStats(w)))
  );
  for (const r of results) assert.deepEqual(r, { ok: true });
  for (const w of [1, 2, 3]) {
    assert.ok((await getAppState(GS, getGameStatsKey(2024, w, 'regular')))?.value);
  }
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});

test('real revisioned writers for different partitions all commit; the witness is deterministic', async () => {
  await activate();
  const results = await Promise.all(
    [1, 2, 3].map((w) => mergeGameStatsPartitionRevisioned(revInput(w)))
  );
  for (const r of results) {
    assert.notEqual(r.outcome, 'unavailable', JSON.stringify(r));
  }
  // Every partition committed evidence.
  for (const w of [1, 2, 3]) {
    assert.ok((await getAppState(GS, getGameStatsKey(2024, w, 'regular')))?.value);
  }
  // Concurrent first commits produced a single deterministic witness value.
  const witness = await getAppState(AC_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY);
  assert.deepEqual(witness?.value, { everExisted: true });
  assert.equal(__appStateKeyLockChainCountForTests(), 0);
});
