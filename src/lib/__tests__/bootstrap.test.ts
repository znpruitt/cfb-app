import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapAliasesAndCaches } from '../bootstrap.ts';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from '../storageKeys.ts';

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
