import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import {
  __resetSeasonRankingsCacheForTests,
  __setSeasonRankingsCacheForTests,
  RANKINGS_MEMO_TTL_MS,
  type RankingsCacheEntry,
} from '@/lib/server/rankings';
import { acquireRankingsRefreshLease } from '@/lib/rankings/refreshLease';
import { getProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import { yearScope } from '@/lib/providerRefreshScope';
import type { RankingsResponse } from '@/lib/rankings';

type MockFetch = typeof fetch;

const ORIGINAL_FETCH = global.fetch;
const DAY_MS = 24 * 60 * 60 * 1000;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

/** A fetch stub that fails the test if any provider request is attempted. */
function forbidProviderCalls(): { calls: () => number } {
  let calls = 0;
  setMockFetch(async () => {
    calls += 1;
    throw new Error('provider fetch must not run for this request');
  });
  return { calls: () => calls };
}

function populatedResponse(generatedAt: string): RankingsResponse {
  return {
    weeks: [
      {
        season: 2027,
        week: 1,
        seasonType: 'regular',
        primarySource: 'ap',
        teams: [
          {
            teamId: 'georgia',
            teamName: 'Georgia',
            rank: 1,
            rankSource: 'ap',
            primaryRank: 1,
            primaryRankSource: 'ap',
          },
        ],
        polls: {
          cfp: [],
          ap: [{ teamId: 'georgia', teamName: 'Georgia', rank: 1, rankSource: 'ap' }],
          coaches: [],
        },
      },
    ],
    latestWeek: null,
    meta: { source: 'cfbd', cache: 'miss', generatedAt },
  };
}

function entryAt(ageMs: number): RankingsCacheEntry {
  const at = Date.now() - ageMs;
  return { at, response: populatedResponse(new Date(at).toISOString()) };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  delete process.env.ADMIN_API_TOKEN;
});

test.after(() => {
  global.fetch = ORIGINAL_FETCH;
});

// 1 — a public cache hit is provider-free and serves clean (non-stale) metadata.
test('public cache hit serves durable rankings without any provider call', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  const guard = forbidProviderCalls();
  await setAppState('rankings', '2027', entryAt(60 * 60 * 1000)); // 1h old

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as RankingsResponse;

  assert.equal(res.status, 200);
  assert.equal(guard.calls(), 0, 'public reads never contact the provider');
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.meta.stale, undefined, 'a young snapshot carries no stale marker');
  assert.equal(json.weeks.length, 1);
});

// 31 — weekly-cadence data is NOT stale at six hours (the old 6h TTL is gone).
test('a six-hour-old snapshot serves without stale/rebuild flags', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  forbidProviderCalls();
  await setAppState('rankings', '2027', entryAt(6 * 60 * 60 * 1000));

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as RankingsResponse;

  assert.equal(res.status, 200);
  assert.equal(json.meta.stale, undefined);
  assert.equal(json.meta.rebuildRequired, undefined);
});

// 2/32 — past the 8-day horizon the snapshot remains servable prior-good
// fallback but carries the stale/rebuild truth; still provider-free.
test('an older-than-eight-day snapshot serves stale flags without a provider call', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  const guard = forbidProviderCalls();
  await setAppState('rankings', '2027', entryAt(9 * DAY_MS));

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as { meta: { stale?: boolean; rebuildRequired?: boolean } };

  assert.equal(res.status, 200);
  assert.equal(guard.calls(), 0);
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.rebuildRequired, true);
});

