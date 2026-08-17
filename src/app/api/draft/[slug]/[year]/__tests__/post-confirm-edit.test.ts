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

  const { result: res, tags } = await runCapturingTags(() =>
    RESET(
      new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/reset`, {
        method: 'POST',
        headers: { 'x-admin-token': TOKEN },
      }),
      { params: confirmParams }
    )
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(after?.phase, 'setup');
  assert.equal(isDraftPublished(after), false, 'the old roster no longer speaks for it');

  // INSIGHTS-025 made publication an INPUT to the cached insight build, so
  // retracting it has to bust that cache. Before this the Overview kept serving
  // membership-change cards derived from a roster that no longer counted, for the
  // full 300s TTL.
  assert.ok(
    tags.includes(`standings:${SLUG}`),
    `retraction must invalidate standings — got ${tags.join(', ') || 'no tags'}`
  );
});

test('undoing the last pick of a published draft retracts its publication', async () => {
  // Same class, second path — and Undo last pick is offered at `complete` too.
  await seedConfirmed();

  const { result: res, tags } = await runCapturingTags(() =>
    UNPICK(
      new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/unpick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
        // PLATFORM-102 — Undo names the pick it removes, so a duplicate press
        // cannot consume the one before it.
        body: JSON.stringify({ expectedPickNumber: 2 }),
      }),
      { params: confirmParams }
    )
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(isDraftPublished(after), false);
  assert.ok(tags.includes(`standings:${SLUG}`), 'same reason as reset — see above');
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

test('a draft confirmed before publication existed still syncs its roster', async () => {
  // Review, HIGH. Records written before `publishedPicks` existed have no
  // signature, so gating the resync on publication dropped them: a pick edit
  // returned 200 while `owners:{slug}:{year}` kept crediting the old team and
  // standings were never invalidated — PLATFORM-072's defect returning through
  // the new field. The gate is `phase === 'complete'` plus an existing roster,
  // which is what `main` covered.
  await seedConfirmed();
  const confirmed = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))!.value!;
  const legacy = { ...confirmed };
  delete (legacy as { publishedPicks?: string | null }).publishedPicks;
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), legacy);

  const { result: res, tags } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const owners = await readOwnerByTeam();
  assert.equal(owners?.get(TEAM_C.toLowerCase()), 'Owner1', 'the roster followed the edit');
  assert.equal(owners?.get(TEAM_A.toLowerCase()), 'NoClaim', 'the old team was released');
  assert.ok(
    tags.some((t) => t.startsWith('standings:')),
    'standings were invalidated'
  );

  // But it gains NO publication. The earlier cut stamped the signature here and
  // called it a truthful backfill; both reviewers showed it is not, because the
  // same conditions are reachable with a roster this draft never produced (see
  // the next test). Keeping the roster in step is what standings need; claiming
  // publication is a separate assertion that only `POST /confirm` may make.
  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(isDraftPublished(after), false, 'synced, but not promoted to published');
});

test('a repair-imported roster is never promoted to the draft output by an edit', async () => {
  // Codex P1 / code-review MEDIUM, and the campaign's core failure reached from a
  // new direction. `owners:{slug}:{year}` has writers unrelated to any draft —
  // the repair import at `/admin/{slug}/roster`, and the demo year-migration. A
  // draft that reaches `complete` without publishing, beside one of those CSVs,
  // met the old "phase complete + a CSV exists" stamp condition: editing ONE
  // pick patched a single row and then declared the whole foreign roster to be
  // this draft's output, so the checklist ticked and setup completed on
  // ownership the draft never assigned.
  const foreignCsv = [
    'team,owner',
    `${TEAM_A},Imported One`,
    `${TEAM_B},Imported Two`,
    `${TEAM_C},Imported Three`,
  ].join('\n');
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', foreignCsv);
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), completeTwoOwnerDraft('complete'));

  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(
    isDraftPublished(after),
    false,
    'one patched row cannot license a whole-roster claim'
  );

  // The remaining rows still describe the import, which is exactly why the claim
  // would have been false.
  const owners = await readOwnerByTeam();
  assert.equal(owners?.get(TEAM_B.toLowerCase()), 'Imported Two');
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

test('every draft-derived value is computed INSIDE the pick-edit transaction', () => {
  // Structural pin, and the only form available: the defect is an interleaving,
  // and the handler exposes no seam to suspend between a read and its
  // transaction. Both reviewers reached it independently — validation and
  // derivation ran before the lock while the write happened after, so the route
  // mixed two snapshots. Two edits racing on one pick then patched the roster
  // with an `oldTeam` already replaced, leaving a team credited to an owner the
  // draft did not show; two edits racing on one TEAM both passed their pre-lock
  // conflict checks and serialized into a draft holding it twice, which
  // `POST /confirm` refuses permanently.
  //
  // The invariant is therefore about WHERE values come from, which is exactly
  // what a structural check can see: nothing before the transaction may touch
  // the stored draft.
  const source = readFileSync(new URL('../pick/[n]/route.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function PUT'));
  const txnAt = body.indexOf('withAppStateKeyTransaction');
  assert.ok(txnAt > 0, 'the edit commits inside a transaction');

  const before = body.slice(0, txnAt);
  assert.ok(!before.includes('getAppState'), 'the draft is not read before the transaction');
  assert.ok(!/\.picks\b/.test(before), 'no pick is inspected before the transaction');

  const inside = body.slice(txnAt);
  assert.match(inside, /await txn\.read<DraftState>\(\)/, 'the record is read from the txn');
  for (const derivation of [
    /const previousTeam = target\.team;/,
    /const displacedIndex = current\.picks\.findIndex\(/,
    /const nextPicks = current\.picks\.map\(/,
    /if \(pickIndex >= current\.picks\.length\)/,
    /if \(current\.phase !== 'live'/,
  ]) {
    assert.match(inside, derivation, `derived inside the transaction: ${derivation}`);
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-094 remediation round 2 — the edit derives EVERYTHING from the record
// it writes. Both reviewers reached this independently.
//
// The gap these close is a TIME gap, and every test above exercises a single
// operation against a fixed starting state. That is why none of them caught it.
// ---------------------------------------------------------------------------

test('two edits to the same pick leave exactly one team credited', async () => {
  // CONTRACT PIN, not a regression test — stated precisely because mutation
  // proved it. Reverting `previousTeam` to a pre-transaction snapshot leaves
  // this green: sequential awaits give the second request a FRESH outer read, so
  // no staleness arises. The defect needs true interleaving (an admin
  // double-click), which this harness cannot produce deterministically — the
  // handler exposes no seam to suspend between its read and its transaction.
  // The cross-snapshot invariant is pinned structurally below instead.
  //
  // What this does pin: the patch logic itself moves ownership exactly once.
  await seedConfirmed();

  const first = await runCapturingTags(() => PUT(editRequest(TEAM_C), { params: pickParams(1) }));
  assert.equal(first.result.status, 200, await first.result.text());

  const second = await runCapturingTags(() => PUT(editRequest(TEAM_B), { params: pickParams(1) }));
  assert.equal(second.result.status, 422, 'TEAM_B is already Owner2s pick');

  const owners = await readOwnerByTeam();
  assert.equal(owners?.get(TEAM_C.toLowerCase()), 'Owner1', 'the surviving edit holds');
  assert.equal(owners?.get(TEAM_A.toLowerCase()), 'NoClaim', 'the original was released');

  // Owner1 holds exactly one team in the persisted roster.
  const held = [...(owners?.entries() ?? [])].filter(([, owner]) => owner === 'Owner1');
  assert.equal(held.length, 1, `Owner1 credited ${held.length} teams: ${JSON.stringify(held)}`);
});

test('a second edit to the same pick releases the team the FIRST edit set', async () => {
  // Contract pin, same limitation as above. Edit 1 → TEAM_C, edit 2 → an unheld
  // team; the release must target TEAM_C, not the original TEAM_A.
  await seedConfirmed();
  const spare = ELIGIBLE[5]!.school;

  await runCapturingTags(() => PUT(editRequest(TEAM_C), { params: pickParams(1) }));
  const second = await runCapturingTags(() => PUT(editRequest(spare), { params: pickParams(1) }));
  assert.equal(second.result.status, 200, await second.result.text());

  const owners = await readOwnerByTeam();
  assert.equal(owners?.get(spare.toLowerCase()), 'Owner1');
  assert.equal(owners?.get(TEAM_C.toLowerCase()), 'NoClaim', 'the first edit was released');
  const held = [...(owners?.entries() ?? [])].filter(([, owner]) => owner === 'Owner1');
  assert.equal(held.length, 1, `Owner1 credited ${held.length} teams`);
});

test('an edit refuses rather than silently no-op when the draft was reset', async () => {
  // `/reset` empties the picks. The guards used to run against a pre-transaction
  // snapshot, so the mapped picks never reached `pickIndex`: the edit was
  // dropped, the route returned 200 with a pick it had not persisted, and it
  // wrote back a draft in `setup` — a phase it explicitly refuses to edit.
  await seedConfirmed();
  await runCapturingTags(() =>
    RESET(
      new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/reset`, {
        method: 'POST',
        headers: { 'x-admin-token': TOKEN },
      }),
      { params: confirmParams }
    )
  );

  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(1) })
  );
  const resetBody = (await res.json()) as { error: string };
  assert.equal(res.status, 422, resetBody.error);
  assert.match(resetBody.error, /Cannot edit picks in phase: setup/);

  const after = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value;
  assert.equal(after?.phase, 'setup', 'the reset stands');
  assert.deepEqual(after?.picks, [], 'and no pick was resurrected');
});

