import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads, so
// route handlers that call `revalidateTag` (via `invalidateStandings`) run under
// the bare node:test runner instead of throwing "static generation store missing".
import '../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET, PUT } from '../route';
import type { League } from '../../../../lib/league.ts';
import { SEED_ALIASES } from '../../../../lib/teamNames.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ADMIN_TOKEN = 'test-admin-token';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  delete MUTABLE_ENV.ADMIN_API_TOKEN;
});

/**
 * Run `fn` inside a stub Next work-async-storage store and return both its
 * result and the tags that `revalidateTag` appended, so tests can assert which
 * standings caches a mutation route invalidated. `revalidateTag` only reads
 * `route`/`incrementalCache` and pushes onto `pendingRevalidatedTags`.
 */
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

function makeLeague(slug: string): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2025,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function globalPutRequest(body: unknown, token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/aliases?scope=global', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

test('global alias PUT requires admin auth', async () => {
  const { result: res } = await runCapturingTags(() =>
    PUT(globalPutRequest({ upserts: { foo: 'Bar' } }, null))
  );
  assert.equal(res.status, 401);
});

test('global alias PUT upserts into the global store and returns the merged map', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);
  await setAppState('aliases:global', 'map', { existing: 'Existing Team' });

  const { result: res } = await runCapturingTags(() =>
    PUT(globalPutRequest({ upserts: { 'gulf coast tech': 'Texas' } }))
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scope: string; map: Record<string, string> };
  assert.equal(body.scope, 'global');
  // Existing global entry preserved, new entry merged.
  assert.equal(body.map.existing, 'Existing Team');
  assert.equal(body.map['gulf coast tech'], 'Texas');

  // Persisted to the global scope.
  const stored = await getAppState<Record<string, string>>('aliases:global', 'map');
  assert.equal(stored?.value['gulf coast tech'], 'Texas');
});

test('global alias PUT busts the shared standings tag for every league', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('league-a'),
    makeLeague('league-b'),
    makeLeague('league-c'),
  ]);

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(globalPutRequest({ upserts: { 'gulf coast tech': 'Texas' } }))
  );
  assert.equal(res.status, 200);

  // One shared tag carried by every snapshot → covers all leagues, all years,
  // without enumerating the registry.
  assert.ok(tags.includes('standings:all'), 'shared standings tag invalidated');
  // No year-scoped tags: global aliases can affect any cached year.
  assert.ok(
    !tags.some((t) => /^standings:.+:\d+$/.test(t)),
    'no year-scoped standings tags invalidated for global writes'
  );
});

test('global alias PUT busts the shared tag even with an empty league registry', async () => {
  // The shared tag does not depend on the registry, so a league registered
  // concurrently with the write is still covered — no pre/post snapshot race.
  const { result: res, tags } = await runCapturingTags(() =>
    PUT(globalPutRequest({ upserts: { 'gulf coast tech': 'Texas' } }))
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { map: Record<string, string> };
  assert.equal(body.map['gulf coast tech'], 'Texas');
  assert.ok(
    tags.includes('standings:all'),
    'shared standings tag invalidated regardless of registry'
  );
});

test('year-only alias PUT invalidates every registered league for that year (P2)', async () => {
  // `aliases:${year}` is a deprecated fallback consumed by every league's
  // canonical standings for that year, so a year-only write must invalidate all
  // registered leagues — not leave them stale as it did before the P2 fix.
  await setAppState('leagues', 'registry', [makeLeague('league-a'), makeLeague('league-b')]);
  const { result: res, tags } = await runCapturingTags(() =>
    PUT(
      new Request('https://example.com/api/aliases?year=2025', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify({ upserts: { 'gulf coast tech': 'Texas' } }),
      })
    )
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { map: Record<string, string> };
  assert.equal(body.map['gulf coast tech'], 'Texas');
  assert.ok(tags.includes('standings:league-a'));
  assert.ok(tags.includes('standings:league-b'));
  assert.ok(tags.includes('standings:league-a:2025'));
  assert.ok(tags.includes('standings:league-b:2025'));
});

test('global GET lazy migration invalidates registered leagues when it moves entries (P2)', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a'), makeLeague('league-b')]);
  // A legacy year-scoped alias within the migration scan range (migrationYear
  // 2025 → scans 2015..2026). Its presence makes the lazy migration actually
  // populate the global store (migrated > 0).
  await setAppState('aliases:league-a:2024', 'map', { 'legacy team': 'Texas' });

  const { result: res, tags } = await runCapturingTags(() =>
    GET(new Request('https://example.com/api/aliases?scope=global', { method: 'GET' }))
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scope: string; map: Record<string, string> };
  assert.equal(body.map['legacy team'], 'Texas');
  assert.ok(tags.includes('standings:all'), 'shared standings tag invalidated after migration');
});

