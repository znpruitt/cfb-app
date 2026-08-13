// installAsyncLocalStorage MUST load before the Next storage module so the global
// AsyncLocalStorage backing `revalidateTag` (via invalidateStandings) exists.
import './_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PUT } from '../pick/[n]/route';
import { POST as CONFIRM, DELETE as REOPEN } from '../confirm/route';
import { POST as RESET } from '../reset/route';
import { POST as UNPICK } from '../unpick/route';
import { PUT as PUT_DRAFT } from '../route';
import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { type DraftState, type DraftPick, draftScope, getDraftEligibleTeams } from '@/lib/draft';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import teamsData from '@/data/teams.json';
import { draftPicksSignature, isDraftPublished } from '@/lib/selectors/draftPublication';

// ---------------------------------------------------------------------------
// PLATFORM-072 — post-confirm draft pick edit ownership drift.
//
// Confirmation copies the draft picks into a SEPARATE persisted store
// (owners:${slug}:${year} / 'csv') that standings / gameOwnership consume. The
// pick-edit route allows editing while phase === 'complete', but previously
// updated only the draft state — leaving that confirmed CSV (and the warm
// standings snapshot) crediting the OLD team→owner. These tests prove a
// post-confirm edit now resyncs the CSV and invalidates, while pre-confirm and
// failure paths leave ownership untouched.
// ---------------------------------------------------------------------------

type TeamsJson = { items: TeamCatalogItem[] };

const SLUG = 'post-confirm-edit-league';
const YEAR = 2026;
const TOKEN = 'test-admin-token';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

const ELIGIBLE = getDraftEligibleTeams((teamsData as TeamsJson).items);
const TEAM_A = ELIGIBLE[0]!.school; // Owner1's confirmed pick
const TEAM_B = ELIGIBLE[1]!.school; // Owner2's confirmed pick
const TEAM_C = ELIGIBLE[2]!.school; // initially NoClaim; the post-confirm edit target

const confirmParams = Promise.resolve({ slug: SLUG, year: String(YEAR) });
const pickParams = (n: number) => Promise.resolve({ slug: SLUG, year: String(YEAR), n: String(n) });

