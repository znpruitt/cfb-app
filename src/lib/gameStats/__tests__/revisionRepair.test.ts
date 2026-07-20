import assert from 'node:assert/strict';
import test from 'node:test';

import { getGameStatsKey } from '../cache.ts';
import {
  inspectRevisionState,
  readRevisionAuditTrail,
  repairRevisionState,
  RECOVERY_DISPOSITION_SCOPE,
  type RevisionInspection,
  type RevisionRepairAction,
} from '../revisionRepair.ts';
import { GAME_STATS_REVISION_SCOPE, type RevisionLedgerRecord } from '../revisionAuthority.ts';
import { parseV2GameObservation } from '../contract.ts';
import { mergeGameStatsPartitionRevisioned } from '../durableMerge.ts';
import { setActivationState } from '../activationControl.ts';
import type { CommitStamp } from '../revisionStamp.ts';
import type { WeeklyGameStats } from '../types.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../../providerRefreshScope.ts';
import {
  getAppState,
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

const AUDIT_SCOPE = 'game-stats-revision-audit';
const ACTIVATION_SCOPE = 'game-stats-activation-control';
const T0 = '2024-10-06T00:00:00.000Z';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const ID = { year: 2024, week: 6, seasonType: 'regular' as const };
const KEY = getGameStatsKey(ID.year, ID.week, ID.seasonType);
const STATUS_KEY = providerRefreshScopeKey(
  'game-stats',
  weekPartitionScope(ID.year, ID.week, ID.seasonType)
);
const ACTOR = 'clerk:admin-1';

function partitionWith(stamp: CommitStamp | undefined): WeeklyGameStats {
  return {
    ...ID,
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: 1 }))],
    ...(stamp ? { commitStamp: stamp } : {}),
  };
}
function ledger(lineage: string, revision: number): RevisionLedgerRecord {
  return {
    schemaVersion: 1,
    ...ID,
    lineage,
    revision,
    initializedFrom: 'new',
    initializedAt: '2024-10-06T00:00:00.000Z',
  };
}
async function digest(): Promise<string> {
  const inspection = (await inspectRevisionState(ID)) as RevisionInspection;
  assert.ok('expectedStateDigest' in inspection);
  return inspection.expectedStateDigest;
}
async function readLedger(): Promise<RevisionLedgerRecord | null> {
  return (await getAppState<RevisionLedgerRecord>(GAME_STATS_REVISION_SCOPE, KEY))?.value ?? null;
}
async function auditEntries() {
  const audit = await readRevisionAuditTrail(ID);
  assert.equal(audit.state, 'available');
  return audit.state === 'available' ? audit.entries : [];
}
const req = (
  action: RevisionRepairAction,
  digestStr: string,
  extra: Record<string, unknown> = {}
) => ({
  identity: ID,
  action,
  expectedStateDigest: digestStr,
  actor: ACTOR,
  reason: 'operator recovery',
  ...extra,
});

// === Inspection ===

test('inspection returns safe structured state and an expected-state digest', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 5 }));
  const inspection = (await inspectRevisionState(ID)) as RevisionInspection;
  assert.equal(inspection.state.partition.stampClass, 'valid');
  assert.deepEqual(inspection.state.partition.stamp, { lineage: 'L', revision: 5 });
  assert.equal(inspection.state.ledger, null);
  assert.ok(inspection.expectedStateDigest.length > 0);
});

// === rebuild-ledger ===

test('rebuild-ledger derives the ledger from surviving same-lineage evidence (dry-run first)', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 5 }));
  const d = await digest();

  // Default dry-run writes nothing.
  const dry = await repairRevisionState(req({ kind: 'rebuild-ledger' }, d));
  assert.ok(dry.ok && dry.dryRun);
  assert.equal(await readLedger(), null);

  // Apply.
  const applied = await repairRevisionState(
    req({ kind: 'rebuild-ledger' }, d, { apply: true, dryRun: false })
  );
  assert.ok(applied.ok && !applied.dryRun);
  const led = await readLedger();
  assert.deepEqual(
    { lineage: led?.lineage, revision: led?.revision, from: led?.initializedFrom },
    {
      lineage: 'L',
      revision: 5,
      from: 'repair',
    }
  );
  const audit = await auditEntries();
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.actor, ACTOR);
  assert.equal(audit[0]!.action.kind, 'rebuild-ledger');
});

