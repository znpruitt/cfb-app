import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import { classifyGameStatsRow, isAnalyticsEligible } from '../contract.ts';
import { getCachedGameStats } from '../cache.ts';
import { ingestGameStatsPartitionResponse } from '../ingestionCoordinator.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStatePoolForTests,
  __setAppStateWriteFailureForTests,
} from '../../server/appStateStore.ts';
import type { GameStats } from '../types.ts';
import { fullWireStats, wireGame } from './fixtures.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const BASE = { year: 2024, week: 6, seasonType: 'regular' as const };
const T1 = '2024-10-07T00:00:00.000Z';
const T2 = '2024-10-08T00:00:00.000Z';
const T3 = '2024-10-09T00:00:00.000Z';

function ingest(payload: unknown, fetchStartedAt = T1) {
  return ingestGameStatsPartitionResponse({ ...BASE, fetchStartedAt, payload });
}

async function readPartition() {
  return getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
}

type WireStat = { category: string; stat: string };

/** Build one untrusted CFBD `/games/teams` game with exact per-side evidence. */
function wireGameCustom(params: {
  id: number;
  homeStats: WireStat[];
  awayStats: WireStat[];
  /** `null` omits the points field entirely; a number sets it; undefined defaults. */
  homePoints?: number | null;
  awayPoints?: number | null;
  homeTeamId?: number;
  awayTeamId?: number;
}): unknown {
  const buildTeam = (
    side: 'home' | 'away',
    stats: WireStat[],
    points: number | null | undefined,
    teamId: number
  ): Record<string, unknown> => {
    const team: Record<string, unknown> = {
      teamId,
      team: side === 'home' ? 'Alpha State' : 'Beta Tech',
      conference: 'Fixture Conference',
      homeAway: side,
      stats,
    };
    const resolved = points === null ? undefined : (points ?? (side === 'home' ? 31 : 17));
    if (resolved !== undefined) team.points = resolved;
    return team;
  };
  return {
    id: params.id,
    teams: [
      buildTeam('home', params.homeStats, params.homePoints, params.homeTeamId ?? 101),
      buildTeam('away', params.awayStats, params.awayPoints, params.awayTeamId ?? 202),
    ],
  };
}

/** A single recognized, valid category → persistable when present on BOTH sides. */
const SPARSE: WireStat[] = [{ category: 'turnovers', stat: '1' }];
/** Only an unmodeled category → parses fine, never persistable. */
const UNKNOWN_ONLY: WireStat[] = [{ category: 'sacks', stat: '3' }];
/** All six analytics-required categories, each valid. */
const REQUIRED_SIX: WireStat[] = [
  { category: 'totalYards', stat: '412' },
  { category: 'rushingYards', stat: '187' },
  { category: 'netPassingYards', stat: '225' },
  { category: 'turnovers', stat: '1' },
  { category: 'thirdDownEff', stat: '6-14' },
  { category: 'possessionTime', stat: '31:24' },
];

/**
 * Minimal fake pg client/pool (PLATFORM-086H3C2): enough to drive ONE merge
 * transaction (begin → lock → read-empty → write → commit) to a LOST COMMIT with
 * a submitted write, so the finalize error carries `writeAttempted: true` — the
 * only path that yields H2 `indeterminate`. The file store's atomic-rename commit
 * failure is `writeAttempted: false` → `unavailable`, so PG mode is required to
 * exercise this shape. No concurrency/capacity is modeled (one sequential call).
 */
class LostCommitClient {
  released = false;
  async query(text: string): Promise<{ rows: unknown[] }> {
    const sql = text.toLowerCase().trim();
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('select value')) return { rows: [] }; // empty existing partition
    if (sql === 'commit') throw new Error('commit acknowledgement lost');
    // begin / pg_advisory_xact_lock / insert (write submitted) / rollback / ddl.
    return { rows: [] };
  }
  release(): void {
    this.released = true;
  }
}

class LostCommitPool {
  async query(text: string): Promise<{ rows: unknown[] }> {
    return text.toLowerCase().includes('to_regclass')
      ? { rows: [{ present: true }] }
      : { rows: [] };
  }
  async connect(): Promise<LostCommitClient> {
    return new LostCommitClient();
  }
  async end(): Promise<void> {}
}

// === Top-level validation ===

