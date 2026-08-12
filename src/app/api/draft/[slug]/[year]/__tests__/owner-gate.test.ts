import assert from 'node:assert/strict';
import test from 'node:test';

import { POST as CREATE_DRAFT, PUT } from '../route';
import { addLeague } from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { type DraftState, draftScope } from '@/lib/draft';

// ---------------------------------------------------------------------------
// PLATFORM-092 — owners must be confirmed before a draft can occur, and the
// draft TAKES its owners from the confirmed roster rather than accepting them.
//
// The defect these guard: `DraftState.owners` is a copy of the season roster,
// and the only screen that changes owners never touches the draft record. The
// previous attempt validated submitted lists against the roster at each entry
// point; this one removes the submitted list from the decision entirely, so
// there is nothing left to disagree.
//
// Exercised through the real handlers, which is the bypass a page-level gate
// would leave open.
// ---------------------------------------------------------------------------

const SLUG = 'gate-league';
const YEAR = 2026;
const TOKEN = 'test-admin-token';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

const params = Promise.resolve({ slug: SLUG, year: String(YEAR) });

function req(method: 'POST' | 'PUT', body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

async function persisted(): Promise<DraftState | undefined> {
  return (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  await addLeague({
    slug: SLUG,
    displayName: 'Gate League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
  });
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) {
    delete process.env.ADMIN_API_TOKEN;
  } else {
    MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  }
});

test('an unconfirmed season cannot create a draft, and nothing is persisted', async () => {
  const res = await CREATE_DRAFT(req('POST', { owners: ['Alice', 'Bob'] }), { params });

  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { reason?: string }).reason, 'owners-not-confirmed');
  assert.equal(await persisted(), undefined);
});

test('a PRIOR season roster does not open the gate', async () => {
  // The exact shape the deleted archive fallback produced: real owners, wrong
  // season.
  await savePreseasonOwners(SLUG, YEAR - 1, ['Alice', 'Bob']);

  assert.equal(
    (await CREATE_DRAFT(req('POST', { owners: ['Alice', 'Bob'] }), { params })).status,
    422
  );
  assert.equal(await persisted(), undefined);
});

test('the created draft carries the ROSTER, whatever the body says', async () => {
  // The body used to supply owners, checked only for "two non-empty strings" —
  // which is how last season's names got in. They are now ignored outright, so a
  // stale tab or a direct request cannot seed a draft with anyone else.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob', 'Carol']);

  const res = await CREATE_DRAFT(req('POST', { owners: ['LastSeasonDave', 'LastSeasonErin'] }), {
    params,
  });
  assert.equal(res.status, 201, await res.text());
  assert.deepEqual((await persisted())?.owners, ['Alice', 'Bob', 'Carol']);
});

test('a draft can be created with no owners field at all', async () => {
  // Nothing about the request decides the roster any more.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);

  const res = await CREATE_DRAFT(req('POST', {}), { params });
  assert.equal(res.status, 201, await res.text());
  assert.deepEqual((await persisted())?.owners, ['Alice', 'Bob']);
});

test('a CSV-confirmed season opens the gate too', async () => {
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nOhio State,Bob');

  const res = await CREATE_DRAFT(req('POST', {}), { params });
  assert.equal(res.status, 201, await res.text());
  assert.deepEqual((await persisted())?.owners, ['Alice', 'Bob']);
});

test('the gate runs after admin auth, not instead of it', async () => {
  const res = await CREATE_DRAFT(
    new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    { params }
  );
  assert.notEqual(res.status, 422);
  assert.ok(
    res.status === 401 || res.status === 403,
    `expected an auth failure, got ${res.status}`
  );
});

// ---------------------------------------------------------------------------
// Reconciling a draft after the roster changes
// ---------------------------------------------------------------------------

test('reopening setup picks up an added owner, and the draft order follows', async () => {
  // This is the reconciliation path. `owners` and `settings.draftOrder` are the
  // two arrays the engine derives from — `getPickOwner` indexes the order while
  // total picks are sized from the owner set — so resizing one without the other
  // yields a draft that can never be confirmed.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);

  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob', 'Carol']);

  // The field signals "reconcile owners"; its CONTENTS are ignored, which the
  // create test above proves directly. Shape is still validated because the
  // started-draft 409 path compares the submitted list against what is stored.
  const res = await PUT(req('PUT', { owners: ['ignored-a', 'ignored-b'] }), { params });
  assert.equal(res.status, 200, await res.text());

  const draft = await persisted();
  assert.deepEqual(draft?.owners, ['Alice', 'Bob', 'Carol']);
  assert.deepEqual(draft?.settings.draftOrder, ['Alice', 'Bob', 'Carol']);
});

