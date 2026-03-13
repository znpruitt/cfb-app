import test from 'node:test';
import assert from 'node:assert/strict';

import { mapCfbdScheduleGame } from '../schedule/cfbdSchedule';

test('mapCfbdScheduleGame maps valid snake_case payload', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 123,
      week: 1,
      home_team: 'Texas',
      away_team: 'Rice',
      start_date: '2025-08-30T16:00:00.000Z',
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.id, '123');
    assert.equal(result.item.week, 1);
    assert.equal(result.item.homeTeam, 'Texas');
    assert.equal(result.item.awayTeam, 'Rice');
    assert.equal(result.item.startDate, '2025-08-30T16:00:00.000Z');
    assert.equal(result.item.seasonType, 'regular');
  }
});

test('mapCfbdScheduleGame maps valid camelCase payload', () => {
  const result = mapCfbdScheduleGame(
    {
      id: 'abc',
      week: '2',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
      startDate: '2025-09-06T20:00:00.000Z',
    },
    'regular'
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.week, 2);
    assert.equal(result.item.homeTeam, 'Alabama');
    assert.equal(result.item.awayTeam, 'Georgia');
    assert.equal(result.item.startDate, '2025-09-06T20:00:00.000Z');
  }
});

test('mapCfbdScheduleGame drops payload with missing week', () => {
  const result = mapCfbdScheduleGame({ home_team: 'Texas', away_team: 'Rice' }, 'regular');

  assert.deepEqual(result, {
    ok: false,
    reason: 'missing_week',
    raw: { home_team: 'Texas', away_team: 'Rice' },
  });
});

test('mapCfbdScheduleGame drops payload with missing home team', () => {
  const result = mapCfbdScheduleGame({ week: 1, away_team: 'Rice' }, 'regular');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing_home_team');
  }
});

test('mapCfbdScheduleGame drops payload with missing away team', () => {
  const result = mapCfbdScheduleGame({ week: 1, home_team: 'Texas' }, 'regular');

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing_away_team');
  }
});
