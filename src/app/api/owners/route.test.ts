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

test('the overwrite guard follows the LIFECYCLE year, not the registry year', async () => {
  // PLATFORM-099. `/admin/{slug}/roster` resolves the season it edits with
  // `resolveLeagueOperatingYear` (status.year), while this guard classified
  // "historical" by the registry's top-level `year`. On a legacy record where
  // the two have drifted with `status.year` BELOW `league.year`, every save from
  // that page fell into the `year < league.year` historical/backfill branch — so
  // the 409 never fired and an accidental save silently clobbered a populated
  // active-season roster, defeating AGENTS.md invariant 12.
  const desynchronized: League = {
    slug: GUARD_SLUG,
    displayName: 'Turf War',
    // The drift the registry warns is reachable on legacy records: a stale
    // top-level year ABOVE the lifecycle year.
    year: 2026,
    createdAt: '2025-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2025 },
  };
  await setAppState('leagues', 'registry', [desynchronized]);

  const first = await ownersPut(`league=${GUARD_SLUG}&year=2025`, 'Team,Owner\nTexas,Alice');
  assert.equal(first.status, 200, 'initial creation is unguarded');

  const second = await ownersPut(`league=${GUARD_SLUG}&year=2025`, 'Team,Owner\nAlabama,Bob');
  const payload = (await second.json()) as { error?: string };
  assert.equal(second.status, 409, 'the season the league is OPERATING in is guarded');
  assert.equal(payload.error, OWNER_ROSTER_OVERWRITE_ERROR);

  // The roster the rejected write targeted is untouched.
  const getRes = await GET(
    new Request(`http://localhost/api/owners?league=${GUARD_SLUG}&year=2025`, {
      headers: { 'x-admin-token': 'test-admin-token' },
    })
  );
  const body = (await getRes.json()) as { csvText: string | null };
  assert.match(body.csvText ?? '', /Alice/);
  assert.doesNotMatch(body.csvText ?? '', /Bob/);
});

test('a genuinely PAST season stays unguarded on the same record', async () => {
  // The positive control. If the guard now fired on every year the test above
  // would pass for the wrong reason, and historical/backfill imports — which
  // AGENTS.md invariant 12 keeps deliberately unguarded — would start 409ing.
  const desynchronized: League = {
    slug: GUARD_SLUG,
    displayName: 'Turf War',
    year: 2026,
    createdAt: '2025-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2025 },
  };
  await setAppState('leagues', 'registry', [desynchronized]);

  assert.equal(
    (await ownersPut(`league=${GUARD_SLUG}&year=2024`, 'Team,Owner\nTexas,Alice')).status,
    200
  );
  assert.equal(
    (await ownersPut(`league=${GUARD_SLUG}&year=2024`, 'Team,Owner\nAlabama,Bob')).status,
    200
  );
});

test('the OPPOSITE drift loosens only genuinely past seasons', async () => {
  // PLATFORM-099, code-review finding: the guard fix is asymmetric, and only the
  // tightening direction was pinned. When `league.year` sits BELOW `status.year`,
  // a write to `league.year` previously evaluated `2025 < 2025` -> guarded and
  // now evaluates `2025 < 2026` -> historical, so the 409 stops firing.
  //
  // That is the CORRECT classification — 2025 is genuinely past for a league
  // operating in 2026 — but it is a behaviour change on legacy records, and an
  // unstated loosening is how a guard quietly stops guarding. Verified at the
  // HTTP surface against `main` before being written down: `main` returns 409
  // here and 200 for the operating season; this branch is the reverse.
  const drifted: League = {
    slug: GUARD_SLUG,
    displayName: 'Turf War',
    year: 2025,
    createdAt: '2025-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: 2026 },
  };
  await setAppState('leagues', 'registry', [drifted]);

  // The season the league is OPERATING in stays guarded.
  assert.equal(
    (await ownersPut(`league=${GUARD_SLUG}&year=2026`, 'Team,Owner\nTexas,Alice')).status,
    200
  );
  assert.equal(
    (await ownersPut(`league=${GUARD_SLUG}&year=2026`, 'Team,Owner\nAlabama,Bob')).status,
    409,
    'the operating season is protected regardless of the stale top-level year'
  );

  // A genuinely past season is not — and this is the branch that changed.
  assert.equal(
    (await ownersPut(`league=${GUARD_SLUG}&year=2025`, 'Team,Owner\nTexas,Alice')).status,
    200
  );
  assert.equal(
    (await ownersPut(`league=${GUARD_SLUG}&year=2025`, 'Team,Owner\nAlabama,Bob')).status,
    200,
    'past-season backfill stays unguarded, as AGENTS.md invariant 12 intends'
  );
});
