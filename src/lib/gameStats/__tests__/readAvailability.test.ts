import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateYearGameStatsAvailability,
  readPublicGameStats,
  validateWeeklyGameStatsEnvelope,
} from '../readAvailability.ts';
import {
  __corruptAppStateFileForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';
import {
  completeLegacyRow,
  legacyRowFromWire,
  seedGameStatsPartitionForTests,
  seedGameStatsTeamDatabaseForTests,
  wireGame,
} from './fixtures.ts';

// PLATFORM-086H3 — the public read boundary: full weekly-envelope validation
// before serving, schema-safe projection, coverage-aware availability, and
// the year-level cache-state probe sharing the same coverage authority.

const YEAR = 2026;
const WEEK = 3;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED = '2026-10-11T20:00:00.000Z';

async function seedSchedule(ids: Array<{ id: string; home?: string; away?: string }>) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW,
    partialFailure: false,
    failedSeasonTypes: [],
    items: ids.map((spec) => ({
      id: spec.id,
      week: WEEK,
      seasonType: 'regular',
      startDate: COMPLETED,
      neutralSite: false,
      conferenceGame: false,
      homeTeam: spec.home ?? 'Alpha State',
      awayTeam: spec.away ?? 'Beta Tech',
      homeConference: 'X',
      awayConference: 'Y',
      status: 'STATUS_FINAL',
    })),
  });
}

function record(games: GameStats[], overrides: Partial<WeeklyGameStats> = {}): WeeklyGameStats {
  return {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: new Date(NOW - 60_000).toISOString(),
    games,
    ...overrides,
  };
}

function read() {
  return readPublicGameStats({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    seasonRelation: 'current',
    now: NOW,
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedGameStatsTeamDatabaseForTests();
});

// === Envelope validation ===

test('envelope: every mismatch and malformation is typed', () => {
  const target = { year: YEAR, week: WEEK, seasonType: 'regular' as const };
  assert.deepEqual(validateWeeklyGameStatsEnvelope(record([]), target), []);
  assert.deepEqual(validateWeeklyGameStatsEnvelope(null, target), ['not-an-object']);
  assert.deepEqual(validateWeeklyGameStatsEnvelope([], target), ['not-an-object']);
  assert.deepEqual(validateWeeklyGameStatsEnvelope(record([], { year: 2025 }), target), [
    'year-mismatch',
  ]);
  assert.deepEqual(validateWeeklyGameStatsEnvelope(record([], { week: 4 }), target), [
    'week-mismatch',
  ]);
  assert.deepEqual(
    validateWeeklyGameStatsEnvelope(record([], { seasonType: 'postseason' }), target),
    ['season-type-mismatch']
  );
  assert.deepEqual(
    validateWeeklyGameStatsEnvelope(record([], { fetchedAt: 'yesterday' }), target),
    ['invalid-fetched-at']
  );
  assert.deepEqual(validateWeeklyGameStatsEnvelope({ ...record([]), games: 'nope' }, target), [
    'games-not-array',
  ]);
});

test('read: a mismatched envelope is a typed failure, never ordinary success', async () => {
  await seedSchedule([{ id: '5001' }]);
  // Stored under week 3's key but claiming to be week 9.
  await seedGameStatsPartitionForTests(record([completeLegacyRow(5001)], { week: WEEK }));
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, record([], { week: 9 }));
  const result = await read();
  assert.equal(result.kind, 'invalid-envelope');
  if (result.kind === 'invalid-envelope') {
    assert.deepEqual(result.failures, ['week-mismatch']);
  }
});

test('read: corrupt storage fails typed, and restored storage recovers', async () => {
  await __corruptAppStateFileForTests();
  const failed = await read();
  assert.equal(failed.kind, 'read-failed');

  await __deleteAppStateFileForTests();
  await seedGameStatsTeamDatabaseForTests();
  await seedSchedule([{ id: '5001' }]);
  await seedGameStatsPartitionForTests(record([legacyRowFromWire(wireGame({ id: 5001 }), WEEK)]));
  const recovered = await read();
  assert.equal(recovered.kind, 'served');
});

// === Schema-safe serving + availability agreement ===

test('read: blocked-only partitions serve an EMPTY games array with blocked availability', async () => {
  await seedSchedule([{ id: '5001' }]);
  const blocked = { ...completeLegacyRow(5001), schemaVersion: 3 } as unknown as GameStats;
  await seedGameStatsPartitionForTests(record([blocked]));
  const result = await read();
  assert.equal(result.kind, 'served');
  if (result.kind === 'served') {
    assert.deepEqual(result.view.record.games, [], 'unsupported schema is never served');
    assert.equal(result.view.withheld.unsupportedSchema, 1);
    assert.equal(result.availability.state, 'blocked', 'availability agrees with the games array');
  }
});