test('rebuild-ledger refuses malformed / stampless evidence', async () => {
  await setAppState('game-stats', KEY, partitionWith(undefined)); // legacy, no stamp
  const d = await digest();
  const result = await repairRevisionState(req({ kind: 'rebuild-ledger' }, d, { dryRun: false }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'malformed-evidence');
});

// === adopt-lineage ===

test('adopt-lineage requires acknowledgement over a conflicting lineage, then reconciles', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L1', revision: 3 }));
  await setAppState(GAME_STATS_REVISION_SCOPE, KEY, ledger('L2', 3));
  const d = await digest();
  const action: RevisionRepairAction = { kind: 'adopt-lineage', lineage: 'L1', floor: 5 };

  // Conflicting lineage without acknowledgement → refused.
  const refused = await repairRevisionState(req(action, d, { dryRun: false }));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, 'acknowledgement-required');

  // With acknowledgement → ledger + status stamp + partition metadata reconciled.
  const ok = await repairRevisionState(
    req(action, d, { dryRun: false, acknowledgeLineageConflict: true })
  );
  assert.ok(ok.ok);
  assert.deepEqual(
    { l: (await readLedger())?.lineage, r: (await readLedger())?.revision },
    { l: 'L1', r: 5 }
  );
  const partition = (await getAppState<WeeklyGameStats>('game-stats', KEY))?.value;
  assert.deepEqual(partition?.commitStamp, { lineage: 'L1', revision: 5 });
  const status = (
    await getAppState<{ lastCommittedStamp?: CommitStamp }>('provider-refresh-status', STATUS_KEY)
  )?.value;
  assert.deepEqual(status?.lastCommittedStamp, { lineage: 'L1', revision: 5 });
  const audit = await auditEntries();
  assert.equal(audit[0]!.supersededLineage, 'L2');
});

test('adopt-lineage refuses a floor below surviving same-lineage evidence', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 5 }));
  const d = await digest();
  const result = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 2 }, d, { dryRun: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'revision-repair-floor-below-surviving-history');
});

test('repair floors that cannot advance safely are refused (MAX / unsafe / nonpositive)', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 1 }));
  const MAX = Number.MAX_SAFE_INTEGER;
  for (const floor of [MAX, MAX + 1, 0, -3]) {
    const d = await digest();
    const adopt = await repairRevisionState(
      req({ kind: 'adopt-lineage', lineage: 'L', floor }, d, {
        dryRun: false,
        acknowledgeLineageConflict: true,
      })
    );
    assert.equal(adopt.ok, false, `adopt floor ${floor}`);
    if (!adopt.ok) assert.equal(adopt.code, 'revision-repair-floor-not-advanceable');

    const establish = await repairRevisionState(
      req({ kind: 'establish-new-lineage', floor }, d, {
        dryRun: false,
        acknowledgeEvidenceLoss: true,
      })
    );
    assert.equal(establish.ok, false, `establish floor ${floor}`);
    if (!establish.ok) assert.equal(establish.code, 'revision-repair-floor-not-advanceable');
  }
  // Nothing was written by any refused plan.
  assert.equal((await getAppState(GAME_STATS_REVISION_SCOPE, KEY))?.value ?? null, null);
});

// === establish-new-lineage ===