test('an edit refuses when the pick it names was undone', async () => {
  await seedConfirmed();
  await runCapturingTags(() =>
    UNPICK(
      new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/unpick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
        body: JSON.stringify({ expectedPickNumber: 2 }),
      }),
      { params: confirmParams }
    )
  );

  // Pick #2 no longer exists after the undo.
  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(2) })
  );
  const undoBody = (await res.json()) as { error: string };
  assert.equal(res.status, 404, undoBody.error);
  assert.match(undoBody.error, /has not been made yet/);
});

// ---------------------------------------------------------------------------
// PLATFORM-096 — a mis-entered draft can be corrected before confirmation.
// ---------------------------------------------------------------------------

test('taking a team another owner holds moves it and vacates their slot', async () => {
  // The gap this exists to close: the editor filtered out every held team, so a
  // draft where two owners hold each other's teams could not be fixed at all.
  // Deliberately NOT a swap — the displaced owner's slot is left empty for the
  // commissioner to fill, because the correction is often not a clean exchange.
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), completeTwoOwnerDraft('complete'));

  // Owner1 takes TEAM_B, which Owner2 holds as pick #2.
  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_B), { params: pickParams(1) })
  );
  assert.equal(res.status, 200, await res.text());

  const picks = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value?.picks ?? [];
  assert.equal(picks[0]?.team, TEAM_B, 'the team moved');
  assert.equal(picks[1]?.team, null, "and the previous holder's slot is empty");
  assert.equal(picks[1]?.owner, 'Owner2', 'the slot still belongs to its owner');
});