test('non-array payload is rejected as invalid-payload without touching a seeded partition', async () => {
  // Seed a real partition through the adapter itself, capture it verbatim.
  const seeded = await ingest([wireGame({ id: 700 })], T1);
  assert.equal(seeded.kind, 'merge-result');
  const before = await readPartition();
  assert.ok(before);

  for (const notAnArray of [null, undefined, 'x', 42, { games: [] }] as unknown[]) {
    const result = await ingest(notAnArray);
    assert.deepEqual(result, { kind: 'rejected', reason: 'invalid-payload' });
  }
  // Prior durable data is byte-for-byte untouched (H2 was never called).
  assert.deepEqual(await readPartition(), before);
});

test('empty array is a no-op; it never creates or rewrites a partition', async () => {
  // No partition yet → no-op, nothing created.
  const onEmpty = await ingest([]);
  assert.deepEqual(onEmpty, { kind: 'no-op', reason: 'empty-response' });
  assert.equal(await readPartition(), null);

  // With a seeded partition → still a no-op; the partition is unchanged (an
  // empty array is never interpreted as a deletion).
  await ingest([wireGame({ id: 701 })], T1);
  const before = await readPartition();
  assert.deepEqual(await ingest([]), { kind: 'no-op', reason: 'empty-response' });
  assert.deepEqual(await readPartition(), before);
});

// === Persistence gate: rejection without a write ===

test('all-invalid, all-nonpersistable, and one-sided batches reject without a write', async () => {
  // (a) every row fails to parse.
  const allInvalid = await ingest([42, {}, { id: 5 }]);
  assert.deepEqual(allInvalid, { kind: 'rejected', reason: 'no-persistable-observations' });
  assert.equal(await readPartition(), null);

  // (b) rows parse but carry only unmodeled categories on both sides.
  const allNonPersistable = await ingest([
    wireGameCustom({ id: 10, homeStats: UNKNOWN_ONLY, awayStats: UNKNOWN_ONLY }),
    wireGameCustom({ id: 11, homeStats: UNKNOWN_ONLY, awayStats: UNKNOWN_ONLY }),
  ]);
  assert.deepEqual(allNonPersistable, { kind: 'rejected', reason: 'no-persistable-observations' });
  assert.equal(await readPartition(), null);

  // (c) evidence on only one side is not persistable.
  const oneSided = await ingest([
    wireGameCustom({ id: 12, homeStats: SPARSE, awayStats: UNKNOWN_ONLY }),
  ]);
  assert.deepEqual(oneSided, { kind: 'rejected', reason: 'no-persistable-observations' });
  assert.equal(await readPartition(), null);
});

// === Mixed batch: whole collection to H2, batch diagnostics ===

test('a mixed batch merges persistable rows, forwards every parsed row, and reports counts', async () => {
  const result = await ingest([
    wireGame({ id: 20 }), // clean, persistable
    42, // parse failure: not-an-object
    { id: 5 }, // parse failure: invalid-teams-shape
    wireGameCustom({ id: 21, homeStats: UNKNOWN_ONLY, awayStats: UNKNOWN_ONLY }), // parsed, non-persistable
  ]);
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;

  // Diagnostics describe the batch decomposition exactly.
  assert.deepEqual(result.diagnostics, {
    rawRowCount: 4,
    parsedRowCount: 2, // game 20 + non-persistable game 21
    persistableRowCount: 1, // game 20
    nonPersistableParsedRowCount: 1, // game 21
    parseFailureCounts: { 'not-an-object': 1, 'invalid-teams-shape': 1 },
    rowAcceptance: 'mixed',
  });
  // The persistable game merged; the batch did not wait for a full slate.
  assert.deepEqual(result.merge.inserted, [20]);
  assert.equal(result.merge.outcome, 'written');
  const partition = await readPartition();
  assert.deepEqual(
    partition!.games.map((g) => g.providerGameId),
    [20]
  );
});

test('H2 — not the adapter — filters parsed non-persistable rows and reports skippedNonPersistable', async () => {
  // One persistable game plus one parsed-but-non-persistable game: the adapter
  // forwards BOTH to H2 (it never pre-filters). H2 drops the non-persistable one
  // and reports it, while the adapter's own diagnostics count it independently.
  const result = await ingest([
    wireGame({ id: 30 }),
    wireGameCustom({ id: 31, homeStats: UNKNOWN_ONLY, awayStats: UNKNOWN_ONLY }),
  ]);
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;
  assert.equal(result.diagnostics.nonPersistableParsedRowCount, 1);
  // H2 saw the non-persistable observation and skipped it.
  assert.equal(result.merge.skippedNonPersistable, 1);
  assert.deepEqual(result.merge.inserted, [30]);
});

