import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from './route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { __resetSeasonRankingsCacheForTests } from '@/lib/server/rankings';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  delete process.env.ADMIN_API_TOKEN;
});

test('rankings route blocks non-admin cache misses from triggering upstream rebuilds', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  const originalFetch = global.fetch;
  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for non-admin cache miss');
  });

  try {
    const res = await GET(new Request('http://localhost/api/rankings?year=2025'));
    const json = (await res.json()) as { error?: string };

    assert.equal(res.status, 503);
    assert.match(String(json.error ?? ''), /admin refresh required/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rankings route allows admin bypassCache refresh and persists snapshot', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  const originalFetch = global.fetch;
  let calls = 0;
  setMockFetch(async () => {
    calls += 1;
    return new Response(
      JSON.stringify([
        {
          season: 2026,
          seasonType: 'regular',
          week: 8,
          polls: [
            {
              poll: 'AP Top 25',
              ranks: [
                {
                  rank: 1,
                  school: 'Texas',
                  conference: 'SEC',
                },
              ],
            },
          ],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  try {
    const res = await GET(
      new Request('http://localhost/api/rankings?year=2026&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    const json = (await res.json()) as {
      weeks: Array<{ week: number }>;
      meta: { cache: string };
    };

    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.equal(json.meta.cache, 'miss');
    assert.equal(json.weeks[0].week, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rankings bypassCache=1 bypasses fresh in-memory cache and fetches upstream again', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  const originalFetch = global.fetch;
  let calls = 0;
  setMockFetch(async () => {
    calls += 1;
    return new Response(
      JSON.stringify([
        {
          season: 2026,
          seasonType: 'regular',
          week: 9,
          polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: 'Texas' }] }],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  try {
    const first = await GET(
      new Request('http://localhost/api/rankings?year=2026&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    const second = await GET(
      new Request('http://localhost/api/rankings?year=2026&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rankings route serves stale shared cache to non-admin reads', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';

  await setAppState('rankings', '2027', {
    at: Date.now() - 10 * 60 * 60 * 1000,
    response: {
      weeks: [],
      latestWeek: null,
      meta: {
        source: 'cfbd',
        cache: 'miss',
        generatedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
      },
    },
  });

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as { meta: { stale?: boolean; rebuildRequired?: boolean } };

  assert.equal(res.status, 200);
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.rebuildRequired, true);
});
