import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCfbdGamesUrl } from '../cfbd.ts';
import { seasonStorageKeys } from '../storageKeys.ts';

test('CFBD games URL builder does not include division by default', () => {
  const url = buildCfbdGamesUrl({ year: 2025, seasonType: 'regular' });

  assert.equal(url.origin, 'https://api.collegefootballdata.com');
  assert.equal(url.pathname, '/games');
  assert.equal(url.searchParams.get('year'), '2025');
  assert.equal(url.searchParams.get('seasonType'), 'regular');
  assert.equal(url.searchParams.get('division'), null);
  assert.equal(
    url.toString(),
    'https://api.collegefootballdata.com/games?year=2025&seasonType=regular'
  );
});

test('CFBD games URL builder supports postseason requests', () => {
  const url = buildCfbdGamesUrl({ year: 2025, seasonType: 'postseason' });

  assert.equal(
    url.toString(),
    'https://api.collegefootballdata.com/games?year=2025&seasonType=postseason'
  );
});

test('CFBD games URL builder keeps week when provided', () => {
  const url = buildCfbdGamesUrl({ year: 2025, seasonType: 'regular', week: 1 });

  assert.equal(url.searchParams.get('year'), '2025');
  assert.equal(url.searchParams.get('seasonType'), 'regular');
  assert.equal(url.searchParams.get('week'), '1');
  assert.equal(
    url.toString(),
    'https://api.collegefootballdata.com/games?year=2025&seasonType=regular&week=1'
  );
});

test('CFBD games URL builder omits week when null', () => {
  const url = buildCfbdGamesUrl({ year: 2025, seasonType: 'regular', week: null });

  assert.equal(url.searchParams.get('week'), null);
});

test('season-scoped storage keys differ across years', () => {
  const keys2025 = seasonStorageKeys(2025);
  const keys2026 = seasonStorageKeys(2026);

  assert.notEqual(keys2025.postseasonOverrides, keys2026.postseasonOverrides);
});
