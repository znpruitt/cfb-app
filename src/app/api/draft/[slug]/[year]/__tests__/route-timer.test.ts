import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, PUT } from '../route';
import { POST as PICK } from '../pick/route';
import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { type DraftState, type DraftSettings, draftScope } from '@/lib/draft';

// ---------------------------------------------------------------------------
// DRAFT-001 — pick/timer persistence integrity.
//
// These tests lock in the invariant that the draft routes persist exactly the
// timer state they return: the value written to the store via setAppState must
// equal the value serialized into the HTTP response. A stale feature branch
// once stamped timerExpiresAt AFTER the store write and returned it, leaving the
// persisted state with timerState:'running' but timerExpiresAt:null — a divergence
// that blanked the live countdown for every poller/refresher. main is already
// correct; this suite is the regression guard so it stays that way.
//
// They also cover server-authoritative round-boundary pausing (DRAFT-002): both
// the manual pick route and the auto-pick path return phase:'paused' when an
// advanced index lands on a round boundary, so the commissioner must explicitly
// start the next round.
// ---------------------------------------------------------------------------

const SLUG = 'timer-test-league';
const YEAR = 2026;
const TOKEN = 'test-admin-token';
const OWNERS = ['Alice', 'Bob'];

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

function draftSettings(overrides: Partial<DraftSettings> = {}): DraftSettings {
  return {
    style: 'snake',
    draftOrder: [...OWNERS],
    pickTimerSeconds: 60,
    timerExpiryBehavior: 'pause-and-prompt',
    autoPickMetric: null,
    totalRounds: 2, // 2 owners x 2 rounds = 4 total picks; round boundary at index 2
    scheduledAt: null,
    ...overrides,
  };
}

function liveDraft(overrides: Partial<DraftState> = {}): DraftState {
  const now = '2026-08-01T00:00:00.000Z';
  return {
    leagueSlug: SLUG,
    year: YEAR,
    phase: 'live',
    owners: [...OWNERS],
    settings: draftSettings(overrides.settings),
    picks: [],
    currentPickIndex: 0,
    timerState: 'running',
    timerExpiresAt: '2026-08-01T00:01:00.000Z',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seedDraft(draft: DraftState): Promise<void> {
  await setAppState<DraftState>(draftScope(SLUG), String(YEAR), draft);
}

async function readPersisted(): Promise<DraftState> {
  const record = await getAppState<DraftState>(draftScope(SLUG), String(YEAR));
  assert.ok(record?.value, 'expected a persisted draft');
  return record.value;
}

function pickRequest(team: string, owner?: string): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify(owner ? { team, owner } : { team }),
  });
}

