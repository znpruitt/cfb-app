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
  getStoredGlobalAliases,
  hashSeedAliases,
  isCopiedSeedDefault,
  migrateYearScopedAliasesToGlobal,
  SEED_ALIASES_HASH,
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
// getScopedAliasMap precedence: stored global > year > SEED_ALIASES
// (league-scoped aliases are legacy storage only and ignored at runtime, PLATFORM-067)
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

test('getScopedAliasMap: a league-scoped alias is IGNORED (PLATFORM-067, legacy storage only)', async () => {
  // Team aliases are not league-specific. A stored `aliases:${slug}:${year}`
  // entry must not affect runtime resolution at all.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], undefined, 'league-scoped alias does not resolve');
});

test('getScopedAliasMap: a league-scoped repair does NOT beat the static seed default (ignored)', async () => {
  // `uh` seeds to houston. A LEAGUE repair to Hawaii is ignored, so the seed wins.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { uh: 'Hawaii' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map.uh, SEED_ALIASES.uh, 'seed default wins; league repair ignored');
});

test('getScopedAliasMap: stored global beats year on key conflict; league entry irrelevant', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Global Target' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'gulf coast tech': 'Year Target' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'League Target' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Global Target');
});

test('getScopedAliasMap: year-scoped repair also beats the static seed default', async () => {
  await setAppState(`aliases:${YEAR}`, 'map', { 'ole miss': 'Year Override' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['ole miss'], 'Year Override');
});

test('getScopedAliasMap: no-league form ("") still applies global + year + seeds', async () => {
  // Owners routes call getScopedAliasMap(league ?? '', year) for the year-only
  // path — the empty slug just yields no league scope; year repair still beats
  // the seed, and seeds still fill.
  await setAppState('aliases:global', 'map', { 'brand new': 'Global Team' });
  await setAppState(`aliases:${YEAR}`, 'map', { uh: 'Hawaii' });
  const map = await getScopedAliasMap('', YEAR);
  assert.equal(map['brand new'], 'Global Team');
  assert.equal(map.uh, 'Hawaii', 'year repair beats seed');
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss'], 'seed still fills');
});

test('getScopedAliasMap: seed fills as fallback when no stored alias covers it', async () => {
  await setAppState(`aliases:${YEAR}`, 'map', { 'gulf coast tech': 'Texas' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  // The unrelated year alias is present, and the seed still fills its own key.
  assert.equal(map['gulf coast tech'], 'Texas');
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss']);
});

test('getScopedAliasMap: preserves multiple stored spellings of one identity in a layer', async () => {
  // Both spellings collapse to the same coarse identity but must both survive so
  // an exact-key consumer resolves either one.
  await setAppState('aliases:global', 'map', {
    'gulf coast tech': 'Texas',
    gulfcoasttech: 'Texas',
  });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas');
  assert.equal(map.gulfcoasttech, 'Texas', 'sibling stored spelling preserved');
});

test('getScopedAliasMap: a league entry does NOT override year on key conflict (ignored)', async () => {
  // Non-seed key so the seed layer doesn't pre-empt this check. The league entry
  // is ignored, so the year target wins.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Target (league)' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'gulf coast tech': 'Target (year)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Target (year)');
});

test('getScopedAliasMap: full precedence global > year, league entry excluded, non-conflicting keys union', async () => {
  await setAppState('aliases:global', 'map', { g: 'from-global', shared: 'global-wins' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { l: 'from-league', shared: 'league-loses' });
  await setAppState(`aliases:${YEAR}`, 'map', { y: 'from-year', shared: 'year-loses' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map.shared, 'global-wins');
  assert.equal(map.g, 'from-global');
  assert.equal(map.l, undefined, 'league-scoped key is not resolved');
  assert.equal(map.y, 'from-year');
});

test('getScopedAliasMap: ASCII keys from global and year coincide, global wins', async () => {
  await setAppState('aliases:global', 'map', { 'texas am': 'Texas A&M (global)' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'texas am': 'Texas A&M (year)' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['texas am'], 'Texas A&M (global)');
});

// PLATFORM-055 P1 + PLATFORM-057 spelling preservation: precedence holds by
// resolver identity, and the lower-layer spelling is KEPT but remapped to the
// higher-precedence winning target (so exact-key consumers still resolve it).
test('getScopedAliasMap: normalized-identity conflict keeps both spellings, both → global target', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${YEAR}`, 'map', { gulfcoasttech: 'Georgia' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas');
  // Lower-layer (year) spelling preserved but remapped to the winning (global) target.
  assert.equal(map.gulfcoasttech, 'Texas');
});

test('getScopedAliasMap: a league-scoped spelling variant is ignored while the year spelling resolves', async () => {
  // The league entry must not contribute a spelling. Only the year spelling is present.
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { gulfcoasttech: 'Georgia' });
  await setAppState(`aliases:${YEAR}`, 'map', { 'gulf coast tech': 'Texas' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(map['gulf coast tech'], 'Texas', 'year spelling resolves');
  assert.equal(map.gulfcoasttech, undefined, 'league-only spelling is not resolved');
});

test('getScopedAliasMap: preserves a shadowed lower-layer spelling for exact-key validation', async () => {
  // validateRosterCSV does exact normalizeAliasLookup indexing, so `gulfcoasttech`
  // must be present (mapped to the winning target) when it comes from the year layer.
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Global Target' });
  await setAppState(`aliases:${YEAR}`, 'map', { gulfcoasttech: 'Legacy Target' });
  const map = await getScopedAliasMap(SLUG, YEAR);
  assert.deepEqual(
    { 'gulf coast tech': map['gulf coast tech'], gulfcoasttech: map.gulfcoasttech },
    { 'gulf coast tech': 'Global Target', gulfcoasttech: 'Global Target' }
  );
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
  // wins. The seed spelling is preserved but remapped to the stored target so
  // an exact-key lookup of either spelling resolves to the manual value.
  await setAppState('aliases:global', 'map', { 'texas am': 'Existing Target' });
  const global = await getGlobalAliases();
  assert.equal(global['texas am'], 'Existing Target');
  assert.equal(global['texas a&m'], 'Existing Target', 'seed spelling remapped to stored winner');
});

// ---------------------------------------------------------------------------
// Legacy year-scope promotion: fill-only (seeds are the lowest layer, so a
// promoted manual repair correctly outranks the seed default)
// ---------------------------------------------------------------------------

test('legacy promotion: a seed-key repair is promoted and beats the seed default', async () => {
  await setAppState('aliases:2024', 'map', { 'ole miss': 'Legacy Target' });
  const { migrated } = await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  // Promoted into the stored global map (it's a persisted manual repair)...
  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(stored['ole miss'], 'Legacy Target');
  assert.ok(migrated > 0);
  // ...so it beats the seed default in the effective map.
  const map = await getScopedAliasMap(SLUG, 2025);
  assert.equal(map['ole miss'], 'Legacy Target');
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

test('legacy promotion: a copied seed default (bootstrap) is NOT promoted', async () => {
  // bootstrapAliasesAndCaches writes the whole SEED_ALIASES bundle into an empty
  // scope; an exact copy (same key AND target) is a default, not a manual repair,
  // so it must not be promoted into the stored global map.
  await setAppState('aliases:2024', 'map', {
    'ole miss': SEED_ALIASES['ole miss']!, // exact seed copy → skip
    'gulf coast tech': 'Real Repair', // genuine repair → promote
  });
  const { migrated } = await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored, 'ole miss'),
    false,
    'seed copy skipped'
  );
  assert.equal(stored['gulf coast tech'], 'Real Repair', 'genuine repair still promoted');
  assert.equal(migrated, 1, 'only the genuine repair counts');
});

test('legacy promotion: a scope of only copied seed defaults migrates nothing', async () => {
  await setAppState('aliases:2024', 'map', {
    'ole miss': SEED_ALIASES['ole miss']!,
    byu: SEED_ALIASES.byu!,
  });
  const { migrated } = await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  assert.equal(migrated, 0, 'no genuine repairs → nothing promoted (no invalidation)');
  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(Object.keys(stored).length, 0);
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

// ---------------------------------------------------------------------------
// PLATFORM-057 remediation: stored-vs-effective separation + seed hash
// ---------------------------------------------------------------------------

test('getStoredGlobalAliases: returns stored entries only, never the in-memory seeds', async () => {
  await setAppState('aliases:global', 'map', { 'brand new': 'Manual Team' });
  const stored = await getStoredGlobalAliases();
  assert.equal(stored['brand new'], 'Manual Team');
  // Seeds are NOT included in the stored view.
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'ole miss'), false);
  // ...but the effective read still surfaces them.
  const effective = await getGlobalAliases();
  assert.equal(effective['ole miss'], SEED_ALIASES['ole miss']);
  assert.equal(effective['brand new'], 'Manual Team');
});

test('getGlobalAliases/getStoredGlobalAliases: preserve every stored spelling of one identity', async () => {
  // Both spellings collapse to the same coarse identity; validateRosterCSV does
  // an exact-key lookup, so dropping either would leave that upload unresolved.
  await setAppState('aliases:global', 'map', {
    'gulf coast tech': 'Texas',
    gulfcoasttech: 'Texas',
  });
  const stored = await getStoredGlobalAliases();
  assert.equal(stored['gulf coast tech'], 'Texas');
  assert.equal(stored.gulfcoasttech, 'Texas');
  const effective = await getGlobalAliases();
  assert.equal(effective['gulf coast tech'], 'Texas');
  assert.equal(effective.gulfcoasttech, 'Texas', 'sibling spelling not dropped by seed merge');
});

test('getStoredGlobalAliases: empty store returns empty (no seeds leak in)', async () => {
  const stored = await getStoredGlobalAliases();
  assert.deepEqual(stored, {});
});

test('hashSeedAliases: deterministic and order-independent', async () => {
  const a = hashSeedAliases({ 'ole miss': 'mississippi', byu: 'brigham young' });
  const b = hashSeedAliases({ byu: 'brigham young', 'ole miss': 'mississippi' });
  assert.equal(a, b, 'same contents in different order → same hash');
});

test('hashSeedAliases: changes when the seed set changes', async () => {
  const base = hashSeedAliases({ 'ole miss': 'mississippi' });
  const added = hashSeedAliases({ 'ole miss': 'mississippi', newseed: 'new target' });
  const changed = hashSeedAliases({ 'ole miss': 'different target' });
  assert.notEqual(base, added, 'adding a seed changes the hash');
  assert.notEqual(base, changed, 'changing a target changes the hash');
});

test('SEED_ALIASES_HASH: matches the hash of the shipped SEED_ALIASES', async () => {
  assert.equal(SEED_ALIASES_HASH, hashSeedAliases(SEED_ALIASES));
  assert.ok(SEED_ALIASES_HASH.length > 0);
});

// ---------------------------------------------------------------------------
// PLATFORM-057 remediation: persisted bootstrap-default reconciliation +
// normalized-identity precedence during legacy promotion
// ---------------------------------------------------------------------------

test('isCopiedSeedDefault: recognizes current seed defaults, rejects manual values', () => {
  assert.equal(isCopiedSeedDefault('ole miss', SEED_ALIASES['ole miss']!), true);
  assert.equal(isCopiedSeedDefault('byu', SEED_ALIASES.byu!), true);
  // Same key, different (manual) target → NOT a copied default.
  assert.equal(isCopiedSeedDefault('ole miss', 'Some Manual Target'), false);
  // Non-seed key → not a default.
  assert.equal(isCopiedSeedDefault('gulf coast tech', 'Texas'), false);
});

test('effective read: a persisted copy of a current seed default is demoted (seed still resolves)', async () => {
  // A stored global copy of the seed default is not treated as a manual override;
  // the identity resolves to the current code seed (same value today, but the
  // copy can never permanently shadow a future corrected seed).
  await setAppState('aliases:global', 'map', { 'ole miss': SEED_ALIASES['ole miss']! });
  const global = await getGlobalAliases();
  assert.equal(global['ole miss'], SEED_ALIASES['ole miss']);
  // Raw stored view still shows the persisted entry (demotion is effective-only).
  const stored = await getStoredGlobalAliases();
  assert.equal(stored['ole miss'], SEED_ALIASES['ole miss']);
});

test('effective read: a manual repair (different target) for a seed key survives and wins', async () => {
  await setAppState('aliases:global', 'map', { uh: 'Hawaii' }); // seed is uh→houston
  const global = await getGlobalAliases();
  assert.equal(global.uh, 'Hawaii', 'manual repair not demoted');
  const scoped = await getScopedAliasMap(SLUG, YEAR);
  assert.equal(scoped.uh, 'Hawaii');
});

test('legacy promotion: identity collision remaps the promoted spelling to the global winner', async () => {
  // stored global owns identity `gulfcoasttech` via `gulf coast tech`→Texas; a
  // legacy scope has `gulfcoasttech`→Georgia. Promotion must NOT introduce the
  // conflicting Georgia target — it maps the spelling to the winner (Texas).
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState('aliases:2024', 'map', { gulfcoasttech: 'Georgia' });
  await migrateYearScopedAliasesToGlobal(['league-a'], 2025);

  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(stored['gulf coast tech'], 'Texas');
  assert.equal(stored.gulfcoasttech, 'Texas', 'promoted spelling remapped to winner, not Georgia');

  const map = await getScopedAliasMap(SLUG, 2025);
  assert.equal(map['gulf coast tech'], 'Texas');
  assert.equal(map.gulfcoasttech, 'Texas');
});

test('legacy promotion: a demoted seed copy does not win an identity over a differently-spelled repair', async () => {
  // Stored global holds a bootstrap copy `uh`→houston (== seed). A legacy scope
  // has a differently-formatted manual repair `u h`→Hawaii (same identity). The
  // copy must NOT count as the identity winner, so the repair promotes and wins.
  await setAppState('aliases:global', 'map', { uh: SEED_ALIASES.uh! }); // uh→houston (seed copy)
  await setAppState('aliases:2024', 'map', { 'u h': 'Hawaii' });
  await migrateYearScopedAliasesToGlobal(['league-a'], 2025);

  const map = await getScopedAliasMap(SLUG, 2025);
  assert.equal(map['u h'], 'Hawaii', 'repair promoted and wins, not remapped to the seed copy');
  assert.equal(map.uh, 'Hawaii', 'copied spelling resolves to the repair winner');
  assert.notEqual(map.uh, SEED_ALIASES.uh);
});

test('legacy promotion: an exact-key manual repair promotes over a copied seed default', async () => {
  // Stored global has a bootstrap copy `uh`→houston at the exact key `uh`. A
  // legacy scope has the manual repair `uh`→Hawaii at the SAME key. The copy is
  // demoted at read time, so it must be treated as absent here and the repair
  // must promote (otherwise every league keeps resolving `uh` to the seed).
  await setAppState('aliases:global', 'map', { uh: SEED_ALIASES.uh! }); // uh→houston (copy)
  await setAppState('aliases:2024', 'map', { uh: 'Hawaii' });
  const { migrated } = await migrateYearScopedAliasesToGlobal(['league-a'], 2025);
  assert.ok(migrated > 0, 'repair counted as promoted');

  const stored = (await getAppState<Record<string, string>>('aliases:global', 'map'))?.value ?? {};
  assert.equal(stored.uh, 'Hawaii', 'repair overwrote the copied seed default');

  const map = await getScopedAliasMap(SLUG, 2025);
  assert.equal(map.uh, 'Hawaii');
});
