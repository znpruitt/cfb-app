import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapAliasesAndCaches } from '../bootstrap.ts';
import { readEffectiveAliasCache, serializeEffectiveAliasCache } from '../effectiveAliasCache.ts';
import { LEGACY_STORAGE_KEYS, seasonOnlyStorageKeys, seasonStorageKeys } from '../storageKeys.ts';

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

function installWindow(storage: MemoryStorage): void {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });
}

test('bootstrap clears stale local owners and postseason overrides when the shared server state is empty', async () => {
  const season = 2026;
  const leagueSlug = 'tsc';
  const storageKeys = seasonStorageKeys(season, leagueSlug);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  localStorage.setItem(storageKeys.ownersCsv, 'Team,Owner\nTexas,Alice');
  localStorage.setItem(LEGACY_STORAGE_KEYS.ownersCsv, 'legacy owners');
  localStorage.setItem(
    storageKeys.postseasonOverrides,
    JSON.stringify({ game1: { notes: 'stale override' } })
  );
  localStorage.setItem(
    LEGACY_STORAGE_KEYS.postseasonOverrides,
    JSON.stringify({ legacy: { notes: 'stale legacy override' } })
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);

    if (url.includes('/api/aliases?')) {
      return Response.json({ year: season, map: {} });
    }

    if (url.includes('/api/owners?')) {
      return Response.json({ year: season, csvText: null, hasStoredValue: true });
    }

    if (url.includes('/api/postseason-overrides?')) {
      return Response.json({ year: season, map: {}, hasStoredValue: true });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {}, leagueSlug });

  assert.equal(result.ownersCsvText, null);
  assert.deepEqual(result.postseasonOverrides, {});
  assert.equal(localStorage.getItem(storageKeys.ownersCsv), null);
  assert.equal(localStorage.getItem(LEGACY_STORAGE_KEYS.ownersCsv), null);
  assert.equal(localStorage.getItem(storageKeys.postseasonOverrides), null);
  assert.equal(localStorage.getItem(LEGACY_STORAGE_KEYS.postseasonOverrides), null);
});

test('bootstrap preserves legacy local owners and overrides when shared state is unseeded', async () => {
  const season = 2026;
  const storageKeys = seasonStorageKeys(season);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  localStorage.setItem(LEGACY_STORAGE_KEYS.ownersCsv, 'legacy owners');
  localStorage.setItem(
    LEGACY_STORAGE_KEYS.postseasonOverrides,
    JSON.stringify({ legacy: { notes: 'legacy override' } })
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);

    if (url.includes('/api/aliases?')) {
      return Response.json({ year: season, map: {} });
    }

    if (url.includes('/api/owners?')) {
      return Response.json({ year: season, csvText: null, hasStoredValue: false });
    }

    if (url.includes('/api/postseason-overrides?')) {
      return Response.json({ year: season, map: {}, hasStoredValue: false });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {} });

  assert.equal(result.ownersCsvText, 'legacy owners');
  assert.deepEqual(result.postseasonOverrides, { legacy: { notes: 'legacy override' } });
  assert.equal(localStorage.getItem(storageKeys.ownersCsv), 'legacy owners');
  assert.equal(
    localStorage.getItem(storageKeys.postseasonOverrides),
    JSON.stringify({ legacy: { notes: 'legacy override' } })
  );
});

test('bootstrap returns empty data for a new league even when another league has localStorage data', async () => {
  const season = 2026;
  const tscKeys = seasonStorageKeys(season, 'tsc');
  const testKeys = seasonStorageKeys(season, 'test');
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  // Simulate TSC league data already in localStorage
  localStorage.setItem(tscKeys.ownersCsv, 'Team,Owner\nTexas,Alice');
  localStorage.setItem(
    tscKeys.postseasonOverrides,
    JSON.stringify({ game1: { notes: 'tsc override' } })
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);

    if (url.includes('/api/aliases?')) {
      return Response.json({ year: season, map: {} });
    }

    // Test League has no server data
    if (url.includes('/api/owners?')) {
      return Response.json({ year: season, csvText: null, hasStoredValue: false });
    }

    if (url.includes('/api/postseason-overrides?')) {
      return Response.json({ year: season, map: {}, hasStoredValue: false });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {}, leagueSlug: 'test' });

  // Test League must get empty data — not TSC's data
  assert.equal(result.ownersCsvText, null);
  assert.deepEqual(result.postseasonOverrides, {});
  assert.equal(localStorage.getItem(testKeys.ownersCsv), null);
  assert.equal(localStorage.getItem(testKeys.postseasonOverrides), null);
  // TSC data must remain untouched
  assert.equal(localStorage.getItem(tscKeys.ownersCsv), 'Team,Owner\nTexas,Alice');
});

