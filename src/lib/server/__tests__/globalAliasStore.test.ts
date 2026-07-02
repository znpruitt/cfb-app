import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../appStateStore.ts';
import {
  getGlobalAliases,
  getScopedAliasMap,
  migrateSeedAliasesToGlobal,
} from '../globalAliasStore.ts';
import { SEED_ALIASES } from '../../teamNames.ts';

const SLUG = 'league-a';
const YEAR = 2025;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// PLATFORM-057: with no scopes seeded, getScopedAliasMap now surfaces the
// migrated static SEED_ALIASES (they are lazily written into the global store
// on first read), rather than an empty map.
test('getScopedAliasMap: with no scopes seeded, static SEED_ALIASES are surfaced', async () => {
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss']);
  assert.equal(map.byu, SEED_ALIASES.byu);
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
  // Uses a non-seed key so migrated SEED_ALIASES (now global-tier) don't
  // pre-empt this league-vs-year precedence check.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Target (league)' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'gulf coast tech': 'Target (year)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Target (league)');
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

// PLATFORM-055 P1: precedence must hold by the resolver's canonical identity,
// not raw key text. `gulf coast tech` and `gulfcoasttech` are textually
// distinct but normalize (via normalizeTeamName, the resolver's alias-key
// normalization) to the same identity. The lower-precedence scope must NOT
// survive alongside the global entry, or buildCanonicalRegistry's first-wins
// could credit the legacy target.
test('getScopedAliasMap: normalized-identity conflict resolves to global, dropping the legacy key', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { gulfcoasttech: 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  // Global entry survives...
  assert.equal(map['gulf coast tech'], 'Texas');
  // ...and the legacy key that collapses to the same identity is dropped, so
  // it cannot win by insertion order in the resolver registry.
  assert.equal(Object.prototype.hasOwnProperty.call(map, 'gulfcoasttech'), false);
});

test('getScopedAliasMap: normalized-identity conflict, league beats year (both non-global)', async () => {
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${YEAR}`, 'map', { gulfcoasttech: 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas');
  assert.equal(Object.prototype.hasOwnProperty.call(map, 'gulfcoasttech'), false);
});

// ---------------------------------------------------------------------------
// PLATFORM-057: migrateSeedAliasesToGlobal — static seed bundle → global store
// ---------------------------------------------------------------------------

test('migrateSeedAliasesToGlobal: writes SEED_ALIASES into the global store', async () => {
  const { migrated } = await migrateSeedAliasesToGlobal();
  assert.ok(migrated > 0, 'reports entries migrated');
  const global = await getGlobalAliases();
  assert.equal(global['ole miss'], SEED_ALIASES['ole miss']);
  assert.equal(global.byu, SEED_ALIASES.byu);
});

test('migrateSeedAliasesToGlobal: is idempotent (sentinel-guarded)', async () => {
  const first = await migrateSeedAliasesToGlobal();
  assert.ok(first.migrated > 0);
  const second = await migrateSeedAliasesToGlobal();
  assert.equal(second.migrated, 0, 'second run is a no-op');
  const sentinel = await getAppState<boolean>('aliases:global', 'seed-migration-done');
  assert.equal(sentinel?.value, true);
});

test('migrateSeedAliasesToGlobal: never overwrites an existing global entry', async () => {
  // A manually corrected global entry for a seed key must survive migration.
  await setAppState('aliases:global', 'map', { 'ole miss': 'Manually Corrected' });
  const { migrated } = await migrateSeedAliasesToGlobal();
  const global = await getGlobalAliases();
  assert.equal(global['ole miss'], 'Manually Corrected', 'manual global entry preserved');
  // Other seeds still land.
  assert.equal(global.byu, SEED_ALIASES.byu);
  assert.ok(migrated > 0);
});

test('migrateSeedAliasesToGlobal: existing global wins on normalized-identity collision', async () => {
  // `texas am` (existing global) and the seed `texas a&m` collapse to the same
  // resolver identity via normalizeTeamName; the existing global entry wins and
  // no colliding seed key is added.
  await setAppState('aliases:global', 'map', { 'texas am': 'Existing Target' });
  await migrateSeedAliasesToGlobal();
  const global = await getGlobalAliases();
  assert.equal(global['texas am'], 'Existing Target');
  assert.equal(Object.prototype.hasOwnProperty.call(global, 'texas a&m'), false);
});

test('migrateSeedAliasesToGlobal: seeds participate in getScopedAliasMap precedence as global-tier', async () => {
  // A league-scoped alias that conflicts (by identity) with a migrated seed must
  // lose — the seed is now a global-tier entry.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'ole miss': 'League Override' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(
    map['ole miss'],
    SEED_ALIASES['ole miss'],
    'migrated seed (global) beats league scope'
  );
});
