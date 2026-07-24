import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
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

// ---------------------------------------------------------------------------
// PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY: a durable catalog synced
// BEFORE the alias-safety fix still carries the unsafe generated `sandiego`
// truncation. The store must serve it SANITIZED through the curated overrides
// at read time — without mutating the stored snapshot — so the fix is
// effective from deploy, not only after the operator resync.
// ---------------------------------------------------------------------------

test('a stale pre-fix durable catalog is served with curated overrides applied, without a write-back', async () => {
  const preFixSnapshot = {
    source: 'cfbd',
    updatedAt: '2025-01-01T00:00:00.000Z',
    items: [
      {
        school: 'San Diego State',
        conference: 'Mountain West',
        // Pre-fix synced alts: carries the unsafe truncation, lacks 'sdsu'.
        alts: ['san diego state', 'sandiego', 'sandiegostate'],
      },
      {
        school: 'San José State',
        conference: 'Mountain West',
        alts: ['san jose state', 'sanjosestate'],
      },
      {
        school: 'New Mexico State',
        conference: 'Conference USA',
        alts: ['new mexico state', 'newmexico', 'newmexicostate'],
      },
    ],
  };
  await setAppState('team-database', 'current', preFixSnapshot);

  const items = await getTeamDatabaseItems();
  const bySchool = new Map(items.map((i) => [i.school, i]));
  const sdsu = bySchool.get('San Diego State');
  assert.ok(sdsu);
  assert.ok(!sdsu!.alts?.includes('sandiego'), 'unsafe truncation removed at read time');
  assert.ok(sdsu!.alts?.includes('sdsu'), 'sanctioned shorthand added at read time');
  const sjsu = bySchool.get('San José State');
  assert.ok(sjsu);
  assert.ok(sjsu!.alts?.includes('san jose'), 'San José State override applied at read time');
  // Overrides with no entry for a school leave its alts untouched.
  const nmsu = bySchool.get('New Mexico State');
  assert.ok(nmsu);
  assert.ok(
    nmsu!.alts?.includes('newmexico'),
    'no override for NMSU — read path never invents removals'
  );

  // The durable snapshot itself is NOT rewritten — sanitization is read-time only.
  const raw = await getAppState<typeof preFixSnapshot>('team-database', 'current');
  const rawSdsu = raw!.value.items.find((i) => i.school === 'San Diego State');
  assert.ok(rawSdsu!.alts.includes('sandiego'), 'stored snapshot untouched');
  assert.ok(!rawSdsu!.alts.includes('sdsu'), 'stored snapshot untouched');
});
