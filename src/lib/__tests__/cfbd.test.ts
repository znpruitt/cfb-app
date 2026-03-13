import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCfbdGamesUrl } from '../cfbd';
import { seasonStorageKeys } from '../storageKeys';

test('CFBD games URL builder does not include division by default', () => {
  const url = buildCfbdGamesUrl({ year: 2025, seasonType: 'regular' });

  assert.equal(url.searchParams.get('year'), '2025');
  assert.equal(url.searchParams.get('seasonType'), 'regular');
  assert.equal(url.searchParams.get('division'), null);
});

test('CFBD games URL builder keeps week when provided', () => {
  const url = buildCfbdGamesUrl({ year: 2025, seasonType: 'postseason', week: 17 });

  assert.equal(url.searchParams.get('year'), '2025');
  assert.equal(url.searchParams.get('seasonType'), 'postseason');
  assert.equal(url.searchParams.get('week'), '17');
});

test('season-scoped storage keys differ across years', () => {
  const keys2025 = seasonStorageKeys(2025);
  const keys2026 = seasonStorageKeys(2026);

  assert.notEqual(keys2025.scheduleCsv, keys2026.scheduleCsv);
  assert.notEqual(keys2025.postseasonOverrides, keys2026.postseasonOverrides);
});
