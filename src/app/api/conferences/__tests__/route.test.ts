import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFERENCES_SNAPSHOT } from '@/data/conferencesSnapshot';
import { GET } from '../route';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

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
    const first = await GET(new Request('http://localhost/api/conferences?bypassCache=1'));
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

  const originalFetch = global.fetch;
  setMockFetch(async () => {
    throw new Error('upstream unavailable');
  });

  try {
    const res = await GET(new Request('http://localhost/api/conferences?bypassCache=1'));
    const json = (await res.json()) as { items: unknown[]; meta: { source: string } };

    assert.equal(res.status, 200);
    assert.equal(json.meta.source, 'local_snapshot');
    assert.equal(json.items.length, CONFERENCES_SNAPSHOT.length);
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});
