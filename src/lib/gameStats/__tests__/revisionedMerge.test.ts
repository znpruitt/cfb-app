import assert from 'node:assert/strict';
import test from 'node:test';

import { parseV2GameObservation, type ParsedV2Observation } from '../contract.ts';
import { getGameStatsKey } from '../cache.ts';
import {
  computeWeeklyGameStatsMerge,
  mergeGameStatsPartitionRevisioned,
  type DurableMergeInput,
} from '../durableMerge.ts';
import { setActivationState } from '../activationControl.ts';
import { GAME_STATS_REVISION_SCOPE, type RevisionLedgerRecord } from '../revisionAuthority.ts';
import type { WeeklyGameStats } from '../types.ts';
import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateFileCommitFailureForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const BASE = { year: 2024, week: 6, seasonType: 'regular' as const };
const KEY = getGameStatsKey(BASE.year, BASE.week, BASE.seasonType);
const T1 = '2024-10-07T00:00:00.000Z';
const T2 = '2024-10-08T00:00:00.000Z';
const T3 = '2024-10-09T00:00:00.000Z';

function obs(id: number, overrides: Parameters<typeof wireGame>[0] = {}): ParsedV2Observation {
  const parsed = parseV2GameObservation(wireGame({ ...overrides, id }));
  assert.ok(parsed.ok);
  return parsed.ok ? parsed.observation : (null as never);
}

function input(fetchStartedAt: string, observations: ParsedV2Observation[]): DurableMergeInput {
  return { ...BASE, fetchStartedAt, observations };
}

async function activate(): Promise<void> {
  assert.ok((await setActivationState('armed')).ok);
  assert.ok((await setActivationState('active')).ok);
}

async function readLedger(): Promise<RevisionLedgerRecord | null> {
  return (await getAppState<RevisionLedgerRecord>(GAME_STATS_REVISION_SCOPE, KEY))?.value ?? null;
}
async function readPartition(): Promise<WeeklyGameStats | null> {
  return (await getAppState<WeeklyGameStats>('game-stats', KEY))?.value ?? null;
}
async function witnessSet(): Promise<boolean> {
  const w = await getAppState('game-stats-activation-control', 'revisioned-evidence-witness');
  return Boolean(w?.value && (w.value as { everExisted?: unknown }).everExisted === true);
}

test('DORMANT: the revisioned writer refuses while the fence is legacy', async () => {
  // Default (absent) fence is legacy → no revisioned write, no ledger, no stamp.
  const result = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'activation-fenced');
  assert.equal(await readPartition(), null);
  assert.equal(await readLedger(), null);
});

test('revisioned writes are fenced OFF in armed and read-only-safe (only active)', async () => {
  await setActivationState('armed');
  const armed = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  assert.equal(armed.unavailableReason, 'activation-fenced');
  assert.equal(await readPartition(), null);
  assert.equal(await witnessSet(), false);

  await setActivationState('read-only-safe');
  const safe = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  assert.equal(safe.unavailableReason, 'activation-fenced');
  assert.equal(await readPartition(), null);
});

test('active: first change allocates revision 1, co-commits ledger, and sets the witness', async () => {
  await activate();
  assert.equal(await witnessSet(), false); // reaching active does NOT set the witness
  const result = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  assert.equal(result.outcome, 'written');
  assert.ok(result.commit, 'commit stamp attached after COMMIT');
  assert.equal(result.commit!.stamp.revision, 1);
  const lineage = result.commit!.stamp.lineage;
  assert.ok(lineage.length > 0);

  const partition = await readPartition();
  assert.deepEqual(partition?.commitStamp, { lineage, revision: 1 });
  const ledger = await readLedger();
  assert.equal(ledger?.revision, 1);
  assert.equal(ledger?.lineage, lineage);
  // The partition was ABSENT pre-merge (first write), so this is a genuinely-new
  // scope, not a recognized-legacy one.
  assert.equal(ledger?.initializedFrom, 'new');
  // The durable global witness is now set (atomically with the first commit).
  assert.equal(await witnessSet(), true);
});

test('read-only-safe completing first excludes a later revisioned write', async () => {
  await activate();
  await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)])); // revision 1
  // The safe-stop transition completes…
  assert.ok((await setActivationState('read-only-safe')).ok);
  // …and no revisioned evidence commits after it (the in-txn fence refuses).
  const after = await mergeGameStatsPartitionRevisioned(
    input(T2, [obs(1, { home: { points: 41 } })])
  );
  assert.equal(after.unavailableReason, 'activation-fenced');
  assert.equal((await readLedger())?.revision, 1); // unchanged
});

test('recognized pre-revision legacy partition initializes lineage from legacy', async () => {
  // A durable partition of legacy-shaped rows with no commit stamp.
  const legacy: WeeklyGameStats = {
    ...BASE,
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: 1 }))],
  };
  await setAppState('game-stats', KEY, legacy);
  await activate();
  // A newer observation upgrades the legacy row → recognized-legacy bootstrap.
  const result = await mergeGameStatsPartitionRevisioned(
    input(T2, [obs(1, { home: { points: 41 } })])
  );
  assert.equal(result.outcome, 'written');
  assert.equal(result.commit!.stamp.revision, 1);
  assert.equal((await readLedger())?.initializedFrom, 'legacy');
});