test('establish-new-lineage requires evidence-loss acknowledgement and preserves history', async () => {
  await setAppState(GAME_STATS_REVISION_SCOPE, KEY, ledger('OLD', 4));
  const d = await digest();

  const refused = await repairRevisionState(
    req({ kind: 'establish-new-lineage' }, d, { dryRun: false })
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, 'acknowledgement-required');

  const ok = await repairRevisionState(
    req({ kind: 'establish-new-lineage', floor: 10 }, d, {
      dryRun: false,
      acknowledgeEvidenceLoss: true,
    })
  );
  assert.ok(ok.ok);
  const led = await readLedger();
  assert.equal(led?.revision, 10);
  assert.notEqual(led?.lineage, 'OLD'); // a fresh lineage
  const audit = await auditEntries();
  assert.equal(audit[0]!.supersededLineage, 'OLD'); // history preserved
});

// === Compare-and-set + active-claim guards ===

test('a repair refuses when durable state changed since inspection (CAS)', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 5 }));
  const stale = await digest();
  // Mutate durable state after inspection.
  await setAppState(GAME_STATS_REVISION_SCOPE, KEY, ledger('L', 5));
  const result = await repairRevisionState(
    req({ kind: 'rebuild-ledger' }, stale, { dryRun: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'revision-repair-state-changed');
});

test('a repair refuses while an unexpired recovery claim exists', async () => {
  await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 5 }));
  await setAppState(RECOVERY_DISPOSITION_SCOPE, KEY, {
    claim: { attemptToken: 't', leaseExpiresAt: '2999-01-01T00:00:00.000Z' },
  });
  const d = await digest();
  const result = await repairRevisionState(req({ kind: 'rebuild-ledger' }, d, { dryRun: false }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'active-recovery-claim');

  // An EXPIRED claim does not block.
  await setAppState(RECOVERY_DISPOSITION_SCOPE, KEY, {
    claim: { attemptToken: 't', leaseExpiresAt: '2000-01-01T00:00:00.000Z' },
  });
  const d2 = await digest();
  const ok = await repairRevisionState(req({ kind: 'rebuild-ledger' }, d2, { dryRun: false }));
  assert.ok(ok.ok);
});

// === PLATFORM-086H3B-REPAIR-SAFETY-DOCS ===

// Malformed evidence is a HARD refusal for every action; acknowledgement cannot
// convert structurally invalid evidence into valid evidence.
test('malformed evidence hard-refuses every action, ignoring acknowledgements', async () => {
  const malformed: Array<[string, unknown]> = [
    [
      'malformed commitStamp',
      { ...ID, fetchedAt: T0, games: [], commitStamp: { lineage: '', revision: 0 } },
    ],
    [
      'v2-marked rows without a stamp',
      {
        ...ID,
        fetchedAt: T0,
        games: [{ ...legacyRowFromWire(wireGame({ id: 1 })), schemaVersion: 2 }],
      },
    ],
    [
      'identity mismatch',
      { year: 2099, week: ID.week, seasonType: ID.seasonType, fetchedAt: T0, games: [] },
    ],
    ['games not an array', { ...ID, fetchedAt: T0, games: 'nope' }],
  ];
  for (const [name, partition] of malformed) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('game-stats', KEY, partition);
    const d = await digest();
    const actions: RevisionRepairAction[] = [
      { kind: 'rebuild-ledger' },
      { kind: 'adopt-lineage', lineage: 'L', floor: 5 },
      { kind: 'establish-new-lineage', floor: 5 },
    ];
    for (const action of actions) {
      const r = await repairRevisionState(
        req(action, d, {
          dryRun: false,
          acknowledgeLineageConflict: true,
          acknowledgeEvidenceLoss: true,
        })
      );
      assert.equal(r.ok, false, `${name} / ${action.kind}`);
      if (!r.ok)
        assert.equal(r.code, 'revision-repair-evidence-malformed', `${name} / ${action.kind}`);
    }
    assert.equal(await readLedger(), null); // nothing written
  }
});

