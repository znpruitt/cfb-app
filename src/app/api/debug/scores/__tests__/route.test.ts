import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

// PLATFORM-076: debug/scores must build its canonical schedule via the shared
// loader — fetching the CFBD conference records (required for correct
// subdivision/eligibility) and the EFFECTIVE alias map — instead of inlining
// its own fetches and omitting conferences.
test('PLATFORM-076: debug/scores loads conferences + effective aliases via the shared loader', async () => {
  const seen = new Set<string>();
  let aliasUrl: string | null = null;
  setMockFetch(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);
    seen.add(req.pathname);
    if (req.pathname === '/api/aliases') {
      aliasUrl = url;
      return new Response(JSON.stringify({ scope: 'effective', map: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
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

  const res = await GET(new Request('http://localhost/api/debug/scores?year=2025'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(seen.has('/api/conferences'), 'conference records must be loaded for parity');
  assert.match(
    String(aliasUrl),
    /[?&]scope=effective(&|$)/,
    'aliases resolved via effective scope'
  );
  assert.equal(json.canonicalGamesTotal, 0);
  assert.equal(json.gamesTruncated, false, 'no truncation when the canonical set fits the cap');
});
