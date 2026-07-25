import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';

type MockFetch = typeof fetch;

function setMockFetch(impl: unknown) {
  global.fetch = impl as MockFetch;
}

// PLATFORM-086H3C5: the eligibility diagnostic must report the CACHED schedule
// row's numeric participant ids, not hard-coded nulls — after the post-deploy
// refreshes populate ids, a null here would falsely claim the cache lacks them
// and undermine the participant-id rollout verification. Rows persisted before
// id persistence (no properties) still truthfully read null.
test('PLATFORM-086H3C5: upstream participant ids pass through from the cached rows; id-less rows stay null', async () => {
  setMockFetch(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);
    if (req.pathname === '/api/schedule') {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: '910001',
              week: 3,
              startDate: '2025-09-06T16:00:00Z',
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Alpha State',
              awayTeam: 'Beta Tech',
              homeId: 101,
              awayId: 202,
              homeConference: 'Sun Belt',
              awayConference: 'ACC',
              status: 'final',
              seasonType: 'regular',
              gamePhase: 'regular',
            },
            {
              // Pre-C5 cached row: no id properties at all.
              id: '910002',
              week: 3,
              startDate: '2025-09-06T16:00:00Z',
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Gamma A&M',
              awayTeam: 'Delta University',
              homeConference: 'SEC',
              awayConference: 'Big Ten',
              status: 'final',
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
            { school: 'Alpha State', level: 'FBS', conference: 'Sun Belt' },
            { school: 'Beta Tech', level: 'FBS', conference: 'ACC' },
            { school: 'Gamma A&M', level: 'FBS', conference: 'SEC' },
            { school: 'Delta University', level: 'FBS', conference: 'Big Ten' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (req.pathname === '/api/aliases') {
      return new Response(JSON.stringify({ scope: 'effective', map: {} }), {
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

  const res = await GET(
    new Request('http://localhost/api/debug/schedule-eligibility?year=2025&week=3')
  );
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.analyzed.length, 2);

  const withIds = json.analyzed.find((row: { id: string }) => row.id === '910001');
  assert.ok(withIds);
  assert.equal(withIds.upstream.homeId, 101);
  assert.equal(withIds.upstream.awayId, 202);
  assert.equal(withIds.upstream.homeName, 'Alpha State');

  const withoutIds = json.analyzed.find((row: { id: string }) => row.id === '910002');
  assert.ok(withoutIds);
  assert.equal(withoutIds.upstream.homeId, null);
  assert.equal(withoutIds.upstream.awayId, null);
});