// The versioned CAS digest changes for every material inspected-state change,
// while game count and commit stamp stay constant (it is NOT a count/stamp digest).
test('CAS digest changes for every material state change', async () => {
  const baseGame = legacyRowFromWire(wireGame({ id: 1 }));
  const basePartition = {
    ...ID,
    fetchedAt: T0,
    games: [baseGame],
    commitStamp: { lineage: 'L', revision: 3 },
  };
  async function seed(opts: {
    partition?: unknown;
    ledger?: unknown;
    status?: unknown;
    recovery?: unknown;
    activation?: unknown;
    witness?: unknown;
    audit?: unknown;
  }): Promise<string> {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('game-stats', KEY, opts.partition ?? basePartition);
    if (opts.ledger) await setAppState(GAME_STATS_REVISION_SCOPE, KEY, opts.ledger);
    if (opts.status) await setAppState('provider-refresh-status', STATUS_KEY, opts.status);
    if (opts.recovery) await setAppState(RECOVERY_DISPOSITION_SCOPE, KEY, opts.recovery);
    if (opts.activation) await setAppState(ACTIVATION_SCOPE, 'global', opts.activation);
    if (opts.witness)
      await setAppState(ACTIVATION_SCOPE, 'revisioned-evidence-witness', opts.witness);
    if (opts.audit) await setAppState(AUDIT_SCOPE, KEY, opts.audit);
    return digest();
  }
  const base = await seed({});
  const stamp = { lineage: 'L', revision: 3 };
  const cases: Array<[string, Parameters<typeof seed>[0]]> = [
    [
      'game id',
      {
        partition: {
          ...ID,
          fetchedAt: T0,
          games: [legacyRowFromWire(wireGame({ id: 2 }))],
          commitStamp: stamp,
        },
      },
    ],
    [
      'participant',
      {
        partition: {
          ...ID,
          fetchedAt: T0,
          games: [legacyRowFromWire(wireGame({ id: 1, home: { school: 'Zeta' } }))],
          commitStamp: stamp,
        },
      },
    ],
    [
      'statistics',
      {
        partition: {
          ...ID,
          fetchedAt: T0,
          games: [legacyRowFromWire(wireGame({ id: 1, home: { points: 99 } }))],
          commitStamp: stamp,
        },
      },
    ],
    [
      'fetchedAt',
      {
        partition: {
          ...ID,
          fetchedAt: '2024-10-07T00:00:00.000Z',
          games: [baseGame],
          commitStamp: stamp,
        },
      },
    ],
    ['ledger', { ledger: ledger('L', 3) }],
    ['committed status', { status: { lastCommittedStamp: { lineage: 'L', revision: 2 } } }],
    [
      'activation',
      {
        activation: {
          schemaVersion: 1,
          state: 'armed',
          updatedAt: '',
          revisionedEvidenceEverExisted: false,
        },
      },
    ],
    ['witness', { witness: { everExisted: true, firstAt: T0 } }],
    ['audit', { audit: [{ auditRef: 'x' }] }],
  ];
  for (const [name, opts] of cases) {
    const d = await seed(opts);
    assert.notEqual(d, base, name);
    // Game count and commit stamp are unchanged across the partition cases.
    if (opts.partition) {
      const p = opts.partition as { games: unknown[]; commitStamp: unknown };
      assert.equal(p.games.length, 1, name);
      assert.deepEqual(p.commitStamp, stamp, name);
    }
  }
  // Recovery-claim TOKEN and EXPIRATION each independently change the digest.
  const claim = (attemptToken: string, leaseExpiresAt: string) => ({
    recovery: { claim: { attemptToken, owner: 'op', leaseExpiresAt } },
  });
  const r0 = await seed(claim('tokA', '2999-01-01T00:00:00.000Z'));
  const rTok = await seed(claim('tokB', '2999-01-01T00:00:00.000Z'));
  const rExp = await seed(claim('tokA', '2998-01-01T00:00:00.000Z'));
  assert.notEqual(r0, rTok, 'recovery token');
  assert.notEqual(r0, rExp, 'recovery expiration');
});