function putRequest(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ slug: SLUG, year: String(YEAR) });

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  await addLeague({
    slug: SLUG,
    displayName: 'Timer Test League',
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

test('normal pick: persists running timer with non-null expiry equal to the response', async () => {
  await seedDraft(liveDraft({ currentPickIndex: 0 }));

  const res = await PICK(pickRequest('Texas'), { params });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { draft: DraftState };

  // Response shape: timer re-armed for the next pick.
  assert.equal(body.draft.phase, 'live');
  assert.equal(body.draft.timerState, 'running');
  assert.equal(body.draft.currentPickIndex, 1);
  assert.ok(body.draft.timerExpiresAt, 'response must carry a non-null timerExpiresAt');
  assert.doesNotThrow(() => new Date(body.draft.timerExpiresAt!).toISOString());

  // Core invariant: persisted == returned for the timer fields.
  const persisted = await readPersisted();
  assert.equal(persisted.timerState, body.draft.timerState);
  assert.equal(persisted.timerExpiresAt, body.draft.timerExpiresAt);
  assert.equal(persisted.currentPickIndex, body.draft.currentPickIndex);
});

test('GET returns the exact persisted timer state after a pick (no server/client drift)', async () => {
  await seedDraft(liveDraft({ currentPickIndex: 0 }));

  const pickRes = await PICK(pickRequest('Alabama'), { params });
  const picked = (await pickRes.json()) as { draft: DraftState };

  const getRes = await GET(new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`), { params });
  assert.equal(getRes.status, 200);
  const got = (await getRes.json()) as { draft: DraftState };

  assert.equal(got.draft.timerState, picked.draft.timerState);
  assert.equal(got.draft.timerExpiresAt, picked.draft.timerExpiresAt);
  assert.ok(got.draft.timerExpiresAt, 'GET must surface a live countdown target, not null');
});

test('round-boundary pick pauses server-side (DRAFT-002): phase paused, timer paused, null expiry', async () => {
  // currentPickIndex 1 -> newPickIndex 2 lands on a round boundary (n=2).
  // The pick route now pauses so the commissioner must start the next round.
  await seedDraft(
    liveDraft({
      currentPickIndex: 1,
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Texas',
          pickedAt: '2026-08-01T00:00:30.000Z',
          autoSelected: false,
        },
      ],
    })
  );

  const res = await PICK(pickRequest('Georgia'), { params });
  const body = (await res.json()) as { draft: DraftState };

  assert.equal(body.draft.currentPickIndex, 2);
  assert.equal(body.draft.phase, 'paused');
  assert.equal(body.draft.timerState, 'paused');
  assert.equal(body.draft.timerExpiresAt, null);

  const persisted = await readPersisted();
  assert.equal(persisted.phase, body.draft.phase);
  assert.equal(persisted.timerState, body.draft.timerState);
  assert.equal(persisted.timerExpiresAt, body.draft.timerExpiresAt);
});

test('non-boundary pick still advances live+running (DRAFT-002 leaves mid-round picks alone)', async () => {
  // currentPickIndex 0 -> newPickIndex 1 is mid-round (n=2): no pause.
  await seedDraft(liveDraft({ currentPickIndex: 0 }));

  const res = await PICK(pickRequest('Georgia'), { params });
  const body = (await res.json()) as { draft: DraftState };

  assert.equal(body.draft.currentPickIndex, 1);
  assert.equal(body.draft.phase, 'live');
  assert.equal(body.draft.timerState, 'running');
  assert.ok(body.draft.timerExpiresAt);
});

test('auto-pick that completes a round also pauses server-side (DRAFT-002)', async () => {
  // Commissioner clicks auto-pick from the expired-prompt overlay (paused+expired).
  // currentPickIndex 1 -> newPickIndex 2 is a round boundary, so it pauses.
  await seedDraft(
    liveDraft({
      phase: 'paused',
      timerState: 'expired',
      timerExpiresAt: null,
      currentPickIndex: 1,
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Texas',
          pickedAt: '2026-08-01T00:00:30.000Z',
          autoSelected: false,
        },
      ],
    })
  );

  const res = await PUT(putRequest({ timerAction: 'expire' }), { params });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { draft: DraftState };

  assert.equal(body.draft.currentPickIndex, 2);
  assert.equal(body.draft.phase, 'paused');
  assert.equal(body.draft.timerState, 'paused');
  assert.equal(body.draft.timerExpiresAt, null);
  assert.equal(body.draft.picks.length, 2);
  assert.equal(body.draft.picks[1]!.autoSelected, true);

  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'paused');
  assert.equal(persisted.timerState, 'paused');
  assert.equal(persisted.timerExpiresAt, null);
});

test('final pick: persists complete + timer off + null expiry, matching the response', async () => {
  // 4 total picks; seed at the last pick (index 3) with three prior picks recorded.
  await seedDraft(
    liveDraft({
      currentPickIndex: 3,
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Texas',
          pickedAt: 't',
          autoSelected: false,
        },
        {
          pickNumber: 2,
          round: 0,
          roundPick: 1,
          owner: 'Bob',
          team: 'Alabama',
          pickedAt: 't',
          autoSelected: false,
        },
        {
          pickNumber: 3,
          round: 1,
          roundPick: 0,
          owner: 'Bob',
          team: 'Georgia',
          pickedAt: 't',
          autoSelected: false,
        },
      ],
    })
  );

  const res = await PICK(pickRequest('Michigan'), { params });
  const body = (await res.json()) as { draft: DraftState };

  assert.equal(body.draft.currentPickIndex, 4);
  assert.equal(body.draft.phase, 'complete');
  assert.equal(body.draft.timerState, 'off');
  assert.equal(body.draft.timerExpiresAt, null);

  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'complete');
  assert.equal(persisted.timerState, 'off');
  assert.equal(persisted.timerExpiresAt, null);
});

test('PUT timerAction "start" persists the same expiry it returns', async () => {
  await seedDraft(liveDraft({ currentPickIndex: 0, timerState: 'off', timerExpiresAt: null }));

  const res = await PUT(putRequest({ timerAction: 'start' }), { params });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { draft: DraftState };

  assert.equal(body.draft.timerState, 'running');
  assert.ok(body.draft.timerExpiresAt, 'start must return a non-null expiry');

  const persisted = await readPersisted();
  assert.equal(persisted.timerState, 'running');
  assert.equal(persisted.timerExpiresAt, body.draft.timerExpiresAt);
});
