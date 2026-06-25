import { runWithRevalidateContext } from './_setup/revalidateContext';

import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../confirm/route';
import { PUT } from '../route';
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
// DRAFT-010 — draft confirmation uses the shared eligible-team definition.
//
// The confirm route derives totalExpectedPicks from the draft-eligible team
// catalog. It previously filtered on `t.classification === 'fbs'`, which counts
// ZERO teams against the current `teams.json` shape (no classification key) — so
// a fully complete, valid draft was rejected as "0 of 0 picks" and could never be
// confirmed. These tests prove a complete draft confirms successfully and that
// undrafted eligible teams (the remainder) are written as NoClaim rows.
// ---------------------------------------------------------------------------

type TeamsJson = { items: TeamCatalogItem[] };

const SLUG = 'confirm-eligibility-league';
const YEAR = 2026;
const TOKEN = 'test-admin-token';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

const ELIGIBLE = getDraftEligibleTeams((teamsData as TeamsJson).items);

const params = Promise.resolve({ slug: SLUG, year: String(YEAR) });

/**
 * Build a complete draft for `ownerCount` owners using real catalog team names.
 * `rounds` defaults to the catalog maximum; pass a smaller value to model a
 * commissioner running fewer than the maximum rounds (a supported override).
 */
function completeDraft(
  ownerCount: number,
  rounds?: number
): {
  draft: DraftState;
  teamsPerOwner: number;
  totalPicks: number;
} {
  const owners = Array.from({ length: ownerCount }, (_, i) => `Owner${i + 1}`);
  const teamsPerOwner = rounds ?? Math.floor(ELIGIBLE.length / ownerCount);
  const totalPicks = teamsPerOwner * ownerCount;

  const picks: DraftPick[] = [];
  for (let i = 0; i < totalPicks; i++) {
    picks.push({
      pickNumber: i + 1,
      round: Math.floor(i / ownerCount),
      roundPick: i % ownerCount,
      owner: owners[i % ownerCount]!,
      team: ELIGIBLE[i]!.school,
      pickedAt: '2026-08-01T00:00:00.000Z',
      autoSelected: false,
    });
  }

  const now = '2026-08-01T00:00:00.000Z';
  const draft: DraftState = {
    leagueSlug: SLUG,
    year: YEAR,
    phase: 'live',
    owners,
    settings: {
      style: 'snake',
      draftOrder: owners,
      pickTimerSeconds: 60,
      timerExpiryBehavior: 'pause-and-prompt',
      autoPickMetric: null,
      totalRounds: teamsPerOwner,
      scheduledAt: null,
    },
    picks,
    currentPickIndex: totalPicks,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return { draft, teamsPerOwner, totalPicks };
}

function confirmRequest(): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/confirm`, {
    method: 'POST',
    headers: { 'x-admin-token': TOKEN },
  });
}

function putSettingsRequest(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify(body),
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  await addLeague({
    slug: SLUG,
    displayName: 'Confirm Eligibility League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
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

test('confirm succeeds for a complete draft against the current teams.json (no classification)', async () => {
  // 2 owners → an even split with zero remainder for the typical 136-team catalog.
  const { draft, totalPicks } = completeDraft(2);
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);

  const res = await runWithRevalidateContext(() => POST(confirmRequest(), { params }));

  // Before DRAFT-010 this returned 422 ("0 of 0 picks") because the eligible count
  // was derived from a non-existent classification field.
  const body = (await res.json()) as {
    success: boolean;
    ownerCount: number;
    teamCount: number;
    error?: string;
  };
  assert.equal(res.status, 200, body.error ?? 'expected confirm to succeed');
  assert.equal(body.success, true);
  assert.equal(body.ownerCount, 2);
  assert.equal(body.teamCount, totalPicks);

  // Phase advanced to complete and an owner CSV was written.
  const persisted = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.equal(persisted?.value?.phase, 'complete');

  const csvRecord = await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv');
  assert.ok(csvRecord?.value, 'expected an owner CSV to be written');
  const rows = csvRecord.value.split('\n');
  assert.equal(rows[0], 'team,owner');
});

test('confirm writes NoClaim rows for undrafted eligible teams (remainder)', async () => {
  // 3 owners leaves a remainder of eligible teams undrafted; those must be written
  // as NoClaim rows, and the eligible set itself must never include NoClaim.
  const { draft, totalPicks } = completeDraft(3);
  const remainder = ELIGIBLE.length - totalPicks;
  assert.ok(remainder > 0, 'fixture expectation: 3 owners leave an undrafted remainder');

  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);

  const res = await runWithRevalidateContext(() => POST(confirmRequest(), { params }));
  assert.equal(res.status, 200, await res.text());

  const csvRecord = await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv');
  assert.ok(csvRecord?.value);
  const dataRows = csvRecord.value.split('\n').slice(1); // drop header
  const noClaimRows = dataRows.filter((r) => r.endsWith(',NoClaim'));

  assert.equal(dataRows.length, totalPicks + remainder);
  assert.equal(noClaimRows.length, remainder);
});

test('confirm honors a sub-maximum configured round count (does not demand max rounds)', async () => {
  // A 2-owner, 1-round draft completes at 2 picks. Confirmation must derive the
  // expected count from settings.totalRounds (2), NOT from floor(eligible/owners)
  // (which would expect the full 136-team catalog and 422 every short draft). All
  // remaining eligible teams are written as NoClaim.
  const rounds = 1;
  const { draft, totalPicks } = completeDraft(2, rounds);
  assert.equal(totalPicks, 2);
  assert.ok(
    rounds < Math.floor(ELIGIBLE.length / 2),
    'fixture expectation: configured rounds are below the catalog maximum'
  );

  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);

  const res = await runWithRevalidateContext(() => POST(confirmRequest(), { params }));
  const body = (await res.json()) as { success: boolean; teamCount: number; error?: string };
  assert.equal(res.status, 200, body.error ?? 'expected sub-max-round confirm to succeed');
  assert.equal(body.success, true);
  assert.equal(body.teamCount, totalPicks);

  const csvRecord = await getAppState<string>(`owners:${SLUG}:${YEAR}`, 'csv');
  assert.ok(csvRecord?.value);
  const dataRows = csvRecord.value.split('\n').slice(1); // drop header
  const noClaimRows = dataRows.filter((r) => r.endsWith(',NoClaim'));

  // Every undrafted eligible team becomes NoClaim: 2 drafted + (eligible - 2) unclaimed.
  assert.equal(dataRows.length, ELIGIBLE.length);
  assert.equal(noClaimRows.length, ELIGIBLE.length - totalPicks);
});

test('a completed draft cannot be made unconfirmable by changing totalRounds after picks exist', async () => {
  // Confirmation derives expected picks from settings.totalRounds. If PUT could
  // mutate totalRounds after the draft has picks, a complete 2-round draft (4
  // picks) bumped to 3 rounds would expect 6 picks and 422 on confirm. The PUT
  // route must reject the change so the finished roster stays confirmable.
  const { draft, totalPicks } = completeDraft(2, 2);
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);

  // Attempt to raise totalRounds on a started draft → rejected with 409.
  const putRes = await runWithRevalidateContext(() =>
    PUT(putSettingsRequest({ settings: { totalRounds: 3 } }), { params })
  );
  const putBody = (await putRes.json()) as { error?: string; field?: string };
  assert.equal(putRes.status, 409, 'expected totalRounds change on a started draft to be rejected');
  assert.match(putBody.error ?? '', /totalRounds cannot be changed/i);

  // The persisted round count is unchanged.
  const persisted = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.equal(persisted?.value?.settings.totalRounds, 2);

  // The completed roster is still confirmable.
  const confirmRes = await runWithRevalidateContext(() => POST(confirmRequest(), { params }));
  const confirmBody = (await confirmRes.json()) as {
    success: boolean;
    teamCount: number;
    error?: string;
  };
  assert.equal(confirmRes.status, 200, confirmBody.error ?? 'expected confirm to still succeed');
  assert.equal(confirmBody.success, true);
  assert.equal(confirmBody.teamCount, totalPicks);
});

test('a completed draft cannot be made unconfirmable by changing owners after picks exist', async () => {
  // Confirmation validates per-owner pick counts and the owner set. If PUT could
  // mutate owners after picks exist, a finished roster would no longer match the
  // owner set it was drafted against. The PUT route must reject the change.
  const { draft, totalPicks } = completeDraft(2, 2);
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);
  const originalOwners = [...draft.owners];

  // Attempt to swap the owner set on a started draft → rejected with 409.
  const putRes = await runWithRevalidateContext(() =>
    PUT(putSettingsRequest({ owners: ['Intruder1', 'Intruder2'] }), { params })
  );
  const putBody = (await putRes.json()) as { error?: string; field?: string };
  assert.equal(putRes.status, 409, 'expected owner change on a started draft to be rejected');
  assert.match(putBody.error ?? '', /owners cannot be changed/i);

  // The persisted owner set is unchanged.
  const persisted = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.deepEqual(persisted?.value?.owners, originalOwners);

  // The completed roster is still confirmable.
  const confirmRes = await runWithRevalidateContext(() => POST(confirmRequest(), { params }));
  const confirmBody = (await confirmRes.json()) as {
    success: boolean;
    teamCount: number;
    error?: string;
  };
  assert.equal(confirmRes.status, 200, confirmBody.error ?? 'expected confirm to still succeed');
  assert.equal(confirmBody.success, true);
  assert.equal(confirmBody.teamCount, totalPicks);
});