test('bootstrap migrates season-only localStorage keys to league-scoped keys', async () => {
  const season = 2026;
  const leagueSlug = 'tsc';
  const oldKeys = seasonOnlyStorageKeys(season);
  const newKeys = seasonStorageKeys(season, leagueSlug);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  // Data stored under old season-only keys (pre-migration format)
  localStorage.setItem(oldKeys.ownersCsv, 'Team,Owner\nTexas,Alice');
  localStorage.setItem(
    oldKeys.postseasonOverrides,
    JSON.stringify({ game1: { notes: 'old override' } })
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);

    if (url.includes('/api/aliases?')) {
      return Response.json({ year: season, map: {} });
    }

    // Server has no stored value — forces localStorage fallback path
    if (url.includes('/api/owners?')) {
      return new Response('boom', { status: 500 });
    }

    if (url.includes('/api/postseason-overrides?')) {
      return new Response('boom', { status: 500 });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {}, leagueSlug });

  // Data should be read from old keys and promoted to new keys
  assert.equal(result.ownersCsvText, 'Team,Owner\nTexas,Alice');
  assert.deepEqual(result.postseasonOverrides, { game1: { notes: 'old override' } });
  // New keys should now have the data
  assert.equal(localStorage.getItem(newKeys.ownersCsv), 'Team,Owner\nTexas,Alice');
  assert.equal(
    localStorage.getItem(newKeys.postseasonOverrides),
    JSON.stringify({ game1: { notes: 'old override' } })
  );
  // Old keys should be cleaned up
  assert.equal(localStorage.getItem(oldKeys.ownersCsv), null);
  assert.equal(localStorage.getItem(oldKeys.postseasonOverrides), null);
});

test('bootstrap keeps cached owners and overrides when the server load fails', async () => {
  const season = 2026;
  const storageKeys = seasonStorageKeys(season);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  localStorage.setItem(storageKeys.ownersCsv, 'Team,Owner\nTexas,Alice');
  localStorage.setItem(
    storageKeys.postseasonOverrides,
    JSON.stringify({ game1: { notes: 'cached override' } })
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);

    if (url.includes('/api/aliases?')) {
      return Response.json({ year: season, map: {} });
    }

    if (url.includes('/api/owners?') || url.includes('/api/postseason-overrides?')) {
      return new Response('boom', { status: 500 });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {} });

  assert.equal(result.ownersCsvText, 'Team,Owner\nTexas,Alice');
  assert.match(result.ownersLoadIssue ?? '', /Owners load failed: owners GET 500/);
  assert.deepEqual(result.postseasonOverrides, { game1: { notes: 'cached override' } });
  assert.match(
    result.postseasonOverridesLoadIssue ?? '',
    /Postseason overrides load failed: postseason overrides GET 500/
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-058: stored (editor) vs effective (resolver) alias separation, and
// the offline/error fallback behavior for each.
// ---------------------------------------------------------------------------

test('bootstrap returns stored + effective alias maps and caches both', async () => {
  const season = 2026;
  const leagueSlug = 'tsc';
  const storageKeys = seasonStorageKeys(season, leagueSlug);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) {
      return url.includes('scope=effective')
        ? Response.json({ scope: 'effective', map: { global: 'Global', league: 'League' } })
        : Response.json({ year: season, league: leagueSlug, map: { league: 'League' } });
    }
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {}, leagueSlug });

  assert.deepEqual(result.aliasMap, { league: 'League' }, 'editor gets stored league aliases only');
  assert.deepEqual(
    result.effectiveAliasMap,
    { global: 'Global', league: 'League' },
    'resolver gets the effective map'
  );
  assert.equal(localStorage.getItem(storageKeys.aliasMap), JSON.stringify({ league: 'League' }));
  // Effective cache is a seed-versioned envelope; read it back through the helper.
  assert.deepEqual(
    readEffectiveAliasCache(localStorage.getItem(storageKeys.effectiveAliasMap), {}),
    {
      global: 'Global',
      league: 'League',
    }
  );
});

test('bootstrap fallback: editor map gets NO seeds; effective map gets seeds (no cache)', async () => {
  const season = 2026;
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) return new Response('boom', { status: 500 });
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  const seedAliases = { byu: 'brigham young' };
  const result = await bootstrapAliasesAndCaches({ season, seedAliases });

  assert.deepEqual(result.aliasMap, {}, 'editor fallback is empty — seeds must not leak into it');
  assert.deepEqual(result.effectiveAliasMap, seedAliases, 'resolver fallback carries the seeds');
  assert.match(result.aliasLoadIssue ?? '', /Aliases load failed/);
});