/** A complete 2-owner / 1-round draft (2 picks): Owner1→TEAM_A, Owner2→TEAM_B. */
function completeTwoOwnerDraft(phase: DraftState['phase'] = 'live'): DraftState {
  const now = '2026-08-01T00:00:00.000Z';
  const picks: DraftPick[] = [
    {
      pickNumber: 1,
      round: 0,
      roundPick: 0,
      owner: 'Owner1',
      team: TEAM_A,
      pickedAt: now,
      autoSelected: false,
    },
    {
      pickNumber: 2,
      round: 0,
      roundPick: 1,
      owner: 'Owner2',
      team: TEAM_B,
      pickedAt: now,
      autoSelected: false,
    },
  ];
  return {
    leagueSlug: SLUG,
    year: YEAR,
    phase,
    owners: ['Owner1', 'Owner2'],
    settings: {
      style: 'snake',
      draftOrder: ['Owner1', 'Owner2'],
      pickTimerSeconds: 60,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    picks,
    currentPickIndex: 2,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function editRequest(team: string, opts: { authed: boolean } = { authed: true }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.authed) headers['x-admin-token'] = TOKEN;
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/pick/1`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ team }),
  });
}

async function runCapturingTags<T>(fn: () => Promise<T>): Promise<{ result: T; tags: string[] }> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, async () => {
    const result = await fn();
    return { result, tags: store.pendingRevalidatedTags };
  });
}

/** Parse the owners CSV into team(lowercased) → owner. Test team names have no commas. */
async function readOwnerByTeam(): Promise<Map<string, string> | null> {
  const record = await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv');
  if (!record?.value) return null;
  const map = new Map<string, string>();
  for (const row of record.value.split('\n').slice(1)) {
    const idx = row.lastIndexOf(',');
    map.set(row.slice(0, idx).toLowerCase(), row.slice(idx + 1));
  }
  return map;
}

/** Seed a complete draft and run the real confirm route to write the owners CSV. */
async function seedConfirmed(): Promise<void> {
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), completeTwoOwnerDraft('live'));
  const res = await runCapturingTags(() => CONFIRM(editConfirmReq(), { params: confirmParams }));
  assert.equal(res.result.status, 200, await res.result.text());
}

function editConfirmReq(): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/confirm`, {
    method: 'POST',
    headers: { 'x-admin-token': TOKEN },
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  await addLeague({
    slug: SLUG,
    displayName: 'Post-Confirm Edit League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete process.env.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
});

test('editing a pick after confirmation resyncs the owners CSV and invalidates standings', async () => {
  await seedConfirmed();

  // Sanity: confirmed CSV credits Owner1 for TEAM_A and TEAM_C is unclaimed.
  const before = await readOwnerByTeam();
  assert.equal(before?.get(TEAM_A.toLowerCase()), 'Owner1');
  assert.equal(before?.get(TEAM_C.toLowerCase()), 'NoClaim');

  // Edit Owner1's pick #1 from TEAM_A → TEAM_C.
  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  // Ownership attribution followed the edit: TEAM_C now Owner1, TEAM_A now unclaimed,
  // TEAM_B untouched.
  const after = await readOwnerByTeam();
  assert.equal(after?.get(TEAM_C.toLowerCase()), 'Owner1', 'new team credited to the owner');
  assert.equal(after?.get(TEAM_A.toLowerCase()), 'NoClaim', 'old team no longer credited');
  assert.equal(after?.get(TEAM_B.toLowerCase()), 'Owner2', 'other owner unchanged');

  // Standings cache busted (league + year scope).
  assert.ok(tags.includes(`standings:${SLUG}`), 'league standings invalidated');
  assert.ok(tags.includes(`standings:${SLUG}:${YEAR}`), 'league/year standings invalidated');

  // Draft stays confirmed.
  const draft = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.equal(draft?.value?.phase, 'complete');
});

test('a post-confirm edit preserves unrelated /api/owners overrides (patches, not rebuilds)', async () => {
  await seedConfirmed();

  // Simulate an admin repair via PUT /api/owners: reassign an unrelated team
  // (TEAM_B, Owner2's pick) to a manually-corrected owner name. This shares the
  // owners:${slug}:${year} store and leaves the draft phase 'complete'.
  const confirmed = await readOwnerByTeam();
  assert.equal(confirmed?.get(TEAM_B.toLowerCase()), 'Owner2');
  const overridden = (await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv'))!.value.replace(
    `${TEAM_B},Owner2`,
    `${TEAM_B},Owner2 (corrected)`
  );
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', overridden);

  // Now edit Owner1's pick #1 (TEAM_A → TEAM_C).
  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const after = await readOwnerByTeam();
  // The edit applied...
  assert.equal(after?.get(TEAM_C.toLowerCase()), 'Owner1');
  assert.equal(after?.get(TEAM_A.toLowerCase()), 'NoClaim');
  // ...and the unrelated manual override survived (not clobbered by a rebuild).
  assert.equal(after?.get(TEAM_B.toLowerCase()), 'Owner2 (corrected)', 'override preserved');
});

test('a post-confirm edit carries an /api/owners owner-name correction to the new team', async () => {
  await seedConfirmed();

  // Simulate an admin owner-name correction on THIS pick's team row (TEAM_A):
  // Owner1 → 'Owner One'. The draft state still stores the stale 'Owner1'.
  const corrected = (await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv'))!.value.replace(
    `${TEAM_A},Owner1`,
    `${TEAM_A},Owner One`
  );
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', corrected);

  // Edit pick #1 (TEAM_A → TEAM_C).
  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const after = await readOwnerByTeam();
  // The corrected identity is carried to the new team, the old team is released,
  // and the stale draft name never appears — no split/duplicate owner identity.
  assert.equal(after?.get(TEAM_C.toLowerCase()), 'Owner One', 'corrected owner carried forward');
  assert.equal(after?.get(TEAM_A.toLowerCase()), 'NoClaim', 'old team released');
  assert.ok(![...after!.values()].includes('Owner1'), 'stale draft owner name is not resurrected');
});

test('editing a pick before confirmation does not write owners or invalidate', async () => {
  // A live (never-confirmed) draft — no authoritative owners CSV exists.
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), completeTwoOwnerDraft('live'));

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  // The edit landed in draft state...
  const draft = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.equal(draft?.value?.picks[0]?.team, TEAM_C);
  // ...but no owners CSV was created and standings were not invalidated.
  assert.equal(await readOwnerByTeam(), null, 'no owners CSV written pre-confirm');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('an unauthorized edit mutates neither ownership nor standings', async () => {
  await seedConfirmed();
  const before = await readOwnerByTeam();

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C, { authed: false }), { params: pickParams(1) })
  );
  assert.equal(res.status, 401);

  // Confirmed CSV untouched, no standings invalidation.
  const after = await readOwnerByTeam();
  assert.deepEqual(after, before, 'owners CSV unchanged');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('a failed edit (unknown team) mutates neither ownership nor standings', async () => {
  await seedConfirmed();
  const before = await readOwnerByTeam();

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest('Not A Real FBS Team'), { params: pickParams(1) })
  );
  assert.equal(res.status, 400);

  const after = await readOwnerByTeam();
  assert.deepEqual(after, before, 'owners CSV unchanged');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-094 — publication digests the PICKS, and these are the paths that
// proved a flag could not work. Each drives the real route handlers.
// ---------------------------------------------------------------------------

test('confirm records the picks it published', async () => {
  await seedConfirmed();

  const draft = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(draft?.phase, 'complete');
  assert.equal(draft?.publishedPicks, draftPicksSignature(draft!.picks));
  assert.equal(isDraftPublished(draft), true);
});

test('resetting a published draft retracts its publication', async () => {
  // `phase: 'complete'` is not a resting state — Reset is offered there. Under a
  // flag it survived, so running the draft again restored `complete` beside a
  // marker pointing at the PREVIOUS draft's roster: the checklist ticked, setup
  // completed, and Confirm hid itself. `/reset` still knows nothing about
  // publication; clearing the picks is what retracts it.
  await seedConfirmed();

  const res = await RESET(
    new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/reset`, {
      method: 'POST',
      headers: { 'x-admin-token': TOKEN },
    }),
    { params: confirmParams }
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(after?.phase, 'setup');
  assert.equal(isDraftPublished(after), false, 'the old roster no longer speaks for it');
});

test('undoing the last pick of a published draft retracts its publication', async () => {
  // Same class, second path — and Undo last pick is offered at `complete` too.
  await seedConfirmed();

  const res = await UNPICK(
    new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/unpick`, {
      method: 'POST',
      headers: { 'x-admin-token': TOKEN },
    }),
    { params: confirmParams }
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(isDraftPublished(after), false);
});

test('changing the pick timer on a published draft does NOT retract it', async () => {
  // The other direction, and why a draft-wide timestamp was wrong: the setup
  // screen still offers the pick timer at `phase: 'complete'`. Keyed to
  // `updatedAt`, that unticked "Teams assigned" and blocked Complete Setup until
  // the commissioner confirmed the whole draft again. The roster describes the
  // picks, and the picks did not move.
  await seedConfirmed();

  const res = await PUT_DRAFT(
    new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: JSON.stringify({ settings: { pickTimerSeconds: 30 } }),
    }),
    { params: confirmParams }
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(after?.settings.pickTimerSeconds, 30, 'the timer change landed');
  assert.equal(isDraftPublished(after), true, 'still published — the picks are unchanged');
});

test('editing a pick on a REOPENED draft does not rewrite live ownership', async () => {
  // The reopen route's contract is that the previously confirmed roster stays in
  // effect until the commissioner confirms again. Gating this resync on anything
  // looser than publication broke that: an edit mid-reopen rewrote the official
  // roster and invalidated standings with no re-confirmation.
  await seedConfirmed();
  const before = await readOwnerByTeam();

  const { result: reopen } = await runCapturingTags(() =>
    REOPEN(
      new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/confirm`, {
        method: 'DELETE',
        headers: { 'x-admin-token': TOKEN },
      }),
      { params: confirmParams }
    )
  );
  assert.equal(reopen.status, 200, await reopen.text());

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  assert.deepEqual(await readOwnerByTeam(), before, 'the confirmed roster is untouched');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'and standings were not invalidated'
  );
});

test('editing a pick on a COMPLETE but unpublished draft mints no roster', async () => {
  // The no-CSV fallback used to build a full roster from the picks, so editing
  // one pick on a never-confirmed draft PUBLISHED the league's assignments as a
  // side effect — from a route that is not the publication authority.
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), completeTwoOwnerDraft('complete'));

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const draft = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(draft?.picks[0]?.team, TEAM_C, 'the edit itself still lands');
  assert.equal(await readOwnerByTeam(), null, 'no roster published by an edit');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('a published draft stays published when its edit carries the roster along', async () => {
  // The one place a writer opts back IN, and only because it just made the
  // roster match. Otherwise every post-confirm edit would demand a re-Confirm
  // for a change the app had already propagated.
  await seedConfirmed();

  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(isDraftPublished(after), true, 'still describes the stored roster');
  assert.equal(after?.publishedPicks, draftPicksSignature(after!.picks));
  assert.equal((await readOwnerByTeam())?.get(TEAM_C.toLowerCase()), 'Owner1');
});

test('an edit does not claim publication when there was no roster to carry', async () => {
  // `PUT /api/owners` can blank the CSV without touching the draft, so a
  // published draft can have nothing left to patch. Re-stamping on
  // `wasPublished` alone then recorded a publication of picks NO roster
  // describes — which keeps Confirm hidden and lets a later unrelated repair
  // import satisfy readiness against picks it never described.
  //
  // This guard existed on the abandoned branch and was lost in the rebuild;
  // re-deriving rather than cherry-picking is required, and this is what it cost.
  await seedConfirmed();
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', null);

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(after?.picks[0]?.team, TEAM_C, 'the edit itself still lands');
  assert.equal(isDraftPublished(after), false, 'no roster was carried, so no claim');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'and nothing was invalidated'
  );
});

test('a pick edit reads the draft inside its own transaction', () => {
  // Structural pin. The route writes inside a transaction but used to read from
  // a snapshot taken before it — atomicity without isolation. A confirmation
  // committing in between was then overwritten by this write, wiping the
  // publication it had just recorded and leaving a roster the draft no longer
  // claimed. `confirm-eligibility.test.ts` pins the same rule for the publish
  // path; observing the interleaving directly needs two requests suspended
  // mid-transaction, which the store exposes no seam for.
  const source = readFileSync(new URL('../pick/[n]/route.ts', import.meta.url), 'utf8');
  const txnAt = source.indexOf('withAppStateKeyTransaction');
  assert.ok(txnAt > 0);
  assert.match(
    source.slice(txnAt),
    /await txn\.read<DraftState>\(\)/,
    'the picks written must come from the transaction itself'
  );
});