test('global GET returns stored aliases only — never the in-memory seeds (P2)', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);
  await setAppState('aliases:global', 'map', { 'manual key': 'Manual Target' });
  // Returning seeds here would let a normal admin save persist them, so the
  // editable global view must be stored-only. Nothing migrates → no invalidation.
  const { result: res, tags } = await runCapturingTags(() =>
    GET(new Request('https://example.com/api/aliases?scope=global', { method: 'GET' }))
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { map: Record<string, string> };
  assert.equal(body.map['manual key'], 'Manual Target', 'stored/manual entry returned');
  assert.equal(
    Object.prototype.hasOwnProperty.call(body.map, 'ole miss'),
    false,
    'in-memory seed NOT included in editable global response'
  );
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'no invalidation when nothing migrates'
  );
});

test('a ?league= param on PUT is rejected (410) — no silent broadening to the year scope', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a'), makeLeague('league-b')]);
  const { result: res, tags } = await runCapturingTags(() =>
    PUT(
      new Request('https://example.com/api/aliases?league=league-a&year=2025', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify({ upserts: { 'ole miss': 'Mississippi' } }),
      })
    )
  );
  // The league-scoped write path was removed with the in-app editor. Silently
  // writing to the YEAR scope would mutate every league's aliases, so the request
  // is rejected outright rather than reinterpreted.
  assert.equal(res.status, 410);
  // Nothing was written — not the year scope, not any league scope.
  const yearScope = await getAppState<Record<string, string>>('aliases:2025', 'map');
  assert.equal(yearScope?.value, undefined, 'no year-scoped write');
  const leagueScope = await getAppState<Record<string, string>>('aliases:league-a:2025', 'map');
  assert.equal(leagueScope?.value, undefined, 'no league-scoped write');
  // A rejected write invalidates nothing.
  assert.equal(tags.length, 0, 'no standings tags invalidated on a rejected write');
});

// ---------------------------------------------------------------------------
// PLATFORM-058: GET ?scope=effective — resolver view for the client bootstrap
// (stored global > year > SEED_ALIASES; league-scoped aliases ignored per
// PLATFORM-067). Read-only; the default (stored) year GET stays the editable view.
// ---------------------------------------------------------------------------

const LEAGUE = 'league-a';
const YR = 2025;

function effectiveGet(): Request {
  return new Request(
    `https://example.com/api/aliases?scope=effective&league=${LEAGUE}&year=${YR}`,
    {
      method: 'GET',
    }
  );
}

async function effectiveMap(): Promise<Record<string, string>> {
  const res = await GET(effectiveGet());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scope: string; map: Record<string, string> };
  assert.equal(body.scope, 'effective');
  return body.map;
}

test('effective GET: returns a global-only alias', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  assert.equal((await effectiveMap())['gulf coast tech'], 'Texas');
});

test('effective GET: returns a year-only alias fallback', async () => {
  await setAppState(`aliases:${YR}`, 'map', { 'gulf coast tech': 'Texas' });
  assert.equal((await effectiveMap())['gulf coast tech'], 'Texas');
});

test('effective GET: returns SEED_ALIASES as a fallback', async () => {
  const map = await effectiveMap();
  assert.equal(map['ole miss'], SEED_ALIASES['ole miss']);
});

test('effective GET: stored global beats year and seed; a league entry is ignored', async () => {
  await setAppState('aliases:global', 'map', { uh: 'Global Target' });
  await setAppState(`aliases:${LEAGUE}:${YR}`, 'map', { uh: 'League Target' });
  await setAppState(`aliases:${YR}`, 'map', { uh: 'Year Target' });
  assert.equal((await effectiveMap()).uh, 'Global Target');
});

test('effective GET: a league+year repair is IGNORED; uh falls back to the seed (PLATFORM-067)', async () => {
  await setAppState(`aliases:${LEAGUE}:${YR}`, 'map', { uh: 'Hawaii' }); // seed is uh→houston
  assert.equal((await effectiveMap()).uh, SEED_ALIASES.uh);
});

test('effective GET: a year alias beats the seed fallback', async () => {
  await setAppState(`aliases:${YR}`, 'map', { uh: 'Hawaii' });
  assert.equal((await effectiveMap()).uh, 'Hawaii');
});

test('effective GET: does not persist anything (read-only)', async () => {
  await effectiveMap();
  const storedGlobal = await getAppState<Record<string, string>>('aliases:global', 'map');
  const storedLeague = await getAppState<Record<string, string>>(`aliases:${LEAGUE}:${YR}`, 'map');
  assert.equal(storedGlobal?.value, undefined, 'no global write');
  assert.equal(storedLeague?.value, undefined, 'no league-scope write');
});

test('default (stored) GET returns the year-scoped editable view — never global/seed', async () => {
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${YR}`, 'map', { 'year key': 'Year Team' });
  const res = await GET(
    new Request(`https://example.com/api/aliases?year=${YR}`, { method: 'GET' })
  );
  const body = (await res.json()) as { map: Record<string, string> };
  assert.equal(body.map['year key'], 'Year Team', 'stored year entry returned');
  assert.equal(
    Object.prototype.hasOwnProperty.call(body.map, 'gulf coast tech'),
    false,
    'global alias NOT in the editable stored view'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(body.map, 'ole miss'),
    false,
    'seed alias NOT in the editable stored view'
  );
});