test('a draft holding an empty slot cannot be confirmed', async () => {
  // The property that makes an empty slot safe: it is an EDITING state that can
  // never become the league's rosters.
  const draft = completeTwoOwnerDraft('complete');
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), {
    ...draft,
    picks: [draft.picks[0]!, { ...draft.picks[1]!, team: null }],
  });

  const res = await runCapturingTags(() => CONFIRM(editConfirmReq(), { params: confirmParams }));
  assert.equal(res.result.status, 422);
  assert.match(
    ((await res.result.json()) as { error: string }).error,
    /unassigned pick/,
    'the refusal names the real reason rather than an unrecognized team'
  );

  assert.equal(await readOwnerByTeam(), null, 'and nothing was written');
});

test('a draft with a LIVE ROSTER but no publication stamp also refuses the move', async () => {
  // The HIGH, found by both reviewers and reproduced against the real routes.
  // The vacate was gated on `isDraftPublished` while the roster sync 40 lines
  // below fires on `phase === 'complete'` plus an existing CSV — deliberately, so
  // drafts confirmed before `publishedPicks` existed keep their rosters in step.
  // In that gap the move was ALLOWED and the CSV patched, leaving an owner with
  // nothing in live standings mid-correction.
  //
  // The design claim this feature rested on — "standings never read draft picks"
  // — is true of `standings.ts` and false of THIS ROUTE, which is the writer that
  // carries a pick edit into the roster.
  await seedConfirmed();
  const confirmed = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))!.value!;
  const legacy = { ...confirmed };
  delete (legacy as { publishedPicks?: string | null }).publishedPicks;
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), legacy);
  const before = await readOwnerByTeam();

  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_B), { params: pickParams(1) })
  );
  assert.equal(res.status, 422, await res.text());

  assert.deepEqual(await readOwnerByTeam(), before, 'the live roster is untouched');
  const picks = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value?.picks ?? [];
  assert.equal(picks[1]?.team, TEAM_B, 'and nobody was vacated');
});

