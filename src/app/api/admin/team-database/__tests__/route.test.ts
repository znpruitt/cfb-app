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
// Colours are in the PROVIDER's shape: CFBD sends `alternateColor`, never
// `altColor` (PLATFORM-199). A fixture without colours cannot see the mapping at
// all, which is how a route-level suite stayed green while every one of the 138
// production alternates was being discarded.
const CFBD_ROWS = [
  {
    school: 'Alpha State',
    classification: 'fbs',
    mascot: 'Aces',
    color: '#000000',
    alternateColor: '#ffcd00',
  },
  { school: 'Beta Tech', classification: 'fbs', mascot: 'Bots', color: '#041e42' },
];

// PLATFORM-204 — a prior-good catalog to assert retention against. Tests read
// the STORED row back rather than trusting a return value: the defect this guard
// closes wrote an empty catalog while returning `ok: true`.
function makeCatalogItem(school: string) {
  return {
    id: school.toLowerCase().replace(/[^a-z0-9]/g, ''),
    providerId: null,
    school,
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
  };
}

async function seedPriorGoodCatalog(schools: string[]): Promise<void> {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2020-01-01T00:00:00.000Z',
    items: schools.map(makeCatalogItem),
  });
}

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

test('PLATFORM-199: the sync carries provider alternateColor into the durable altColor', async () => {
  stubFetchOk(CFBD_ROWS);

  // `revalidateTag` needs the harness's static-generation store, exactly as the
  // sibling success-path tests do.
  const { result: res } = await runCapturingTags(() => POST(postRequest()));

  // Read the body once: `assert.equal`'s message argument is evaluated eagerly,
  // so `await res.text()` there would consume it before `res.json()` below.
  const body = (await res.json()) as {
    summary: { withColorCount: number; withAltColorCount: number };
  };
  assert.equal(res.status, 200, JSON.stringify(body));

  // The witness the operator actually reads (ReferenceDataPanel). It reported 0
  // on every production sync while the ingest read a field CFBD does not send.
  assert.equal(body.summary.withColorCount, 2);
  assert.equal(body.summary.withAltColorCount, 1);

  const stored = await getTeamDatabaseFile();
  const alpha = stored.items.find((i) => i.school === 'Alpha State');
  const beta = stored.items.find((i) => i.school === 'Beta Tech');
  assert.equal(alpha?.color, '#000000');
  assert.equal(alpha?.altColor, '#FFCD00', 'alternateColor survives fetch → normalize → durable');
  assert.equal(beta?.color, '#041E42');
  assert.equal(beta?.altColor, null, 'a provider row with no alternate stores none');
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

// PLATFORM-086F2D1 — with the drifted co-located duplicate suite deleted, pin
// the route-level upstream contract here: the CFBD request carries the
// configured key as a bearer Authorization header and targets /teams.
test('the upstream CFBD request forwards the configured bearer key', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  let capturedUrl = '';
  let capturedAuth: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify(CFBD_ROWS), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const { result: res } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 200, await res.text());
  assert.match(capturedUrl, /\/teams/);
  assert.equal(capturedAuth, 'Bearer test-cfbd-key');
});

// ---------------------------------------------------------------------------
// PLATFORM-204 — an upstream body that would empty the catalog is rejected
// BEFORE the durable write, and prior-good is retained.
//
// Neither of the two things that look like safety nets is one: `previousItems`
// feeds only `updatedCount` and never contributes an item, and the store's seed
// fallback is reached through `??`, which does not fire on a durable row that is
// present but holds `items: []`. So an unguarded empty commit is a silent wipe
// that no later read repairs.
//
// The three rejection reasons are asserted SEPARATELY — one test covering all
// three would pass with two of the branches unreachable.
// ---------------------------------------------------------------------------

test('PLATFORM-204: an EMPTY upstream body is rejected and the stored catalog is unchanged', async () => {
  await seedPriorGoodCatalog(['Alpha State', 'Beta Tech', 'Gamma A&M']);
  stubFetchOk([]);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  const body = (await res.json()) as { error?: string; detail?: string };

  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'team-database-empty-replacement-rejected');

  // Asserted against the STORED row, not the response.
  const stored = await getTeamDatabaseFile();
  assert.deepEqual(
    stored.items.map((i) => i.school).sort(),
    ['Alpha State', 'Beta Tech', 'Gamma A&M'],
    'prior-good catalog retained'
  );
  assert.equal(stored.updatedAt, '2020-01-01T00:00:00.000Z', 'no durable write occurred');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'a rejected sync invalidates nothing'
  );
});

