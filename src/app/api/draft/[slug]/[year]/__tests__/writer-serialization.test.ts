import assert from 'node:assert/strict';
import test from 'node:test';

import { PUT } from '../route';
import { POST as PICK } from '../pick/route';
import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
} from '@/lib/server/appStateStore';
import { type DraftState, type DraftSettings, draftScope } from '@/lib/draft';

// ---------------------------------------------------------------------------
// PLATFORM-102 — the two draft writers that can append a pick must serialize.
//
// Both `POST /pick` and `PUT { timerAction: 'expire' }` used to read the draft
// record, derive for a long stretch, then write the WHOLE record back. A commit
// landing in that window was erased by whichever write came second.
//
// The concrete loss: `DraftBoardClient` fires the expire PUT automatically when
// the countdown reaches zero. A pick submitted as the clock ran out committed,
// then expiry wrote its stale snapshot back — the pick vanished while its caller
// got a 200, and the board prompted for an auto-pick on a slot that had already
// been filled. Accepting that prompt assigned a RANDOM team to that owner.
//
// TWO KINDS OF TEST HERE, and only the first kind can fail if the transaction is
// removed:
//
//   1. STRUCTURAL — inject a key-lock acquisition failure and assert the route
//      cannot proceed. A route that reads via `getAppState` never asks for the
//      lock, so it would sail past the injection and succeed. This is the guard
//      that actually pins the fix. Mutation-proven: reverting either route to
//      getAppState/setAppState fails these.
//
//   2. BEHAVIOURAL — the buzzer-beater outcome. This documents what SHOULD
//      happen when a pick beats the clock, but note honestly that it passes
//      before the fix too, because it drives the routes sequentially. It is a
//      semantics regression guard, not evidence of serialization.
// ---------------------------------------------------------------------------

const SLUG = 'writer-serialization-league';
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
    totalRounds: 2,
    scheduledAt: null,
    ...overrides,
  };
}

/** A live draft whose timer has ALREADY elapsed — the buzzer-beater setup. */
function liveExpiredDraft(overrides: Partial<DraftState> = {}): DraftState {
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
    // In the past relative to any real clock, so `expire` is legitimately due.
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

function pickRequest(team: string): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify({ team }),
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
  __setAppStateKeyLockFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = TOKEN;
  await addLeague({
    slug: SLUG,
    displayName: 'Writer Serialization League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

test.after(() => {
  __setAppStateKeyLockFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
});

test('STRUCTURAL: POST /pick goes through the draft key lock', async () => {
  await seedDraft(liveExpiredDraft());

  // Scoped to the draft key so nothing else in the test is affected.
  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => PICK(pickRequest('Georgia'), { params }),
    'a pick that cannot take the lock must NOT proceed to a write'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 0, 'nothing was written');
});

test('STRUCTURAL: PUT { timerAction: expire } goes through the draft key lock', async () => {
  await seedDraft(liveExpiredDraft());

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => PUT(putRequest({ timerAction: 'expire' }), { params }),
    'an expiry that cannot take the lock must NOT proceed to a write'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'live', 'the draft was not moved to paused');
  assert.equal(persisted.timerState, 'running', 'timer state untouched');
});

test('BEHAVIOURAL: a pick that beats the clock survives, and the late expiry is refused', async () => {
  // Sequential, so this passes with or without the transaction — see the header.
  // It pins the OUTCOME the serialization is meant to produce.
  await seedDraft(liveExpiredDraft());

  const pickRes = await PICK(pickRequest('Georgia'), { params });
  assert.equal(pickRes.status, 200, 'the pick lands');

  // The pick refreshed the timer, so the expiry that was due a moment ago no
  // longer is. Under the lock this is the read the expiry actually sees.
  const expireRes = await PUT(putRequest({ timerAction: 'expire' }), { params });
  assert.equal(expireRes.status, 422, 'the late expiry is refused');
  const expireBody = (await expireRes.json()) as { error?: string };
  assert.match(String(expireBody.error), /Timer has not expired yet/);

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 1, 'the pick was NOT erased by the expiry');
  assert.equal(persisted.picks[0]?.team, 'Georgia');
  assert.equal(persisted.picks[0]?.autoSelected, false, 'and it is still the manual pick');
});

test('the expire-only path and the mixed-request path agree (shared applyTimerExpiry)', async () => {
  // `applyTimerExpiry` is shared so the serialized path and the legacy path
  // cannot drift. Drive the legacy path (expire alongside another field) and
  // assert it produces the same pause-and-prompt state.
  await seedDraft(liveExpiredDraft());

  const res = await PUT(putRequest({ timerAction: 'expire', owners: [...OWNERS] }), { params });
  assert.equal(res.status, 200);

  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'paused', 'natural expiry pauses');
  assert.equal(persisted.timerState, 'expired', 'and prompts');
  assert.equal(persisted.picks.length, 0, 'natural expiry never auto-picks');
});