test('equivalent partitions with different key order produce the same digest', async () => {
  const games = [legacyRowFromWire(wireGame({ id: 1 }))];
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('game-stats', KEY, {
    year: 2024,
    week: 6,
    seasonType: 'regular',
    fetchedAt: T0,
    games,
    commitStamp: { lineage: 'L', revision: 3 },
  });
  const d1 = await digest();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('game-stats', KEY, {
    commitStamp: { revision: 3, lineage: 'L' },
    games,
    seasonType: 'regular',
    week: 6,
    fetchedAt: T0,
    year: 2024,
  });
  const d2 = await digest();
  assert.equal(d1, d2);
});

test('audit availability: absent vs available(empty) vs unavailable(malformed/failed)', async () => {
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'absent' });

  await setAppState(AUDIT_SCOPE, KEY, []);
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'available', entries: [] });

  await setAppState(AUDIT_SCOPE, KEY, { corrupt: true }); // present but not an array
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'unavailable' });

  __setAppStateReadFailureForTests(new Error('audit store down'), AUDIT_SCOPE);
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'unavailable' });
  __setAppStateReadFailureForTests(null);
});

// === PLATFORM-086H3B-REPAIR-HIGH-WATER ===

/** Seed a partition stamp + optional ledger + optional committed status stamp. */
async function seedHistory(opts: {
  partitionStamp?: CommitStamp;
  ledger?: { lineage: string; revision: number };
  status?: CommitStamp;
}): Promise<void> {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('game-stats', KEY, partitionWith(opts.partitionStamp));
  if (opts.ledger)
    await setAppState(
      GAME_STATS_REVISION_SCOPE,
      KEY,
      ledger(opts.ledger.lineage, opts.ledger.revision)
    );
  if (opts.status) {
    await setAppState('provider-refresh-status', STATUS_KEY, { lastCommittedStamp: opts.status });
  }
}

test('EXACT Codex regression: adopt-lineage L floor 5 with partition L/5, ledger L/10 → refused, ledger stays L/10', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 5 },
    ledger: { lineage: 'L', revision: 10 },
  });
  const d = await digest();
  const result = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 5 }, d, { dryRun: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'revision-repair-floor-below-surviving-history');
  assert.equal((await readLedger())?.revision, 10); // ledger NOT lowered
});

test('rebuild-ledger with partition L/5, ledger L/10 → refused (no downward reconstruction)', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 5 },
    ledger: { lineage: 'L', revision: 10 },
  });
  const d = await digest();
  const result = await repairRevisionState(req({ kind: 'rebuild-ledger' }, d, { dryRun: false }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'revision-repair-ledger-ahead-of-evidence');
  assert.equal((await readLedger())?.revision, 10); // unchanged
});

test('the repair high-water includes the valid ledger and committed status', async () => {
  // adopt floor must be >= max(partition, ledger, status) on the same lineage.
  const cases: Array<{ p: number; l?: number; s?: number; hw: number }> = [
    { p: 5, l: 10, hw: 10 },
    { p: 5, l: 10, s: 8, hw: 10 },
    { p: 5, l: 10, s: 12, hw: 12 },
    { p: 10, s: 10, hw: 10 }, // no ledger
    { p: 10, l: 5, s: 10, hw: 10 },
    { p: 10, l: 10, s: 8, hw: 10 },
  ];
  for (const c of cases) {
    await seedHistory({
      partitionStamp: { lineage: 'L', revision: c.p },
      ...(c.l ? { ledger: { lineage: 'L', revision: c.l } } : {}),
      ...(c.s ? { status: { lineage: 'L', revision: c.s } } : {}),
    });
    const label = JSON.stringify(c);
    // floor at the high-water is accepted; one below is refused.
    const at = await repairRevisionState(
      req({ kind: 'adopt-lineage', lineage: 'L', floor: c.hw }, await digest(), { dryRun: false })
    );
    assert.ok(at.ok, `accept floor==hw ${label}`);
    if (at.ok)
      assert.deepEqual(at.survivingHighWater, {
        lineage: 'L',
        highWater: c.hw,
        sources: at.survivingHighWater!.sources,
      });
    await seedHistory({
      partitionStamp: { lineage: 'L', revision: c.p },
      ...(c.l ? { ledger: { lineage: 'L', revision: c.l } } : {}),
      ...(c.s ? { status: { lineage: 'L', revision: c.s } } : {}),
    });
    const below = await repairRevisionState(
      req({ kind: 'adopt-lineage', lineage: 'L', floor: c.hw - 1 }, await digest(), {
        dryRun: false,
      })
    );
    assert.equal(below.ok, false, `refuse floor<hw ${label}`);
    if (!below.ok) assert.equal(below.code, 'revision-repair-floor-below-surviving-history', label);
  }
});