test('ordinary allocation advances revision on each subsequent change', async () => {
  await activate();
  const r1 = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  assert.equal(r1.commit!.stamp.revision, 1);
  // A strictly newer, content-changing observation → revision 2, same lineage.
  const r2 = await mergeGameStatsPartitionRevisioned(input(T2, [obs(1, { home: { points: 41 } })]));
  assert.equal(r2.outcome, 'written');
  assert.equal(r2.commit!.stamp.revision, 2);
  assert.equal(r2.commit!.stamp.lineage, r1.commit!.stamp.lineage);
  assert.equal((await readLedger())?.revision, 2);
});

test('no-change merges allocate no revision (ledger untouched)', async () => {
  await activate();
  await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  // Same fence, identical content → unchanged, no new revision.
  const again = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  assert.equal(again.outcome, 'unchanged');
  assert.equal(again.commit, undefined);
  assert.equal((await readLedger())?.revision, 1);
});

test('process restart: the persisted ledger remains the sole allocator', async () => {
  await activate();
  await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  await mergeGameStatsPartitionRevisioned(input(T2, [obs(1, { home: { points: 41 } })]));
  assert.equal((await readLedger())?.revision, 2);

  // Simulate a process restart: drop in-process state (locks/pool) but KEEP the
  // durable file. The ledger — not any reconstruction — drives the next number.
  __resetAppStateForTests();
  const r3 = await mergeGameStatsPartitionRevisioned(input(T3, [obs(1, { home: { points: 55 } })]));
  assert.equal(r3.commit!.stamp.revision, 3);
});

test('concurrent allocation on one partition serializes to distinct revisions', async () => {
  await activate();
  // Two concurrent inserts of DIFFERENT games at the same fence: both change, so
  // both allocate; the primitive serializes them on the partition lock.
  const [a, b] = await Promise.all([
    mergeGameStatsPartitionRevisioned(input(T1, [obs(10)])),
    mergeGameStatsPartitionRevisioned(input(T1, [obs(20)])),
  ]);
  const revisions = [a.commit?.stamp.revision, b.commit?.stamp.revision].sort();
  assert.deepEqual(revisions, [1, 2], 'distinct revisions, none reused');
  const ledger = await readLedger();
  assert.equal(ledger?.revision, 2);
  // Both games survived (disjoint inserts never lost).
  const ids = (await readPartition())?.games.map((g) => g.providerGameId).sort((x, y) => x - y);
  assert.deepEqual(ids, [10, 20]);
});

test('atomic co-commit: a failed COMMIT persists NEITHER evidence nor ledger', async () => {
  await activate();
  __setAppStateFileCommitFailureForTests(new Error('commit boom'));
  const result = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
  __setAppStateFileCommitFailureForTests(null);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'transaction-finalize-failed');
  // All-or-nothing: neither the partition stamp nor the ledger became durable.
  assert.equal(await readPartition(), null);
  assert.equal(await readLedger(), null);
});

test('revision block: a lineage conflict refuses the write, durable state untouched', async () => {
  // Seed a partition stamped lineage L1 alongside a ledger of lineage L2.
  const seed = computeWeeklyGameStatsMerge(
    null,
    input('2024-10-06T00:00:00.000Z', [obs(1)])
  ).partition!;
  seed.commitStamp = { lineage: 'L1', revision: 1 };
  await setAppState('game-stats', KEY, seed);
  await setAppState<RevisionLedgerRecord>(GAME_STATS_REVISION_SCOPE, KEY, {
    schemaVersion: 1,
    year: BASE.year,
    week: BASE.week,
    seasonType: BASE.seasonType,
    lineage: 'L2',
    revision: 1,
    initializedFrom: 'new',
    initializedAt: '2024-10-06T00:00:00.000Z',
  });
  await activate();
  const result = await mergeGameStatsPartitionRevisioned(
    input(T2, [obs(1, { home: { points: 41 } })])
  );
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.unavailableReason, 'revision-lineage-conflict');
  // Durable state preserved bit-for-bit.
  assert.deepEqual((await readPartition())?.commitStamp, { lineage: 'L1', revision: 1 });
  assert.equal((await readLedger())?.lineage, 'L2');
});

test('a present-invalid ledger ROW blocks allocation as ambiguous (present, not value, decides)', async () => {
  for (const bad of [null, { corrupt: true }]) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await activate();
    // A present ledger row that does not validate (incl. JSON null) is a
    // revision-era marker — allocation must block, writing nothing.
    await setAppState(GAME_STATS_REVISION_SCOPE, KEY, bad);
    const result = await mergeGameStatsPartitionRevisioned(input(T1, [obs(1)]));
    assert.equal(result.outcome, 'unavailable', JSON.stringify(bad));
    assert.equal(result.unavailableReason, 'revision-history-ambiguous', JSON.stringify(bad));
    assert.equal(result.commit, undefined);
    assert.equal(await readPartition(), null); // no evidence written
    assert.deepEqual((await getAppState(GAME_STATS_REVISION_SCOPE, KEY))?.value, bad); // ledger unchanged
  }
});
