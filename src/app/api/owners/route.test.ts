import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, PUT } from './route';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../lib/server/appStateStore.ts';
import { OWNER_ROSTER_OVERWRITE_ERROR } from '../../../lib/ownerRosterGuard.ts';
import type { League } from '../../../lib/league.ts';

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

test('owners route rejects commissioner writes without an admin token', async () => {
  const res = await PUT(
    new Request('http://localhost/api/owners?year=2026', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csvText: 'Team,Owner\nTexas,Alice' }),
    })
  );
  const payload = (await res.json()) as { error?: string; detail?: string };

  assert.equal(res.status, 401);
  assert.equal(payload.error, 'admin-token-required');
  assert.match(payload.detail ?? '', /requires an admin token/i);
});

test('owners route stores, reads, and clears shared csv state', async () => {
  const putRes = await PUT(
    new Request('http://localhost/api/owners?year=2026', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': 'test-admin-token',
      },
      body: JSON.stringify({ csvText: 'Team,Owner\nTexas,Alice' }),
    })
  );
  const putPayload = (await putRes.json()) as { year: number; csvText: string | null };

  assert.equal(putRes.status, 200);
  assert.equal(putPayload.year, 2026);
  assert.equal(putPayload.csvText, 'Team,Owner\nTexas,Alice');

  const getRes = await GET(new Request('http://localhost/api/owners?year=2026'));
  const getPayload = (await getRes.json()) as { year: number; csvText: string | null };

  assert.equal(getRes.status, 200);
  assert.equal(getPayload.year, 2026);
  assert.equal(getPayload.csvText, 'Team,Owner\nTexas,Alice');

  const clearRes = await PUT(
    new Request('http://localhost/api/owners?year=2026', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': 'test-admin-token',
      },
      body: JSON.stringify({ csvText: null }),
    })
  );
  const clearPayload = (await clearRes.json()) as { year: number; csvText: string | null };

  assert.equal(clearRes.status, 200);
  assert.equal(clearPayload.csvText, null);

  const afterClear = await GET(new Request('http://localhost/api/owners?year=2026'));
  const afterClearPayload = (await afterClear.json()) as { year: number; csvText: string | null };

  assert.equal(afterClear.status, 200);
  assert.equal(afterClearPayload.csvText, null);
});

// ---------------------------------------------------------------------------
// PLATFORM-083 — active-season owner-roster overwrite guard (league-scoped)
// ---------------------------------------------------------------------------

const GUARD_SLUG = 'tsc';
const GUARD_LEAGUE_YEAR = 2026;

async function seedGuardLeague(): Promise<void> {
  const league: League = {
    slug: GUARD_SLUG,
    displayName: 'Turf War',
    year: GUARD_LEAGUE_YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: GUARD_LEAGUE_YEAR },
  };
  await setAppState('leagues', 'registry', [league]);
}

function ownersPut(query: string, csvText: string | null): Promise<Response> {
  return PUT(
    new Request(`http://localhost/api/owners?${query}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ csvText }),
    })
  );
}

test('active-season initial roster creation succeeds without override', async () => {
  await seedGuardLeague();
  const res = await ownersPut(
    `league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`,
    'Team,Owner\nTexas,Alice'
  );
  assert.equal(res.status, 200);
});

test('active-season overwrite of a populated roster is rejected without override', async () => {
  await seedGuardLeague();
  // First write creates the roster (allowed — no existing populated roster).
  const first = await ownersPut(
    `league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`,
    'Team,Owner\nTexas,Alice'
  );
  assert.equal(first.status, 200);

  // Second write would overwrite it — must be rejected 409.
  const second = await ownersPut(
    `league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`,
    'Team,Owner\nAlabama,Bob'
  );
  const payload = (await second.json()) as { error?: string; message?: string };
  assert.equal(second.status, 409);
  assert.equal(payload.error, OWNER_ROSTER_OVERWRITE_ERROR);

  // The stored roster is unchanged by the rejected write.
  const getRes = await GET(
    new Request(`http://localhost/api/owners?league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`)
  );
  const getPayload = (await getRes.json()) as { csvText: string | null };
  assert.match(getPayload.csvText ?? '', /Texas,Alice/);
});

test('active-season overwrite succeeds with explicit override=1', async () => {
  await seedGuardLeague();
  await ownersPut(`league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`, 'Team,Owner\nTexas,Alice');

  const res = await ownersPut(
    `league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}&override=1`,
    'Team,Owner\nAlabama,Bob'
  );
  assert.equal(res.status, 200);

  const getRes = await GET(
    new Request(`http://localhost/api/owners?league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`)
  );
  const getPayload = (await getRes.json()) as { csvText: string | null };
  assert.match(getPayload.csvText ?? '', /Alabama,Bob/);
});

test('past/historical-season write over an existing roster is allowed without override', async () => {
  await seedGuardLeague();
  const pastYear = GUARD_LEAGUE_YEAR - 1;
  // Seed an existing populated roster for the past year.
  await setAppState(`owners:${GUARD_SLUG}:${pastYear}`, 'csv', 'Team,Owner\nTexas,Alice');

  const res = await ownersPut(`league=${GUARD_SLUG}&year=${pastYear}`, 'Team,Owner\nAlabama,Bob');
  assert.equal(res.status, 200, 'historical backfill is not gated');
});

test('active-season clear of a populated roster is rejected without override', async () => {
  await seedGuardLeague();
  await ownersPut(`league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`, 'Team,Owner\nTexas,Alice');

  const res = await ownersPut(`league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`, null);
  const payload = (await res.json()) as { error?: string };
  assert.equal(res.status, 409);
  assert.equal(payload.error, OWNER_ROSTER_OVERWRITE_ERROR);
});

test('active-season league-scoped write still requires admin auth', async () => {
  await seedGuardLeague();
  const res = await PUT(
    new Request(`http://localhost/api/owners?league=${GUARD_SLUG}&year=${GUARD_LEAGUE_YEAR}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csvText: 'Team,Owner\nTexas,Alice' }),
    })
  );
  assert.equal(res.status, 401);
});
