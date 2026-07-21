import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPartitionStamp,
  classifyRevisionAllocation,
  validateLedgerRecord,
  type PartitionStampClass,
  type RevisionLedgerRecord,
  type RevisionSources,
} from '../revisionAuthority.ts';
import type { CommitStamp } from '../revisionStamp.ts';
import type { WeeklyGameStats } from '../types.ts';

// === Pure state-machine tests (frozen contract §5) ===

const ID = { year: 2024, week: 6, seasonType: 'regular' as const };
const NOW = '2024-10-06T00:00:00.000Z';
const CTX = { now: NOW, mintLineage: () => 'MINTED' };

function ledger(
  lineage: string,
  revision: number,
  initializedFrom: RevisionLedgerRecord['initializedFrom'] = 'new'
): RevisionLedgerRecord {
  return {
    schemaVersion: 1,
    year: ID.year,
    week: ID.week,
    seasonType: ID.seasonType,
    lineage,
    revision,
    initializedFrom,
    initializedAt: NOW,
  };
}

function sources(
  partition: PartitionStampClass,
  opts: {
    ledger?: RevisionLedgerRecord | null;
    ledgerMarker?: boolean;
    consulted?: boolean;
    statusStamp?: CommitStamp | null;
    statusMarker?: boolean;
  } = {}
): RevisionSources {
  return {
    partition,
    ledger: { valid: opts.ledger ?? null, markerPresent: opts.ledgerMarker ?? false },
    status: {
      consulted: opts.consulted ?? false,
      stamp: opts.statusStamp ?? null,
      markerPresent: opts.statusMarker ?? false,
    },
  };
}

function expectOk(result: ReturnType<typeof classifyRevisionAllocation>) {
  assert.ok(result.ok, `expected ok, got ${JSON.stringify(result)}`);
  return result.ok ? result.allocation : (null as never);
}

function expectBlock(result: ReturnType<typeof classifyRevisionAllocation>, code: string) {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code);
}

test('genuinely new: no partition, ledger, or status → lineage MINTED, revision 1', () => {
  const a = expectOk(
    classifyRevisionAllocation(sources({ kind: 'absent' }, { consulted: true }), ID, CTX)
  );
  assert.equal(a.mode, 'new');
  assert.deepEqual(a.stamp, { lineage: 'MINTED', revision: 1 });
  assert.equal(a.ledger.initializedFrom, 'new');
  assert.equal(a.ledger.revision, 1);
});

test('recognized legacy partition → new lineage, revision 1, initializedFrom legacy', () => {
  const a = expectOk(
    classifyRevisionAllocation(sources({ kind: 'legacy' }, { consulted: true }), ID, CTX)
  );
  assert.equal(a.mode, 'legacy');
  assert.deepEqual(a.stamp, { lineage: 'MINTED', revision: 1 });
  assert.equal(a.ledger.initializedFrom, 'legacy');
});

test('healthy ordinary allocation → ledger.revision + 1, same lineage', () => {
  const a = expectOk(
    classifyRevisionAllocation(
      sources({ kind: 'valid', stamp: { lineage: 'L', revision: 3 } }, { ledger: ledger('L', 3) }),
      ID,
      CTX
    )
  );
  assert.equal(a.mode, 'ordinary');
  assert.deepEqual(a.stamp, { lineage: 'L', revision: 4 });
  assert.equal(a.ledger.revision, 4);
  assert.equal(a.ledger.lineage, 'L');
});

test('ordinary: ledger behind surviving partition evidence → reconstruct above highest', () => {
  const a = expectOk(
    classifyRevisionAllocation(
      sources({ kind: 'valid', stamp: { lineage: 'L', revision: 5 } }, { ledger: ledger('L', 3) }),
      ID,
      CTX
    )
  );
  assert.equal(a.mode, 'reconstruct-partition');
  assert.deepEqual(a.stamp, { lineage: 'L', revision: 6 });
});

test('ordinary: ledger AHEAD of surviving partition → suspected evidence loss', () => {
  expectBlock(
    classifyRevisionAllocation(
      sources({ kind: 'valid', stamp: { lineage: 'L', revision: 3 } }, { ledger: ledger('L', 5) }),
      ID,
      CTX
    ),
    'revision-evidence-loss-suspected'
  );
});