test('PLATFORM-204: a NON-ARRAY upstream body is rejected and the stored catalog is unchanged', async () => {
  await seedPriorGoodCatalog(['Alpha State', 'Beta Tech', 'Gamma A&M']);
  // A CFBD 200 whose body is an object, not a list — the shape violation the
  // route used to launder into `[]` via `Array.isArray(rows) ? rows : []`.
  stubFetchOk({ error: 'rate limited' });

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  const body = (await res.json()) as { error?: string; detail?: string };

  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(
    body.error,
    'team-database-invalid-payload',
    'a shape violation is a DISTINCT diagnosis from "the provider said zero teams"'
  );

  const stored = await getTeamDatabaseFile();
  assert.deepEqual(
    stored.items.map((i) => i.school).sort(),
    ['Alpha State', 'Beta Tech', 'Gamma A&M'],
    'prior-good catalog retained'
  );
  assert.equal(stored.updatedAt, '2020-01-01T00:00:00.000Z', 'no durable write occurred');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'a rejected sync invalidates nothing'
  );
});

test('PLATFORM-204: a NONEMPTY body that normalizes to zero teams is rejected as schema drift', async () => {
  await seedPriorGoodCatalog(['Alpha State', 'Beta Tech', 'Gamma A&M']);
  // The case a `rows.length === 0` guard cannot see: CFBD renames or drops
  // `school`, so all 3 rows fail normalization and the built catalog is empty.
  // Keyed on the BUILT item count, this is still a wipe and still rejected.
  stubFetchOk([
    { name: 'Alpha State', classification: 'fbs' },
    { name: 'Beta Tech', classification: 'fbs' },
    { name: 'Gamma A&M', classification: 'fbs' },
  ]);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  const body = (await res.json()) as {
    error?: string;
    detail?: string;
    summary?: { fetchedCount: number; writtenCount: number };
  };

  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'team-database-schema-drift');
  assert.equal(body.summary?.fetchedCount, 3, 'the payload was nonempty');
  assert.equal(body.summary?.writtenCount, 0, 'and normalized to zero usable teams');

  // The per-row reasons must reach the OPERATOR, not just the raw response:
  // `syncTeamDatabase` discards the payload on a non-ok and keeps only `detail`,
  // so diagnostics living solely in `summary.errors` are invisible on exactly
  // the failure this guard exists for (review finding).
  assert.match(body.detail ?? '', /First rows:/);
  assert.match(body.detail ?? '', /missing school name/);

  const stored = await getTeamDatabaseFile();
  assert.deepEqual(
    stored.items.map((i) => i.school).sort(),
    ['Alpha State', 'Beta Tech', 'Gamma A&M'],
    'prior-good catalog retained'
  );
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'a rejected sync invalidates nothing'
  );
});

test('PLATFORM-204: a refusal tells the operator what was kept, naming the retained count', async () => {
  // The whole point of the item: a silent no-op is indistinguishable from a
  // silent wipe. `syncTeamDatabase` surfaces `detail` verbatim in the panel's
  // red "Sync error:" span, so the detail must name the retained catalog.
  await seedPriorGoodCatalog(['Alpha State', 'Beta Tech', 'Gamma A&M']);
  stubFetchOk([]);

  const { result: res } = await runCapturingTags(() => POST(postRequest()));
  const body = (await res.json()) as { detail?: string };

  assert.match(body.detail ?? '', /returned 0 teams/i);
  assert.match(body.detail ?? '', /NOT changed/i);
  assert.match(body.detail ?? '', /\b3 teams are still being served\b/);
});

test('PLATFORM-204 MUTATION GUARD: a healthy sync still REPLACES the catalog', async () => {
  // A guard that rejects everything passes every negative test above. This is
  // the named test that must go red when the guard is broken to reject all
  // input — it is the only assertion in this file that a 2xx commit still
  // happens over a populated prior-good catalog.
  await seedPriorGoodCatalog(['Stale One', 'Stale Two']);
  stubFetchOk(CFBD_ROWS);

  const { result: res, tags } = await runCapturingTags(() => POST(postRequest()));
  assert.equal(res.status, 200, await res.text());

  const stored = await getTeamDatabaseFile();
  assert.deepEqual(
    stored.items.map((i) => i.school).sort(),
    ['Alpha State', 'Beta Tech'],
    'the healthy payload replaced prior-good rather than being refused'
  );
  assert.ok(
    !stored.items.some((i) => i.school.startsWith('Stale')),
    'no prior-good row survived a successful replacement'
  );
  assert.ok(tags.includes('standings:all'), 'a committed sync still invalidates standings');
});
