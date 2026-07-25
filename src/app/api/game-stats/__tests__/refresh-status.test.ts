import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../lib/gameStats/cache.ts';
import { seedActiveWriterControl } from '../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import { wireGame } from '../../../../lib/gameStats/__tests__/fixtures.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../lib/providerRefreshScope.ts';

// PLATFORM-086H3E3 — the activated manual-refresh contract: admin-first,
// attempt-before-credentials, quota gate with explicit quotaOverride, the ONE
// ingestion path + interpreter, and a durable-reread response.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
};
const ORIGINAL_FETCH = globalThis.fetch;
const ADMIN_TOKEN = 'test-admin-token';

function adminRefresh(extra = ''): Request {
  return new Request(
    `https://example.com/api/game-stats?year=2026&week=3&seasonType=regular&bypassCache=1${extra}`,
    { headers: { 'x-admin-token': ADMIN_TOKEN } }
  );
}

/** Stub CFBD: /info serves healthy usage; /games/teams serves `payload`. */
function stubProvider(payload: unknown, usage: unknown = { patronLevel: 1, remainingCalls: 4000 }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/info') ? usage : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test.beforeEach(async () => {
  // Env first: a prior test may have left NODE_ENV=production, under which the
  // file-fallback store (rightly) refuses.
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  // The activated world: H2 is the only writer, permitted only under `active`.
  await seedActiveWriterControl();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL.ADMIN_API_TOKEN;
  if (ORIGINAL.CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL.CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

test('auth precedes validation: an unauthenticated MALFORMED request fails auth first', async () => {
  delete MUTABLE_ENV.ADMIN_API_TOKEN;
  MUTABLE_ENV.NODE_ENV = 'production';
  const res = await GET(new Request('https://example.com/api/game-stats?year=abc&week=-1'));
  assert.equal(res.status, 401);
});

test('strict seasonType: any present value outside the two partitions is rejected', async () => {
  const res = await GET(
    new Request('https://example.com/api/game-stats?year=2026&week=3&seasonType=preseason', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { field?: string };
  assert.equal(body.field, 'seasonType');
});

test('missing usage WITHOUT quotaOverride refuses 429 and resolves the attempt as failed', async () => {
  // No CFBD key → the usage probe itself cannot run → usage-unavailable.
  delete MUTABLE_ENV.CFBD_API_KEY;

  const res = await GET(adminRefresh());
  assert.equal(res.status, 429);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-quota-usage-unavailable');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed', 'the quota refusal resolves the attempt');
  assert.equal(status.lastError?.code, 'game-stats-quota-usage-unavailable');
});

test('missing CFBD key WITH quotaOverride reaches the credential check and records the failure', async () => {
  delete MUTABLE_ENV.CFBD_API_KEY;

  const res = await GET(adminRefresh('&quotaOverride=1'));
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'CFBD_API_KEY not configured');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

test('below-reserve usage refuses 429 unless the explicit override is supplied', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider([], { patronLevel: 1, remainingCalls: 900 });

  const refused = await GET(adminRefresh());
  assert.equal(refused.status, 429);
  assert.equal(
    ((await refused.json()) as { code?: string }).code,
    'game-stats-quota-below-reserve'
  );

  // The explicit second parameter proceeds — and the empty payload is a no-op.
  const overridden = await GET(adminRefresh('&quotaOverride=1'));
  assert.equal(overridden.status, 200);
  const body = (await overridden.json()) as {
    refresh: { outcome: string; reason: string; quotaOverride: boolean };
  };
  assert.equal(body.refresh.outcome, 'no-op');
  assert.equal(body.refresh.quotaOverride, true);
});

test('a genuinely empty provider response is a no-op: no durable write, truthful reread', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider([]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    refresh: { outcome: string; reason: string };
    durable: { status: string };
  };
  assert.equal(body.refresh.outcome, 'no-op');
  assert.equal(body.refresh.reason, 'empty-response');
  assert.equal(body.durable.status, 'absent', 'the reread truthfully reports absence');

  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'no empty record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null);
});

test('a payload with no persistable observations fails (prior-good preserved, no write)', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  // A row missing its away team parses to nothing persistable.
  stubProvider([{ id: 5001, teams: [{ team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] }]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 502);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-no-persistable-observations');

  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'nothing written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-no-persistable-observations');
});

test('a persistable payload commits through H2 and records success from the confirmed commit', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider([
    wireGame({
      id: 5001,
      home: { school: 'Alpha State', teamId: 101 },
      away: { school: 'Beta Tech', teamId: 202 },
    }),
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { refresh: { outcome: string; reason: string } };
  assert.equal(body.refresh.outcome, 'success');
  assert.equal(body.refresh.reason, 'written-clean');

  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the durable partition holds the merged row');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
});

test('while control is NOT active, H2 refuses and the refresh is a truthful 503 failure', async () => {
  const { seedLegacyWriterControl } = await import(
    '../../../../lib/gameStats/__tests__/writerControlSeed.ts'
  );
  await seedLegacyWriterControl();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider([
    wireGame({
      id: 5001,
      home: { school: 'Alpha State', teamId: 101 },
      away: { school: 'Beta Tech', teamId: 202 },
    }),
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 503);
  const body = (await res.json()) as { code?: string; durable?: { status?: string } };
  assert.equal(body.code, 'game-stats-unavailable');
  // Even FAILURE responses carry the projected durable reread — the caller
  // sees the exact durable partition, never an assumed merge result.
  assert.equal(body.durable?.status, 'absent');
  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'both writers refused');
});

test('the flag grammar is EXACTLY =1: loose spellings neither refresh nor override', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  let providerCalled = false;
  globalThis.fetch = (async () => {
    providerCalled = true;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  // bypassCache=true is NOT a refresh — it is an ordinary cache-only read.
  const looseBypass = await GET(
    new Request(
      'https://example.com/api/game-stats?year=2026&week=3&seasonType=regular&bypassCache=true',
      { headers: { 'x-admin-token': ADMIN_TOKEN } }
    )
  );
  assert.equal(looseBypass.status, 404, 'ordinary-read absence, not a refresh');
  assert.equal(providerCalled, false);

  // quotaOverride=yes does NOT bypass the reserve (usage unknowable here).
  delete MUTABLE_ENV.CFBD_API_KEY;
  const looseOverride = await GET(adminRefresh('&quotaOverride=yes'));
  assert.equal(looseOverride.status, 429);
});

test('an ordinary read is cache-only and provider-free even when the cache is absent', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  let providerCalled = false;
  globalThis.fetch = (async () => {
    providerCalled = true;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const res = await GET(
    new Request('https://example.com/api/game-stats?year=2026&week=3&seasonType=regular', {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    })
  );
  assert.equal(res.status, 404, 'absence is a distinct outcome, never a provider trigger');
  assert.equal(providerCalled, false, 'no provider attempt for an ordinary read');
});