test('read: mixed valid + blocked rows serve the valid rows with truthful withheld counts', async () => {
  await seedSchedule([
    { id: '5001' },
    { id: '5002', home: 'Gamma Poly', away: 'Delta Agricultural' },
  ]);
  const valid = legacyRowFromWire(wireGame({ id: 5001 }), WEEK);
  const blocked = {
    ...legacyRowFromWire(
      wireGame({
        id: 5002,
        home: { school: 'Gamma Poly', teamId: 303 },
        away: { school: 'Delta Agricultural', teamId: 404 },
      }),
      WEEK
    ),
    schemaVersion: 3,
  } as unknown as GameStats;
  await seedGameStatsPartitionForTests(record([valid, blocked]));
  const result = await read();
  assert.equal(result.kind, 'served');
  if (result.kind === 'served') {
    assert.deepEqual(
      result.view.record.games.map((g) => g.providerGameId),
      [5001]
    );
    assert.equal(result.view.withheld.unsupportedSchema, 1);
    assert.equal(result.availability.state, 'partial');
    assert.equal(result.availability.blocked, 1, 'the blocked expected game stays typed');
  }
});

test('read: a valid envelope whose rows are all malformed serves empty games with absent coverage', async () => {
  await seedSchedule([{ id: '5001' }]);
  await seedGameStatsPartitionForTests(record([{ nonsense: true } as unknown as GameStats]));
  const result = await read();
  assert.equal(result.kind, 'served');
  if (result.kind === 'served') {
    assert.deepEqual(result.view.record.games, []);
    assert.equal(result.view.withheld.malformed, 1);
    assert.equal(result.availability.state, 'absent');
  }
});

test('read: miss carries availability; served marks stale beyond the TTL', async () => {
  await seedSchedule([{ id: '5001' }]);
  const miss = await read();
  assert.equal(miss.kind, 'miss');
  if (miss.kind === 'miss') assert.equal(miss.availability.state, 'absent');

  await seedGameStatsPartitionForTests(
    record([legacyRowFromWire(wireGame({ id: 5001 }), WEEK)], {
      fetchedAt: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
  );
  const stale = await read();
  assert.equal(stale.kind, 'served');
  if (stale.kind === 'served') {
    assert.equal(stale.stale, true);
    assert.equal(stale.availability.state, 'complete');
  }
});

// === Year-level provider cache-state availability (shared coverage) ===

test('cache-state: a complete partition is available; schedule-unrelated rows are not', async () => {
  await seedSchedule([{ id: '5001' }]);
  await seedGameStatsPartitionForTests(record([legacyRowFromWire(wireGame({ id: 5001 }), WEEK)]));
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'available');

  // Replace with an analytics-eligible row the schedule does NOT expect.
  await seedGameStatsPartitionForTests(
    record([legacyRowFromWire(wireGame({ id: 999_999 }), WEEK)])
  );
  assert.equal(
    await evaluateYearGameStatsAvailability(YEAR, NOW),
    'absent',
    'one eligible row unrelated to the schedule never makes the dataset available'
  );
});

test('cache-state: partial coverage is available; blocked/absent/placeholder-only are not', async () => {
  await seedSchedule([
    { id: '5001' },
    { id: '5002', home: 'Gamma Poly', away: 'Delta Agricultural' },
  ]);
  // Partial: one of two expected games satisfied.
  await seedGameStatsPartitionForTests(record([legacyRowFromWire(wireGame({ id: 5001 }), WEEK)]));
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'available');

  // Blocked-only evidence.
  await seedGameStatsPartitionForTests(
    record([{ ...completeLegacyRow(5001), schemaVersion: 3 } as unknown as GameStats])
  );
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'absent');

  // Absent partition.
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, null);
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'absent');

  // Placeholder-only slate.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: 'cfp-semi',
        week: 1,
        seasonType: 'postseason',
        startDate: COMPLETED,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'TBD',
        awayTeam: 'TBD',
        homeConference: null,
        awayConference: null,
        status: 'STATUS_SCHEDULED',
      },
    ],
  });
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'absent');
});

test('cache-state: no schedule + stored partitions → unknown (never proven absent)', async () => {
  await seedGameStatsPartitionForTests(record([completeLegacyRow(5001)]));
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'unknown');
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, null);
  assert.equal(await evaluateYearGameStatsAvailability(YEAR, NOW), 'absent');
});
