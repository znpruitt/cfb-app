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

// PLATFORM-086H3 — schema-safe public projection (round 5): EVERY level of the
// wire — envelope, game, team, and `raw` — is CONSTRUCTED from an explicit
// allowlist; NO row or envelope is returned by reference; unsupported schema is
// WITHHELD (never laundered); malformed rows withheld; public-only duplicate
// conflicts are order-independent.

function record(games: GameStats[]): WeeklyGameStats {
  return {
    year: 2024,
    week: 5,
    seasonType: 'regular',
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games,
  };
}

test('legacy rows are CONSTRUCTED (never by reference); unrecognized raw categories are dropped', () => {
  const row = completeLegacyRow(101);
  // The fixture carries the deliberately-UNMODELED `completionAttempts` in raw.
  assert.ok('completionAttempts' in row.home.raw, 'precondition: stored row has the unknown key');
  const view = buildPublicWeeklyGameStats(record([row, completeLegacyRow(102)]));
  assert.notEqual(view.record.games[0], row, 'a fresh object, never the stored reference');
  assert.equal(view.record.games[0]!.providerGameId, 101);
  assert.ok(
    !('completionAttempts' in view.record.games[0]!.home.raw),
    'the unrecognized raw category is dropped by the allowlist'
  );
  // The recognized categories survive with identical values.
  assert.equal(view.record.games[0]!.home.raw.totalYards, row.home.raw.totalYards);
  assert.deepEqual(view.withheld, {
    unsupportedSchema: 0,
    malformed: 0,
    defective: 0,
    partitionMismatch: 0,
    conflictingDuplicates: 0,
  });
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
  // Recognized raw categories survive verbatim; any unrecognized category the
  // wire carried (e.g. completionAttempts) is dropped by the allowlist.
  for (const [category, value] of Object.entries(publicRow.home.raw)) {
    assert.equal(value, storedRow.home.raw[category]);
  }
  assert.ok(!('completionAttempts' in publicRow.home.raw));

  // The projection never mutates the stored record.
  assert.equal(storedRow.schemaVersion, 2);
  assert.equal(storedRow.home.pointsProvided, true);
});

