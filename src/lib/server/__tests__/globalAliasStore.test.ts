import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { getScopedAliasMap } from '../globalAliasStore.ts';

const SLUG = 'league-a';
const YEAR = 2025;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('getScopedAliasMap: no scopes seeded returns empty map', async () => {
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.deepEqual(map, {});
});

test('getScopedAliasMap: global-only alias is returned', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas');
});

test('getScopedAliasMap: league-only alias is returned as deprecated fallback', async () => {
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Georgia');
});

test('getScopedAliasMap: global overrides league+year on key conflict', async () => {
  await setAppState('aliases:global', 'map', { 'ole miss': 'Mississippi (global)' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'ole miss': 'Mississippi (league)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['ole miss'], 'Mississippi (global)');
});

test('getScopedAliasMap: league+year overrides year-only on key conflict', async () => {
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'ole miss': 'Mississippi (league)' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'ole miss': 'Mississippi (year)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['ole miss'], 'Mississippi (league)');
});

test('getScopedAliasMap: full precedence global > league+year > year, non-conflicting keys union', async () => {
  await setAppState('aliases:global', 'map', { g: 'from-global', shared: 'global-wins' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { l: 'from-league', shared: 'league-loses' });
  await setAppState(`aliases:${YEAR}`, 'map', { y: 'from-year', shared: 'year-loses' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map.shared, 'global-wins');
  assert.equal(map.g, 'from-global');
  assert.equal(map.l, 'from-league');
  assert.equal(map.y, 'from-year');
});

// Documents the current exact-key merge behavior across differently formatted
// keys (does not assert normalization — global keys are written via
// normalizeAliasLookup while the legacy league-scoped PUT lowercases only). For
// ASCII keys the two coincide, so the resolver's normalizeAliasLookup(raw)
// lookup hits the global entry and global-wins holds at lookup time.
test('getScopedAliasMap: ASCII keys from global and league coincide, global wins', async () => {
  await setAppState('aliases:global', 'map', { 'texas am': 'Texas A&M (global)' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'texas am': 'Texas A&M (league)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['texas am'], 'Texas A&M (global)');
});
