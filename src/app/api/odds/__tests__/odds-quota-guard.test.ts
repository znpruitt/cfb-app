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
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
  getDurableOddsRecord,
} from '../../../../lib/server/durableOddsStore.ts';

import { GET } from '../route.ts';
import {
  __resetOddsRouteCacheForTests,
  oddsCache,
  pickFreshestOddsFallback,
  type SharedOddsCacheEntry,
} from '../routeInternals.ts';

// ---------------------------------------------------------------------------
// PLATFORM-020 / PLATFORM-075 — odds quota protection for public traffic.
//
// PLATFORM-075 hardened the model: the public/anonymous path (`/api/odds`
// without refresh=1) is now a pure cache reader — it NEVER spends upstream Odds
// API quota, cold or stale. Only an authorized admin refresh (refresh=1,
// auth-gated) reaches upstream. The saved quota guard still surfaces the current
// low-usage snapshot on the anonymous path so the client can self-throttle its
// own manual refresh (PLATFORM-020). Cache-serving behavior must be unchanged.
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
  meta: {
    cache: 'hit' | 'miss';
    usage: OddsUsageSnapshot | null;
    snapshotCapturedAt: string | null;
    season: number;
  };
};

// ---------------------------------------------------------------------------
// Rereview finding #2 — the odds response carries the SERVED cache entry's
// timestamp for THIS season (not the global quota snapshot), so the user-facing
// freshness label is honest and cannot inherit another season's recency.
// ---------------------------------------------------------------------------

test('meta.snapshotCapturedAt reflects the served cache entry, and is null when nothing is cached', async () => {
  const stub = installFetchStub();
  try {
    // Cold cache for this season: the freshness timestamp is honestly null.
    const cold = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(cold.status, 200, await cold.clone().text());
    const coldBody = (await cold.json()) as OddsResponseBody;
    assert.equal(
      coldBody.meta.snapshotCapturedAt,
      null,
      'a cold-cache season shows no snapshot time (never a spurious "just now")'
    );

    // Seed a served cache entry via a real refresh, then stamp its lastFetch to a
    // known value; the served snapshot time must equal that entry's capture time.
    const seed = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(seed.status, 200, await seed.clone().text());
    const lastFetch = Date.parse('2026-09-15T12:00:00.000Z');
    const seededKey = Object.keys(oddsCache.entries)[0]!;
    oddsCache.entries[seededKey] = { ...oddsCache.entries[seededKey]!, lastFetch };
    await setAppState('odds-cache', seededKey, oddsCache.entries[seededKey]);

    const served = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    const servedBody = (await served.json()) as OddsResponseBody;
    assert.equal(
      servedBody.meta.snapshotCapturedAt,
      new Date(lastFetch).toISOString(),
      'the served snapshot time is the served cache entry lastFetch for this season'
    );
    assert.equal(servedBody.meta.season, ODDS_TEST_SEASON);
  } finally {
    stub.restore();
  }
});

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

test('authorized refresh fetches upstream when no saved usage snapshot exists', async () => {
  // No setLatestKnownOddsUsage -> guard has no low-quota signal. An authorized
  // refresh reaches upstream. (Anonymous cold-cache never fetches — PLATFORM-075.)
  const stub = installFetchStub();
  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(stub.oddsCalls() >= 1, 'authorized refresh must reach the upstream Odds API');

    const body = (await res.json()) as OddsResponseBody;
    assert.equal(body.meta.cache, 'miss');
  } finally {
    stub.restore();
  }
});

test('authorized refresh fetches upstream when saved quota is comfortably above the threshold', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(400)); // safe -> guard allows
  const stub = installFetchStub();
  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(stub.oddsCalls() >= 1, 'authorized refresh must reach the upstream Odds API');
  } finally {
    stub.restore();
  }
});

test('serves a fresh cache entry without a second upstream call (cache-serving not broken)', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(400)); // safe -> refresh hits upstream
  const stub = installFetchStub();
  try {
    const first = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await first.json()).meta.cache, 'miss');
    assert.equal(stub.oddsCalls(), 1);

    // Anonymous follow-up is served from the fresh cache seeded by the refresh.
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