test('ordinary: partition lineage differs from ledger → lineage conflict', () => {
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L1', revision: 3 } },
        { ledger: ledger('L2', 3) }
      ),
      ID,
      CTX
    ),
    'revision-lineage-conflict'
  );
});

test('ordinary: partition absent but ledger valid → evidence loss (committed history survives)', () => {
  expectBlock(
    classifyRevisionAllocation(sources({ kind: 'absent' }, { ledger: ledger('L', 4) }), ID, CTX),
    'revision-evidence-loss-suspected'
  );
});

test('ordinary: partition absent + REPAIR ledger → continuation (operator attested)', () => {
  const a = expectOk(
    classifyRevisionAllocation(
      sources({ kind: 'absent' }, { ledger: ledger('L', 4, 'repair') }),
      ID,
      CTX
    )
  );
  assert.equal(a.mode, 'ordinary');
  assert.deepEqual(a.stamp, { lineage: 'L', revision: 5 });
});

test('ordinary: legacy partition with a valid ledger → evidence loss', () => {
  expectBlock(
    classifyRevisionAllocation(sources({ kind: 'legacy' }, { ledger: ledger('L', 2) }), ID, CTX),
    'revision-evidence-loss-suspected'
  );
});

test('ordinary: malformed / revision-era partition with a valid ledger → ambiguous', () => {
  for (const kind of ['malformed', 'revision-era-no-stamp'] as const) {
    expectBlock(
      classifyRevisionAllocation(sources({ kind }, { ledger: ledger('L', 2) }), ID, CTX),
      'revision-history-ambiguous'
    );
  }
});

test('bootstrap: surviving same-lineage partition, no ledger → reconstruct above partition', () => {
  for (const status of [
    { statusStamp: { lineage: 'L', revision: 4 } as CommitStamp }, // status agrees
    { statusStamp: { lineage: 'L', revision: 2 } as CommitStamp }, // status behind
    {}, // no status
  ]) {
    const a = expectOk(
      classifyRevisionAllocation(
        sources(
          { kind: 'valid', stamp: { lineage: 'L', revision: 4 } },
          {
            consulted: true,
            ...status,
          }
        ),
        ID,
        CTX
      )
    );
    assert.equal(a.mode, 'reconstruct-partition');
    assert.deepEqual(a.stamp, { lineage: 'L', revision: 5 });
  }
});

test('bootstrap: status stamp NEWER than surviving partition → evidence loss', () => {
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L', revision: 3 } },
        {
          consulted: true,
          statusStamp: { lineage: 'L', revision: 5 },
        }
      ),
      ID,
      CTX
    ),
    'revision-evidence-loss-suspected'
  );
});

test('bootstrap: partition and status disagree on lineage → lineage conflict', () => {
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L1', revision: 3 } },
        {
          consulted: true,
          statusStamp: { lineage: 'L2', revision: 3 },
        }
      ),
      ID,
      CTX
    ),
    'revision-lineage-conflict'
  );
});

// === Restoration: committed status as a high-water witness in the ORDINARY path ===

test('ordinary: status AHEAD of a restored-behind ledger/partition → evidence loss', () => {
  // ledger 5, partition 5, status 10 on the same lineage — the restored-behind
  // ledger must NOT reuse revisions 6-10 already represented in status.
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L', revision: 5 } },
        { ledger: ledger('L', 5), statusStamp: { lineage: 'L', revision: 10 } }
      ),
      ID,
      CTX
    ),
    'revision-evidence-loss-suspected'
  );
});

test('ordinary: status on a FOREIGN lineage → lineage conflict', () => {
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L', revision: 5 } },
        { ledger: ledger('L', 5), statusStamp: { lineage: 'M', revision: 1 } }
      ),
      ID,
      CTX
    ),
    'revision-lineage-conflict'
  );
});

test('ordinary: status equal / behind / absent / unrelated-legacy → allocate from ledger', () => {
  for (const status of [
    { statusStamp: { lineage: 'L', revision: 5 } as CommitStamp }, // equal
    { statusStamp: { lineage: 'L', revision: 3 } as CommitStamp }, // behind
    {}, // absent (also stands in for a legacy/unrelated provider-status shape)
  ]) {
    const a = expectOk(
      classifyRevisionAllocation(
        sources(
          { kind: 'valid', stamp: { lineage: 'L', revision: 5 } },
          { ledger: ledger('L', 5), ...status }
        ),
        ID,
        CTX
      )
    );
    assert.deepEqual(a.stamp, { lineage: 'L', revision: 6 });
  }
});

