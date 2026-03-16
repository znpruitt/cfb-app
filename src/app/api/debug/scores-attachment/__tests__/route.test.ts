import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test('debug scores attachment route returns summary and diagnostics from shared pipeline', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);

    if (req.pathname === '/api/schedule') {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'evt-1',
              week: 1,
              startDate: '2026-09-01T00:00:00Z',
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Army',
              awayTeam: 'Navy',
              homeConference: 'AAC',
              awayConference: 'AAC',
              status: 'scheduled',
              seasonType: 'regular',
              gamePhase: 'regular',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (req.pathname === '/api/teams') {
      return new Response(
        JSON.stringify({
          items: [
            { school: 'Army', level: 'FBS' },
            { school: 'Navy', level: 'FBS' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (req.pathname === '/api/aliases') {
      return new Response(JSON.stringify({ map: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (req.pathname === '/api/conferences') {
      return new Response(
        JSON.stringify({
          items: [
            {
              name: 'American Athletic Conference',
              shortName: 'American Athletic',
              abbreviation: 'AAC',
              classification: 'fbs',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (req.pathname === '/api/scores') {
      return new Response(
        JSON.stringify({
          items: [
            {
              week: 1,
              seasonType: 'regular',
              status: 'final',
              home: { team: 'Army', score: 21 },
              away: { team: 'Navy', score: 14 },
            },
            {
              week: 1,
              seasonType: 'regular',
              status: 'final',
              home: { team: 'Unknown U', score: 17 },
              away: { team: 'Navy', score: 10 },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    throw new Error(`Unhandled fetch: ${req.pathname}`);
  });

  const req = new Request('http://localhost/api/debug/scores-attachment?year=2026&week=1');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.year, 2026);
  assert.equal(json.week, 1);
  assert.equal(json.summary.providerRowCount, 2);
  assert.equal(json.summary.attachedCount, 1);
  assert.equal(json.summary.ignoredCount, 1);
  assert.equal(json.summary.reasons.unresolved_home_team, 1);
  assert.equal(Array.isArray(json.diagnostics), true);
  assert.equal(json.diagnostics[0].type, 'ignored_score_row');
});