test('suppressed response reports the current low usage, not the stale cached entry usage', async () => {
  // 1. Prime the cache via a normal fetch while quota is safe; the cached entry
  //    captures a HIGH remaining from the upstream headers (400).
  await setLatestKnownOddsUsage(usageSnapshot(400));
  const stub = installFetchStub();
  try {
    const seed = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(seed.status, 200, await seed.clone().text());
    assert.equal((await seed.json()).meta.cache, 'miss');
    assert.equal(stub.oddsCalls(), 1);

    // 2. Make the cached fallback STALE and stamp it with an old, high usage so a
    //    naive response would surface remaining=450. The in-memory key is now
    //    season-scoped (PLATFORM-075) and identical to the durable key, so mirror
    //    it into appState under the same key.
    const cacheKey = Object.keys(oddsCache.entries)[0]!;
    const staleEntry = {
      ...oddsCache.entries[cacheKey]!,
      lastFetch: Date.now() - 10 * 60 * 1000,
      usage: usageSnapshot(450),
    };
    oddsCache.entries[cacheKey] = staleEntry;
    await setAppState('odds-cache', cacheKey, staleEntry);

    // 3. Saved quota is now low -> guard suppresses upstream and serves the stale
    //    fallback odds, but must report the CURRENT low usage.
    await setLatestKnownOddsUsage(usageSnapshot(5));
    const callsBefore = stub.oddsCalls();

    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(stub.oddsCalls(), callsBefore, 'no upstream Odds API call during suppression');

    const body = (await res.json()) as OddsResponseBody;
    assert.equal(body.meta.cache, 'hit');
    assert.equal(
      body.meta.usage?.remaining,
      5,
      'meta.usage must reflect the current low quota, not the stale cached entry usage'
    );
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

test('quota guard decides from durable usage, not a stale process-memoized snapshot', async () => {
  // Memoize a HIGH snapshot, then lower the durable record directly (bypassing
  // the store setter) so the process memo (400) is stale vs durable storage (5).
  await setLatestKnownOddsUsage(usageSnapshot(400));
  await setAppState('odds-usage', 'latest', usageSnapshot(5));

  const stub = installFetchStub();
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(
      stub.oddsCalls(),
      0,
      'guard must suppress using the fresh durable quota (5), not the memoized 400'
    );

    const body = (await res.json()) as OddsResponseBody;
    assert.equal(body.meta.usage?.remaining, 5);
  } finally {
    stub.restore();
  }
});

test('pickFreshestOddsFallback returns the entry with the newest lastFetch', () => {
  const older: SharedOddsCacheEntry = { data: [], lastFetch: 1000, usage: null };
  const newer: SharedOddsCacheEntry = { data: [], lastFetch: 2000, usage: null };

  assert.equal(pickFreshestOddsFallback(older, newer), newer);
  assert.equal(pickFreshestOddsFallback(newer, older), newer);
  assert.equal(pickFreshestOddsFallback(undefined, older), older);
  assert.equal(pickFreshestOddsFallback(older, undefined), older);
  assert.equal(pickFreshestOddsFallback(undefined, undefined), undefined);
});

function scheduleItem(): Record<string, unknown> {
  return {
    id: 'game-1',
    week: 1,
    startDate: '2026-12-01T19:30:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Georgia',
    awayTeam: 'Clemson',
    homeConference: 'SEC',
    awayConference: 'ACC',
    status: 'scheduled',
    seasonType: 'regular',
    gamePhase: 'regular',
  };
}

function oddsEvent(): Record<string, unknown> {
  return {
    home_team: 'Georgia Bulldogs',
    away_team: 'Clemson Tigers',
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        markets: [
          {
            key: 'spreads',
            outcomes: [
              { name: 'Georgia', point: -7, price: -110 },
              { name: 'Clemson', point: 7, price: -110 },
            ],
          },
        ],
      },
    ],
  };
}

