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
  if (!result.ok) assert.equal(result.code, 'floor-below-surviving-evidence');
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