test('a mixed partition strips v2 metadata AND constructs legacy rows fresh', () => {
  const legacy = completeLegacyRow(101);
  const v2ish = {
    ...completeLegacyRow(102),
    schemaVersion: 2 as const,
    fetchStartedAt: '2026-10-15T12:00:00.000Z',
  };
  const view = buildPublicWeeklyGameStats(record([legacy, v2ish]));
  assert.notEqual(
    view.record.games[0],
    legacy,
    'legacy row is a fresh construction, not a reference'
  );
  assert.equal(view.record.games[0]!.providerGameId, 101);
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

test('duplicates: equivalent copies collapse; conflicting copies withhold the game (counted per id)', () => {
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
  assert.equal(view.withheld.conflictingDuplicates, 1, 'one conflicted GAME id, not two copies');
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

// === Cross-format duplicate authority (shared with H1 analytics selection) ===

test('duplicates: an eligible v2 copy SUPERSEDES its equivalent compatible legacy copy', () => {
  // The v2 fixture and the legacy fixture project identically for analytics
  // (same raw + points), so H1 selects the v2 class — public output publishes
  // the v2 copy (metadata-stripped) and never an empty games array.
  const legacy = completeLegacyRow(220);
  const v2 = v2RowLike({
    id: 220,
    homeRaw: legacy.home.raw,
    awayRaw: legacy.away.raw,
    homeOverrides: { school: legacy.home.school, points: legacy.home.points },
    awayOverrides: { school: legacy.away.school, points: legacy.away.points },
  }) as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([legacy, v2]));
  assert.equal(view.record.games.length, 1, 'a coverage-satisfied pair never yields games: []');
  assert.ok(!('schemaVersion' in view.record.games[0]!), 'the v2 winner publishes stripped');
  assert.equal(view.withheld.conflictingDuplicates, 0);
});

test('duplicates: DIVERGENT legacy/v2 projections for one game conflict and withhold every copy', () => {
  const legacy = completeLegacyRow(221);
  const v2 = v2RowLike({ id: 221 }) as unknown as GameStats; // different school/points → divergent projections
  const view = buildPublicWeeklyGameStats(record([legacy, v2]));
  // H1: eligible v2 preferred class contains ONE candidate — selection picks
  // it deterministically (no conflict within the class). Verify agreement:
  // whatever analytics selects is what the wire serves.
  assert.equal(view.record.games.length, 1);
  assert.ok(!('schemaVersion' in view.record.games[0]!), 'the analytics-preferred v2 copy serves');
});

test('duplicates: conflicting v2 copies withhold all; identical v2-sparse copies collapse', () => {
  const sparseA = v2RowLike({
    id: 222,
    homeOverrides: { pointsProvided: false, points: 0 },
  }) as unknown as GameStats;
  const sparseB = v2RowLike({
    id: 222,
    homeOverrides: { pointsProvided: false, points: 0 },
  }) as unknown as GameStats;
  const identical = buildPublicWeeklyGameStats(record([sparseA, sparseB]));
  assert.equal(identical.record.games.length, 1, 'indistinguishable sparse copies collapse');

  const divergentB = v2RowLike({
    id: 222,
    homeOverrides: { pointsProvided: false, points: 0, school: 'Someone Else', schoolId: 909 },
  }) as unknown as GameStats;
  const divergent = buildPublicWeeklyGameStats(record([sparseA, divergentB]));
  assert.deepEqual(divergent.record.games, [], 'divergent sparse copies withhold entirely');
  assert.equal(divergent.withheld.conflictingDuplicates, 1, 'one conflicted game id');
});

test('duplicates: a defective or unsupported-schema copy never joins the duplicate decision', () => {
  const good = completeLegacyRow(223);
  const defective = statlessLegacyRow(223);
  const future = { ...completeLegacyRow(223), schemaVersion: 3 } as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([good, defective, future]));
  assert.equal(view.record.games.length, 1, 'the approved copy publishes alone');
  assert.equal(view.withheld.defective, 1);
  assert.equal(view.withheld.unsupportedSchema, 1);
});

test('strict optional partition fields: malformed values are mismatches, not "absent"', () => {
  const stringWeek = { ...completeLegacyRow(224), week: '5' } as unknown as GameStats;
  const badSeason = { ...completeLegacyRow(225), seasonType: 'exhibition' } as unknown as GameStats;
  const wrongYear = { ...completeLegacyRow(226), year: 2020 } as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(
    record([completeLegacyRow(227), stringWeek, badSeason, wrongYear]),
    { year: 2024, week: 5, seasonType: 'regular' }
  );
  assert.deepEqual(
    view.record.games.map((g) => g.providerGameId),
    [227]
  );
  assert.equal(view.withheld.partitionMismatch, 3);
});

test('construction allowlist: unknown internal fields on v2 rows/teams are dropped by construction', () => {
  const contaminated = {
    ...(v2RowLike({ id: 228 }) as unknown as GameStats),
    attemptToken: 'secret-token',
    writeAttempted: true,
    futureInternalField: { nested: true },
  } as unknown as GameStats;
  (contaminated.home as unknown as Record<string, unknown>).recoveryMetadata = 'internal';
  const view = buildPublicWeeklyGameStats(record([contaminated]));
  const serialized = JSON.stringify(view.record);
  for (const banned of [
    'attemptToken',
    'writeAttempted',
    'futureInternalField',
    'recoveryMetadata',
    'schemaVersion',
    'fetchStartedAt',
    'pointsProvided',
    'commitRevision',
  ]) {
    assert.ok(!serialized.includes(banned), `${banned} never reaches the wire`);
  }
  assert.equal(view.record.games.length, 1, 'the row itself still publishes');
});

// === Explicit construction at EVERY level; unknown fields dropped (RC 24–27) ===

test('construction allowlist: unknown fields injected at envelope/game/team/raw/nested never reach the wire', () => {
  const contaminated = {
    ...(v2RowLike({
      id: 300,
      homeRaw: {
        totalYards: '412',
        rushingYards: '187',
        netPassingYards: '225',
        turnovers: '1',
        thirdDownEff: '6-14',
        possessionTime: '31:24',
        // Unknown/internal raw categories that must be dropped:
        completionAttempts: '22-33',
        sacks: '3',
        __proto__key: 'x',
        injectedInternal: 'leak',
      },
    }) as unknown as GameStats),
    // Game-level contamination:
    commitRevision: 7,
    attemptToken: 'game-token',
  } as unknown as GameStats;
  // Team-level contamination:
  (contaminated.home as unknown as Record<string, unknown>).recoveryMetadata = 'internal';
  (contaminated.home as unknown as Record<string, unknown>).writeAttempted = true;
  // Envelope-level contamination:
  const envelope = {
    ...record([contaminated]),
    commitRevision: 9,
    internalEnvelopeField: { nested: true },
  } as unknown as WeeklyGameStats;

  const view = buildPublicWeeklyGameStats(envelope);
  const serialized = JSON.stringify(view.record);
  for (const banned of [
    'commitRevision',
    'attemptToken',
    'recoveryMetadata',
    'writeAttempted',
    'internalEnvelopeField',
    'completionAttempts',
    'sacks',
    'injectedInternal',
    'schemaVersion',
    'fetchStartedAt',
    'pointsProvided',
  ]) {
    assert.ok(!serialized.includes(banned), `${banned} dropped by construction`);
  }
  assert.equal(view.record.games.length, 1);
  // Only the recognized raw categories survive.
  assert.deepEqual(Object.keys(view.record.games[0]!.home.raw).sort(), [
    'netPassingYards',
    'possessionTime',
    'rushingYards',
    'thirdDownEff',
    'totalYards',
    'turnovers',
  ]);
});

test('raw allowlist: a non-string recognized value is dropped (only valid string categories survive)', () => {
  const row = v2RowLike({
    id: 301,
    homeRaw: {
      totalYards: '412',
      rushingYards: 187, // number, not a string → dropped
      netPassingYards: '225',
      turnovers: '1',
      thirdDownEff: '6-14',
      possessionTime: '31:24',
    },
  }) as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([row]));
  assert.ok(!('rushingYards' in view.record.games[0]!.home.raw), 'non-string value dropped');
  assert.equal(view.record.games[0]!.home.raw.totalYards, '412');
});

// === Public-only duplicate conflicts (RC 28–32): analytics-equal but
// public-different copies must conflict; array order never decides ===

test('duplicates: two v2 copies EQUAL for analytics but different in a return stat are a PUBLIC conflict', () => {
  // Both carry identical analytics-required categories (so selectAnalyticsRows
  // would treat them as one), differing ONLY in kickReturnYards — a public
  // field analytics never inspects.
  const analyticsRaw = {
    totalYards: '412',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
  };
  const copyA = v2RowLike({
    id: 310,
    homeRaw: { ...analyticsRaw, kickReturnYards: '64' },
    homeOverrides: { kickReturnYards: 64 },
  }) as unknown as GameStats;
  const copyB = v2RowLike({
    id: 310,
    homeRaw: { ...analyticsRaw, kickReturnYards: '9' },
    homeOverrides: { kickReturnYards: 9 },
  }) as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([copyA, copyB]));
  assert.deepEqual(view.record.games, [], 'public-different copies withheld');
  assert.equal(view.withheld.conflictingDuplicates, 1);
});

