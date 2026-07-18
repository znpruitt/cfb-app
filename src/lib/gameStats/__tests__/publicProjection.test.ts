import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicWeeklyGameStats } from '../publicProjection.ts';
import { mergeGameStatsPartitionDurable } from '../durableMerge.ts';
import { parseV2GameObservation } from '../contract.ts';
import { getCachedGameStats } from '../cache.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';
import {
  blankSchoolLegacyRow,
  completeLegacyRow,
  legacyRowFromWire,
  malformedRequiredLegacyRow,
  normalizedMismatchLegacyRow,
  statlessLegacyRow,
  v2RowLike,
  wireGame,
} from './fixtures.ts';

// PLATFORM-086H3 — schema-safe public projection: legacy rows byte-equivalent
// by reference, v2 metadata stripped, unsupported schema WITHHELD (never
// laundered into legacy-looking data), malformed rows withheld.

function record(games: GameStats[]): WeeklyGameStats {
  return {
    year: 2024,
    week: 5,
    seasonType: 'regular',
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games,
  };
}

test('legacy rows pass through by reference — public output stays byte-equivalent', () => {
  const row = completeLegacyRow(101);
  const view = buildPublicWeeklyGameStats(record([row, completeLegacyRow(102)]));
  assert.equal(view.record.games[0], row, 'same reference, not a reshaped copy');
  assert.deepEqual(view.withheld, {
    unsupportedSchema: 0,
    malformed: 0,
    defective: 0,
    partitionMismatch: 0,
    conflictingDuplicates: 0,
  });
  const source = record([completeLegacyRow(101), completeLegacyRow(102)]);
  assert.equal(
    JSON.stringify(buildPublicWeeklyGameStats(source).record),
    JSON.stringify(source),
    'an all-legacy partition serializes identically'
  );
});

test('v2 persistence metadata is stripped from the public wire', async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  // Build a REAL v2 row through the production write path (merge authority).
  const parsed = parseV2GameObservation(wireGame({ id: 5001 }));
  assert.ok(parsed.ok);
  const merge = await mergeGameStatsPartitionDurable({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchStartedAt: '2026-10-15T12:00:00.000Z',
    observations: [parsed.ok ? parsed.observation : (null as never)],
  });
  assert.equal(merge.outcome, 'written');
  assert.ok(merge.commit, 'a committed write carries its commit stamp');
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.ok(stored);
  const storedRow = stored!.games[0]!;
  assert.equal(storedRow.schemaVersion, 2, 'precondition: durable row carries v2 metadata');
  assert.ok(storedRow.fetchStartedAt);
  assert.equal(storedRow.home.pointsProvided, true);

  const view = buildPublicWeeklyGameStats(stored!);
  const serialized = JSON.stringify(view.record);
  assert.ok(!serialized.includes('schemaVersion'));
  assert.ok(!serialized.includes('fetchStartedAt'));
  assert.ok(!serialized.includes('pointsProvided'));

  // Everything that was always public survives untouched.
  const publicRow = view.record.games[0]!;
  assert.equal(publicRow.providerGameId, 5001);
  assert.equal(publicRow.home.points, storedRow.home.points);
  assert.equal(publicRow.home.totalYards, storedRow.home.totalYards);
  assert.deepEqual(publicRow.home.raw, storedRow.home.raw);

  // The projection never mutates the stored record.
  assert.equal(storedRow.schemaVersion, 2);
  assert.equal(storedRow.home.pointsProvided, true);
});

test('a mixed partition strips only v2 rows; legacy stays by reference', () => {
  const legacy = completeLegacyRow(101);
  const v2ish = {
    ...completeLegacyRow(102),
    schemaVersion: 2 as const,
    fetchStartedAt: '2026-10-15T12:00:00.000Z',
  };
  const view = buildPublicWeeklyGameStats(record([legacy, v2ish]));
  assert.equal(view.record.games[0], legacy, 'legacy row is the identical object');
  assert.ok(!('schemaVersion' in view.record.games[1]!));
  assert.ok(!('fetchStartedAt' in view.record.games[1]!));
  assert.equal(view.record.games[1]!.providerGameId, 102);
});

