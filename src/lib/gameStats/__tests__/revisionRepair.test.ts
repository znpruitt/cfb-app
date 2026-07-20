import assert from 'node:assert/strict';
import test from 'node:test';

import { getGameStatsKey } from '../cache.ts';
import {
  classifyRepairEvidence,
  inspectRevisionState,
  readRevisionAuditTrail,
  repairRevisionState,
  validateAuditEntry,
  RECOVERY_DISPOSITION_SCOPE,
  type DurableRead,
  type RevisionInspection,
  type RevisionRepairAction,
} from '../revisionRepair.ts';
import { GAME_STATS_REVISION_SCOPE, type RevisionLedgerRecord } from '../revisionAuthority.ts';
import { classifyGameStatsRow, parseV2GameObservation } from '../contract.ts';
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

// A durable evidence row consistent with the ID partition (H1 legacy-compatible),
// so certification exercises the intended path rather than a week/identity mismatch.
function evidenceRow(overrides: Parameters<typeof wireGame>[0] = {}) {
  return legacyRowFromWire(wireGame({ id: 1, ...overrides }), ID.week);
}
function partitionWith(stamp: CommitStamp | undefined): WeeklyGameStats {
  return {
    ...ID,
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: [evidenceRow()],
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
  const good = evidenceRow();
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

// ===========================================================================
// PLATFORM-086H3B-REPAIR-PRESENCE-H1-AUDIT
// ===========================================================================

const reset = async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
};
const inspect = async () => (await inspectRevisionState(ID)) as RevisionInspection;
const present = (value: unknown): DurableRead => ({ present: true, value });

// === (1) Durable row presence: absent vs present-null is never collapsed ===

test('presence: absent vs present-null is distinct (digest + CAS) for every repair-state row', async () => {
  const categories: Array<[string, string, string, boolean]> = [
    ['partition', 'game-stats', KEY, true],
    ['ledger', GAME_STATS_REVISION_SCOPE, KEY, false],
    ['status', 'provider-refresh-status', STATUS_KEY, false],
    ['activation', ACTIVATION_SCOPE, 'global', false],
    ['witness', ACTIVATION_SCOPE, 'revisioned-evidence-witness', false],
    ['recovery', RECOVERY_DISPOSITION_SCOPE, KEY, false],
    ['audit', AUDIT_SCOPE, KEY, false],
  ];
  for (const [label, scope, key, isPartition] of categories) {
    // ABSENT baseline (a valid partition present unless the partition IS the category).
    await reset();
    if (!isPartition)
      await setAppState('game-stats', KEY, partitionWith({ lineage: 'L', revision: 3 }));
    const absentDigest = (await inspect()).expectedStateDigest;
    // PRESENT-NULL: the same state, but this one row present with a JSON-null value.
    await setAppState(scope, key, null);
    const presentNullDigest = (await inspect()).expectedStateDigest;
    assert.notEqual(absentDigest, presentNullDigest, `${label}: absent vs present-null digest`);
    // CAS: a repair authorized at the absent digest refuses once present-null exists.
    const r = await repairRevisionState(
      req({ kind: 'establish-new-lineage' }, absentDigest, {
        dryRun: false,
        acknowledgeEvidenceLoss: true,
      })
    );
    assert.equal(r.ok, false, label);
    if (!r.ok) assert.equal(r.code, 'revision-repair-state-changed', `${label}: CAS`);
  }
});

test('presence: present-null PARTITION evidence is malformed, not absent', async () => {
  await reset();
  await setAppState('game-stats', KEY, null); // present row, JSON-null value
  const insp = await inspect();
  assert.equal(insp.state.partition.present, true, 'present-null partition is PRESENT');
  const r = await repairRevisionState(
    req({ kind: 'rebuild-ledger' }, insp.expectedStateDigest, { dryRun: false })
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'revision-repair-evidence-malformed');
  // Classifier: present-null → malformed; genuinely absent → absent.
  assert.equal(classifyRepairEvidence(present(null), ID), 'malformed');
  assert.equal(classifyRepairEvidence({ present: false }, ID), 'absent');
});

test('presence: present-null LEDGER is an ambiguous marker, not "no ledger"', async () => {
  await reset();
  await setAppState('game-stats', KEY, partitionWith(undefined));
  await setAppState(GAME_STATS_REVISION_SCOPE, KEY, null); // present-null ledger
  const withNull = await inspect();
  assert.equal(withNull.state.ledgerMarkerPresent, true, 'present-null ledger is a marker');
  assert.equal(withNull.state.ledger, null);
  // Genuinely absent ledger is NOT a marker (new-lineage init remains possible).
  await reset();
  await setAppState('game-stats', KEY, partitionWith(undefined));
  const absent = await inspect();
  assert.equal(absent.state.ledgerMarkerPresent, false);
  // The present-null marker changes the digest vs absent.
  assert.notEqual(withNull.expectedStateDigest, absent.expectedStateDigest);
});

test('presence: present-null AUDIT is unavailable, never an empty history', async () => {
  await reset();
  await setAppState('game-stats', KEY, partitionWith(undefined));
  await setAppState(AUDIT_SCOPE, KEY, null); // present-null audit row
  assert.deepEqual(await readRevisionAuditTrail(ID), { state: 'unavailable' });
});

// === (2) Evidence certified through the H1 durable contract ===

test('evidence certification defers to the H1 contract (per-row parity)', async () => {
  const env = (row: unknown, stamp?: CommitStamp): DurableRead =>
    present({ ...ID, fetchedAt: T0, games: [row], ...(stamp ? { commitStamp: stamp } : {}) });
  const H1_ACCEPTED = new Set(['legacy-compatible', 'legacy-statless', 'v2-complete', 'v2-sparse']);
  const legacy = evidenceRow();
  const samples: Array<[string, unknown]> = [
    ['legacy-compatible (positive game id)', legacy],
    ['zero provider game id', { ...legacy, providerGameId: 0 }],
    ['negative provider game id', { ...legacy, providerGameId: -1 }],
    ['fractional provider game id', { ...legacy, providerGameId: 1.5 }],
    ['unsupported schema version', { ...legacy, schemaVersion: 3 }],
    ['malformed schema version', { ...legacy, schemaVersion: 'nope' }],
    ['blank home school', { ...legacy, home: { ...legacy.home, school: '' } }],
    ['malformed nested statistics', { ...legacy, home: { ...legacy.home, raw: 'not-an-object' } }],
  ];
  for (const [label, row] of samples) {
    const cls = classifyRepairEvidence(env(row), ID);
    const repairAccepts = cls === 'recognized-legacy' || cls === 'valid-revision-era';
    const h1State = classifyGameStatsRow(row).state;
    const h1Accepts = H1_ACCEPTED.has(h1State);
    assert.equal(repairAccepts, h1Accepts, `${label}: repair=${cls} h1=${h1State}`);
  }
  // Recognized legacy vs valid revision-era envelope (accepted, distinct classes).
  assert.equal(classifyRepairEvidence(env(legacy), ID), 'recognized-legacy');
  assert.equal(
    classifyRepairEvidence(env(legacy, { lineage: 'L', revision: 3 }), ID),
    'valid-revision-era'
  );
});

test('evidence: strict canonical fetchedAt (round-trip), not merely Date.parse-finite', async () => {
  const env = (fetchedAt: unknown): DurableRead =>
    present({ ...ID, fetchedAt, games: [evidenceRow()] });
  assert.equal(classifyRepairEvidence(env(T0), ID), 'recognized-legacy'); // canonical
  for (const bad of [
    '2024-13-45T00:00:00.000Z', // calendar-invalid (Date.parse handles, still rejected)
    '2024-10-06', // noncanonical date-only
    '2024-10-06T00:00:00.000+05:00', // noncanonical offset (not UTC round-trip)
    '2024-10-06T00:00:00Z', // missing milliseconds
    12345, // non-string
    '', // empty
  ]) {
    assert.equal(classifyRepairEvidence(env(bad), ID), 'malformed', String(bad));
  }
});

test('evidence: row week/season-type must not contradict the partition; mixed rows taint the envelope', async () => {
  const good = evidenceRow();
  const weekMismatch = { ...good, week: 99 };
  const seasonMismatch = { ...good, seasonType: 'postseason' };
  assert.equal(
    classifyRepairEvidence(present({ ...ID, fetchedAt: T0, games: [weekMismatch] }), ID),
    'malformed'
  );
  assert.equal(
    classifyRepairEvidence(present({ ...ID, fetchedAt: T0, games: [seasonMismatch] }), ID),
    'malformed'
  );
  // A single withheld/malformed row taints the whole envelope (no partial accept).
  assert.equal(
    classifyRepairEvidence(present({ ...ID, fetchedAt: T0, games: [good, {}] }), ID),
    'malformed'
  );
});

test('evidence: repair refuses everything H1 withholds/rejects (parity through the public API)', async () => {
  // A v2-schema row with no persistable evidence is withheld by H1 → repair refuses.
  await reset();
  await setAppState('game-stats', KEY, {
    ...ID,
    fetchedAt: T0,
    games: [{ ...evidenceRow(), schemaVersion: 3 }], // unsupported-version → withheld
    commitStamp: { lineage: 'L', revision: 3 },
  });
  const d = await digest();
  const r = await repairRevisionState(
    req({ kind: 'adopt-lineage', lineage: 'L', floor: 3 }, d, {
      dryRun: false,
      acknowledgeLineageConflict: true,
      acknowledgeEvidenceLoss: true,
    })
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'revision-repair-evidence-malformed');
});

// === (3) Nested audit reconstruction through an exact allowlist ===

const AUDIT_LEDGER = {
  schemaVersion: 1 as const,
  ...ID,
  lineage: 'L',
  revision: 3,
  initializedFrom: 'repair' as const,
  initializedAt: T0,
  repairAuditRef: 'ref-1',
};
const auditEntry = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  auditRef: 'a1',
  actor: ACTOR,
  at: T0,
  reason: 'operator recovery',
  beforeDigest: 'd-before',
  action: { kind: 'adopt-lineage', lineage: 'L', floor: 3 },
  afterState: {
    ledger: AUDIT_LEDGER,
    committedStamp: { lineage: 'L', revision: 3 },
    partitionStamp: null,
  },
  ...over,
});
const afterStateWith = (over: Record<string, unknown>) => ({
  afterState: {
    ledger: AUDIT_LEDGER,
    committedStamp: { lineage: 'L', revision: 3 },
    partitionStamp: null,
    ...over,
  },
});
const seedAudit = async (dataset: unknown) => {
  await reset();
  await setAppState(AUDIT_SCOPE, KEY, dataset);
  return readRevisionAuditTrail(ID);
};