test('rebuild-ledger raises a BEHIND ledger up to the high-water (never lowering)', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 10 },
    ledger: { lineage: 'L', revision: 5 },
    status: { lineage: 'L', revision: 10 },
  });
  const applied = await repairRevisionState(
    req({ kind: 'rebuild-ledger' }, await digest(), { dryRun: false, apply: true })
  );
  assert.ok(applied.ok);
  assert.equal((await readLedger())?.revision, 10); // raised 5 → 10, never down
});

test('conflicting-lineage witnesses refuse rebuild-ledger', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 5 },
    ledger: { lineage: 'M', revision: 5 },
  });
  const result = await repairRevisionState(
    req({ kind: 'rebuild-ledger' }, await digest(), { dryRun: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'revision-repair-lineage-conflict');
});

test('establish-new-lineage after acknowledged loss uses a different lineage, preserving prior high-water', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'OLD', revision: 4 },
    ledger: { lineage: 'OLD', revision: 9 },
  });
  const ok = await repairRevisionState(
    req({ kind: 'establish-new-lineage', floor: 3 }, await digest(), {
      dryRun: false,
      acknowledgeEvidenceLoss: true,
    })
  );
  assert.ok(ok.ok);
  const led = await readLedger();
  assert.notEqual(led?.lineage, 'OLD'); // genuinely different lineage
  assert.equal(led?.revision, 3); // new-lineage floor (not compared to OLD's 9)
  const audit = await auditEntries();
  assert.equal(audit[0]!.supersededLineage, 'OLD');
  assert.equal(audit[0]!.survivingHighWater?.highWater, 9); // OLD's high-water preserved
});

test('NON-REUSE: after an accepted repair, the next allocation is strictly above all surviving history', async () => {
  // partition L/5, ledger L/10 — adopt at the high-water (10), then allocate.
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 5 },
    ledger: { lineage: 'L', revision: 10 },
  });
  const applied = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 10 }, await digest(), {
      dryRun: false,
      apply: true,
    })
  );
  assert.ok(applied.ok);
  assert.equal((await readLedger())?.revision, 10);

  // The next revisioned allocation must issue a revision strictly above 10.
  assert.ok((await setActivationState('armed')).ok);
  assert.ok((await setActivationState('active')).ok);
  const parsed = parseV2GameObservation(wireGame({ id: 1, home: { points: 41 } }));
  assert.ok(parsed.ok);
  const merge = await mergeGameStatsPartitionRevisioned({
    ...ID,
    fetchStartedAt: '2024-10-08T00:00:00.000Z',
    observations: parsed.ok ? [parsed.observation] : [],
  });
  assert.equal(merge.outcome, 'written');
  assert.equal(merge.commit!.stamp.lineage, 'L');
  assert.ok(
    merge.commit!.stamp.revision > 10,
    `revision ${merge.commit!.stamp.revision} must exceed 10`
  );
});

// === PLATFORM-086H3B-REPAIR-STRUCTURE-CAS-AUDIT ===

