import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGameStatsPayload,
  expectsGameStats,
  hasUsableGameStats,
  usableGameStatsGameIds,
} from '../coverage.ts';
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

// 5th-review finding #5 — payload classification shared by cron + manual route.
test('classifyGameStatsPayload: empty array → noop', () => {
  assert.deepEqual(classifyGameStatsPayload([], 1, 'regular'), { kind: 'noop' });
});

test('classifyGameStatsPayload: non-array → no-usable-rows (failure)', () => {
  assert.deepEqual(classifyGameStatsPayload(null, 1, 'regular'), { kind: 'no-usable-rows' });
  assert.deepEqual(classifyGameStatsPayload({ oops: true }, 1, 'regular'), {
    kind: 'no-usable-rows',
  });
});

test('classifyGameStatsPayload: nonempty payload with no usable rows → no-usable-rows', () => {
  // A row missing its away team is dropped by normalization; a row with a blank
  // school normalizes but is not usable — both leave zero usable rows.
  const raw = [
    { id: 5001, teams: [{ team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] },
    {
      id: 5002,
      teams: [
        { team: '', homeAway: 'home', points: 10, stats: [] },
        { team: '', homeAway: 'away', points: 7, stats: [] },
      ],
    },
  ];
  assert.deepEqual(classifyGameStatsPayload(raw, 1, 'regular'), { kind: 'no-usable-rows' });
});

test('classifyGameStatsPayload: ≥1 usable row → commit with the normalized games', () => {
  const raw = [
    {
      id: 5001,
      teams: [
        { team: 'Alpha', homeAway: 'home', points: 21, stats: [] },
        { team: 'Beta', homeAway: 'away', points: 14, stats: [] },
      ],
    },
  ];
  const result = classifyGameStatsPayload(raw, 1, 'regular');
  assert.equal(result.kind, 'commit');
  assert.equal(result.kind === 'commit' && result.games.length, 1);
});