test('nested audit: valid minimal and full entries are available; order preserved', async () => {
  assert.equal(
    (await seedAudit([auditEntry({ action: { kind: 'rebuild-ledger' } })])).state,
    'available'
  );
  const full = await seedAudit([
    auditEntry({
      supersededLineage: 'old-lineage',
      survivingHighWater: { lineage: 'L', highWater: 3, sources: ['ledger', 'status'] },
    }),
  ]);
  assert.equal(full.state, 'available');
  const ordered = await seedAudit([
    auditEntry({ auditRef: 'first' }),
    auditEntry({ auditRef: 'second' }),
  ]);
  assert.equal(ordered.state, 'available');
  if (ordered.state === 'available') {
    assert.deepEqual(
      ordered.entries.map((e) => e.auditRef),
      ['first', 'second']
    );
  }
});

test('nested audit: any unexpected or malformed nested field makes the WHOLE dataset unavailable', async () => {
  const cases: Array<[string, unknown]> = [
    [
      'extra key under afterState.ledger',
      [auditEntry(afterStateWith({ ledger: { ...AUDIT_LEDGER, secret: 'x' } }))],
    ],
    [
      'extra key in commit stamp',
      [auditEntry(afterStateWith({ committedStamp: { lineage: 'L', revision: 3, evil: 1 } }))],
    ],
    [
      'malformed nested revision',
      [auditEntry(afterStateWith({ ledger: { ...AUDIT_LEDGER, revision: 0 } }))],
    ],
    [
      'malformed nested lineage',
      [auditEntry(afterStateWith({ ledger: { ...AUDIT_LEDGER, lineage: '' } }))],
    ],
    [
      'unsupported nested schema version',
      [auditEntry(afterStateWith({ ledger: { ...AUDIT_LEDGER, schemaVersion: 2 } }))],
    ],
    ['unexpected top-level field', [auditEntry({ injectedSql: "'; DROP TABLE app_state; --" })]],
    [
      'extra key in afterState',
      [auditEntry({ afterState: { ...auditEntry().afterState, extra: 1 } })],
    ],
    [
      'extra key in survivingHighWater',
      [auditEntry({ survivingHighWater: { lineage: 'L', highWater: 3, sources: [], leak: 1 } })],
    ],
    ['extra key in action', [auditEntry({ action: { kind: 'rebuild-ledger', extra: 1 } })]],
    [
      'one valid plus one nested-malformed',
      [auditEntry(), auditEntry(afterStateWith({ ledger: { ...AUDIT_LEDGER, secret: 'x' } }))],
    ],
  ];
  for (const [label, dataset] of cases) {
    assert.equal((await seedAudit(dataset)).state, 'unavailable', label);
  }
});