test('bootstrap fallback: reconciles the version-matched cached effective map, preserving global/year', async () => {
  const season = 2026;
  const storageKeys = seasonStorageKeys(season);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);
  const seedAliases = { byu: 'brigham young' };

  // A prior successful bootstrap cached both maps (effective as a seed-versioned
  // envelope keyed by the SAME seeds used below).
  localStorage.setItem(storageKeys.aliasMap, JSON.stringify({ league: 'League' }));
  localStorage.setItem(
    storageKeys.effectiveAliasMap,
    serializeEffectiveAliasCache({ global: 'Global', year: 'Year', league: 'League' }, seedAliases)
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) return new Response('boom', { status: 500 });
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases });

  assert.deepEqual(result.aliasMap, { league: 'League' }, 'editor restored from stored cache');
  // Reconciled from stored + version-matched cached effective + seeds: global/year
  // preserved, and the current seed is present too.
  assert.deepEqual(result.effectiveAliasMap, {
    league: 'League',
    global: 'Global',
    year: 'Year',
    byu: 'brigham young',
  });
});

test('bootstrap fallback: a stale-seed-version cached effective map is discarded', async () => {
  const season = 2026;
  const storageKeys = seasonStorageKeys(season);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  // Cache built from an OLD seed set (uh→houston); current seeds differ.
  localStorage.setItem(storageKeys.aliasMap, JSON.stringify({}));
  localStorage.setItem(
    storageKeys.effectiveAliasMap,
    serializeEffectiveAliasCache({ uh: 'Houston' }, { uh: 'Houston' })
  );

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) return new Response('boom', { status: 500 });
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  // Current seeds map uh→Hawaii — different set, so the old cache is discarded.
  const result = await bootstrapAliasesAndCaches({ season, seedAliases: { uh: 'Hawaii' } });

  assert.equal(result.effectiveAliasMap.uh, 'Hawaii', 'stale cached seed value not resurrected');
});

test('bootstrap partial failure: a failed stored fetch must not discard a successful effective fetch', async () => {
  const season = 2026;
  const leagueSlug = 'tsc';
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) {
      // Effective request succeeds; stored request fails.
      return url.includes('scope=effective')
        ? Response.json({ scope: 'effective', map: { global: 'Global', league: 'League' } })
        : new Response('boom', { status: 500 });
    }
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {}, leagueSlug });

  // The freshly fetched effective map is preserved (not clobbered by the failed
  // stored request); the editor map falls back to (empty) cache.
  assert.deepEqual(result.effectiveAliasMap, { global: 'Global', league: 'League' });
  assert.deepEqual(result.aliasMap, {});
  assert.match(result.aliasLoadIssue ?? '', /Aliases load failed/);
});

test('bootstrap partial failure: a failed effective fetch keeps the fresh stored map', async () => {
  const season = 2026;
  const leagueSlug = 'tsc';
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) {
      return url.includes('scope=effective')
        ? new Response('boom', { status: 500 })
        : Response.json({ year: season, league: leagueSlug, map: { league: 'League' } });
    }
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({
    season,
    seedAliases: { byu: 'brigham young' },
    leagueSlug,
  });

  assert.deepEqual(result.aliasMap, { league: 'League' }, 'fresh stored map kept');
  // Effective falls back to seeds over the fresh stored map (no effective cache).
  assert.deepEqual(result.effectiveAliasMap, { byu: 'brigham young', league: 'League' });
});

test('bootstrap effective fallback preserves stored-over-seed precedence by identity', async () => {
  const season = 2026;
  const leagueSlug = 'tsc';
  const storageKeys = seasonStorageKeys(season, leagueSlug);
  const localStorage = new MemoryStorage();
  installWindow(localStorage);

  // Cached STORED league repair `u-h`→Hawaii; NO cached effective map, so the
  // fallback merges stored over seeds. Both alias fetches fail.
  localStorage.setItem(storageKeys.aliasMap, JSON.stringify({ 'u-h': 'Hawaii' }));

  setMockFetch(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/api/aliases?')) return new Response('boom', { status: 500 });
    if (url.includes('/api/owners?'))
      return Response.json({ csvText: null, hasStoredValue: false });
    if (url.includes('/api/postseason-overrides?'))
      return Response.json({ map: {}, hasStoredValue: false });
    throw new Error(`Unexpected request: ${url}`);
  });

  // Seed maps `uh`→Houston, which collides with the stored `u-h`→Hawaii identity.
  const result = await bootstrapAliasesAndCaches({
    season,
    seedAliases: { uh: 'Houston' },
    leagueSlug,
  });

  assert.deepEqual(result.aliasMap, { 'u-h': 'Hawaii' }, 'editor keeps cached stored repair');
  // Stored repair wins the `uh` identity over the seed; both spellings → Hawaii.
  assert.equal(result.effectiveAliasMap['u-h'], 'Hawaii');
  assert.equal(result.effectiveAliasMap.uh, 'Hawaii', 'seed does not beat the stored repair');
});