// === Incremental / partial behavior ===

test('an incremental single-game response writes that game using the caller fetchStartedAt', async () => {
  const result = await ingest([wireGame({ id: 40 })], T1);
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;
  assert.deepEqual(result.merge.inserted, [40]);
  assert.equal(result.diagnostics.rowAcceptance, 'clean');

  const partition = await readPartition();
  assert.deepEqual(
    partition!.games.map((g) => g.providerGameId),
    [40]
  );
  // The stored fence is exactly the supplied fetchStartedAt — the adapter never
  // generated a later timestamp after receiving the response.
  assert.equal(partition!.games[0]!.fetchStartedAt, T1);
});

test('a later partial response retains previously stored games and omitted valid categories', async () => {
  await ingest([wireGame({ id: 50 })], T1); // full stats for game 50

  // A later batch addressing only game 51 retains game 50 untouched.
  const second = await ingest([wireGame({ id: 51 })], T2);
  assert.equal(second.kind, 'merge-result');
  if (second.kind !== 'merge-result') return;
  assert.deepEqual(second.merge.inserted, [51]);
  assert.deepEqual(second.merge.retainedExisting, [50]);

  // A newer, sparser observation of game 50 (only `turnovers`, a CHANGED value)
  // preserves the raw categories it omits — H2's conservative merge, forwarded
  // unchanged.
  const changedTurnovers: WireStat[] = [{ category: 'turnovers', stat: '2' }];
  const third = await ingest(
    [wireGameCustom({ id: 50, homeStats: changedTurnovers, awayStats: changedTurnovers })],
    T3
  );
  assert.equal(third.kind, 'merge-result');
  if (third.kind !== 'merge-result') return;
  assert.deepEqual(third.merge.updated, [50]);

  const partition = await readPartition();
  const ids = partition!.games.map((g) => g.providerGameId).sort((a, b) => a - b);
  assert.deepEqual(ids, [50, 51]); // both games still present
  const game50 = partition!.games.find((g) => g.providerGameId === 50)!;
  // Omitted category preserved; the updated category advanced.
  assert.equal(game50.home.raw!.totalYards, '412');
  assert.equal(game50.home.raw!.turnovers, '2');
});

test('missing points still persists sparse evidence but never establishes analytics completeness', async () => {
  const result = await ingest([
    wireGameCustom({
      id: 60,
      homeStats: REQUIRED_SIX,
      awayStats: REQUIRED_SIX,
      homePoints: null, // points field omitted on both sides
      awayPoints: null,
    }),
  ]);
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;
  assert.deepEqual(result.merge.inserted, [60]);

  const stored = (await readPartition())!.games[0] as GameStats;
  // Persisted, but sparse (points evidence missing) and NOT analytics-eligible.
  assert.equal(classifyGameStatsRow(stored).state, 'v2-sparse');
  assert.equal(isAnalyticsEligible(stored), false);
});

// === H2 outcome pass-through (never collapsed or relabeled) ===

test('a stale-only H2 outcome passes through unchanged', async () => {
  await ingest([wireGame({ id: 70 })], T2); // newer durable row
  const stale = await ingest([wireGame({ id: 70 })], T1); // older observation
  assert.equal(stale.kind, 'merge-result');
  if (stale.kind !== 'merge-result') return;
  assert.equal(stale.merge.outcome, 'stale');
  assert.deepEqual(stale.merge.stale, [70]);
  assert.deepEqual(stale.merge.inserted, []);
});

test('a conflict-only H2 outcome passes through unchanged', async () => {
  await ingest([wireGame({ id: 80 })], T1);
  // Same fence, divergent content for the same game → same-fence-divergent.
  const conflict = await ingest(
    [wireGame({ id: 80, home: { statOverrides: { totalYards: '999' } } })],
    T1
  );
  assert.equal(conflict.kind, 'merge-result');
  if (conflict.kind !== 'merge-result') return;
  assert.equal(conflict.merge.outcome, 'conflict');
  assert.deepEqual(conflict.merge.conflicts, [
    { providerGameId: 80, reason: 'same-fence-divergent' },
  ]);
});

