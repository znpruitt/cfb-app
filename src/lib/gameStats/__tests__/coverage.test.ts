import assert from 'node:assert/strict';
import test from 'node:test';

import { isUsableGameStatsRow, usableGameStatsGameIds } from '../coverage.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';

// PLATFORM-086H3E3: coverage.ts is now PRESENCE-only (the admin cache-state
// probe). The legacy payload classifier and cron slate helpers
// (classifyGameStatsPayload / expectsGameStats / hasUsableGameStats) were
// retired with the legacy writer — ingestion policy lives solely behind
// ingestGameStatsPartitionResponse, and canonical coverage is the
// evidence-based evaluatePartitionCoverage.

function row(providerGameId: number, homeSchool = 'Alpha', awaySchool = 'Beta'): GameStats {
  return {
    providerGameId,
    week: 1,
    seasonType: 'regular',
    // Only the fields presence inspects need to be real; the rest are structural.
    home: { school: homeSchool } as GameStats['home'],
    away: { school: awaySchool } as GameStats['away'],
  };
}

function record(games: GameStats[]): WeeklyGameStats {
  return {
    year: 2026,
    week: 1,
    seasonType: 'regular',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    games,
  };
}

test('a missing record has no usable ids', () => {
  assert.equal(usableGameStatsGameIds(null).size, 0);
  assert.equal(usableGameStatsGameIds(undefined).size, 0);
});

test('an empty games array yields no usable ids (finding #3)', () => {
  assert.equal(usableGameStatsGameIds(record([])).size, 0);
});

test('rows with no positive provider id are dropped', () => {
  assert.equal(isUsableGameStatsRow(row(0)), false);
  assert.equal(isUsableGameStatsRow(row(-5)), false);
  assert.equal(usableGameStatsGameIds(record([row(0), row(-5)])).size, 0);
});

test('usable rows are counted by their provider game id (as strings, matching ScheduleItem.id)', () => {
  const ids = usableGameStatsGameIds(record([row(101), row(0), row(102)]));
  assert.deepEqual([...ids].sort(), ['101', '102']);
});

// 5th-review finding #4 — a row needs nonempty team identities on BOTH sides.
test('a row with a blank home or away school is NOT usable (finding #4)', () => {
  assert.equal(isUsableGameStatsRow(row(101, '', 'Beta')), false, 'blank home');
  assert.equal(isUsableGameStatsRow(row(101, 'Alpha', '')), false, 'blank away');
  assert.equal(isUsableGameStatsRow(row(101, '   ', 'Beta')), false, 'whitespace-only');
  // A blank-identity row does not count even alongside a usable one.
  assert.deepEqual([...usableGameStatsGameIds(record([row(101, '', ''), row(102)]))], ['102']);
});
