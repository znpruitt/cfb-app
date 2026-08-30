import assert from 'node:assert/strict';
import test from 'node:test';

import { __deleteAppStateFileForTests, __resetAppStateForTests } from '@/lib/server/appStateStore';
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
    assert.deepEqual(
      provider.billedUrls().map((url) => new URL(url).pathname),
      ['/games']
    );
  });
});
