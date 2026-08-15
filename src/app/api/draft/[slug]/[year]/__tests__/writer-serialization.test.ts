import assert from 'node:assert/strict';
import test from 'node:test';

import { PUT } from '../route';
import { POST as PICK } from '../pick/route';
import { POST as UNPICK } from '../unpick/route';
import { POST as RESET } from '../reset/route';
import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
} from '@/lib/server/appStateStore';
import { type DraftState, type DraftSettings, draftScope } from '@/lib/draft';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
    // Computed, not hardcoded. A literal here ('2026-08-01T00:01:00.000Z') was
    // in the FUTURE when this suite was written and only became "expired" through
    // wall-clock drift — so the tests that depend on the timer having elapsed
    // would have silently inverted depending on when they ran.
    timerExpiresAt: new Date(Date.now() - 60_000).toISOString(),
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

// ---------------------------------------------------------------------------
// The deadlock guard.
//
// Review found a P1 in the first version of this slice: `getScopedAliasMap` (two
// `getAppState` reads) and `await req.json()` were moved INSIDE the pick
// transaction. `withAppStateKeyTransaction` holds one of only three pooled
// clients (`appStateStore.ts` → `max: 3`, no `connectionTimeoutMillis`) for the
// whole callback, and same-key waiters hold a client each while blocked on the
// advisory lock — so a nested pool read needs a client that can never be freed.
// Two concurrent picks would have deadlocked the pool process-wide.
//
// Tests cannot observe this: the suite runs the file-backed store, which has no
// pool. A SOURCE guard is therefore the honest pin, and it is mutation-proof —
// moving either call back inside the callback fails it.
// ---------------------------------------------------------------------------

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

test('GUARD: the pick route does no pool-backed I/O inside the transaction', () => {
  const src = sourceOf('../pick/route.ts');

  // Anchor on the CALL, not the import at the top of the file — matching the
  // import made this guard pass vacuously for everything below it.
  const txnAt = src.lastIndexOf('await withAppStateKeyTransaction');
  assert.ok(txnAt > 0, 'the pick route must open a key transaction');

  // Anchor on the AWAITED CALL, and assert on the LAST occurrence.
  //
  // This guard has now been vacuous twice, both times by matching prose instead
  // of code: first `withAppStateKeyTransaction` matched the import line, then
  // `req.json(` matched a COMMENT in the route that says "Same for `req.json()`".
  // Review caught the second by moving the real call inside the callback and
  // watching this test stay green. `lastIndexOf` plus the `await` prefix means a
  // mention in prose can no longer satisfy it.
  for (const call of ['await getScopedAliasMap(', 'await req.json(']) {
    const at = src.lastIndexOf(call);
    assert.ok(at > 0, `expected ${call} in the pick route`);
    assert.ok(
      at < txnAt,
      `${call} must run BEFORE withAppStateKeyTransaction — a pooled read inside ` +
        'the callback deadlocks the 3-client pool under concurrent same-draft requests'
    );
  }

  // Nothing else may reach the pool from inside either.
  const callback = src.slice(txnAt);
  assert.ok(
    !callback.includes('getAppState('),
    'no getAppState inside the transaction callback — use txn.read'
  );
  assert.ok(
    !callback.includes('setAppState('),
    'no setAppState inside the transaction callback — use txn.write'
  );
});

test('GUARD: the timer-only fast path does no pool-backed I/O inside the transaction', () => {
  const src = sourceOf('../route.ts');
  const fastPath = src.indexOf('const outcome = await withAppStateKeyTransaction');
  assert.ok(fastPath > 0, 'the timer-only fast path must open a key transaction');

  // The callback ends where the outcome is mapped back to a response.
  const end = src.indexOf("if (!('ok' in outcome))", fastPath);
  assert.ok(end > fastPath, 'expected the outcome mapping after the callback');
  const callback = src.slice(fastPath, end);

  for (const banned of [
    'getAppState(',
    'setAppState(',
    'getScopedAliasMap(',
    'getConfirmedRoster(',
  ]) {
    assert.ok(
      !callback.includes(banned),
      `${banned} must not run inside the timer transaction callback (pool deadlock)`
    );
  }
});

test('STRUCTURAL: PUT { timerAction: pause } also goes through the draft key lock', async () => {
  // Review finding: `start`, `pause` and `resume` are sent ALONE by DraftControls
  // and DraftBoardClient too, take the same whole-record write, and could erase a
  // concurrently-committed pick exactly as expiry could. They are now serialized
  // by the same fast path.
  await seedDraft(liveExpiredDraft());

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => PUT(putRequest({ timerAction: 'pause' }), { params }),
    'a pause that cannot take the lock must NOT proceed to a write'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.timerState, 'running', 'timer state untouched');
});

test('a timer-only pause still behaves correctly through the serialized path', async () => {
  await seedDraft(liveExpiredDraft());

  const res = await PUT(putRequest({ timerAction: 'pause' }), { params });
  assert.equal(res.status, 200);

  const persisted = await readPersisted();
  assert.equal(persisted.timerState, 'paused');
  assert.equal(persisted.timerExpiresAt, null);
  assert.equal(persisted.phase, 'live', 'pause does not change phase');
});

