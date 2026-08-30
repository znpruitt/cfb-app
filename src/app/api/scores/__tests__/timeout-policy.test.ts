import assert from 'node:assert/strict';
import test from 'node:test';

import type { CacheEntry } from '@/lib/scores/cache';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import { installDelayedCfbdProvider, withCompressedTimeouts } from '@/test/compressedTimeout';

import { GET } from '../route';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_FETCH = globalThis.fetch;

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manual scores refresh uses one longer attempt for 25s-equivalent provider latency', async () => {
  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [],
      providerDelayMs: 25_000,
      nativeSetTimeout,
    });

    const res = await GET(
      new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
    );

    assert.equal(res.status, 200);
    assert.deepEqual(provider.billedPaths(), ['/games']);
  });
});

test('manual scores timeout uses one billed attempt and retains prior-good data', async () => {
  const priorGood: CacheEntry = {
    at: 1_000,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: '401001',
        week: 3,
        status: 'Q2 05:00',
        startDate: null,
        home: { team: 'Alabama', score: 14 },
        away: { team: 'Georgia', score: 7 },
        time: null,
      },
    ],
  };
  await setAppState('scores', '2026-3-regular', priorGood);

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    const provider = installDelayedCfbdProvider({
      payload: [],
      providerDelayMs: 50_000,
      nativeSetTimeout,
    });

    const res = await GET(
      new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
    );
    const body = (await res.json()) as {
      metadata?: { cfbdFallbackReason?: string };
    };

    assert.equal(res.status, 502);
    assert.equal(body.metadata?.cfbdFallbackReason, 'cfbd-timeout');
    assert.deepEqual(provider.billedPaths(), ['/games']);
  });

  const stored = await getAppState<CacheEntry>('scores', '2026-3-regular');
  assert.deepEqual(stored?.value, priorGood);
});