test('ordinary: a malformed revision-era status marker → ambiguous', () => {
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L', revision: 5 } },
        { ledger: ledger('L', 5), statusMarker: true }
      ),
      ID,
      CTX
    ),
    'revision-history-ambiguous'
  );
});

test('bootstrap: a present-invalid ledger MARKER blocks ambiguous even with a valid partition stamp', () => {
  // A present JSON-null / malformed ledger row is a revision-era marker — it
  // blocks even alongside surviving same-lineage partition evidence.
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L', revision: 3 } },
        {
          consulted: true,
          ledgerMarker: true,
        }
      ),
      ID,
      CTX
    ),
    'revision-history-ambiguous'
  );
});

// === Safe-integer exhaustion ===

test('exhaustion: ledger/partition at MAX_SAFE_INTEGER → revision-counter-exhausted', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  expectBlock(
    classifyRevisionAllocation(
      sources(
        { kind: 'valid', stamp: { lineage: 'L', revision: MAX } },
        { ledger: ledger('L', MAX) }
      ),
      ID,
      CTX
    ),
    'revision-counter-exhausted'
  );
});

test('exhaustion: reconstructed high-water at MAX_SAFE_INTEGER → revision-counter-exhausted', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  expectBlock(
    classifyRevisionAllocation(
      sources({ kind: 'valid', stamp: { lineage: 'L', revision: MAX } }, { consulted: true }),
      ID,
      CTX
    ),
    'revision-counter-exhausted'
  );
});

test('bootstrap: evidence absent/legacy while status committed history survives → evidence loss', () => {
  for (const kind of ['absent', 'legacy'] as const) {
    expectBlock(
      classifyRevisionAllocation(
        sources({ kind }, { consulted: true, statusStamp: { lineage: 'L', revision: 2 } }),
        ID,
        CTX
      ),
      'revision-evidence-loss-suspected'
    );
  }
});

test('bootstrap: revision-era markers with no usable source → ambiguous (never restart at 1)', () => {
  // ledger marker, status marker, malformed partition, and v2-marked-no-stamp all
  // BLOCK rather than silently minting lineage 1.
  expectBlock(
    classifyRevisionAllocation(
      sources({ kind: 'absent' }, { consulted: true, ledgerMarker: true }),
      ID,
      CTX
    ),
    'revision-history-ambiguous'
  );
  expectBlock(
    classifyRevisionAllocation(
      sources({ kind: 'absent' }, { consulted: true, statusMarker: true }),
      ID,
      CTX
    ),
    'revision-history-ambiguous'
  );
  expectBlock(
    classifyRevisionAllocation(sources({ kind: 'malformed' }, { consulted: true }), ID, CTX),
    'revision-history-ambiguous'
  );
  expectBlock(
    classifyRevisionAllocation(
      sources({ kind: 'revision-era-no-stamp' }, { consulted: true }),
      ID,
      CTX
    ),
    'revision-history-ambiguous'
  );
});

// === classifyPartitionStamp ===

function partition(
  games: WeeklyGameStats['games'],
  extra: Partial<WeeklyGameStats> = {}
): WeeklyGameStats {
  return { year: 2024, week: 6, seasonType: 'regular', fetchedAt: NOW, games, ...extra };
}
const legacyGame = {
  providerGameId: 1,
  week: 6,
  seasonType: 'regular' as const,
} as WeeklyGameStats['games'][number];

