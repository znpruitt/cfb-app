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
  migrateYearScopedAliasesToGlobal,
  upsertGlobalAliases,
} from '../globalAliasStore.ts';
import { SEED_ALIASES } from '../../teamNames.ts';

const SLUG = 'league-a';
const YEAR = 2025;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// ---------------------------------------------------------------------------
// getScopedAliasMap precedence: stored global > SEED_ALIASES > league+year > year
// ---------------------------------------------------------------------------

// PLATFORM-057: static SEED_ALIASES are merged in-memory (not persisted), so
// with no scopes seeded they still surface — always current with the code.
test('getScopedAliasMap: with no scopes seeded, static SEED_ALIASES are surfaced', async () => {
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss']);
  assert.equal(map.byu, SEED_ALIASES.byu);
});

test('getScopedAliasMap: stored global alias is returned', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas');
});

test('getScopedAliasMap: league-only alias is returned as deprecated fallback', async () => {
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Georgia');
});

test('getScopedAliasMap: stored global overrides league+year on key conflict', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Global Target' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'League Target' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Global Target');
});

test('getScopedAliasMap: static seed beats a conflicting league/year alias', async () => {
  // Seeds sit above the deprecated scoped stores, so a league alias for a seed
  // key must lose to the seed.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'ole miss': 'League Override' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'ole miss': 'Year Override' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss']);
});

test('getScopedAliasMap: league+year overrides year-only on key conflict', async () => {
  // Non-seed key so the seed layer doesn't pre-empt this league-vs-year check.
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

test('getScopedAliasMap: ASCII keys from global and league coincide, global wins', async () => {
  await setAppState('aliases:global', 'map', { 'texas am': 'Texas A&M (global)' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'texas am': 'Texas A&M (league)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['texas am'], 'Texas A&M (global)');
});

// PLATFORM-055 P1: precedence holds by resolver identity, not raw key text.
test('getScopedAliasMap: normalized-identity conflict resolves to global, dropping the legacy key', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { gulfcoasttech: 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas');
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
// getGlobalAliases: stored global with the in-memory seed layer merged under
// ---------------------------------------------------------------------------

test('getGlobalAliases: direct read surfaces SEED_ALIASES (no prior scoped read, no write)', async () => {
  const global = await getGlobalAliases();
  assert.equal(global['ole miss'], SEED_ALIASES['ole miss']);
  assert.equal(global.byu, SEED_ALIASES.byu);
  // Seeds are merged in-memory only — nothing is persisted to the store.
  const stored = await getAppState<Record<string, string>>('aliases:global', 'map');
  assert.equal(stored?.value, undefined, 'no global map persisted by a read');
});

test('getGlobalAliases: manual/stored global entry beats the seed for the same key', async () => {
  await setAppState('aliases:global', 'map', { 'ole miss': 'Manually Corrected' });
  const global = await getGlobalAliases();
  assert.equal(global['ole miss'], 'Manually Corrected');
  // Other seeds still appear.
  assert.equal(global.byu, SEED_ALIASES.byu);
});

test('getGlobalAliases: manual global beats seed on normalized-identity collision', async () => {
  // `texas am` (stored) and seed `texas a&m` share a resolver identity; stored
  // wins and no colliding seed key is added.
  await setAppState('aliases:global', 'map', { 'texas am': 'Existing Target' });
  const global = await getGlobalAliases();
  assert.equal(global['texas am'], 'Existing Target');
  assert.equal(Object.prototype.hasOwnProperty.call(global, 'texas a&m'), false);
});

// ---------------------------------------------------------------------------
// Legacy year-scope promotion: fill-only, and never above a seed identity
// ---------------------------------------------------------------------------

test('legacy promotion: a seed-identity key is never promoted (seed keeps precedence)', async () => {
  await setAppState('aliases:2024', 'map', { 'ole miss': 'Legacy Target' });
  const { migrated } = await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  // Not promoted into the stored global map...
  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'ole miss'), false);
  assert.equal(migrated, 0);
  // ...so the seed still wins in the effective map.
  const map = await getScopedAliasMap(SLUG, 2025);
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss']);
});

test('legacy promotion: manual global alias beats both seed and legacy', async () => {
  await setAppState('aliases:global', 'map', { 'ole miss': 'Manual Correction' });
  await setAppState('aliases:2024', 'map', { 'ole miss': 'Legacy Target' });
  await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  const global = await getGlobalAliases();
  assert.equal(global['ole miss'], 'Manual Correction');
});

test('legacy promotion: a non-seed key is still promoted into the global store', async () => {
  await setAppState('aliases:2024', 'map', { 'gulf coast tech': 'Legacy Only' });
  const { migrated } = await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  assert.ok(migrated > 0);
  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(stored['gulf coast tech'], 'Legacy Only', 'non-seed key promoted');
  const global = await getGlobalAliases();
  assert.equal(global['gulf coast tech'], 'Legacy Only');
  assert.equal(global['ole miss'], SEED_ALIASES['ole miss']); // seeds still present
});

// ---------------------------------------------------------------------------
// Concurrency: serialized global-map writes do not clobber each other
// ---------------------------------------------------------------------------

test('concurrent upserts: the write lock preserves both entries', async () => {
  await Promise.all([
    upsertGlobalAliases({ 'first key': 'First' }),
    upsertGlobalAliases({ 'second key': 'Second' }),
  ]);
  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(stored['first key'], 'First');
  assert.equal(stored['second key'], 'Second');
});
