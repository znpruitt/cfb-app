import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
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
    new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular')
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

  const res = await GET(new Request('http://localhost/api/scores?year=2026&seasonType=postseason'));
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

  const req = new Request('http://localhost/api/scores?year=2026&week=16&seasonType=postseason');
  const first = await GET(req);
  const firstJson = await first.json();
  const second = await GET(req);
  const secondJson = await second.json();

  assert.equal(first.status, 200);
  assert.equal(firstJson.meta.source, 'cfbd');
  assert.equal(firstJson.meta.fallbackUsed, false);
  assert.equal(firstJson.meta.cache, 'miss');
  assert.equal(secondJson.meta.cache, 'hit');
});
