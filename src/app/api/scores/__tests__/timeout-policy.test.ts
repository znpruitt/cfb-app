import assert from 'node:assert/strict';
import test from 'node:test';

import { __deleteAppStateFileForTests, __resetAppStateForTests } from '@/lib/server/appStateStore';
import { delayedJsonResponse, withCompressedTimeouts } from '@/test/compressedTimeout';

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

test('manual scores refresh retains its three 12s attempts instead of adopting the cron ceiling', async () => {
  let billedCalls = 0;

  await withCompressedTimeouts(async (nativeSetTimeout) => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      billedCalls += 1;
      return delayedJsonResponse({
        payload: [],
        delayMs: 25,
        init,
        nativeSetTimeout,
      });
    }) as typeof fetch;

    const res = await GET(
      new Request('http://localhost/api/scores?year=2026&week=3&seasonType=regular&refresh=1')
    );

    assert.equal(res.status, 502);
    assert.equal(billedCalls, 3, 'the existing manual retry policy remains unchanged');
  });
});
