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
  const storageKeys = seasonStorageKeys(season);
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
      return Response.json({ year: season, csvText: null });
    }

    if (url.includes('/api/postseason-overrides?')) {
      return Response.json({ year: season, map: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await bootstrapAliasesAndCaches({ season, seedAliases: {} });

  assert.equal(result.ownersCsvText, null);
  assert.deepEqual(result.postseasonOverrides, {});
  assert.equal(localStorage.getItem(storageKeys.ownersCsv), null);
  assert.equal(localStorage.getItem(LEGACY_STORAGE_KEYS.ownersCsv), null);
  assert.equal(localStorage.getItem(storageKeys.postseasonOverrides), null);
  assert.equal(localStorage.getItem(LEGACY_STORAGE_KEYS.postseasonOverrides), null);
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