test('unsupported schema authority is WITHHELD, never laundered into legacy-looking rows', () => {
  const future = { ...completeLegacyRow(103), schemaVersion: 3 } as unknown as GameStats;
  const malformedVersion = {
    ...completeLegacyRow(104),
    schemaVersion: 'two',
  } as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(
    record([completeLegacyRow(101), future, malformedVersion])
  );
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [101],
    'unsupported-schema rows never reach the public wire'
  );
  assert.equal(view.withheld.unsupportedSchema, 2);
  const serialized = JSON.stringify(view.record);
  assert.ok(!serialized.includes('"schemaVersion"'), 'no version metadata leaks');
});

test('structurally malformed rows are withheld as malformed', () => {
  const garbage = { nonsense: true } as unknown as GameStats;
  const idless = { ...completeLegacyRow(105), providerGameId: 0 } as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([completeLegacyRow(101), garbage, idless]));
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [101]
  );
  assert.equal(view.withheld.malformed, 2);
});

test('a valid envelope with no publishable rows serves an empty games array with truthful counts', () => {
  const view = buildPublicWeeklyGameStats(
    record([{ ...completeLegacyRow(103), schemaVersion: 3 } as unknown as GameStats])
  );
  assert.deepEqual(view.record.games, []);
  assert.deepEqual(view.withheld, {
    unsupportedSchema: 1,
    malformed: 0,
    defective: 0,
    partitionMismatch: 0,
    conflictingDuplicates: 0,
  });
});

// === Explicit H1 public allowlist matrix (RC 19/25) ===

test('allowlist: defective legacy states and non-persistable v2 rows are withheld as defective', () => {
  const view = buildPublicWeeklyGameStats(
    record([
      completeLegacyRow(101), // legacy-compatible → published
      statlessLegacyRow(102), // legacy-statless → withheld
      malformedRequiredLegacyRow(103), // legacy-malformed → withheld
      normalizedMismatchLegacyRow(104), // legacy-normalized-mismatch → withheld
      blankSchoolLegacyRow(105), // unusable-identity → withheld
      v2RowLike({ id: 106, homeRaw: {}, awayRaw: {} }) as unknown as GameStats, // non-persistable-empty → withheld
    ])
  );
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [101],
    'only allowlisted states reach the wire'
  );
  assert.equal(view.withheld.defective, 5);
});

test('allowlist: a v2-sparse row (authority-written partial evidence) is published', () => {
  const sparse = v2RowLike({
    id: 107,
    homeOverrides: { pointsProvided: false, points: 0 },
  }) as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([sparse]));
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [107]
  );
  assert.ok(!('schemaVersion' in view.record.games[0]!));
});

test('projection safety: a malformed v2 row without home/away cannot throw', () => {
  const noSides = { schemaVersion: 2, providerGameId: 108, week: 5, seasonType: 'regular' };
  const view = buildPublicWeeklyGameStats(record([noSides as unknown as GameStats]));
  assert.deepEqual(view.record.games, []);
  assert.equal(view.withheld.defective, 1, 'missing-side v2 is unusable-identity → defective');
});

test('duplicates: equivalent eligible copies collapse; conflicting copies are ALL withheld', () => {
  const a = completeLegacyRow(109);
  const identical = completeLegacyRow(109);
  const conflictA = completeLegacyRow(110);
  const conflictB = legacyRowFromWire(wireGame({ id: 110, home: { points: 99 } }));
  const view = buildPublicWeeklyGameStats(record([a, identical, conflictA, conflictB]));
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [109],
    'one copy of the identical pair; NO copy of the conflicting pair'
  );
  assert.equal(view.withheld.conflictingDuplicates, 2);
});

test('partition identity: rows claiming a different week or season type are withheld', () => {
  const wrongWeek = { ...completeLegacyRow(111), week: 9 };
  const wrongSeason = { ...completeLegacyRow(112), seasonType: 'postseason' as const };
  const view = buildPublicWeeklyGameStats(
    record([completeLegacyRow(113), wrongWeek, wrongSeason]),
    { week: 5, seasonType: 'regular' }
  );
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [113]
  );
  assert.equal(view.withheld.partitionMismatch, 2);
});

test('envelope metadata: commitRevision never reaches the public wire', () => {
  const stored = { ...record([completeLegacyRow(114)]), commitRevision: 7 };
  const view = buildPublicWeeklyGameStats(stored);
  assert.ok(!('commitRevision' in view.record));
  assert.ok(!JSON.stringify(view.record).includes('commitRevision'));
});
