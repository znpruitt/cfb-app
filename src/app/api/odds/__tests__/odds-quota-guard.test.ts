import assert from 'node:assert/strict';
import test from 'node:test';

import type { OddsUsageSnapshot } from '../../../../lib/api/oddsUsage.ts';
import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  setLatestKnownOddsUsage,
} from '../../../../lib/server/oddsUsageStore.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
} from '../../../../lib/server/durableOddsStore.ts';

import { GET } from '../route.ts';
import { __resetOddsRouteCacheForTests } from '../routeInternals.ts';

// ---------------------------------------------------------------------------
// PLATFORM-020 — server-side odds quota guard.
//
// Public/non-admin callers do not carry admin usage data, so /api/odds must
// enforce the saved odds quota guard itself: on the non-admin auto path it must
// NOT call the upstream Odds API when the saved usage snapshot says remaining
// quota is below the auto-disable threshold (<= 10). Admin-driven refreshes
// (refresh=1, auth-gated) intentionally bypass the guard. Cache-serving and
// safe/absent-usage behavior must be unchanged.
// ---------------------------------------------------------------------------

const ODDS_TEST_SEASON = 2026;
const ODDS_API_HOST = 'api.the-odds-api.com';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
  await __deleteDurableOddsStoreFileForTests(ODDS_TEST_SEASON);
  __resetDurableOddsStoreForTests();
  __resetOddsRouteCacheForTests();
  process.env.ODDS_API_KEY = 'test-key';
});

function usageSnapshot(remaining: number): OddsUsageSnapshot {
  return {
    used: 500 - remaining,
    remaining,
    lastCost: 1,
    limit: 500,
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'odds-response-headers',
    sportKey: 'americanfootball_ncaaf',
    endpointType: 'odds',
    cacheStatus: 'miss',
  };
}

function okOddsResponse(): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-requests-used': '100',
      'x-requests-remaining': '400',
      'x-requests-last': '1',
    },
  });
}

type FetchStub = { oddsCalls(): number; restore(): void };

function installFetchStub(oddsHandler: () => Response = okOddsResponse): FetchStub {
  const realFetch = globalThis.fetch;
  let oddsCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    if (url.hostname === ODDS_API_HOST) {
      oddsCalls += 1;
      return oddsHandler();
    }
    if (url.pathname === '/api/schedule' || url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    oddsCalls: () => oddsCalls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

type OddsResponseBody = {
  items: Array<{ canonicalGameId: string }>;
  meta: { cache: 'hit' | 'miss'; usage: OddsUsageSnapshot | null };
};

test('does not call the upstream Odds API when saved quota is below the auto-disable threshold', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(5)); // remaining <= 10 -> disableAutoRefresh
  const stub = installFetchStub();
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(
      stub.oddsCalls(),
      0,
      'upstream Odds API must not be called on low-quota auto path'
    );

    const body = (await res.json()) as OddsResponseBody;
    assert.equal(body.meta.cache, 'hit', 'suppressed request should not report an upstream miss');
    // The saved snapshot is still surfaced so the client can self-throttle too.
    assert.equal(body.meta.usage?.remaining, 5);
  } finally {
    stub.restore();
  }
});

test('calls the upstream Odds API when no saved usage snapshot exists (existing behavior preserved)', async () => {
  // No setLatestKnownOddsUsage -> getLatestKnownOddsUsage() is null -> guard allows.
  const stub = installFetchStub();
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(stub.oddsCalls() >= 1, 'absent usage snapshot must not suppress the upstream fetch');

    const body = (await res.json()) as OddsResponseBody;
    assert.equal(body.meta.cache, 'miss');
  } finally {
    stub.restore();
  }
});

test('calls the upstream Odds API when saved quota is comfortably above the threshold', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(400)); // safe -> guard allows
  const stub = installFetchStub();
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(stub.oddsCalls() >= 1, 'safe quota must allow the upstream fetch');
  } finally {
    stub.restore();
  }
});

test('serves a fresh cache entry without a second upstream call (cache-serving not broken)', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(400)); // safe -> first call hits upstream
  const stub = installFetchStub();
  try {
    const first = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await first.json()).meta.cache, 'miss');
    assert.equal(stub.oddsCalls(), 1);

    const second = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(second.status, 200, await second.clone().text());
    assert.equal(
      (await second.json()).meta.cache,
      'hit',
      'second call should be served from cache'
    );
    assert.equal(stub.oddsCalls(), 1, 'a fresh cache entry must not trigger another upstream call');
  } finally {
    stub.restore();
  }
});

test('admin refresh bypasses the quota guard even when saved quota is exhausted', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(0)); // exhausted
  const stub = installFetchStub();
  try {
    // refresh=1 is auth-gated; in the test runtime (no admin token configured,
    // non-production) requireAdminRequest authorizes, mirroring an admin caller.
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(stub.oddsCalls() >= 1, 'admin refresh must still reach the upstream Odds API');
  } finally {
    stub.restore();
  }
});
