import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFERENCES_SNAPSHOT } from '@/data/conferencesSnapshot';
import { __resetConferencesRouteCacheForTests } from '../cache';
import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetConferencesRouteCacheForTests();
  delete process.env.ADMIN_API_TOKEN;
});

test('conferences route uses local snapshot when CFBD key is missing', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  delete process.env.CFBD_API_KEY;

  const originalFetch = global.fetch;
  setMockFetch(async () => {
    throw new Error('fetch should not be called without API key');
  });

  try {
    const res = await GET(new Request('http://localhost/api/conferences'));
    const json = (await res.json()) as { items: unknown[]; meta: { source: string } };

    assert.equal(res.status, 200);
    assert.equal(json.meta.source, 'local_snapshot');
    assert.equal(json.items.length, CONFERENCES_SNAPSHOT.length);
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('conferences route serves cache on repeat calls to avoid extra upstream traffic', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  let upstreamCalls = 0;
  const originalFetch = global.fetch;
  setMockFetch(async () => {
    upstreamCalls += 1;
    return new Response(
      JSON.stringify([
        {
          name: 'American Athletic Conference',
          shortName: 'American Athletic',
          abbreviation: 'AAC',
          classification: 'fbs',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  try {
    const first = await GET(
      new Request('http://localhost/api/conferences?bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    const firstJson = (await first.json()) as { meta: { source: string } };
    const second = await GET(new Request('http://localhost/api/conferences'));
    const secondJson = (await second.json()) as { meta: { source: string } };

    assert.equal(firstJson.meta.source, 'cfbd_live');
    assert.equal(secondJson.meta.source, 'cache');
    assert.equal(upstreamCalls, 1);
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('conferences route falls back to local snapshot when upstream fails on cold fetch', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  const originalFetch = global.fetch;
  setMockFetch(async () => {
    throw new Error('upstream unavailable');
  });

  try {
    const res = await GET(
      new Request('http://localhost/api/conferences?bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    const json = (await res.json()) as { items: unknown[]; meta: { source: string } };

    assert.equal(res.status, 200);
    assert.equal(json.meta.source, 'local_snapshot');
    assert.equal(json.items.length, CONFERENCES_SNAPSHOT.length);
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('conferences route blocks non-admin rebuild when cache is missing', async () => {
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  const originalFetch = global.fetch;
  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for non-admin cache miss');
  });

  try {
    const res = await GET(new Request('http://localhost/api/conferences'));
    const json = (await res.json()) as { error?: string };
    assert.equal(res.status, 503);
    assert.match(String(json.error ?? ''), /admin refresh required/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('conferences route serves stale shared cache to non-admin reads', async () => {
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  await setAppState('conferences', 'snapshot', {
    at: Date.now() - 3 * 24 * 60 * 60 * 1000,
    items: [
      {
        name: 'Atlantic Coast Conference',
        shortName: 'ACC',
        abbreviation: 'ACC',
        classification: 'fbs',
      },
    ],
  });

  const originalFetch = global.fetch;
  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for stale non-admin cache reads');
  });

  try {
    const res = await GET(new Request('http://localhost/api/conferences'));
    const json = (await res.json()) as { items: unknown[]; meta: { stale?: boolean } };
    assert.equal(res.status, 200);
    assert.equal(json.items.length, 1);
    assert.equal(json.meta.stale, true);
  } finally {
    global.fetch = originalFetch;
  }
});
