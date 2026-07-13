import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';

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

// ---------------------------------------------------------------------------
// PLATFORM-086A rereview — ESPN removed as an automatic score fallback. CFBD is
// the sole normal production score provider: a CFBD failure preserves prior-good
// data and reports a failure (never a silent ESPN substitution); a valid empty
// CFBD partition is a no-op, not a failure.
// ---------------------------------------------------------------------------

test('a CFBD failure reports a failure and never calls ESPN', async () => {
  let espnCalls = 0;
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response('upstream unavailable', { status: 503 });
    }
    if (url.origin === 'https://site.web.api.espn.com') {
      espnCalls += 1;
      return new Response('[]', { status: 200 });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
  );

  assert.notEqual(res.status, 200, 'a CFBD failure is a failure, not a 200 ESPN substitution');
  assert.equal(espnCalls, 0, 'ESPN must never be contacted');
});

test('a valid empty postseason CFBD partition is a no-op (200), not a failure, and calls no ESPN', async () => {
  let espnCalls = 0;
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      // Postseason not yet published → CFBD returns an authoritative empty array.
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.origin === 'https://site.web.api.espn.com') {
      espnCalls += 1;
      return new Response('[]', { status: 200 });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&seasonType=postseason&refresh=1')
  );
  const json = await res.json();

  assert.equal(res.status, 200, 'a valid empty partition is a successful no-op, not a 502');
  assert.equal(json.meta.source, 'cfbd');
  assert.equal(json.meta.fallbackUsed, false);
  assert.equal(json.meta.cfbdFallbackReason, 'cfbd-empty');
  assert.deepEqual(json.items, []);
  assert.equal(espnCalls, 0, 'a valid empty partition must not trigger ESPN');
});

