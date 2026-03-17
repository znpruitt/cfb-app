import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

test('postseason score attachment debug route emits canonical attachment fields', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);

    if (req.pathname === '/api/schedule') {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'post-orange-bowl',
              week: 17,
              startDate: '2025-12-28T01:00:00Z',
              neutralSite: true,
              conferenceGame: false,
              homeTeam: 'Alabama',
              awayTeam: 'Georgia',
              homeConference: 'SEC',
              awayConference: 'SEC',
              status: 'scheduled',
              seasonType: 'postseason',
              gamePhase: 'postseason',
              postseasonSubtype: 'bowl',
              label: 'Orange Bowl',
              eventKey: 'orange-bowl',
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
            { school: 'Alabama', level: 'FBS' },
            { school: 'Georgia', level: 'FBS' },
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
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (req.pathname === '/api/scores') {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'post-orange-bowl',
              week: 17,
              seasonType: 'postseason',
              startDate: '2025-12-28T01:00:00Z',
              status: 'final',
              home: { team: 'Alabama', score: 30 },
              away: { team: 'Georgia', score: 27 },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    throw new Error(`Unhandled fetch: ${req.pathname}`);
  });

  const req = new Request('http://localhost/api/debug/postseason-score-attachment?year=2025');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.upstream.postseasonScoreFetchOk, true);
  assert.equal(json.upstream.postseasonScoreRowCount, 1);
  assert.equal(Array.isArray(json.games), true);
  assert.equal(json.games[0].matchedNormalizedScore, true);
  assert.equal('homeCanonicalId' in json.games[0], true);
});
