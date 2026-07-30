import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
} from '../../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — new leagues are born with an explicit lifecycle status:
// creation persists a synchronized `year` + `status: { state:'season', year }`
// in the same registry record, so no new missing-status league can exist.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function createRequest(body: unknown): Request {
  return new Request('https://example.com/api/admin/leagues', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
});

test('league creation persists synchronized year and status in one record', async () => {
  const res = await POST(
    createRequest({ slug: 'my-league', displayName: 'My League', year: 2026 })
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { league: League };
  assert.equal(body.league.year, 2026);
  assert.deepEqual(body.league.status, { state: 'season', year: 2026 });

  const record = await getAppState<League[]>('leagues', 'registry');
  const stored = record?.value?.[0];
  assert.equal(stored?.year, 2026);
  assert.deepEqual(stored?.status, { state: 'season', year: 2026 });
});