// Bounded evidence certification: malformed envelope / fetchedAt / game rows are a
// HARD refusal for every action (dry-run and apply), writing nothing.
test('malformed envelope / fetchedAt / game rows hard-refuse every action', async () => {
  const good = legacyRowFromWire(wireGame({ id: 1 }));
  const stamp = { lineage: 'L', revision: 3 };
  const bad: Array<[string, unknown]> = [
    ['invalid fetchedAt', { ...ID, fetchedAt: 'not-a-date', games: [good], commitStamp: stamp }],
    ['missing fetchedAt', { ...ID, games: [good], commitStamp: stamp }],
    ['non-string fetchedAt', { ...ID, fetchedAt: 12345, games: [good], commitStamp: stamp }],
    ['empty-object row', { ...ID, fetchedAt: T0, games: [{}], commitStamp: stamp }],
    ['primitive row', { ...ID, fetchedAt: T0, games: [7], commitStamp: stamp }],
    [
      'missing game identity',
      { ...ID, fetchedAt: T0, games: [{ home: good.home, away: good.away }], commitStamp: stamp },
    ],
    [
      'malformed participant',
      {
        ...ID,
        fetchedAt: T0,
        games: [{ providerGameId: 1, home: { school: 5, schoolId: 1 }, away: good.away }],
      },
    ],
    [
      'malformed statistics',
      { ...ID, fetchedAt: T0, games: [{ ...good, home: { ...good.home, raw: 'nope' } }] },
    ],
    ['one invalid row among valid', { ...ID, fetchedAt: T0, games: [good, {}] }],
  ];
  const actions: RevisionRepairAction[] = [
    { kind: 'rebuild-ledger' },
    { kind: 'adopt-lineage', lineage: 'L', floor: 5 },
    { kind: 'establish-new-lineage', floor: 5 },
  ];
  for (const [name, partition] of bad) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('game-stats', KEY, partition);
    const d = await digest();
    for (const action of actions) {
      const r = await repairRevisionState(
        req(action, d, {
          dryRun: false,
          acknowledgeLineageConflict: true,
          acknowledgeEvidenceLoss: true,
        })
      );
      assert.equal(r.ok, false, `${name}/${action.kind}`);
      if (!r.ok)
        assert.equal(r.code, 'revision-repair-evidence-malformed', `${name}/${action.kind}`);
    }
    assert.equal(await readLedger(), null); // no writes
  }
});

test('structurally valid legacy and revision-era evidence certify (not evidence-malformed)', async () => {
  await setAppState('game-stats', KEY, partitionWith(undefined)); // valid legacy shape
  const legacyResult = await repairRevisionState(
    req({ kind: 'rebuild-ledger' }, await digest(), { dryRun: false })
  );
  assert.equal(legacyResult.ok, false);
  if (!legacyResult.ok) assert.equal(legacyResult.code, 'malformed-evidence'); // stampless, NOT evidence-malformed

  await seedHistory({ partitionStamp: { lineage: 'L', revision: 3 } }); // valid revision-era
  const revResult = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, await digest(), { dryRun: true })
  );
  assert.ok(revResult.ok);
});

// CAS serialization: activation + witness are read under the activation-control
// lock and bound by the digest, so a completed change refuses state-changed.
test('a completed activation or witness change before repair → state-changed', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 3 },
    ledger: { lineage: 'L', revision: 3 },
  });
  const dActivation = await digest();
  assert.ok((await setActivationState('armed')).ok); // activation changes after inspect
  const rA = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, dActivation, { dryRun: false })
  );
  assert.equal(rA.ok, false);
  if (!rA.ok) assert.equal(rA.code, 'revision-repair-state-changed');

  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 3 },
    ledger: { lineage: 'L', revision: 3 },
  });
  const dWitness = await digest();
  await setAppState(ACTIVATION_SCOPE, 'revisioned-evidence-witness', {
    everExisted: true,
    firstAt: T0,
  });
  const rW = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, dWitness, { dryRun: false })
  );
  assert.equal(rW.ok, false);
  if (!rW.ok) assert.equal(rW.code, 'revision-repair-state-changed');
});

