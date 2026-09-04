import assert from 'node:assert/strict';
import test from 'node:test';

import { __resetAppStateForTests, setAppState } from '@/lib/server/appStateStore';
import {
  PROVIDER_USAGE_SERIES_KEY,
  PROVIDER_USAGE_SERIES_SCOPE,
  readProviderUsageSeries,
} from '@/lib/server/providerUsageSeries';

import { GET } from '../route';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_KEY = process.env.CFBD_API_KEY;

// `__resetAppStateForTests` clears pools and test seams but NOT the backing
// file, so durable rows survive between tests in this file. Clear the series
// explicitly or each test inherits the previous one's samples.
async function reset(): Promise<void> {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env.CRON_SECRET = 'test-secret';
  process.env.CFBD_API_KEY = 'test-key';
  __resetAppStateForTests();
  await setAppState(PROVIDER_USAGE_SERIES_SCOPE, PROVIDER_USAGE_SERIES_KEY, { samples: [] });
}

function authed(): Request {
  return new Request('https://turfwar.games/api/cron/usage-sample', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

function stubInfo(body: unknown, seen?: string[]): void {
  globalThis.fetch = (async (input: URL | string) => {
    seen?.push(typeof input === 'string' ? input : input.toString());
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('an authenticated run records one sample from /info', async () => {
  await reset();
  const seen: string[] = [];
  stubInfo({ patronLevel: 1, remainingCalls: 4600 }, seen);

  const res = await GET(authed());
  const body = (await res.json()) as { recorded: boolean; day: string | null };

  assert.equal(res.status, 200);
  assert.equal(body.recorded, true);
  assert.equal(seen.length, 1, 'exactly one outbound request — the unbilled /info probe');
  assert.match(seen[0]!, /\/info/, 'and it is the info endpoint, not a billed dataset call');

  const series = await readProviderUsageSeries();
  assert.equal(series.samples.length, 1);
  assert.equal(series.samples[0]?.remaining, 4600);
  assert.equal(series.samples[0]?.limit, 5000, 'Tier 1 resolves the canonical limit');
  assert.equal(series.samples[0]?.used, 400, 'used is derived as limit − remaining');
  assert.equal(series.samples[0]?.day, body.day);
});

test('it is UNGATED — no season, target, or league state can suppress the sample', async () => {
  // The whole reason this route exists rather than riding an existing cron. The
  // durable store is empty: no leagues, no schedule, no polling target, no
  // season context. Every other observation point in the app would produce
  // nothing here.
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 123 });

  const res = await GET(authed());

  assert.equal(res.status, 200);
  assert.equal((await res.json()).recorded, true, 'a sample is taken with no app state at all');
  assert.equal((await readProviderUsageSeries()).samples[0]?.remaining, 123);
});

test('an unauthenticated request records nothing and never calls the provider', async () => {
  await reset();
  const seen: string[] = [];
  stubInfo({ patronLevel: 1, remainingCalls: 4600 }, seen);

  const res = await GET(new Request('https://turfwar.games/api/cron/usage-sample'));

  assert.equal(res.status, 401);
  assert.equal(seen.length, 0, 'no outbound request before authentication');
  assert.equal((await readProviderUsageSeries()).samples.length, 0);
});

test('an unreachable provider still records a truthful all-null observation', async () => {
  // "We looked and got nothing" is a fact worth keeping — a GAP and a NULL are
  // different claims, and only one of them says the sampler ran.
  await reset();
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  const res = await GET(authed());

  assert.equal(res.status, 200, 'observation-only: a provider outage is not a cron failure');
  const series = await readProviderUsageSeries();
  assert.equal(series.samples.length, 1, 'the attempt is still recorded');
  assert.equal(series.samples[0]?.remaining, null, 'and it is null, never coerced to 0');
});

test('a later failed probe cannot destroy an earlier usable reading for the same day', async () => {
  // The end-to-end form of preferSample: six-hourly sampling means several
  // observations land on one day, and one bad one must not erase a good one.
  await reset();
  stubInfo({ patronLevel: 1, remainingCalls: 4600 });
  await GET(authed());

  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  await GET(authed());

  const series = await readProviderUsageSeries();
  assert.equal(series.samples.length, 1, 'still one entry for the day');
  assert.equal(series.samples[0]?.remaining, 4600, 'the usable reading survived');
});

test('teardown restores globals', () => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_KEY === undefined) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = ORIGINAL_KEY;
  assert.ok(true);
});
