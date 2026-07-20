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
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

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
  const audit = await readRevisionAuditTrail(ID);
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
  const audit = await readRevisionAuditTrail(ID);
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
  const audit = await readRevisionAuditTrail(ID);
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
  if (!result.ok) assert.equal(result.code, 'state-changed');
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
