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
  // PLATFORM-076: the postseason debug index/output exposes providerWeek so a
  // score under the provider week reconciles with the canonical-week game.
  assert.equal(json.games[0].providerWeek, 17, 'provider week is surfaced in the output');
});

test('PLATFORM-076: resolves aliases through the effective (global>year>SEED) scope', async () => {
  const aliasUrls: string[] = [];
  setMockFetch(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);
    if (req.pathname === '/api/aliases') {
      aliasUrls.push(url);
      return new Response(JSON.stringify({ scope: 'effective', map: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Minimal context for the rest of the pipeline.
    if (
      req.pathname === '/api/schedule' ||
      req.pathname === '/api/teams' ||
      req.pathname === '/api/conferences' ||
      req.pathname === '/api/scores'
    ) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unhandled fetch: ${req.pathname}`);
  });

  const res = await GET(
    new Request('http://localhost/api/debug/postseason-score-attachment?year=2025')
  );
  assert.equal(res.status, 200);
  assert.equal(aliasUrls.length, 1, 'the alias map is fetched once via the shared loader');
  assert.match(
    aliasUrls[0]!,
    /[?&]scope=effective(&|$)/,
    'debug diagnostics must resolve against the effective alias precedence'
  );
});

test('PLATFORM-075: forwards refresh=1 and the admin credential to the scores sub-request', async () => {
  let scoresUrl: string | null = null;
  let scoresToken: string | null = null;
  setMockFetch(async (input: URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);
    if (req.pathname === '/api/scores') {
      scoresUrl = url;
      scoresToken = new Headers(init?.headers).get('x-admin-token');
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Minimal season context for the rest of the pipeline.
    if (req.pathname === '/api/schedule' || req.pathname === '/api/teams') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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
    throw new Error(`Unhandled fetch: ${req.pathname}`);
  });

  const req = new Request('http://localhost/api/debug/postseason-score-attachment?year=2025', {
    headers: { 'x-admin-token': 'diag-token' },
  });
  const res = await GET(req);
  assert.equal(res.status, 200);
  assert.ok(scoresUrl, 'the debug route must request scores');
  assert.match(String(scoresUrl), /[?&]refresh=1(&|$)/);
  assert.equal(scoresToken, 'diag-token', 'the admin credential must be forwarded');
});
