import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  process.env.CFBD_API_KEY = 'test-cfbd-token';
});

test('scores route validates seasonType query parameter', async () => {
  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  });

  const res = await GET(new Request('http://localhost/api/scores?year=2026&seasonType=invalid'));
  const json = await res.json();

  assert.equal(res.status, 400);
  assert.equal(json.field, 'seasonType');
  assert.equal(fetchCalls, 0);
});

test('scores route falls back to ESPN when CFBD fails for week-scoped requests', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response('upstream unavailable', { status: 503 });
    }
    if (url.origin === 'https://site.web.api.espn.com') {
      return new Response(
        JSON.stringify({
          events: [
            {
              competitions: [
                {
                  competitors: [
                    { homeAway: 'home', team: { displayName: 'Texas' }, score: '31' },
                    { homeAway: 'away', team: { displayName: 'Rice' }, score: '14' },
                  ],
                  status: {
                    type: { description: 'Final' },
                    displayClock: '0:00',
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
  );
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.meta.source, 'espn');
  assert.equal(json.meta.fallbackUsed, true);
  assert.equal(Array.isArray(json.items), true);
});

test('scores route denies week-null ESPN fallback when CFBD key is missing', async () => {
  process.env.CFBD_API_KEY = '';
  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&seasonType=postseason&refresh=1')
  );
  const json = await res.json();

  assert.equal(res.status, 502);
  assert.match(String(json.error ?? ''), /season-wide fallback unavailable/i);
  assert.equal(fetchCalls, 0);
});

test('scores route reports metadata and caches by explicit seasonType', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response(
        JSON.stringify([
          {
            id: 99,
            home_team: 'Georgia',
            away_team: 'Alabama',
            home_points: 24,
            away_points: 17,
            start_date: '2026-12-20T00:00:00Z',
            completed: true,
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  // First call is an authorized refresh (fetches + persists); the anonymous
  // follow-up is served from the fresh cache seeded by that refresh.
  const first = await GET(
    new Request('http://localhost/api/scores?year=2026&week=16&seasonType=postseason&refresh=1')
  );
  const firstJson = await first.json();
  const second = await GET(
    new Request('http://localhost/api/scores?year=2026&week=16&seasonType=postseason')
  );
  const secondJson = await second.json();

  assert.equal(first.status, 200);
  assert.equal(firstJson.meta.source, 'cfbd');
  assert.equal(firstJson.meta.fallbackUsed, false);
  assert.equal(firstJson.meta.cache, 'miss');
  assert.equal(secondJson.meta.cache, 'hit');
});

test('scores refresh: a durable write failure does not publish process-local fresh scores (PLATFORM-085A)', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response(
        JSON.stringify([
          {
            id: 555,
            home_team: 'Texas',
            away_team: 'Rice',
            home_points: 31,
            away_points: 7,
            start_date: '2026-10-01T00:00:00Z',
            completed: true,
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    // ESPN fallback unavailable, so the refresh cannot succeed by any path.
    if (url.origin === 'https://site.web.api.espn.com') {
      return new Response('unavailable', { status: 503 });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  // Durable persistence is down: the refresh must NOT return fresh scores nor
  // seed the process cache with data no other instance could reproduce.
  __setAppStateWriteFailureForTests(new Error('durable write unavailable'));
  let refresh: Response;
  try {
    refresh = await GET(
      new Request('http://localhost/api/scores?year=2026&week=9&seasonType=regular&refresh=1')
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.notEqual(refresh.status, 200);

  // A subsequent public (no-refresh) read must NOT serve the un-persisted
  // scores from process memory — the cache was never poisoned.
  const anon = await GET(
    new Request('http://localhost/api/scores?year=2026&week=9&seasonType=regular')
  );
  const anonJson = await anon.json();
  assert.deepEqual(anonJson.items, []);
});

// ---------------------------------------------------------------------------
// PLATFORM-075 — public scores traffic is a pure cache reader. Only an
// authorized admin refresh (refresh=1) may spend CFBD/ESPN quota. Anonymous
// requests serve fresh/stale cache or a controlled empty response, never a
// cold-cache upstream fetch.
// ---------------------------------------------------------------------------

test('PLATFORM-075: anonymous cold-cache scores request does not call CFBD/ESPN', async () => {
  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  });

  // Unique (valid) week-scoped key untouched by other tests so the cache is cold.
  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&week=50&seasonType=regular')
  );
  const json = await res.json();

  // Controlled empty (200) — a week request is a leaf, so no downstream fan-out.
  assert.equal(res.status, 200);
  assert.equal(fetchCalls, 0, 'anonymous cold cache must not spend CFBD/ESPN quota');
  assert.equal(json.meta.cache, 'stale');
  assert.equal(json.meta.cfbdFallbackReason, 'upstream-suppressed');
  assert.deepEqual(json.items, []);
});

test('PLATFORM-075: season-wide read reconciles week caches server-side (no fan-out)', async () => {
  // Seed two week-scoped caches directly (as an authorized refresh would); the
  // season-wide read must merge them in a single request without calling upstream.
  const mkEntry = (week: number, home: string, away: string) => ({
    at: Date.now() - 30 * 60 * 1000,
    items: [
      {
        id: `${home}-${away}-w${week}`,
        week,
        status: 'STATUS_FINAL',
        startDate: `2027-12-${10 + week}T00:00:00Z`,
        home: { team: home, score: 21 },
        away: { team: away, score: 14 },
        time: null,
      },
    ],
    source: 'cfbd' as const,
    cfbdFallbackReason: 'none' as const,
  });
  await setAppState('scores', '2027-5-postseason', mkEntry(5, 'Georgia', 'Clemson'));
  await setAppState('scores', '2027-6-postseason', mkEntry(6, 'Texas', 'Rice'));

  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  });

  // Season-wide request (no week param): merges the two week caches.
  const res = await GET(new Request('http://localhost/api/scores?year=2027&seasonType=postseason'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(fetchCalls, 0, 'season-wide reconciliation must not call upstream');
  assert.equal(json.meta.cache, 'stale');
  assert.equal(json.items.length, 2, 'both week caches surface in one season-wide response');
});

test('PLATFORM-075: a fresher week cache overrides a stale season entry for the same game', async () => {
  const gameId = 'ND-Navy-w2';
  // Stale season-wide entry: old score for the game.
  await setAppState('scores', '2027-all-regular', {
    at: Date.now() - 2 * 60 * 60 * 1000, // 2h old
    items: [
      {
        id: gameId,
        week: 2,
        status: 'STATUS_IN_PROGRESS',
        startDate: '2027-09-12T00:00:00Z',
        home: { team: 'Notre Dame', score: 7 },
        away: { team: 'Navy', score: 3 },
        time: 'Q2',
      },
    ],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });
  // Fresher week-scoped entry: final score for the same game.
  await setAppState('scores', '2027-2-regular', {
    at: Date.now() - 5 * 60 * 1000, // 5m old -> newer than the season entry
    items: [
      {
        id: gameId,
        week: 2,
        status: 'STATUS_FINAL',
        startDate: '2027-09-12T00:00:00Z',
        home: { team: 'Notre Dame', score: 28 },
        away: { team: 'Navy', score: 10 },
        time: 'Final',
      },
    ],
    source: 'espn',
    cfbdFallbackReason: 'cfbd-http',
  });

  setMockFetch(async () => new Response('[]', { status: 200 }));

  const res = await GET(new Request('http://localhost/api/scores?year=2027&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.items.length, 1, 'the same game is merged, not duplicated');
  assert.equal(
    json.items[0].home.score,
    28,
    'the fresher week score wins over the stale season score'
  );
  assert.equal(json.items[0].status, 'STATUS_FINAL');
});

test('PLATFORM-075: a postseason game under provider and canonical week aliases reconciles to one row', async () => {
  // CFBD season snapshot stores the bowl under its PROVIDER week (1).
  await setAppState('scores', '2027-all-postseason', {
    at: Date.now() - 30 * 60 * 1000, // 30m old
    items: [
      {
        id: 'cfbd-9001',
        week: 1,
        status: 'STATUS_IN_PROGRESS',
        startDate: '2027-12-31T20:00:00Z',
        home: { team: 'Georgia', score: 7 },
        away: { team: 'Texas', score: 3 },
        time: 'Q2',
      },
    ],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });
  // ESPN fallback stores the SAME game under its CANONICAL week (16) with a
  // different provider id — newer, final. Keyed by week these would duplicate;
  // keyed by canonical identity (team pair + date) they reconcile.
  await setAppState('scores', '2027-16-postseason', {
    at: Date.now() - 60 * 1000, // 1m old
    items: [
      {
        id: 'espn-4242',
        week: 16,
        status: 'STATUS_FINAL',
        startDate: '2027-12-31T20:00:00Z',
        home: { team: 'Georgia', score: 24 },
        away: { team: 'Texas', score: 21 },
        time: 'Final',
      },
    ],
    source: 'espn',
    cfbdFallbackReason: 'cfbd-http',
  });

  setMockFetch(async () => new Response('[]', { status: 200 }));

  const res = await GET(new Request('http://localhost/api/scores?year=2027&seasonType=postseason'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.items.length, 1, 'provider/canonical week aliases are not double-counted');
  assert.equal(json.items[0].home.score, 24, 'the fresher ESPN row wins the alias reconciliation');
  assert.equal(json.items[0].status, 'STATUS_FINAL');
});

test('PLATFORM-075: an empty newer week fallback does not erase populated season scores', async () => {
  await setAppState('scores', '2027-all-regular', {
    at: Date.now() - 10 * 60 * 1000, // 10m old, populated
    items: [
      {
        id: 'cfbd-7',
        week: 3,
        status: 'STATUS_FINAL',
        startDate: '2027-09-20T00:00:00Z',
        home: { team: 'Ohio State', score: 35 },
        away: { team: 'Purdue', score: 10 },
        time: 'Final',
      },
    ],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });
  // A newer week entry from an ESPN fallback that returned no games.
  await setAppState('scores', '2027-3-regular', {
    at: Date.now() - 60 * 1000, // 1m old (newer) but EMPTY
    items: [],
    source: 'espn',
    cfbdFallbackReason: 'cfbd-http',
  });

  setMockFetch(async () => new Response('[]', { status: 200 }));

  const res = await GET(new Request('http://localhost/api/scores?year=2027&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.items.length, 1, 'the populated season row survives a newer empty week entry');
  assert.equal(json.items[0].home.score, 35);
  assert.equal(
    json.meta.source,
    'cfbd',
    'meta source reflects the newest entry that actually had rows'
  );
});

test('PLATFORM-075: season-wide read reflects a week cache refreshed within the season entry TTL', async () => {
  const gameId = 'UGA-Bama-w1';
  // Fresh season-wide entry (within the 5-min TTL) with an older score.
  await setAppState('scores', '2027-all-regular', {
    at: Date.now() - 2 * 60 * 1000, // 2m old -> fresh
    items: [
      {
        id: gameId,
        week: 1,
        status: 'STATUS_IN_PROGRESS',
        startDate: '2027-08-30T00:00:00Z',
        home: { team: 'Georgia', score: 3 },
        away: { team: 'Alabama', score: 0 },
        time: 'Q1',
      },
    ],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });
  // Week cache refreshed a moment later (also within TTL) with the final score.
  await setAppState('scores', '2027-1-regular', {
    at: Date.now() - 30 * 1000, // 30s old -> newer than the season entry
    items: [
      {
        id: gameId,
        week: 1,
        status: 'STATUS_FINAL',
        startDate: '2027-08-30T00:00:00Z',
        home: { team: 'Georgia', score: 34 },
        away: { team: 'Alabama', score: 20 },
        time: 'Final',
      },
    ],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });

  setMockFetch(async () => new Response('[]', { status: 200 }));

  const res = await GET(new Request('http://localhost/api/scores?year=2027&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.meta.cache, 'hit', 'freshest contributor within TTL reports a hit');
  assert.equal(json.items.length, 1);
  assert.equal(
    json.items[0].home.score,
    34,
    'a week cache refreshed within the season TTL is not masked by the fresh season snapshot'
  );
  assert.equal(json.items[0].status, 'STATUS_FINAL');
});

test('PLATFORM-075: anonymous request serves cached scores without calling upstream', async () => {
  let cfbdCalls = 0;
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      cfbdCalls += 1;
      return new Response(
        JSON.stringify([
          {
            id: 7,
            home_team: 'Georgia',
            away_team: 'Alabama',
            home_points: 24,
            away_points: 17,
            start_date: '2026-11-01T00:00:00Z',
            completed: true,
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  const seed = await GET(
    new Request('http://localhost/api/scores?year=2026&week=9&seasonType=regular&refresh=1')
  );
  assert.equal(seed.status, 200);
  assert.equal((await seed.json()).meta.cache, 'miss');
  assert.equal(cfbdCalls, 1);

  const anon = await GET(
    new Request('http://localhost/api/scores?year=2026&week=9&seasonType=regular')
  );
  const anonJson = await anon.json();
  assert.equal(anon.status, 200);
  assert.equal(cfbdCalls, 1, 'anonymous read must not trigger a second CFBD call');
  assert.equal(anonJson.items.length, 1);
  assert.equal(anonJson.meta.cache, 'hit');
});

test('PLATFORM-075: anonymous request serves a STALE durable entry without calling upstream', async () => {
  const staleEntry = {
    at: Date.now() - 60 * 60 * 1000, // 1h old -> well past the 5-min TTL
    items: [
      {
        week: 42,
        status: 'STATUS_FINAL',
        home: { team: 'Georgia', score: 24 },
        away: { team: 'Alabama', score: 17 },
        time: null,
      },
    ],
    source: 'cfbd' as const,
    cfbdFallbackReason: 'none' as const,
  };
  await setAppState('scores', '2027-42-regular', staleEntry);

  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2027&week=42&seasonType=regular')
  );
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(fetchCalls, 0, 'stale-serve must not call upstream');
  assert.equal(json.meta.cache, 'stale');
  assert.equal(json.items.length, 1);
});

test('PLATFORM-075: scores refresh requires admin authorization when a token is configured', async () => {
  const prior = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = 'secret-token';
  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  });

  try {
    const denied = await GET(
      new Request('http://localhost/api/scores?year=2026&week=2&seasonType=regular&refresh=1')
    );
    assert.equal(denied.status, 401);
    assert.equal(fetchCalls, 0, 'unauthorized refresh must not call upstream');

    const allowed = await GET(
      new Request('http://localhost/api/scores?year=2026&week=2&seasonType=regular&refresh=1', {
        headers: { 'x-admin-token': 'secret-token' },
      })
    );
    assert.equal(allowed.status, 200);
    assert.ok(fetchCalls >= 1, 'authorized refresh must reach upstream');
  } finally {
    if (prior === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = prior;
  }
});
