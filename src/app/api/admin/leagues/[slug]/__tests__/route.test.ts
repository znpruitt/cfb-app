import assert from 'node:assert/strict';
import test from 'node:test';

import { DELETE, PATCH } from '../route';
import type { League } from '../../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../../../lib/server/appStateStore.ts';

// PLATFORM-086F2I adds the DELETE suite below — this endpoint had NO tests at
// all, while being irreversible and one click away.
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

function deleteRequest(
  slug: string,
  confirm?: string
): [Request, { params: Promise<{ slug: string }> }] {
  const query = confirm === undefined ? '' : `?confirm=${encodeURIComponent(confirm)}`;
  return [
    new Request(`https://example.com/api/admin/leagues/${slug}${query}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': ADMIN_TOKEN },
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

// PLATFORM-086F2J — the founding year is set at creation and frozen. This test
// asserted the OPPOSITE (that editing it was green); it is inverted rather than
// deleted, so the change of rule stays visible in the suite's history.
test('PATCH with foundedYear → 409 league-founded-year-immutable and writes nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = await readRegistry();

  const [req, ctx] = patchRequest('alpha', { foundedYear: 2005 });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.equal(body.error, 'league-founded-year-immutable');
  assert.deepEqual(await readRegistry(), before);
});

// Refused WHOLESALE, matching the lifecycle fields: a partial apply would make
// the rename land while the field the operator actually changed was refused.
test('PATCH mixing foundedYear with a valid displayName is rejected wholesale', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = await readRegistry();

  const [req, ctx] = patchRequest('alpha', { displayName: 'Renamed', foundedYear: 2005 });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 409);
  assert.deepEqual(await readRegistry(), before, 'displayName not applied alongside the rejection');
});

// POSITIVE CONTROL — without this, the two tests above pass against a PATCH that
// rejects everything.
test('display-name editing remains green', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);

  const [req, ctx] = patchRequest('alpha', { displayName: 'Renamed' });
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { league: League };
  assert.equal(body.league.displayName, 'Renamed');

  const stored = (await readRegistry())[0]!;
  assert.equal(stored.displayName, 'Renamed');
  assert.equal(stored.year, 2024, 'lifecycle year untouched');
  assert.deepEqual(stored.status, { state: 'season', year: 2024 });
});

// REGRESSION TEST — an existing BACKDATED value survives. The fixture is 2018
// rather than the current year on purpose: a fixture equal to
// today's year cannot distinguish "preserved" from "silently recomputed", and
// this slice explicitly performs no migration.
test('a backdated foundedYear survives both a refused and a successful PATCH', async () => {
  await setAppState('leagues', 'registry', [{ ...makeLeague('alpha'), foundedYear: 2018 }]);

  const [refusedReq, refusedCtx] = patchRequest('alpha', { foundedYear: 2005 });
  assert.equal((await PATCH(refusedReq, refusedCtx)).status, 409);
  assert.equal((await readRegistry())[0]!.foundedYear, 2018, 'unchanged by the refusal');

  const [okReq, okCtx] = patchRequest('alpha', { displayName: 'Renamed' });
  assert.equal((await PATCH(okReq, okCtx)).status, 200);
  const stored = (await readRegistry())[0]!;
  assert.equal(stored.displayName, 'Renamed');
  assert.equal(stored.foundedYear, 2018, 'and unchanged by a successful edit of another field');
});

test('PATCH with no updatable fields → 400 naming the allowed fields', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);

  const [req, ctx] = patchRequest('alpha', {});
  const res = await PATCH(req, ctx);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /displayName/);
  assert.ok(
    !(await (await PATCH(...patchRequest('alpha', {}))).text()).includes('foundedYear'),
    'the message no longer advertises a field that can no longer be updated'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2I — DELETE. This endpoint shipped with ZERO tests while being
// irreversible, one click away, and reachable directly by anyone holding the
// static `ADMIN_API_TOKEN`.
//
// The confirmation is the SLUG rather than a fixed word, because a fixed word is
// identical on every row: it defends against a stray click but not against
// acting on the WRONG league, which is the accident the guard exists for. Test 2
// is that case and is the reason for the design.
// ---------------------------------------------------------------------------

test('DELETE without a confirmation refuses and the registry is byte-identical', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha'), makeLeague('bravo')]);
  const before = JSON.stringify(await readRegistry());

  const res = await DELETE(...deleteRequest('alpha'));

  assert.equal(res.status, 400);
  // Plain text, matching the route's other errors — the only client renders
  // `res.text()` verbatim, so a JSON body would show an operator a raw blob.
  const text = await res.text();
  assert.match(text, /^league-delete-confirmation-required/, 'stable code stays greppable');
  assert.match(text, /alpha/, 'the operator is told what to type');
  assert.equal(JSON.stringify(await readRegistry()), before, 'nothing was written');
});

// THE case the design exists for: right button, wrong row.
test('DELETE confirming a DIFFERENT league removes nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha'), makeLeague('bravo')]);
  const before = JSON.stringify(await readRegistry());

  const res = await DELETE(...deleteRequest('alpha', 'bravo'));

  assert.equal(res.status, 400);
  const text = await res.text();
  assert.match(
    text,
    /^league-delete-confirmation-mismatch/,
    'a DISTINCT code from the absent case — "you did not confirm" and "you confirmed a ' +
      'different league" are different operator conditions'
  );
  assert.equal(JSON.stringify(await readRegistry()), before, 'neither league was touched');
});

test('DELETE with the matching confirmation removes exactly that league', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha'),
    makeLeague('bravo'),
    makeLeague('charlie'),
  ]);

  const res = await DELETE(...deleteRequest('bravo', 'bravo'));

  assert.equal(res.status, 200);
  assert.deepEqual(
    (await readRegistry()).map((l) => l.slug),
    ['alpha', 'charlie'],
    'siblings survive'
  );
});

test('DELETE of an absent league still 404s, before any confirmation handling', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  const before = JSON.stringify(await readRegistry());

  // No confirmation supplied: if the 404 did NOT come first this would answer
  // `confirmation-required` and imply the league exists.
  const res = await DELETE(...deleteRequest('ghost'));

  assert.equal(res.status, 404);
  assert.equal(JSON.stringify(await readRegistry()), before);
});

// The response still tells the truth about what a delete does NOT do. The guard
// makes the action deliberate; it does not make it complete.
test('DELETE still reports that stored league data is not removed', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha')]);
  await setAppState(`owners:alpha:2024`, 'csv', 'Owner,Team\nDana,Alabama');

  const res = await DELETE(...deleteRequest('alpha', 'alpha'));
  const body = (await res.json()) as { note?: string };

  assert.equal(res.status, 200);
  assert.match(body.note ?? '', /not deleted/i);
  assert.notEqual(
    await getAppState('owners:alpha:2024', 'csv'),
    null,
    'and the claim is true — the roster survives the delete'
  );
});