test('classifyPartitionStamp: absent / legacy / valid / malformed / revision-era', () => {
  assert.equal(classifyPartitionStamp(null).kind, 'absent');
  assert.equal(classifyPartitionStamp(partition([legacyGame])).kind, 'legacy');
  assert.equal(classifyPartitionStamp(partition([])).kind, 'legacy'); // empty games, no stamp

  const valid = classifyPartitionStamp(
    partition([legacyGame], { commitStamp: { lineage: 'L', revision: 2 } })
  );
  assert.equal(valid.kind, 'valid');
  assert.deepEqual(valid.kind === 'valid' ? valid.stamp : null, { lineage: 'L', revision: 2 });

  // A commitStamp PROPERTY that is invalid is malformed — NOT "new". A missing
  // revision field alone never proves a scope new.
  assert.equal(
    classifyPartitionStamp(
      partition([legacyGame], { commitStamp: { lineage: '', revision: 0 } as CommitStamp })
    ).kind,
    'malformed'
  );
  // A v2-marked row without a partition stamp is revision-era damage.
  const v2Game = { ...legacyGame, schemaVersion: 2 } as WeeklyGameStats['games'][number];
  assert.equal(classifyPartitionStamp(partition([v2Game])).kind, 'revision-era-no-stamp');
});

// === validateLedgerRecord ===

test('validateLedgerRecord: rejects wrong schema, bad revision/lineage, mislabeled identity', () => {
  const good = ledger('L', 3);
  assert.deepEqual(validateLedgerRecord(good, ID), good);
  assert.equal(validateLedgerRecord({ ...good, schemaVersion: 2 }, ID), null);
  assert.equal(validateLedgerRecord({ ...good, revision: 0 }, ID), null);
  assert.equal(validateLedgerRecord({ ...good, lineage: '' }, ID), null);
  assert.equal(validateLedgerRecord({ ...good, initializedFrom: 'bogus' }, ID), null);
  // Mislabeled identity (wrong week) → not a ledger (a revision-era marker).
  assert.equal(validateLedgerRecord({ ...good, week: 7 }, ID), null);
});

// ===========================================================================
// PLATFORM-086H3B-DURABLE-STATE-CLASSIFICATION — shared status classifier,
// strict ledger validation, and the presence-aware live allocator.
// ===========================================================================

