import assert from 'node:assert/strict';
import test from 'node:test';

import { expectsGameStats, hasUsableGameStats, usableGameStatsGameIds } from '../coverage.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';

function row(providerGameId: number, homeSchool = 'Alpha', awaySchool = 'Beta'): GameStats {
  return {
    providerGameId,
    week: 1,
    seasonType: 'regular',
    // Only the fields coverage inspects need to be real; the rest are structural.
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

test('a missing record has no coverage', () => {
  assert.equal(hasUsableGameStats(null), false);
  assert.equal(hasUsableGameStats(undefined), false);
  assert.equal(usableGameStatsGameIds(null).size, 0);
});

test('an empty games array is not coverage (finding #3)', () => {
  assert.equal(hasUsableGameStats(record([])), false);
  assert.equal(usableGameStatsGameIds(record([])).size, 0);
});

test('rows with no positive provider id are dropped (all-dropped record is not coverage)', () => {
  assert.equal(hasUsableGameStats(record([row(0)])), false);
  assert.equal(hasUsableGameStats(record([row(-5)])), false);
});

test('usable rows are counted by their provider game id (as strings, matching ScheduleItem.id)', () => {
  const ids = usableGameStatsGameIds(record([row(101), row(0), row(102)]));
  assert.deepEqual([...ids].sort(), ['101', '102']);
  assert.equal(hasUsableGameStats(record([row(101)])), true);
});

// 5th-review finding #4 — a row needs nonempty team identities on BOTH sides.
test('a row with a blank home or away school is NOT usable (finding #4)', () => {
  assert.equal(hasUsableGameStats(record([row(101, '', 'Beta')])), false, 'blank home');
  assert.equal(hasUsableGameStats(record([row(101, 'Alpha', '')])), false, 'blank away');
  assert.equal(hasUsableGameStats(record([row(101, '   ', 'Beta')])), false, 'whitespace-only');
  // A blank-identity row does not count even alongside a usable one.
  assert.deepEqual([...usableGameStatsGameIds(record([row(101, '', ''), row(102)]))], ['102']);
});

// 5th-review finding #1 — disrupted games do not produce stats.
test('expectsGameStats excludes disrupted statuses, includes normal ones', () => {
  for (const status of ['Canceled', 'cancelled', 'Postponed', 'Suspended', 'Delayed']) {
    assert.equal(expectsGameStats(status), false, status);
  }
  for (const status of ['STATUS_FINAL', 'final', 'in progress', 'scheduled', '']) {
    assert.equal(expectsGameStats(status), true, status);
  }
});

// PLATFORM-086H3: raw provider payload classification moved to `ingestion.ts`
// (`validateGameStatsPayload`, covered in ingestion.test.ts), which parses
// through the strict contract instead of the legacy normalizer.