// ---------------------------------------------------------------------------
// The gap that carve-outs kept leaving open.
//
// Two earlier versions serialized only a narrow slice of the PUT, on the
// reasoning that clients never bundle a timer action with anything else. Review
// found three call sites that do exactly that: `DraftBoardClient` sends
// `{ phase: 'live', timerAction: 'start' }` from the round-boundary resume
// inside handlePick, from handleResume, and from handleStartRound. All three
// fell through to the unlocked path — so "Start round", the button pressed at
// every round boundary, could still erase a pick that committed while it ran.
//
// The whole handler is now transactional, so there is no combination left to
// predict. These tests pin that.
// ---------------------------------------------------------------------------

test('STRUCTURAL: a bundled { phase, timerAction } PUT goes through the draft key lock', async () => {
  // The exact body DraftBoardClient sends from Start round / Resume.
  await seedDraft(liveExpiredDraft({ phase: 'paused', timerState: 'paused' }));

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => PUT(putRequest({ phase: 'live', timerAction: 'start' }), { params }),
    'Start round must NOT proceed to a write without the lock'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'paused', 'the draft was not moved to live');
});

test('STRUCTURAL: an owners/settings PUT goes through the draft key lock', async () => {
  await seedDraft(liveExpiredDraft({ phase: 'settings', picks: [], timerState: 'off' }));

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => PUT(putRequest({ settings: { pickTimerSeconds: 90 } }), { params }),
    'a settings write must NOT proceed without the lock'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.settings.pickTimerSeconds, 60, 'settings untouched');
});

test('a null JSON body is refused by the draft-state guards, not a crash', async () => {
  // `JSON.parse('null')` succeeds, so the body arrives as null. Destructuring it
  // threw a TypeError (a 500) where the state guards should answer.
  await seedDraft(liveExpiredDraft({ phase: 'complete' }));

  const res = await PUT(
    new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: 'null',
    }),
    { params }
  );

  assert.ok(res.status < 500, `expected a controlled refusal, got ${res.status}`);
});

// ---------------------------------------------------------------------------
// Round 3 — the last two buttons on the draft board.
//
// Undo and Reset were scoped out of rounds 1 and 2 on the reasoning that they
// are pressed deliberately, when nothing else is in flight. Review disagreed and
// was right: `DraftBoardClient.handleUndo` is a button on the board DURING the
// draft, so a pick landing as it is pressed hit the exact failure this slice
// exists to close. No unserialized draft-record writer remains behind a button
// on that screen.
// ---------------------------------------------------------------------------

function postRequest(path: string): Request {
  return new Request(`http://localhost/api/draft/${SLUG}/${YEAR}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify({}),
  });
}

test('STRUCTURAL: Undo goes through the draft key lock', async () => {
  await seedDraft(
    liveExpiredDraft({
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Georgia',
          pickedAt: '2026-08-01T00:00:30.000Z',
          autoSelected: false,
        },
      ],
      currentPickIndex: 1,
    })
  );

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => UNPICK(postRequest('unpick'), { params }),
    'Undo must NOT proceed to a write without the lock'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 1, 'the pick is still there');
});

test('STRUCTURAL: Reset goes through the draft key lock', async () => {
  await seedDraft(liveExpiredDraft());

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => RESET(postRequest('reset'), { params }),
    'Reset must NOT proceed to a write without the lock'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'live', 'the draft was not reset');
});

test('GUARD: no draft-record writer bypasses the transaction', () => {
  // The whole point of round 3. Every route that writes the draft record must go
  // through a key transaction — a plain `setAppState` on the draft scope is the
  // shape that loses picks, and it is what three rounds of carve-outs kept
  // leaving behind somewhere.
  for (const route of ['../pick/route.ts', '../unpick/route.ts', '../reset/route.ts']) {
    const src = sourceOf(route);
    assert.ok(
      src.includes('withAppStateKeyTransaction'),
      `${route} must serialize its draft-record write`
    );
    assert.ok(
      !src.includes('await setAppState<DraftState>'),
      `${route} still writes the draft record outside a transaction`
    );
  }

  // The PUT only — draft CREATION (`POST`) lives in the same file and is
  // deliberately excluded. It builds a fresh record rather than reading one and
  // writing it back, so it cannot lose a pick; its own read-then-write on the
  // "already exists" 409 check is a separate, much smaller concern and is not in
  // this slice's scope.
  const routeSrc = sourceOf('../route.ts');
  const putOnly = routeSrc.slice(routeSrc.indexOf('export async function PUT('));
  assert.ok(putOnly.includes('withAppStateKeyTransaction'), 'the PUT must serialize');
  assert.ok(
    !putOnly.includes('await setAppState<DraftState>'),
    'the PUT still writes the draft record outside a transaction'
  );
});

test('Undo still behaves correctly through the serialized path', async () => {
  await seedDraft(
    liveExpiredDraft({
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Georgia',
          pickedAt: '2026-08-01T00:00:30.000Z',
          autoSelected: false,
        },
      ],
      currentPickIndex: 1,
    })
  );

  const res = await UNPICK(postRequest('unpick'), { params });
  assert.equal(res.status, 200);

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 0, 'the pick was undone');
  assert.equal(persisted.currentPickIndex, 0);
  assert.equal(persisted.phase, 'live');
});
