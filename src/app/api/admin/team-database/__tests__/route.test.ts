import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads, so
// the route handler's `revalidateTag` (via invalidateAllLeaguesStandings) runs
// under the bare node:test runner instead of throwing "static generation store
// missing".
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { POST } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __deleteTeamDatabaseStoreFileForTests,
  __resetTeamDatabaseStoreForTests,
  getTeamDatabaseFile,
  setTeamDatabaseFile,
} from '../../../../../lib/server/teamDatabaseStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-070 — team-database syncs must invalidate cached canonical standings.
//
// `computeCanonicalStandings` reads the team catalog via getTeamDatabaseItems()
// (the runtime team-database store). A resync (POST /api/admin/team-database)
// changes team identity, canonical IDs, derived alts/aliases, and FBS/FCS
// classification, so warm standings snapshots must be busted or they keep
// resolving against the pre-sync catalog. Before the fix the route wrote the
// new catalog but invalidated nothing (0 standings tags); it now busts the
// shared ALL_STANDINGS_TAG carried by every snapshot.
// ---------------------------------------------------------------------------

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ADMIN_TOKEN = 'test-admin-token';

// A minimal CFBD teams payload; buildTeamDatabaseFile keys off `school`.
const CFBD_ROWS = [
  { school: 'Alpha State', classification: 'fbs', mascot: 'Aces' },
  { school: 'Beta Tech', classification: 'fbs', mascot: 'Bots' },
];

function makeLeague(slug: string): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2025,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function stubFetchOk(rows: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function stubFetchFailing(): void {
  globalThis.fetch = (async () => new Response('upstream boom', { status: 502 })) as typeof fetch;
}

function postRequest(token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/admin/team-database', { method: 'POST', headers });
}

function runCapturingTags<T>(fn: () => Promise<T>): Promise<{ result: T; tags: string[] }> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, async () => {
    const result = await fn();
    return { result, tags: store.pendingRevalidatedTags };
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteTeamDatabaseStoreFileForTests();
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-key';
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

test('a successful sync busts the shared standings tag and persists the new catalog', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('league-a'),
    makeLeague('league-b'),
    makeLeague('league-c'),
  ]);
  stubFetchOk(CFBD_ROWS);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 200, await res.text());

  // Global mutation → the shared tag every standings snapshot carries. One tag
  // covers all leagues and all years without enumerating the registry.
  assert.ok(tags.includes('standings:all'), 'shared standings tag invalidated');
  // No year-scoped tags — team-database data is global, not year-scoped.
  assert.ok(
    !tags.some((t) => /^standings:.+:\d+$/.test(t)),
    'no year-scoped standings tags for a global team-database sync'
  );

  // New catalog is persisted and readable.
  const stored = await getTeamDatabaseFile();
  const schools = stored.items.map((i) => i.school).sort();
  assert.deepEqual(schools, ['Alpha State', 'Beta Tech']);
});

test('a successful sync busts the shared tag even with no registered leagues', async () => {
  // The shared tag does not depend on the registry, so a league registered
  // concurrently (after any snapshot would have been read) is still covered.
  stubFetchOk(CFBD_ROWS);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 200, await res.text());
  assert.ok(
    tags.includes('standings:all'),
    'shared standings tag invalidated regardless of registry'
  );
});

test('an unauthorized request writes nothing and invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2020-01-01T00:00:00.000Z',
    items: [
      {
        id: 'zzz',
        providerId: null,
        school: 'Preexisting',
        displayName: null,
        shortDisplayName: null,
        abbreviation: null,
        mascot: null,
        level: null,
        subdivision: null,
        conference: null,
        classification: 'fbs',
        color: null,
        altColor: null,
        logos: [],
        alts: [],
      },
    ],
  });
  stubFetchOk(CFBD_ROWS);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest(null)));
  assert.equal(res.status, 401);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'rejected auth invalidates nothing'
  );
  // Catalog unchanged.
  const stored = await getTeamDatabaseFile();
  assert.deepEqual(
    stored.items.map((i) => i.school),
    ['Preexisting']
  );
});

test('a missing CFBD_API_KEY invalidates nothing', async () => {
  delete MUTABLE_ENV.CFBD_API_KEY;
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 500);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'misconfigured sync invalidates nothing'
  );
});

test('an upstream failure writes nothing and invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2020-01-01T00:00:00.000Z',
    items: [
      {
        id: 'zzz',
        providerId: null,
        school: 'Preexisting',
        displayName: null,
        shortDisplayName: null,
        abbreviation: null,
        mascot: null,
        level: null,
        subdivision: null,
        conference: null,
        classification: 'fbs',
        color: null,
        altColor: null,
        logos: [],
        alts: [],
      },
    ],
  });
  stubFetchFailing();

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 502);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'failed upstream fetch invalidates nothing'
  );
  // Catalog unchanged — the failed sync must not have overwritten it.
  const stored = await getTeamDatabaseFile();
  assert.deepEqual(
    stored.items.map((i) => i.school),
    ['Preexisting']
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY: a durable sync must persist a
// catalog with the corrected derived aliases — no truncated multi-token
// prefixes, sanctioned shorthand applied via alias-overrides.json.
// ---------------------------------------------------------------------------

test('a sync persists the corrected derived aliases in the durable catalog', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);
  stubFetchOk([
    { school: 'San Diego State', classification: 'fbs', mascot: 'Aztecs' },
    { school: 'San José State', classification: 'fbs', mascot: 'Spartans' },
    { school: 'New Mexico State', classification: 'fbs', mascot: 'Aggies' },
  ]);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 200, await res.text());
  // Existing durable-write + invalidation behavior is unchanged.
  assert.ok(tags.includes('standings:all'), 'shared standings tag still invalidated');

  const stored = await getTeamDatabaseFile();
  const bySchool = new Map(stored.items.map((i) => [i.school, i]));
  const sdsu = bySchool.get('San Diego State');
  assert.ok(sdsu);
  assert.ok(sdsu!.alts?.includes('sdsu'), 'sanctioned SDSU shorthand persisted');
  assert.ok(!sdsu!.alts?.includes('sandiego'), 'truncated sandiego prefix not persisted');
  const sjsu = bySchool.get('San José State');
  assert.ok(sjsu);
  assert.ok(sjsu!.alts?.includes('san jose'), 'San José State retains explicit shorthand');
  const nmsu = bySchool.get('New Mexico State');
  assert.ok(nmsu);
  assert.ok(!nmsu!.alts?.includes('newmexico'), 'truncated newmexico prefix not persisted');
});
