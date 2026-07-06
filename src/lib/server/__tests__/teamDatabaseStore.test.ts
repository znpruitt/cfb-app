import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import {
  __deleteTeamDatabaseStoreFileForTests,
  __resetTeamDatabaseStoreForTests,
  getTeamDatabaseFile,
  getTeamDatabaseItems,
} from '../teamDatabaseStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-070 — the catalog store must not shadow cross-instance writes.
//
// Standings invalidation (tag-based) is worthless if a recompute reads a stale
// process-local catalog. The store previously kept a module-level singleton
// that cached the catalog for the process lifetime, so a catalog synced by
// ANOTHER instance (written straight to the durable app-state store) was never
// observed until the process recycled. It now reads the durable store per
// request (React `cache`, which does not memoize outside a request), so a fresh
// read reflects an external write immediately.
// ---------------------------------------------------------------------------

const EXTERNAL_SCHOOL = 'Externally Synced U';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteTeamDatabaseStoreFileForTests();
  __resetTeamDatabaseStoreForTests();
});

async function writeDurableCatalogExternally(schools: string[]): Promise<void> {
  // Write directly to the durable app-state store, bypassing setTeamDatabaseFile
  // — this is what a DIFFERENT server instance's sync looks like to THIS process
  // (no in-process write path is exercised here).
  await setAppState('team-database', 'current', {
    source: 'cfbd',
    updatedAt: '2030-01-01T00:00:00.000Z',
    items: schools.map((school) => ({ school })),
  });
}

test('getTeamDatabaseFile observes a durable catalog written by another instance', async () => {
  // First read primes any (former) process-local cache.
  const first = await getTeamDatabaseFile();
  assert.ok(
    !first.items.some((i) => i.school === EXTERNAL_SCHOOL),
    'external catalog is not present before the external write'
  );

  await writeDurableCatalogExternally([EXTERNAL_SCHOOL]);

  // The next read must reflect the external write — a lingering process-local
  // singleton would have returned the primed `first` snapshot instead.
  const second = await getTeamDatabaseFile();
  assert.deepEqual(
    second.items.map((i) => i.school),
    [EXTERNAL_SCHOOL],
    'a fresh read reflects the cross-instance durable write'
  );
});

test('getTeamDatabaseItems reflects a subsequent external catalog change', async () => {
  await writeDurableCatalogExternally(['Alpha']);
  assert.deepEqual(
    (await getTeamDatabaseItems()).map((i) => i.school),
    ['Alpha']
  );

  await writeDurableCatalogExternally(['Beta', 'Gamma']);
  assert.deepEqual(
    (await getTeamDatabaseItems()).map((i) => i.school).sort(),
    ['Beta', 'Gamma'],
    'a later external write is observed on the next read (no stale singleton)'
  );
});