// 3 — a public cache miss stays provider-free and demands an admin refresh.
test('rankings route blocks non-admin cache misses from triggering upstream rebuilds', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  const guard = forbidProviderCalls();

  try {
    const res = await GET(new Request('http://localhost/api/rankings?year=2025'));
    const json = (await res.json()) as { error?: string };

    assert.equal(res.status, 503);
    assert.match(String(json.error ?? ''), /admin refresh required/i);
    assert.equal(guard.calls(), 0);
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

// 4 — an unauthorized bypass request is refused BEFORE any provider work.
test('unauthorized bypassCache performs no provider call', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  const guard = forbidProviderCalls();

  const res = await GET(new Request('http://localhost/api/rankings?year=2026&bypassCache=1'));

  assert.equal(res.status, 401);
  assert.equal(guard.calls(), 0);
});

// 5 — one authorized refresh performs EXACTLY the regular+postseason pair.
test('rankings route allows admin bypassCache refresh and persists snapshot', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  let calls = 0;
  setMockFetch(async (input: URL | string) => {
    calls += 1;
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body =
      url.searchParams.get('seasonType') === 'postseason'
        ? []
        : [
            {
              season: 2026,
              seasonType: 'regular',
              week: 8,
              polls: [
                {
                  poll: 'AP Top 25',
                  ranks: [{ rank: 1, school: 'Texas', conference: 'SEC' }],
                },
              ],
            },
          ];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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
    // One refresh = TWO upstream requests (regular + postseason partitions).
    assert.equal(calls, 2);
    assert.equal(json.meta.cache, 'miss');
    assert.equal(json.weeks[0].week, 8);
    assert.ok(await getAppState('rankings', '2026'), 'snapshot persisted durably');
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

// 6 — a second forced refresh spends another two upstream requests.
test('rankings bypassCache=1 bypasses fresh in-memory cache and fetches upstream again', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  let calls = 0;
  setMockFetch(async (input: URL | string) => {
    calls += 1;
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body =
      url.searchParams.get('seasonType') === 'postseason'
        ? []
        : [
            {
              season: 2026,
              seasonType: 'regular',
              week: 9,
              polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: 'Texas' }] }],
            },
          ];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const first = await GET(
      new Request('http://localhost/api/rankings?year=2026&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    // Ensure the second observation lands strictly after the first commit.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await GET(
      new Request('http://localhost/api/rankings?year=2026&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    // Two forced refreshes = FOUR upstream requests (two partitions each).
    assert.equal(calls, 4);
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

// 7 — lease contention: the exact 409 body, no provider call, no fabricated
// provider-refresh attempt.
test('a held refresh lease yields the exact 409 with no provider call and no attempt', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  const guard = forbidProviderCalls();

  const held = await acquireRankingsRefreshLease({ year: 2026, now: Date.now() });
  assert.equal(held.acquired, true);

  const res = await GET(
    new Request('http://localhost/api/rankings?year=2026&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
  const body = (await res.json()) as { error?: string };

  assert.equal(res.status, 409);
  assert.deepEqual(body, { error: 'rankings-refresh-in-progress' });
  assert.equal(guard.calls(), 0, 'the losing caller makes no provider request');

  const status = await getProviderRefreshStatus('rankings', yearScope(2026));
  assert.equal(status.latestAttemptOutcome, null, 'no fabricated provider-refresh attempt');
});

// 30 — cross-instance visibility: past the 120s memo bound, a newer durable
// snapshot written by "another instance" is served.
test('a remote durable update becomes visible after the 120-second memo TTL', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  forbidProviderCalls();

  const oldEntry = entryAt(2 * 60 * 60 * 1000); // local memo copy, 2h old
  __setSeasonRankingsCacheForTests(2027, oldEntry, {
    memoizedAtMs: Date.now() - RANKINGS_MEMO_TTL_MS - 1000,
  });
  const newerEntry = entryAt(10 * 60 * 1000); // another instance committed 10m ago
  await setAppState('rankings', '2027', newerEntry);

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as RankingsResponse;

  assert.equal(res.status, 200);
  assert.equal(json.meta.generatedAt, newerEntry.response.meta.generatedAt);
});

// 30 (bound) — within the memo TTL the in-process copy may serve; the bound is
// the documented ≤120s visibility window, not immediate.
test('within the memo TTL the process copy serves without a durable re-read', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  forbidProviderCalls();

  const memoEntry = entryAt(2 * 60 * 60 * 1000);
  __setSeasonRankingsCacheForTests(2027, memoEntry); // memoized just now
  await setAppState('rankings', '2027', entryAt(10 * 60 * 1000));

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as RankingsResponse;

  assert.equal(res.status, 200);
  assert.equal(json.meta.generatedAt, memoEntry.response.meta.generatedAt);
});

// Stale fallback still prefers the NEWEST available snapshot once the memo
// expires (both candidates past the 8-day horizon here).
test('rankings stale fallback prefers newer shared durable snapshot over older in-memory stale cache', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  forbidProviderCalls();

  const olderMemo = entryAt(10 * DAY_MS);
  __setSeasonRankingsCacheForTests(2027, olderMemo, {
    memoizedAtMs: Date.now() - RANKINGS_MEMO_TTL_MS - 1000,
  });
  const newerDurable = entryAt(9 * DAY_MS);
  await setAppState('rankings', '2027', newerDurable);

  const res = await GET(new Request('http://localhost/api/rankings?year=2027'));
  const json = (await res.json()) as { meta: { generatedAt: string; stale?: boolean } };

  assert.equal(res.status, 200);
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.generatedAt, newerDurable.response.meta.generatedAt);
});

// 33 — the manual refresh consults transaction-fresh DURABLE state, never the
// process memo: a fresher durable entry (from another instance) wins over this
// refresh's observation even while the local memo is fresh.
test('manual refresh bypasses a fresh local memo and defers to fresher durable state', async () => {
  process.env.ADMIN_API_TOKEN = 'admin-token';
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Local memo: fresh (memoized now) but OLD content.
  __setSeasonRankingsCacheForTests(2027, entryAt(60 * 60 * 1000));
  // Durable: committed by "another instance" with an observation in this
  // refresh's future — the transaction-fresh read must let it win.
  const fresher: RankingsCacheEntry = {
    at: Date.now() + 60_000,
    response: populatedResponse(new Date(Date.now() + 60_000).toISOString()),
  };
  await setAppState('rankings', '2027', fresher);

  let calls = 0;
  setMockFetch(async () => {
    calls += 1;
    return new Response(
      JSON.stringify([
        {
          season: 2027,
          seasonType: 'regular',
          week: 2,
          polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: 'Texas' }] }],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  try {
    const res = await GET(
      new Request('http://localhost/api/rankings?year=2027&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    );
    const json = (await res.json()) as RankingsResponse;

    assert.equal(res.status, 200);
    assert.equal(calls, 2, 'the refresh still fetched both partitions');
    // The fresher durable snapshot is served; this observation wrote nothing.
    assert.equal(json.meta.generatedAt, fresher.response.meta.generatedAt);
    const durable = await getAppState<RankingsCacheEntry>('rankings', '2027');
    assert.equal(durable?.value?.at, fresher.at, 'fresher durable entry untouched');
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});