test('a mixed write + stale batch preserves H2 partially-merged alongside mixed row acceptance', async () => {
  await ingest([wireGame({ id: 90 })], T2); // seed game 90 at a newer fence

  const result = await ingest(
    [
      wireGame({ id: 90 }), // older fence → stale
      wireGame({ id: 91 }), // new persistable game → written
      42, // parse failure
    ],
    T1
  );
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;
  // rowAcceptance (batch decomposition) and H2 outcome are SEPARATE facts.
  assert.equal(result.diagnostics.rowAcceptance, 'mixed');
  assert.equal(result.merge.outcome, 'partially-merged');
  assert.deepEqual(result.merge.inserted, [91]);
  assert.deepEqual(result.merge.stale, [90]);
});

test('H2 unavailable is returned unchanged and never collapsed to a write', async () => {
  // An invalid fetchStartedAt is H2's fence policy, not the adapter's: the
  // adapter forwards it and returns H2's unavailable verbatim.
  const result = await ingest([wireGame({ id: 100 })], 'not-a-timestamp');
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;
  assert.equal(result.merge.outcome, 'unavailable');
  assert.equal(result.merge.unavailableReason, 'invalid-fetch-started-at');
  // Diagnostics still describe the batch; durable state was not created.
  assert.equal(result.diagnostics.rowAcceptance, 'clean');
  assert.equal(await readPartition(), null);
});

test('a durable write failure surfaces as H2 unavailable, unchanged', async () => {
  __setAppStateWriteFailureForTests(new Error('write down'), 'game-stats');
  try {
    const result = await ingest([wireGame({ id: 105 })], T1);
    assert.equal(result.kind, 'merge-result');
    if (result.kind !== 'merge-result') return;
    assert.equal(result.merge.outcome, 'unavailable');
    assert.equal(result.merge.unavailableReason, 'durable-write-failed');
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});

test('H2 indeterminate is returned unchanged and never labeled success or failure', async () => {
  // PG mode with a lost COMMIT after a submitted write → H2 `indeterminate`.
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  __setAppStatePoolForTests(new LostCommitPool() as unknown as Pool);
  try {
    const result = await ingest([wireGame({ id: 110 })], T1);
    assert.equal(result.kind, 'merge-result');
    if (result.kind !== 'merge-result') return;
    assert.equal(result.merge.outcome, 'indeterminate');
    assert.deepEqual(result.merge.indeterminate, {
      reason: 'transaction-finalize-failed',
      durability: 'unknown',
      partitionKey: result.merge.partitionKey,
    });
  } finally {
    __setAppStatePoolForTests(null);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    __resetAppStateForTests();
  }
});

// === Idempotence ===

test('repeating the same input is idempotent through H2', async () => {
  const first = await ingest([wireGame({ id: 120 })], T1);
  assert.equal(first.kind, 'merge-result');
  if (first.kind !== 'merge-result') return;
  assert.deepEqual(first.merge.inserted, [120]);
  const afterFirst = await readPartition();

  const second = await ingest([wireGame({ id: 120 })], T1);
  assert.equal(second.kind, 'merge-result');
  if (second.kind !== 'merge-result') return;
  // Same fence, identical content → unchanged; no durable rewrite.
  assert.equal(second.merge.outcome, 'unchanged');
  assert.deepEqual(second.merge.inserted, []);
  assert.deepEqual(await readPartition(), afterFirst);
});

// Guard against a fixture regression: the "full" wire game is analytics-complete
// so the sparse/partial cases above are meaningful contrasts.
test('sanity: the full wire fixture is a complete, analytics-eligible observation', async () => {
  const result = await ingest([wireGame({ id: 130 })], T1);
  assert.equal(result.kind, 'merge-result');
  if (result.kind !== 'merge-result') return;
  const stored = (await readPartition())!.games[0] as GameStats;
  assert.equal(classifyGameStatsRow(stored).state, 'v2-complete');
  assert.equal(isAnalyticsEligible(stored), true);
  // The fixture carries the recognized categories the sparse cases omit.
  assert.equal(
    fullWireStats().some((s) => s.category === 'totalYards'),
    true
  );
});