test('a nonempty CFBD payload that normalizes to zero rows is a schema-drift FAILURE, not a no-op', async () => {
  let espnCalls = 0;
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      // Nonempty array whose rows all fail toScorePackFromCfbd (no team names) —
      // a provider field rename would look like this.
      return new Response(JSON.stringify([{ id: 1, week: 3, home_points: 10, away_points: 7 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.origin === 'https://site.web.api.espn.com') {
      espnCalls += 1;
      return new Response('[]', { status: 200 });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
  );
  assert.notEqual(res.status, 200, 'schema drift is a failure, not a silent 200 no-op');
  assert.equal(espnCalls, 0, 'no ESPN fallback on schema drift');
});

test('a non-array CFBD payload is a schema-drift FAILURE', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response(JSON.stringify({ error: 'unexpected shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });

  const res = await GET(
    new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
  );
  assert.notEqual(res.status, 200, 'a non-array payload is uncertainty, not valid absence');
});

test('a missing CFBD key reports a failure (no ESPN fallback)', async () => {
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
  assert.match(String(json.error ?? ''), /CFBD API key missing/i);
  assert.equal(fetchCalls, 0, 'no provider call is made without a CFBD key');
});

test('a valid empty CFBD partition does not erase prior-good cached scores', async () => {
  // Seed a prior-good week cache.
  await setAppState('scores', '2026-4-regular', {
    at: Date.now() - 60 * 1000,
    items: [
      {
        id: 'prior-good',
        week: 4,
        status: 'STATUS_FINAL',
        startDate: '2026-09-26T00:00:00Z',
        home: { team: 'Georgia', score: 30 },
        away: { team: 'Auburn', score: 10 },
        time: 'Final',
      },
    ],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });

  // An authorized refresh of that same week now returns empty (valid absence).
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin === 'https://api.collegefootballdata.com') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });
  const refresh = await GET(
    new Request('http://localhost/api/scores?year=2026&week=4&seasonType=regular&refresh=1')
  );
  assert.equal(refresh.status, 200);
  assert.deepEqual((await refresh.json()).items, [], 'the empty no-op response carries no rows');

  // The prior-good durable entry is untouched — a subsequent public read serves it.
  setMockFetch(async () => new Response('[]', { status: 200 }));
  const anon = await GET(
    new Request('http://localhost/api/scores?year=2026&week=4&seasonType=regular')
  );
  const anonJson = await anon.json();
  assert.equal(anonJson.items.length, 1, 'prior-good scores survive a valid empty refresh');
  assert.equal(anonJson.items[0].home.score, 30);
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
// authorized admin refresh (refresh=1) may spend CFBD quota. Anonymous
// requests serve fresh/stale cache or a controlled empty response, never a
// cold-cache upstream fetch.
// ---------------------------------------------------------------------------

test('PLATFORM-075: anonymous cold-cache scores request does not call CFBD', async () => {
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
  assert.equal(fetchCalls, 0, 'anonymous cold cache must not spend CFBD quota');
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

// ---------------------------------------------------------------------------
// 6th-review finding #4 — the manual/authorized score fan-out resolves as ONE
// aggregate 'scores' attempt, so no partition's success or no-op can erase
// another partition's failure. The admin panels issue exactly this request.
// ---------------------------------------------------------------------------

const AGGREGATE_URL =
  'http://localhost/api/scores?year=2026&refresh=1&aggregate=1&seasonTypes=regular,postseason';

function gamePayload(home: string, away: string) {
  return [
    {
      id: `${home}-${away}`,
      home_team: home,
      away_team: away,
      home_points: 21,
      away_points: 14,
      start_date: '2026-11-01T00:00:00Z',
      completed: true,
    },
  ];
}

// Per-partition mock: 'ok' → a usable game, 'empty' → valid absence (no-op),
// 'fail' → a non-array payload (immediate schema-drift failure, no retry delay).
function setAggregateMock(spec: {
  regular: 'ok' | 'empty' | 'fail';
  postseason: 'ok' | 'empty' | 'fail';
}) {
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin !== 'https://api.collegefootballdata.com') {
      throw new Error(`unexpected URL: ${url.toString()}`);
    }
    const st = url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
    const mode = spec[st];
    if (mode === 'fail') {
      return new Response(JSON.stringify({ error: 'drift' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (mode === 'empty') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(
      JSON.stringify(
        st === 'postseason' ? gamePayload('Georgia', 'Texas') : gamePayload('Texas', 'Rice')
      ),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}

test('aggregate scores refresh: both partitions succeed → success, rows summed, one attempt', async () => {
  setAggregateMock({ regular: 'ok', postseason: 'ok' });
  const res = await GET(new Request(AGGREGATE_URL));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.items.length, 2, 'both partitions contribute rows to one response');
  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 2);
});

test('aggregate scores refresh: regular success + postseason no-op → success', async () => {
  setAggregateMock({ regular: 'ok', postseason: 'empty' });
  const res = await GET(new Request(AGGREGATE_URL));
  assert.equal(res.status, 200);
  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 1);
});

test('aggregate scores refresh: regular FAILURE + postseason no-op → FAILURE (no-op cannot erase it)', async () => {
  setAggregateMock({ regular: 'fail', postseason: 'empty' });
  const res = await GET(new Request(AGGREGATE_URL));
  assert.notEqual(res.status, 200, 'a partition failure fails the aggregate action');
  const status = await getProviderRefreshStatus('scores');
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the later postseason no-op must NOT overwrite the regular failure'
  );
  assert.deepEqual(status.failedPartitions, ['regular']);
  assert.equal(status.lastSuccessAt, null, 'a failed aggregate does not advance last-success');
});

test('aggregate scores refresh: regular FAILURE + postseason success → partial FAILURE', async () => {
  setAggregateMock({ regular: 'fail', postseason: 'ok' });
  const res = await GET(new Request(AGGREGATE_URL));
  assert.notEqual(res.status, 200);
  const status = await getProviderRefreshStatus('scores');
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'a committed postseason cannot mask the regular failure'
  );
  assert.deepEqual(status.failedPartitions, ['regular']);
  assert.equal(status.partialFailure, true);
});

test('aggregate scores refresh: both partitions fail → failure listing both partitions', async () => {
  setAggregateMock({ regular: 'fail', postseason: 'fail' });
  const res = await GET(new Request(AGGREGATE_URL));
  assert.notEqual(res.status, 200);
  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.deepEqual(status.failedPartitions, ['regular', 'postseason']);
});

test('aggregate scores refresh: both partitions empty → aggregate no-op (no commit)', async () => {
  setAggregateMock({ regular: 'empty', postseason: 'empty' });
  const res = await GET(new Request(AGGREGATE_URL));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.items, []);
  const status = await getProviderRefreshStatus('scores');
  assert.equal(status.latestAttemptOutcome, 'no-op', 'no partition committed → aggregate no-op');
  assert.equal(status.lastSuccessAt, null);
});

// ---------------------------------------------------------------------------
// 7th-review finding #1 — the aggregate endpoint is SERVER-AUTHORITATIVE for
// applicable score partitions: an ordinary refresh (no seasonTypes) derives them
// cache-only from the schedule, so a pre-postseason refresh never spends a doomed
// postseason CFBD request even if the client omits (or mis-sends) the list.
// ---------------------------------------------------------------------------

const ORDINARY_AGG = 'http://localhost/api/scores?year=2026&refresh=1&aggregate=1';

function scheduleItem(seasonType: 'regular' | 'postseason') {
  return {
    id: `g-${seasonType}`,
    week: 1,
    startDate: '2026-09-01T00:00:00.000Z',
    homeTeam: 'Georgia',
    awayTeam: 'Auburn',
    status: 'scheduled',
    seasonType,
  };
}

async function seedSchedule(items: ReturnType<typeof scheduleItem>[]) {
  await setAppState('schedule', '2026-all-all', {
    at: Date.now(),
    items,
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

// Records which CFBD season-type partitions were actually fetched.
function setTrackingMock(): { fetched: string[] } {
  const fetched: string[] = [];
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.origin !== 'https://api.collegefootballdata.com') {
      throw new Error(`unexpected URL: ${url.toString()}`);
    }
    const st = url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
    fetched.push(st);
    return new Response(
      JSON.stringify(
        st === 'postseason' ? gamePayload('Georgia', 'Texas') : gamePayload('Texas', 'Rice')
      ),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
  return { fetched };
}

test('ordinary aggregate refresh: server derives regular-only before postseason is scheduled', async () => {
  await seedSchedule([scheduleItem('regular')]);
  const tracker = setTrackingMock();
  const res = await GET(new Request(ORDINARY_AGG));
  assert.equal(res.status, 200);
  assert.deepEqual([...new Set(tracker.fetched)], ['regular']);
  assert.ok(!tracker.fetched.includes('postseason'), 'no doomed postseason CFBD request');
});

test('ordinary aggregate refresh: server derives both partitions once postseason is scheduled', async () => {
  await seedSchedule([scheduleItem('regular'), scheduleItem('postseason')]);
  const tracker = setTrackingMock();
  const res = await GET(new Request(ORDINARY_AGG));
  assert.equal(res.status, 200);
  const fetched = new Set(tracker.fetched);
  assert.ok(fetched.has('regular') && fetched.has('postseason'), 'both partitions fetched');
});

test('ordinary aggregate refresh: no cached schedule → regular only (safe default)', async () => {
  // beforeEach resets app-state, so 2026 has no cached schedule here.
  const tracker = setTrackingMock();
  const res = await GET(new Request(ORDINARY_AGG));
  assert.equal(res.status, 200);
  assert.deepEqual([...new Set(tracker.fetched)], ['regular']);
});

test('aggregate refresh: an explicit postseason override targets only postseason (repair)', async () => {
  // A regular-only schedule, but the explicit override still refreshes postseason.
  await seedSchedule([scheduleItem('regular')]);
  const tracker = setTrackingMock();
  const res = await GET(new Request(`${ORDINARY_AGG}&seasonTypes=postseason`));
  assert.equal(res.status, 200);
  assert.deepEqual([...new Set(tracker.fetched)], ['postseason']);
});

test('aggregate refresh: an INVALID explicit seasonTypes list falls back to server-derived applicability', async () => {
  await seedSchedule([scheduleItem('regular')]);
  const tracker = setTrackingMock();
  const res = await GET(new Request(`${ORDINARY_AGG}&seasonTypes=bogus`));
  assert.equal(res.status, 200);
  assert.deepEqual(
    [...new Set(tracker.fetched)],
    ['regular'],
    'an unusable client list cannot force a partition; the server derives applicability'
  );
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
