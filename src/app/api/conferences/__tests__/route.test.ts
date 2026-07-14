import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFERENCES_SNAPSHOT } from '@/data/conferencesSnapshot';
import { __resetConferencesRouteCacheForTests } from '../cache';
import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import { getProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';

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

    // Rereview finding #5: the missing-credential refresh is now recorded as a
    // failed attempt rather than being invisible.
    const status = await getProviderRefreshStatus('conferences');
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
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

// ---------------------------------------------------------------------------
// Final-truthfulness v2 finding #3 — an empty / malformed conference response is
// classified BEFORE any durable write. Conference reference data does not
// legitimately disappear, so it is a failure (prior-good retained), never a
// successful zero-row commit.
// ---------------------------------------------------------------------------

async function conferencesRefresh(): Promise<Response> {
  return GET(
    new Request('http://localhost/api/conferences?bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
}

test('conferences refresh rejects a NON-ARRAY payload and retains prior-good (finding #3)', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  await setAppState('conferences', 'snapshot', {
    at: 1,
    items: [{ name: 'Big Ten', shortName: 'B1G', abbreviation: 'B1G', classification: 'fbs' }],
  });
  const originalFetch = global.fetch;
  setMockFetch(
    async () =>
      new Response(JSON.stringify({ notAnArray: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );
  try {
    const res = await conferencesRefresh();
    const json = (await res.json()) as { meta: { source: string; fallbackUsed: boolean } };
    // Fallback body → the shared interpreter reports a failed refresh, not success.
    assert.equal(json.meta.source, 'local_snapshot');
    assert.equal(json.meta.fallbackUsed, true);

    const status = await getProviderRefreshStatus('conferences');
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'conferences-invalid-payload');

    // Prior-good durable cache retained (no empty/invalid overwrite).
    const durable = await getAppState<{ items: Array<{ name: string }> }>(
      'conferences',
      'snapshot'
    );
    assert.equal(durable?.value?.items?.[0]?.name, 'Big Ten');
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('conferences refresh rejects an EMPTY array and retains prior-good (finding #3)', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  await setAppState('conferences', 'snapshot', {
    at: 1,
    items: [{ name: 'Big Ten', shortName: 'B1G', abbreviation: 'B1G', classification: 'fbs' }],
  });
  const originalFetch = global.fetch;
  setMockFetch(
    async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );
  try {
    const res = await conferencesRefresh();
    const json = (await res.json()) as { meta: { fallbackUsed: boolean } };
    assert.equal(json.meta.fallbackUsed, true);

    const status = await getProviderRefreshStatus('conferences');
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'conferences-no-usable-rows');

    const durable = await getAppState<{ items: Array<{ name: string }> }>(
      'conferences',
      'snapshot'
    );
    assert.equal(durable?.value?.items?.[0]?.name, 'Big Ten', 'prior-good retained');
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('conferences refresh rejects a nonempty payload that normalizes to ZERO usable rows, without writing an empty cache (finding #3)', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  // No prior cache: the rejection must not fabricate an empty snapshot.
  const originalFetch = global.fetch;
  setMockFetch(
    async () =>
      new Response(JSON.stringify([{ abbreviation: 'X' }, { shortName: 'Y' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );
  try {
    const res = await conferencesRefresh();
    const json = (await res.json()) as { meta: { fallbackUsed: boolean } };
    assert.equal(json.meta.fallbackUsed, true);

    const status = await getProviderRefreshStatus('conferences');
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'conferences-no-usable-rows');

    // No durable conferences snapshot was written (no fabricated empty cache).
    const durable = await getAppState('conferences', 'snapshot');
    assert.equal(durable, null, 'a rejected payload must not write an empty cache');
  } finally {
    process.env.CFBD_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('conferences refresh with at least one usable row commits and records success (finding #3)', async () => {
  const originalKey = process.env.CFBD_API_KEY;
  process.env.CFBD_API_KEY = 'test-key';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  const originalFetch = global.fetch;
  setMockFetch(
    async () =>
      new Response(
        JSON.stringify([
          { name: 'Atlantic Coast Conference', abbreviation: 'ACC', classification: 'fbs' },
          { abbreviation: 'noname' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
  );
  try {
    const res = await conferencesRefresh();
    const json = (await res.json()) as { meta: { source: string } };
    assert.equal(json.meta.source, 'cfbd_live');

    const status = await getProviderRefreshStatus('conferences');
    assert.equal(status.latestAttemptOutcome, 'succeeded');

    const durable = await getAppState<{ items: unknown[] }>('conferences', 'snapshot');
    assert.equal(durable?.value?.items?.length, 2, 'the usable payload commits durably');
  } finally {
    process.env.CFBD_API_KEY = originalKey;
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
