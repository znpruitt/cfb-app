import test from 'node:test';
import assert from 'node:assert/strict';

import { GET } from '../route';
import { resetScheduleRouteCacheForTests } from '../cache';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  delete process.env.ADMIN_API_TOKEN;
});

test('schedule route returns mapped items from CFBD upstream', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  setMockFetch(async (input: URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const requestUrl = new URL(url);

    assert.equal(requestUrl.origin, 'https://api.collegefootballdata.com');
    assert.equal(requestUrl.pathname, '/games');
    assert.equal(
      init?.headers ? (init.headers as Record<string, string>).Authorization : '',
      'Bearer test-cfbd-token'
    );

    const seasonType = requestUrl.searchParams.get('seasonType');
    const body =
      seasonType === 'regular'
        ? [
            {
              week: 1,
              home_team: 'Texas',
              away_team: 'Rice',
              id: 1,
              start_date: '2025-08-30T00:00:00Z',
            },
          ]
        : [
            {
              week: 16,
              homeTeam: 'Georgia',
              awayTeam: 'Ohio State',
              id: 2,
              startDate: '2025-12-20T00:00:00Z',
              neutralSite: true,
              notes: 'Vrbo Fiesta Bowl',
            },
          ];

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('http://localhost/api/schedule?year=2025&seasonType=all');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.items.length, 2);
  assert.equal(json.items[0].homeTeam, 'Texas');
  assert.equal(json.items[1].homeTeam, 'Georgia');
  assert.equal(json.items[1].gamePhase, 'postseason');
  assert.equal(json.items[1].postseasonSubtype, 'bowl');
  assert.equal(json.meta.source, 'cfbd');
});

test('schedule route returns empty items when upstream array is empty', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  setMockFetch(async () => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('http://localhost/api/schedule?year=2027&seasonType=regular');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(json.items, []);
  assert.equal(json.meta.partialFailure, false);
});

test('schedule route returns 502 for seasonType=all when one request fails', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const seasonType = url.searchParams.get('seasonType');

    if (seasonType === 'postseason') {
      return new Response('forbidden', { status: 403 });
    }

    return new Response(JSON.stringify([{ week: 1, home_team: 'Texas', away_team: 'Rice' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('http://localhost/api/schedule?year=2027&seasonType=all');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 502);
  assert.equal(json.error, 'partial upstream error');
  assert.deepEqual(json.detail.failedSeasonTypes, ['postseason']);
});

test('schedule route bypassCache=1 forces an upstream refetch', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  let fetchCount = 0;
  setMockFetch(async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify([
        { week: 1, home_team: `Home ${fetchCount}`, away_team: 'Away', id: fetchCount },
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  });

  const first = await GET(
    new Request('http://localhost/api/schedule?year=2026&seasonType=regular&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
  const firstJson = await first.json();

  const second = await GET(
    new Request('http://localhost/api/schedule?year=2026&seasonType=regular&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
  const secondJson = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 2);
  assert.equal(firstJson.meta.cache, 'miss');
  assert.equal(secondJson.meta.cache, 'miss');
  assert.equal(firstJson.items[0].homeTeam, 'Home 1');
  assert.equal(secondJson.items[0].homeTeam, 'Home 2');
});

test('schedule route blocks non-admin upstream rebuild when shared cache is missing', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for non-admin cache miss');
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2026&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 503);
  assert.match(String(json.error ?? ''), /admin refresh required/i);
});

test('schedule route serves stale shared cache to non-admin requests instead of rebuilding', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  await setAppState('schedule', '2026-all-regular', {
    at: Date.now() - 10 * 60 * 60 * 1000,
    items: [{ week: 1, homeTeam: 'Stale Home', awayTeam: 'Away', seasonType: 'regular' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for stale non-admin reads');
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2026&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.rebuildRequired, true);
  assert.equal(json.items[0].homeTeam, 'Stale Home');
});

test('stale shared schedule cache entries are refetched instead of treated as permanently fresh', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  let fetchCount = 0;

  await setAppState('schedule', '2026-all-regular', {
    at: Date.now() - 3_601_000,
    items: [{ week: 1, homeTeam: 'Stale Home', awayTeam: 'Away', seasonType: 'regular' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  setMockFetch(async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify([{ week: 1, home_team: 'Fresh Home', away_team: 'Away', id: fetchCount }]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2026&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(fetchCount, 1);
  assert.equal(json.meta.cache, 'miss');
  assert.equal(json.items[0].homeTeam, 'Fresh Home');
});
