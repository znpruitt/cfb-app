import assert from 'node:assert/strict';
import test from 'node:test';

import { POST as PICK } from '../pick/route';
import { PUT as EDIT_PICK } from '../pick/[n]/route';
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
// DRAFT-010 — pick/confirm eligibility consistency.
//
// The confirm route validates picks against the draft-eligible catalog (team
// `school` set). The pick routes must use the SAME definition: a seeded alias
// like `albany -> ualbany` or `southeastern la -> se louisiana` resolves to a
// non-null canonicalName that is NOT in teams.json. Accepting it (because it is
// merely `!= NoClaim`) would persist a pick that confirm later rejects, leaving
// an unconfirmable draft. These tests lock both pick route variants to a catalog
// membership check.
// ---------------------------------------------------------------------------

type TeamsJson = { items: TeamCatalogItem[] };

const SLUG = 'pick-eligibility-league';
const YEAR = 2026;
const TOKEN = 'test-admin-token';
const OWNERS = ['Alice', 'Bob'];

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

const ELIGIBLE_SCHOOLS = new Set(
  getDraftEligibleTeams((teamsData as TeamsJson).items).map((t) => t.school.toLowerCase())
);

// An alias whose canonical target is NOT in the FBS catalog (FCS school).
const OUT_OF_CATALOG_ALIAS = 'albany'; // -> 'ualbany', absent from teams.json

function liveDraft(overrides: Partial<DraftState> = {}): DraftState {
  const now = '2026-08-01T00:00:00.000Z';
  return {
    leagueSlug: SLUG,
    year: YEAR,
    phase: 'live',
    owners: [...OWNERS],
    settings: {
      style: 'snake',
      draftOrder: [...OWNERS],
      pickTimerSeconds: 60,
      timerExpiryBehavior: 'pause-and-prompt',
      autoPickMetric: null,
      totalRounds: 2, // 2 owners x 2 rounds = 4 picks
      scheduledAt: null,
    },
    picks: [],
    currentPickIndex: 0,
    timerState: 'running',
    timerExpiresAt: '2026-08-01T00:01:00.000Z',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function existingPick(team: string): DraftPick {
  return {
    pickNumber: 1,
    round: 0,
    roundPick: 0,
    owner: 'Alice',
    team,
    pickedAt: '2026-08-01T00:00:30.000Z',
    autoSelected: false,
  };
}

async function seed(draft: DraftState): Promise<void> {
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);
}

async function readPersisted(): Promise<DraftState> {
  const record = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.ok(record?.value, 'expected a persisted draft');
  return record.value;
}

function pickRequest(team: string): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify({ team }),
  });
}

function editPickRequest(team: string): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/pick/1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify({ team }),
  });
}

const pickParams = Promise.resolve({ slug: SLUG, year: String(YEAR) });
const editParams = Promise.resolve({ slug: SLUG, year: String(YEAR), n: '1' });

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  await addLeague({
    slug: SLUG,
    displayName: 'Pick Eligibility League',
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

// --- POST /pick (make a new pick) -----------------------------------------

test('POST /pick rejects an alias resolving to an out-of-catalog team and does not persist', async () => {
  await seed(liveDraft());

  const res = await PICK(pickRequest(OUT_OF_CATALOG_ALIAS), { params: pickParams });
  assert.equal(res.status, 400, 'out-of-catalog alias must be rejected at pick time');

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 0, 'rejected pick must not be persisted');
  assert.equal(persisted.currentPickIndex, 0, 'pick index must not advance on a rejected pick');
});

test('POST /pick accepts a direct catalog team and persists it', async () => {
  await seed(liveDraft());

  const res = await PICK(pickRequest('Texas'), { params: pickParams });
  assert.equal(res.status, 200, await res.text());

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 1);
  assert.equal(persisted.picks[0]!.team, 'Texas');
});

test('POST /pick accepts a valid alias that resolves to a catalog team', async () => {
  await seed(liveDraft());

  // 'app state' -> 'appalachian state' -> a real FBS catalog team.
  const res = await PICK(pickRequest('app state'), { params: pickParams });
  assert.equal(res.status, 200, await res.text());

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 1);
  assert.ok(
    ELIGIBLE_SCHOOLS.has(persisted.picks[0]!.team.toLowerCase()),
    `resolved team "${persisted.picks[0]!.team}" must be in the eligible catalog`
  );
});

// --- PUT /pick/[n] (edit an existing pick) --------------------------------

test('PUT /pick/[n] rejects an out-of-catalog alias and leaves the existing pick unchanged', async () => {
  await seed(liveDraft({ currentPickIndex: 1, picks: [existingPick('Texas')] }));

  const res = await EDIT_PICK(editPickRequest(OUT_OF_CATALOG_ALIAS), { params: editParams });
  assert.equal(res.status, 400, 'out-of-catalog alias must be rejected when editing a pick');

  const persisted = await readPersisted();
  assert.equal(persisted.picks[0]!.team, 'Texas', 'rejected edit must not overwrite the pick');
});

test('PUT /pick/[n] accepts a valid catalog team and updates the pick', async () => {
  await seed(liveDraft({ currentPickIndex: 1, picks: [existingPick('Texas')] }));

  const res = await EDIT_PICK(editPickRequest('Georgia'), { params: editParams });
  assert.equal(res.status, 200, await res.text());

  const persisted = await readPersisted();
  assert.equal(persisted.picks[0]!.team, 'Georgia');
});
