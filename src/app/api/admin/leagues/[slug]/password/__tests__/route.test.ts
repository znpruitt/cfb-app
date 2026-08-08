import assert from 'node:assert/strict';
import test from 'node:test';

import { DELETE, PUT } from '../route';
import { PUT as OWNERS_PUT } from '../../../../../owners/route';
import type { League } from '../../../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../../../../lib/server/appStateStore.ts';
import {
  createLeagueAuthCookie,
  leagueAuthCookieName,
  verifyLeagueAuthCookie,
} from '../../../../../../../lib/leagueAuth.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2J — the league-password route had NO tests, and it defines the
// only non-admin credential in the application.
//
// The claim this file exists to pin is the BOUNDARY: a league password grants
// READS and never authorizes a mutation. That claim was previously supported
// only by reading the routes, and it is the foundation a future commissioner
// account system would be built on — if a later change lets the league cookie
// reach a write, this suite must fail.
//
// Every refusal below is paired with a success. A suite of refusals alone passes
// just as well against a route that rejects everyone.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token';
const LEAGUE_PASSWORD = 'a-strong-password';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const ORIGINAL_LEAGUE_AUTH_SECRET = process.env.LEAGUE_AUTH_SECRET;

function makeLeague(slug: string): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2024,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'season', year: 2024 },
  };
}

function passwordRequest(
  slug: string,
  body: unknown,
  token: string | null = ADMIN_TOKEN
): [Request, { params: Promise<{ slug: string }> }] {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return [
    new Request(`https://example.com/api/admin/leagues/${slug}/password`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

function deleteRequest(
  slug: string,
  token: string | null = ADMIN_TOKEN
): [Request, { params: Promise<{ slug: string }> }] {
  const headers: Record<string, string> = {};
  if (token) headers['x-admin-token'] = token;
  return [
    new Request(`https://example.com/api/admin/leagues/${slug}/password`, {
      method: 'DELETE',
      headers,
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

async function readLeague(slug: string): Promise<League | undefined> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value?.find((l) => l.slug === slug);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  MUTABLE_ENV.LEAGUE_AUTH_SECRET = 'test-league-auth-secret-value';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  if (ORIGINAL_LEAGUE_AUTH_SECRET === undefined) delete MUTABLE_ENV.LEAGUE_AUTH_SECRET;
  else MUTABLE_ENV.LEAGUE_AUTH_SECRET = ORIGINAL_LEAGUE_AUTH_SECRET;
});

// -- Who may set it ----------------------------------------------------------

test('an authorized PUT stores a hash and salt, and never the plaintext', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);

  const res = await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }));
  assert.equal(res.status, 200);

  const stored = await readLeague('alpha');
  assert.ok(stored?.passwordHash, 'a hash is persisted');
  assert.ok(stored?.passwordSalt, 'with its salt');
  assert.ok(
    !JSON.stringify(stored).includes(LEAGUE_PASSWORD),
    'the plaintext appears nowhere in the stored record'
  );
  assert.ok(
    !JSON.stringify(await res.json()).includes(LEAGUE_PASSWORD),
    'and is not echoed in the response'
  );
});

test('an authorized DELETE clears both the hash and the salt', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }));
  assert.ok((await readLeague('alpha'))?.passwordHash, 'armed');

  const res = await DELETE(...deleteRequest('alpha'));

  assert.equal(res.status, 200);
  const stored = await readLeague('alpha');
  assert.ok(!stored?.passwordHash, 'hash cleared');
  assert.ok(!stored?.passwordSalt, 'salt cleared too — a salt without a hash is debris');
});

test('an unauthorized PUT is refused and writes nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = JSON.stringify(await readLeague('alpha'));

  const res = await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }, null));

  assert.equal(res.status, 401);
  assert.equal(JSON.stringify(await readLeague('alpha')), before);
});

test('an unauthorized DELETE is refused and writes nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }));
  const before = JSON.stringify(await readLeague('alpha'));

  const res = await DELETE(...deleteRequest('alpha', null));

  assert.equal(res.status, 401);
  assert.equal(JSON.stringify(await readLeague('alpha')), before, 'the password survives');
});

// A hash with no signing secret would lock everyone out: no valid cookie could
// ever be minted to match it. The route refuses rather than persisting one.
test('a missing signing secret refuses with 503 and leaves the registry byte-identical', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = JSON.stringify(await readLeague('alpha'));
  delete MUTABLE_ENV.LEAGUE_AUTH_SECRET;

  const res = await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }));

  assert.equal(res.status, 503);
  assert.equal(JSON.stringify(await readLeague('alpha')), before, 'no unusable hash persisted');
});

// -- THE BOUNDARY ------------------------------------------------------------
//
// Four steps, because the middle assertion is worthless without the outer two:
// an arbitrary bad cookie would also be refused by a write, and a fixture that
// cannot perform the write either way proves nothing.

test('the credential this suite uses is genuinely VALID', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }));

  const cookie = await createLeagueAuthCookie('alpha');
  assert.equal(
    await verifyLeagueAuthCookie('alpha', cookie),
    true,
    'proven against the real verifier — otherwise the refusal below would be about a bad cookie'
  );

  // POSITIVE CONTROL in the other direction: a tampered value does NOT verify,
  // so the check above is discriminating rather than one that accepts anything.
  assert.equal(await verifyLeagueAuthCookie('alpha', `${cookie}x`), false);
});

// THE BOUNDARY. Stated precisely, because the precise version is stronger than
// the loose one: `requireAdminRequest` does not consult cookies AT ALL, so a
// league credential is not weighed and rejected — it is never write authority in
// the first place. If a future change makes any write path accept the league
// cookie, this fails.
test('a valid league credential does NOT authorize a league mutation', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  await PUT(...passwordRequest('alpha', { password: LEAGUE_PASSWORD }));
  const cookie = await createLeagueAuthCookie('alpha');

  const res = await OWNERS_PUT(
    new Request('https://example.com/api/owners?league=alpha&year=2023', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `${leagueAuthCookieName('alpha')}=${cookie}`,
      },
      body: JSON.stringify({ csvText: 'Owner,Team\nDana,Alabama' }),
    })
  );

  assert.equal(res.status, 401, 'reads only — a league password is not write authority');
  assert.equal(await getAppState('owners:alpha:2023', 'csv'), null, 'and nothing was written');
});

test('POSITIVE CONTROL: the same mutation succeeds with platform-admin authority', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);

  const res = await OWNERS_PUT(
    new Request('https://example.com/api/owners?league=alpha&year=2023', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ csvText: 'Owner,Team\nDana,Alabama' }),
    })
  );

  assert.ok(res.status < 400, `admin authority performs the write; got ${res.status}`);
  assert.notEqual(
    await getAppState('owners:alpha:2023', 'csv'),
    null,
    'the same fixture the refusal used IS writable — so that refusal was about authority'
  );
});