function installMappedFetchStub(): FetchStub {
  const realFetch = globalThis.fetch;
  let oddsCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    if (url.hostname === ODDS_API_HOST) {
      oddsCalls += 1;
      return new Response(JSON.stringify([oddsEvent()]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '100',
          'x-requests-remaining': '400',
          'x-requests-last': '1',
        },
      });
    }
    if (url.pathname === '/api/schedule') {
      return new Response(JSON.stringify({ items: [scheduleItem()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/api/conferences') {
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

test('suppressed fallback does not persist (downgrade) a newer durable odds snapshot', async () => {
  await setLatestKnownOddsUsage(usageSnapshot(400)); // safe -> refresh persists durable
  const stub = installMappedFetchStub();
  try {
    const seed = await GET(
      new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}&refresh=1`)
    );
    assert.equal(seed.status, 200, await seed.clone().text());
    const seedBody = (await seed.json()) as OddsResponseBody;
    const gameId = seedBody.items[0]?.canonicalGameId;
    assert.ok(gameId, 'seed GET should produce a canonical odds item');
    assert.equal(stub.oddsCalls(), 1);

    const seededRecord = await getDurableOddsRecord(ODDS_TEST_SEASON, gameId);
    const seededCapturedAt = seededRecord?.latestSnapshot?.capturedAt;
    assert.ok(seededCapturedAt, 'durable record should have a latest snapshot');

    // Make the cache fallback stale (older lastFetch) so the next anonymous
    // request serves this stale entry; mirror it into appState under the same
    // season-scoped key (PLATFORM-075).
    const cacheKey = Object.keys(oddsCache.entries)[0]!;
    const staleEntry = {
      ...oddsCache.entries[cacheKey]!,
      lastFetch: Date.now() - 10 * 60 * 1000,
    };
    oddsCache.entries[cacheKey] = staleEntry;
    await setAppState('odds-cache', cacheKey, staleEntry);

    await setLatestKnownOddsUsage(usageSnapshot(5)); // low -> suppress
    const callsBefore = stub.oddsCalls();

    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(stub.oddsCalls(), callsBefore, 'no upstream Odds API call during suppression');

    const afterRecord = await getDurableOddsRecord(ODDS_TEST_SEASON, gameId);
    assert.equal(
      afterRecord?.latestSnapshot?.capturedAt,
      seededCapturedAt,
      'suppressed stale fallback must not overwrite the newer durable snapshot'
    );
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-075 — public odds traffic is a pure cache reader; season-scoped
// in-memory cache key; removed dead dayKey.
// ---------------------------------------------------------------------------

test('PLATFORM-075: anonymous cold-cache odds request does not call upstream', async () => {
  const stub = installFetchStub();
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${ODDS_TEST_SEASON}`));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(stub.oddsCalls(), 0, 'anonymous cold cache must not spend Odds API quota');

    const body = (await res.json()) as OddsResponseBody & { items: unknown[] };
    assert.equal(body.meta.cache, 'hit', 'best-effort empty read reports a cache hit');
    assert.deepEqual(body.items, []);
  } finally {
    stub.restore();
  }
});

test('PLATFORM-075: in-memory odds cache is keyed by season (no cross-season collision)', async () => {
  const stub = installFetchStub();
  try {
    await GET(new Request('http://localhost/api/odds?year=2025&refresh=1'));
    await GET(new Request('http://localhost/api/odds?year=2026&refresh=1'));

    const keys = Object.keys(oddsCache.entries);
    assert.ok(
      keys.some((k) => k.startsWith('2025:')),
      'a 2025 entry must occupy its own cache slot'
    );
    assert.ok(
      keys.some((k) => k.startsWith('2026:')),
      'a 2026 entry must occupy its own cache slot'
    );
    assert.equal(new Set(keys).size, keys.length, 'cache keys must be unique');
    assert.ok(keys.length >= 2, 'distinct seasons must not alias the same in-memory entry');
  } finally {
    stub.restore();
  }
});

test('PLATFORM-075: odds cache exposes only entries (dead dayKey field removed)', () => {
  __resetOddsRouteCacheForTests();
  assert.ok(!('dayKey' in oddsCache), 'dayKey must be removed from the odds cache');
  assert.deepEqual(Object.keys(oddsCache), ['entries']);
});