test('nested audit: recognizable secret text in a nested field never reaches the response', async () => {
  const SECRET = 'postgres://user:SUPERSECRETPW@db.internal/prod';
  const read = await seedAudit([
    auditEntry(afterStateWith({ ledger: { ...AUDIT_LEDGER, connectionString: SECRET } })),
  ]);
  assert.equal(read.state, 'unavailable'); // corrupted history is never trusted
  assert.ok(!JSON.stringify(read).includes('SUPERSECRETPW'), 'secret never surfaces in the read');
});

test('nested audit: rebuilt objects never share identity with the raw stored objects', async () => {
  // Validated IN-MEMORY (no serialization round-trip), so a shared reference would survive.
  const rawAfterState = {
    ledger: { ...AUDIT_LEDGER },
    committedStamp: { lineage: 'L', revision: 3 },
    partitionStamp: null,
  };
  const rawAction = { kind: 'adopt-lineage', lineage: 'L', floor: 3 };
  const raw = { ...auditEntry(), afterState: rawAfterState, action: rawAction };
  const rebuilt = validateAuditEntry(raw);
  assert.ok(rebuilt, 'entry validates');
  if (rebuilt) {
    assert.notEqual(rebuilt.afterState, rawAfterState, 'afterState rebuilt fresh');
    assert.notEqual(rebuilt.afterState.ledger, rawAfterState.ledger, 'ledger rebuilt fresh');
    assert.notEqual(
      rebuilt.afterState.committedStamp,
      rawAfterState.committedStamp,
      'commit stamp rebuilt fresh'
    );
    assert.notEqual(rebuilt.action, rawAction, 'action rebuilt fresh');
    assert.deepEqual(rebuilt.action, { kind: 'adopt-lineage', lineage: 'L', floor: 3 });
  }
});