test('a draft cannot start against a roster that has since changed', async () => {
  // `DraftSetupShell.handleStartDraft` sends `{ phase: 'live' }` and no owners,
  // so nothing re-reads the roster on the way in.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);
  // `setup → live` is not a legal transition, so the draft has to reach
  // `settings` first — otherwise this asserts against the transition check
  // rather than the roster gate.
  assert.equal((await PUT(req('PUT', { phase: 'settings' }), { params })).status, 200);

  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Carol']);

  const res = await PUT(req('PUT', { phase: 'live' }), { params });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { reason?: string }).reason, 'draft-owners-stale');
  assert.equal((await persisted())?.phase, 'settings');
});

test('an illegal transition keeps its own diagnosis, not the roster one', () => {
  // The roster gate sits BELOW `isValidTransition` so a draft that cannot go live
  // at all is told that, rather than being sent to a settings screen that cannot
  // help it.
  return (async () => {
    await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
    assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);
    await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Carol']);

    // Still in `setup`, where `live` is not reachable.
    const res = await PUT(req('PUT', { phase: 'live' }), { params });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error?: string; reason?: string };
    assert.match(body.error ?? '', /Cannot transition from 'setup' to 'live'/);
    assert.notEqual(body.reason, 'draft-owners-stale');
  })();
});

test('the refusal names a remedy that works', async () => {
  // Reopening settings re-seeds from the roster, and the draft then starts.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Carol']);

  assert.equal((await PUT(req('PUT', { phase: 'live' }), { params })).status, 422);

  // What the setup page's save does.
  assert.equal((await PUT(req('PUT', { owners: ['a', 'b'] }), { params })).status, 200);
  assert.deepEqual((await persisted())?.owners, ['Alice', 'Carol']);

  assert.equal((await PUT(req('PUT', { phase: 'settings' }), { params })).status, 200);
  const started = await PUT(req('PUT', { phase: 'live' }), { params });
  assert.equal(started.status, 200, await started.text());
  assert.equal((await persisted())?.phase, 'live');
});

test('an unchanged roster starts normally', async () => {
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);

  assert.equal((await PUT(req('PUT', { phase: 'settings' }), { params })).status, 200);
  const res = await PUT(req('PUT', { phase: 'live' }), { params });
  assert.equal(res.status, 200, await res.text());
});

test('resuming a paused draft is never blocked by the roster check', async () => {
  // A paused draft is already running with picks against a frozen owner set;
  // re-checking would strand it mid-draft.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);
  const draft = (await persisted())!;
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), { ...draft, phase: 'paused' });

  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Carol']);

  const res = await PUT(req('PUT', { phase: 'live' }), { params });
  assert.equal(res.status, 200, await res.text());
  assert.equal((await persisted())?.phase, 'live');
});

test('the reopen-settings remedy is the one the UI actually performs', async () => {
  // The previous version proved an owners-ONLY PUT works. The settings screen
  // sends `owners` AND `settings.draftOrder`, and that path used to 400: the
  // panel seeded from the draft's stale copy, so the order it sent no longer
  // matched the owners the server had just re-derived. The documented remedy
  // could not be applied through the interface.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);

  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob', 'Carol']);
  assert.equal((await PUT(req('PUT', { phase: 'live' }), { params })).status, 422);

  // What the settings screen submits once the panel reads the current roster.
  const saved = await PUT(
    req('PUT', {
      owners: ['Alice', 'Bob', 'Carol'],
      settings: { draftOrder: ['Alice', 'Bob', 'Carol'] },
    }),
    { params }
  );
  assert.equal(saved.status, 200, await saved.text());

  assert.equal((await PUT(req('PUT', { phase: 'settings' }), { params })).status, 200);
  const started = await PUT(req('PUT', { phase: 'live' }), { params });
  assert.equal(started.status, 200, await started.text());
});

test('an unconfirmed roster is diagnosed as unconfirmed, not as "changed"', async () => {
  // Two causes, two remedies. Reachable on the demo league, whose controls clear
  // the owner record directly.
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);
  assert.equal((await CREATE_DRAFT(req('POST', {}), { params })).status, 201);
  assert.equal((await PUT(req('PUT', { phase: 'settings' }), { params })).status, 200);
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), null);

  const res = await PUT(req('PUT', { phase: 'live' }), { params });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { reason?: string; error?: string };
  assert.equal(body.reason, 'owners-not-confirmed');
  assert.doesNotMatch(body.error ?? '', /has changed/);
});
