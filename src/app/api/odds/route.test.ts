import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  getLatestKnownOddsUsage,
} from '@/lib/server/oddsUsageStore';

import { GET } from './route';

test.beforeEach(async () => {
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
  process.env.ODDS_API_KEY = 'test-key';
});

test('402 with valid usage headers persists authoritative header-derived snapshot', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ message: 'payment required' }), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'x-requests-used': '500',
        'x-requests-remaining': '0',
        'x-requests-last': '3',
      },
    })) as typeof fetch;

  try {
    const res = await GET(new Request('http://localhost/api/odds?markets=h2h,spreads'));
    assert.equal(res.status, 402);

    const usage = await getLatestKnownOddsUsage();
    assert.equal(usage?.source, 'odds-response-headers');
    assert.equal(usage?.remaining, 0);
    assert.equal(usage?.lastCost, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('429 without usable usage headers persists fallback-labeled depleted snapshot', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ message: 'too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
      },
    })) as typeof fetch;

  try {
    const res = await GET(new Request('http://localhost/api/odds?markets=totals'));
    assert.equal(res.status, 429);

    const usage = await getLatestKnownOddsUsage();
    assert.equal(usage?.source, 'quota-error-fallback');
    assert.equal(usage?.remaining, 0);
    assert.equal(usage?.limit, 500);
  } finally {
    global.fetch = originalFetch;
  }
});
