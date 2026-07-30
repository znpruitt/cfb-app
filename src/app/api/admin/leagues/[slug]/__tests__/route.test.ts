import assert from 'node:assert/strict';
import test from 'node:test';

import { PATCH } from '../route';
import type { League } from '../../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../../../lib/server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the league-configuration PATCH is no longer a competing
// year authority: a body containing `year` (or `status`) is rejected with a
// stable 409 and writes nothing; display-name/founded-year editing stays green.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function makeLeague(slug: string): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2024,
    createdAt: '2022-01-01T00:00:00.000Z',
    foundedYear: 2010,
    status: { state: 'season', year: 2024 },
  };
}

function patchRequest(
  slug: string,
  body: unknown
): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`https://example.com/api/admin/leagues/${slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
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

test('PATCH with year → 409 league-year-lifecycle-managed and writes nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = await readRegistry();

  const [req, ctx] = patchRequest('alpha', { year: 2030 });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string; detail?: string };
  assert.equal(body.error, 'league-year-lifecycle-managed');
  assert.equal(body.detail, 'Season year is managed through league lifecycle operations.');

  assert.deepEqual(await readRegistry(), before, 'no field silently applied');
});

test('PATCH mixing year with valid fields is still rejected wholesale', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = await readRegistry();

  const [req, ctx] = patchRequest('alpha', { displayName: 'New Name', year: 2030 });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 409);

  assert.deepEqual(await readRegistry(), before, 'displayName not applied alongside rejection');
});

test('PATCH with status → 409 league-status-lifecycle-managed and writes nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = await readRegistry();

  const [req, ctx] = patchRequest('alpha', { status: { state: 'offseason' } });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, 'league-status-lifecycle-managed');

  assert.deepEqual(await readRegistry(), before);
});

test('display-name and founded-year editing remain green', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);

  const [req, ctx] = patchRequest('alpha', { displayName: 'Renamed', foundedYear: 2005 });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { league: League };
  assert.equal(body.league.displayName, 'Renamed');
  assert.equal(body.league.foundedYear, 2005);

  const stored = (await readRegistry())[0]!;
  assert.equal(stored.displayName, 'Renamed');
  assert.equal(stored.foundedYear, 2005);
  assert.equal(stored.year, 2024, 'lifecycle year untouched');
  assert.deepEqual(stored.status, { state: 'season', year: 2024 });
});

test('PATCH with no updatable fields → 400 naming the allowed fields', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);

  const [req, ctx] = patchRequest('alpha', {});
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /displayName, foundedYear/);
});