test('the repair activation lock is released after success AND refusal', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 3 },
    ledger: { lineage: 'L', revision: 3 },
  });
  const ok = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, await digest(), {
      dryRun: false,
      apply: true,
    })
  );
  assert.ok(ok.ok);
  assert.ok((await setActivationState('armed')).ok); // lock released after success

  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 3 },
    ledger: { lineage: 'L', revision: 10 },
  });
  const refused = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, await digest(), { dryRun: false })
  );
  assert.equal(refused.ok, false);
  assert.ok((await setActivationState('armed')).ok); // lock released after refusal
});

test('repair racing a concurrent activation transition never deadlocks and stays consistent', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 3 },
    ledger: { lineage: 'L', revision: 3 },
  });
  const d = await digest();
  const [repair, transition] = await Promise.all([
    repairRevisionState(
      req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, d, { dryRun: false, apply: true })
    ),
    setActivationState('armed'),
  ]);
  assert.equal(transition.ok, true); // the transition always settles armed
  // Repair either committed (won the lock first) or observed the armed state and
  // refused state-changed — never a partial/torn outcome.
  assert.ok(repair.ok || (repair.ok === false && repair.code === 'revision-repair-state-changed'));
});

// Audit history validation + allowlist.
function validAuditEntry(auditRef: string) {
  return {
    schemaVersion: 1,
    auditRef,
    actor: 'clerk:a',
    at: T0,
    reason: 'r',
    action: { kind: 'rebuild-ledger' },
    beforeDigest: 'd',
    afterState: { ledger: ledger('L', 3), committedStamp: null, partitionStamp: null },
  };
}

test('audit availability distinguishes empty/populated/non-array/malformed/mixed, preserving order, exposing no arbitrary fields', async () => {
  await setAppState(AUDIT_SCOPE, KEY, []);
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'available', entries: [] });

  await setAppState(AUDIT_SCOPE, KEY, [validAuditEntry('a1'), validAuditEntry('a2')]);
  const avail = await readRevisionAuditTrail(ID);
  assert.equal(avail.state, 'available');
  if (avail.state === 'available')
    assert.deepEqual(
      avail.entries.map((e) => e.auditRef),
      ['a1', 'a2']
    );

  await setAppState(AUDIT_SCOPE, KEY, { corrupt: true }); // non-array
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'unavailable' });

  await setAppState(AUDIT_SCOPE, KEY, [{ auditRef: 'x' }]); // malformed entry
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'unavailable' });

  await setAppState(AUDIT_SCOPE, KEY, [validAuditEntry('a1'), { auditRef: 'x' }]); // mixed
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'unavailable' });

  // An unapproved extra field (secret) → unavailable, and never reaches the response.
  await setAppState(AUDIT_SCOPE, KEY, [
    { ...validAuditEntry('a1'), secret: 'postgres://user:SECRETPW@db/prod /var/secrets' },
  ]);
  const withSecret = await readRevisionAuditTrail(ID);
  assert.equal(withSecret.state, 'unavailable');
  assert.equal(JSON.stringify(withSecret).includes('SECRETPW'), false);
});

test('applied repair refuses to append to a malformed audit history (never trusted)', async () => {
  await seedHistory({
    partitionStamp: { lineage: 'L', revision: 3 },
    ledger: { lineage: 'L', revision: 3 },
  });
  await setAppState(AUDIT_SCOPE, KEY, [{ auditRef: 'malformed' }]);
  const d = await digest();
  const r = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, d, { dryRun: false, apply: true })
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'revision-repair-audit-unavailable');
  assert.deepEqual((await getAppState(AUDIT_SCOPE, KEY))?.value, [{ auditRef: 'malformed' }]); // unchanged
});