import {
  allocateGameStatsCommitStamp,
  classifyRevisionStatus,
  GAME_STATS_REVISION_SCOPE,
} from '../revisionAuthority.ts';
import { getGameStatsKey } from '../cache.ts';
import { toDurableRead } from '../durableState.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../../providerRefreshScope.ts';
import {
  getAppState,
  setAppState,
  withAppStateKeyTransaction,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';

const present = (value: unknown) => toDurableRead({ value });
const PARTITION_KEY = getGameStatsKey(ID.year, ID.week, ID.seasonType);
const STATUS_KEY = providerRefreshScopeKey(
  'game-stats',
  weekPartitionScope(ID.year, ID.week, ID.seasonType)
);

test('classifyRevisionStatus: presence-aware states (absent / legacy / valid / malformed)', () => {
  assert.equal(classifyRevisionStatus({ present: false }).kind, 'absent');
  // Present JSON-null / primitive / array / unrecognized object → malformed.
  assert.equal(classifyRevisionStatus(present(null)).kind, 'malformed');
  assert.equal(classifyRevisionStatus(present(42)).kind, 'malformed');
  assert.equal(classifyRevisionStatus(present([])).kind, 'malformed');
  assert.equal(classifyRevisionStatus(present({ random: 1 })).kind, 'malformed');
  // Malformed committed stamp / malformed attempt chronology → malformed.
  assert.equal(
    classifyRevisionStatus(present({ lastCommittedStamp: { lineage: '', revision: 0 } })).kind,
    'malformed'
  );
  assert.equal(
    classifyRevisionStatus(
      present({ dataset: 'game-stats', scopeKey: STATUS_KEY, lastAttemptOrdinal: 0 })
    ).kind,
    'malformed'
  );
  // Valid committed stamp → valid-revisioned; recognized legacy record → legacy.
  const valid = classifyRevisionStatus(
    present({ lastCommittedStamp: { lineage: 'L', revision: 3 } })
  );
  assert.equal(valid.kind, 'valid-revisioned');
  if (valid.kind === 'valid-revisioned')
    assert.deepEqual(valid.value.committedStamp, { lineage: 'L', revision: 3 });
  assert.equal(
    classifyRevisionStatus(
      present({
        dataset: 'game-stats',
        scope: {},
        scopeKey: STATUS_KEY,
        latestAttemptOutcome: 'in-progress',
      })
    ).kind,
    'recognized-legacy'
  );
});

test('validateLedgerRecord: strict fields, no silent normalization', () => {
  const good = ledger('L', 3, 'repair');
  assert.ok(validateLedgerRecord({ ...good, initializedAt: NOW }, ID));
  const bad: Array<[string, unknown]> = [
    ['object initializedAt', { ...good, initializedAt: {} }],
    ['empty initializedAt', { ...good, initializedAt: '' }],
    ['noncanonical initializedAt', { ...good, initializedAt: '2024-10-06' }],
    ['malformed lineage', { ...good, lineage: '' }],
    ['zero revision', { ...good, revision: 0 }],
    ['fractional revision', { ...good, revision: 1.5 }],
    ['negative revision', { ...good, revision: -1 }],
    ['unsafe revision', { ...good, revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['malformed repairAuditRef', { ...good, repairAuditRef: 5 }],
    ['empty repairAuditRef', { ...good, repairAuditRef: '' }],
    ['unexpected extra field', { ...good, injected: 'x' }],
    ['present JSON-null', null],
  ];
  for (const [label, value] of bad) {
    assert.equal(validateLedgerRecord(value, ID), null, label);
  }
  // A valid ledger with a valid repairAuditRef round-trips (fresh object).
  const withRef = validateLedgerRecord({ ...good, repairAuditRef: 'ref-1' }, ID);
  assert.equal(withRef?.repairAuditRef, 'ref-1');
  assert.equal(withRef?.initializedAt, NOW); // never normalized to ''
});

// === Live allocator: present-null / malformed status + ledger block before mutation ===

async function allocateWith(opts: {
  partition?: WeeklyGameStats | null;
  status?: unknown;
  ledger?: unknown;
}): Promise<ReturnType<typeof classifyRevisionAllocation>> {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  if (opts.partition) await setAppState('game-stats', PARTITION_KEY, opts.partition);
  if ('status' in opts) await setAppState('provider-refresh-status', STATUS_KEY, opts.status);
  if ('ledger' in opts) await setAppState(GAME_STATS_REVISION_SCOPE, PARTITION_KEY, opts.ledger);
  return withAppStateKeyTransaction('game-stats', PARTITION_KEY, (txn) =>
    allocateGameStatsCommitStamp(txn, ID, opts.partition ?? null, PARTITION_KEY, NOW)
  );
}

test('live allocator: present-null / primitive / array / unrecognized status blocks as ambiguous (no mutation)', async () => {
  for (const status of [null, 42, [], { random: 1 }]) {
    const result = await allocateWith({ partition: null, status }); // absent partition, absent ledger
    expectBlock(result, 'revision-history-ambiguous');
    // No durable mutation: the allocator only reads (no ledger written).
    assert.equal(
      await getAppState(GAME_STATS_REVISION_SCOPE, PARTITION_KEY),
      null,
      JSON.stringify(status)
    );
    // The status row is untouched.
    assert.deepEqual((await getAppState('provider-refresh-status', STATUS_KEY))?.value, status);
  }
});

test('live allocator: a genuinely absent status allows a first allocation (unchanged)', async () => {
  const result = await allocateWith({ partition: null }); // no status row at all
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.equal(result.allocation.stamp.revision, 1);
});

test('live allocator: a malformed live ledger blocks before mutation (revision-history-ambiguous)', async () => {
  for (const badLedger of [
    null, // present JSON-null
    {
      schemaVersion: 1,
      ...ID,
      lineage: 'L',
      revision: 3,
      initializedFrom: 'new',
      initializedAt: {},
    },
    {
      schemaVersion: 1,
      ...ID,
      lineage: 'L',
      revision: 0,
      initializedFrom: 'new',
      initializedAt: NOW,
    },
    {
      schemaVersion: 1,
      ...ID,
      lineage: 'L',
      revision: 3,
      initializedFrom: 'new',
      initializedAt: NOW,
      injected: 'x',
    },
  ]) {
    const result = await allocateWith({ partition: null, ledger: badLedger });
    expectBlock(result, 'revision-history-ambiguous');
    // Ledger row byte-for-byte unchanged (never normalized).
    assert.deepEqual(
      (await getAppState(GAME_STATS_REVISION_SCOPE, PARTITION_KEY))?.value,
      badLedger
    );
  }
});
