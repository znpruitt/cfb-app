import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, PUT } from './route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../lib/server/appStateStore.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = 'test-admin-token';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) {
    delete process.env.ADMIN_API_TOKEN;
  } else {
    MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  }
});

test('postseason overrides route rejects commissioner writes without an admin token', async () => {
  const res = await PUT(
    new Request('http://localhost/api/postseason-overrides?year=2026', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        map: {
          '2026-cfp-final': { homeTeam: 'Texas', awayTeam: 'Georgia' },
        },
      }),
    })
  );
  const payload = (await res.json()) as { error?: string; detail?: string };

  assert.equal(res.status, 401);
  assert.equal(payload.error, 'admin-token-required');
  assert.match(payload.detail ?? '', /requires an admin token/i);
});

test('postseason overrides route stores, reads, and clears shared override state', async () => {
  const map = {
    '2026-cfp-final': {
      homeTeam: 'Texas',
      awayTeam: 'Georgia',
      notes: 'Manual neutral-site repair',
    },
  };

  const putRes = await PUT(
    new Request('http://localhost/api/postseason-overrides?year=2026', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': 'test-admin-token',
      },
      body: JSON.stringify({ map }),
    })
  );
  const putPayload = (await putRes.json()) as { year: number; map: typeof map };

  assert.equal(putRes.status, 200);
  assert.equal(putPayload.year, 2026);
  assert.deepEqual(putPayload.map, map);

  const getRes = await GET(new Request('http://localhost/api/postseason-overrides?year=2026'));
  const getPayload = (await getRes.json()) as { year: number; map: typeof map };

  assert.equal(getRes.status, 200);
  assert.equal(getPayload.year, 2026);
  assert.deepEqual(getPayload.map, map);

  const clearRes = await PUT(
    new Request('http://localhost/api/postseason-overrides?year=2026', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': 'test-admin-token',
      },
      body: JSON.stringify({ map: null }),
    })
  );
  const clearPayload = (await clearRes.json()) as { year: number; map: Record<string, never> };

  assert.equal(clearRes.status, 200);
  assert.deepEqual(clearPayload.map, {});

  const afterClear = await GET(new Request('http://localhost/api/postseason-overrides?year=2026'));
  const afterClearPayload = (await afterClear.json()) as {
    year: number;
    map: Record<string, never>;
  };

  assert.equal(afterClear.status, 200);
  assert.deepEqual(afterClearPayload.map, {});
});
