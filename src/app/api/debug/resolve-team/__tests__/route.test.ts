import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

// PLATFORM-076: resolve-team must resolve against the EFFECTIVE alias map
// (stored global > year > SEED_ALIASES) — the same precedence production uses —
// not the year-only stored subset. It also surfaces the manual alias override
// and the observed names that seeded the resolver so the diagnostic is
// trustworthy.
test('PLATFORM-076: resolve-team uses the effective alias scope and reports the manual override', async () => {
  let aliasUrl: string | null = null;
  setMockFetch(async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    const req = new URL(url);
    if (req.pathname === '/api/teams') {
      return new Response(JSON.stringify({ items: [{ school: 'Mississippi', level: 'FBS' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (req.pathname === '/api/aliases') {
      aliasUrl = url;
      // An alias that lives in the effective (global/SEED) layer, not the
      // year-only stored map.
      return new Response(
        JSON.stringify({ scope: 'effective', map: { 'ole miss': 'Mississippi' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
    throw new Error(`Unhandled fetch: ${req.pathname}`);
  });

  const res = await GET(
    new Request('http://localhost/api/debug/resolve-team?name=Ole%20Miss&year=2025')
  );
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(aliasUrl, 'the alias map must be fetched');
  assert.match(
    String(aliasUrl),
    /[?&]scope=effective(&|$)/,
    'resolve-team must request the effective alias scope'
  );
  assert.equal(json.aliasScope, 'effective');
  // The name resolves only because the effective-layer alias is present; without
  // scope=effective (year-only map) this would be unresolved.
  assert.equal(json.canonicalMatch, true, 'the effective-layer alias resolves the name');
  assert.equal(json.canonicalId, 'mississippi');
  // The manual override is surfaced off the effective map regardless of whether
  // the resolver classifies the baked-in alias entry as canonical vs alias.
  assert.ok(json.manualAliasOverride, 'the manual alias override is surfaced');
  assert.equal(json.manualAliasOverride.to, 'Mississippi');
  assert.deepEqual(json.observedNames, ['Ole Miss']);
});