test('a PUBLISHED draft refuses the move instead of vacating a live roster', async () => {
  // Once published, the picks describe the league's live rosters. Vacating one
  // would detach a roster from the draft that produced it — post-publication
  // corrections are a roster edit, per the owner's standing rule.
  await seedConfirmed();

  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_B), { params: pickParams(1) })
  );
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { error: string }).error, /rosters are live/);

  const picks = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value?.picks ?? [];
  assert.equal(picks[1]?.team, TEAM_B, 'the live roster is untouched');
});

test('filling an empty slot gives the team to that owner, releasing nothing', async () => {
  // Three attempts at this, and the first two were wrong in opposite directions.
  //
  //   `oldTeam: previousTeam ?? canonicalTeam` made it a SELF-MOVE:
  //   `oldCanon === newCanon` makes the release branch unreachable and rewrites
  //   the row to the owner it already had — a write that changed nothing while
  //   invalidating standings.
  //
  //   Skipping the patch outright left the draft saying this owner holds the
  //   team while the roster still credited someone else — the PLATFORM-072
  //   silent-divergence class. **The test I wrote for that round asserted the
  //   skip as correct**, locking the defect in.
  //
  // The slot released nothing, so only the new team's row changes.
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), completeTwoOwnerDraft('complete'));
  await runCapturingTags(() => PUT(editRequest(TEAM_B), { params: pickParams(1) }));
  const vacated = (await getAppState<DraftState>(draftScope(SLUG), String(YEAR)))?.value?.picks;
  assert.equal(vacated?.[1]?.team, null, 'precondition: slot #2 is empty');

  // A repair roster arrives while the slot is still open.
  const repair = ['team,owner', `${TEAM_A},Imported`, `${TEAM_C},Imported`].join('\n');
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', repair);

  // Owner2 fills the empty slot with TEAM_C.
  const { result: res } = await runCapturingTags(() =>
    PUT(editRequest(TEAM_C), { params: pickParams(2) })
  );
  assert.equal(res.status, 200, await res.text());

  const owners = await readOwnerByTeam();
  assert.equal(owners?.get(TEAM_C.toLowerCase()), 'Owner2', 'the team is credited to this owner');
  assert.equal(
    owners?.get(TEAM_A.toLowerCase()),
    'Imported',
    'and nothing else is released — the empty slot held nothing to give up'
  );
});

test('a pick with a MISSING team is refused, not crashed on', async () => {
  // The guard tested `=== null`, so a hand-edited or partly migrated record whose
  // `team` field is absent slipped past it and reached `pick.team!.toLowerCase()`
  // below — a 500 in place of the 422 the guard exists to give. Its neighbours
  // (`draftPicksSignature`, `isDraftPublished`) already defend against exactly
  // that shape.
  const draft = completeTwoOwnerDraft('complete');
  const missing = { ...draft.picks[1]! } as Partial<DraftPick>;
  delete missing.team;
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), {
    ...draft,
    picks: [draft.picks[0]!, missing as DraftPick],
  });

  const res = await runCapturingTags(() => CONFIRM(editConfirmReq(), { params: confirmParams }));
  assert.equal(res.result.status, 422, 'a refusal, not a crash');
  assert.match(((await res.result.json()) as { error: string }).error, /unassigned pick/);
});
