// installAsyncLocalStorage MUST load before the Next storage module so the global
// AsyncLocalStorage backing `revalidateTag` (via invalidateStandings) exists.
import './_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import assert from 'node:assert/strict';
import test from 'node:test';

import { PUT } from '../pick/[n]/route';
import { POST as CONFIRM } from '../confirm/route';
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
      autoPickMetric: null,
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