test('duplicates: array ORDER never decides which of two public-conflicting copies serves', () => {
  const analyticsRaw = {
    totalYards: '412',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
  };
  const hi = v2RowLike({
    id: 311,
    homeRaw: { ...analyticsRaw, puntReturnYards: '40' },
    homeOverrides: { puntReturnYards: 40 },
  }) as unknown as GameStats;
  const lo = v2RowLike({
    id: 311,
    homeRaw: { ...analyticsRaw, puntReturnYards: '2' },
    homeOverrides: { puntReturnYards: 2 },
  }) as unknown as GameStats;
  const forward = buildPublicWeeklyGameStats(record([hi, lo]));
  const reverse = buildPublicWeeklyGameStats(record([lo, hi]));
  assert.deepEqual(forward.record.games, [], 'forward order: withheld');
  assert.deepEqual(reverse.record.games, [], 'reverse order: identically withheld');
});

test('duplicates: a three-copy group with two equal + one conflicting withholds the whole game', () => {
  const analyticsRaw = {
    totalYards: '412',
    rushingYards: '187',
    netPassingYards: '225',
    turnovers: '1',
    thirdDownEff: '6-14',
    possessionTime: '31:24',
  };
  const equalA = v2RowLike({ id: 312, homeRaw: analyticsRaw }) as unknown as GameStats;
  const equalB = v2RowLike({ id: 312, homeRaw: analyticsRaw }) as unknown as GameStats;
  const different = v2RowLike({
    id: 312,
    homeOverrides: { points: 99 },
  }) as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([equalA, equalB, different]));
  assert.deepEqual(view.record.games, [], 'any divergent copy in the winning class conflicts');
  assert.equal(view.withheld.conflictingDuplicates, 1);
});

test('duplicates: a coverage-satisfied equivalent legacy+v2 pair still yields ONE public game', () => {
  const legacy = completeLegacyRow(313);
  const v2 = v2RowLike({
    id: 313,
    homeRaw: legacy.home.raw,
    awayRaw: legacy.away.raw,
    homeOverrides: { school: legacy.home.school, points: legacy.home.points },
    awayOverrides: { school: legacy.away.school, points: legacy.away.points },
  }) as unknown as GameStats;
  const view = buildPublicWeeklyGameStats(record([legacy, v2]));
  assert.equal(view.record.games.length, 1, 'format precedence, never games: []');
  assert.equal(view.withheld.conflictingDuplicates, 0);
});
