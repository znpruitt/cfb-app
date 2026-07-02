import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads, so
// route handlers that call `revalidateTag` (via `invalidateStandings`) run under
// the bare node:test runner instead of throwing "static generation store missing".
import '../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { PUT } from '../route';
import type { League } from '../../../../lib/league.ts';
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

test('global alias PUT invalidates the standings umbrella tag for every registered league', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('league-a'),
    makeLeague('league-b'),
    makeLeague('league-c'),
  ]);

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(globalPutRequest({ upserts: { 'gulf coast tech': 'Texas' } }))
  );
  assert.equal(res.status, 200);

  // Every registered league's umbrella tag (no year → busts all cached years).
  assert.ok(tags.includes('standings:league-a'), 'league-a umbrella tag invalidated');
  assert.ok(tags.includes('standings:league-b'), 'league-b umbrella tag invalidated');
  assert.ok(tags.includes('standings:league-c'), 'league-c umbrella tag invalidated');
  // No year-scoped tags: global aliases can affect any cached year, so only the
  // umbrella tag is used.
  assert.ok(
    !tags.some((t) => /^standings:league-[abc]:\d+$/.test(t)),
    'no year-scoped standings tags invalidated for global writes'
  );
});

test('global alias PUT succeeds with an empty league registry', async () => {
  const { result: res, tags } = await runCapturingTags(() =>
    PUT(globalPutRequest({ upserts: { 'gulf coast tech': 'Texas' } }))
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { map: Record<string, string> };
  assert.equal(body.map['gulf coast tech'], 'Texas');
  // No leagues → no standings tags invalidated.
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('league-scoped alias PUT still invalidates only that league+year (regression guard)', async () => {
  await setAppState('leagues', 'registry', [makeLeague('league-a')]);
  const { result: res, tags } = await runCapturingTags(() =>
    PUT(
      new Request('https://example.com/api/aliases?league=league-a&year=2025', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify({ upserts: { 'ole miss': 'Mississippi' } }),
      })
    )
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { league: string | null; map: Record<string, string> };
  assert.equal(body.league, 'league-a');
  assert.equal(body.map['ole miss'], 'Mississippi');
  // League-scoped write invalidates the umbrella + the specific year, and no
  // other league.
  assert.ok(tags.includes('standings:league-a'));
  assert.ok(tags.includes('standings:league-a:2025'));
  assert.ok(!tags.some((t) => t.startsWith('standings:league-b')));
});
