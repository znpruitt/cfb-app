import { runWithRevalidateContext } from './_setup/revalidateContext';

import assert from 'node:assert/strict';
import test from 'node:test';

import { PUT } from '../route';
import { POST as PICK } from '../pick/route';
import { POST as UNPICK } from '../unpick/route';
import { POST as RESET } from '../reset/route';
import { DELETE as REOPEN } from '../confirm/route';
import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  getAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
} from '@/lib/server/appStateStore';
import { type DraftState, type DraftSettings, draftScope } from '@/lib/draft';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
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

/**
 * A live draft whose timer has ALREADY elapsed — the buzzer-beater setup.
 *
 * `settings` is accepted PARTIALLY and merged over the defaults. It is applied
 * after the spread on purpose: it previously sat above `...overrides`, so a
 * caller passing `settings` replaced the defaults outright and got a DraftState
 * with no `totalRounds` or `draftOrder`. `totalRounds * owners.length` is then
 * NaN, the completeness guard passes, and the pick route dies in `getPickOwner`.
 * Invisible until a test passed `settings`, which none did.
 */
function liveExpiredDraft(
  overrides: Partial<Omit<DraftState, 'settings'>> & { settings?: Partial<DraftSettings> } = {}
): DraftState {
  const now = '2026-08-01T00:00:00.000Z';
  return {
    leagueSlug: SLUG,
    year: YEAR,
    phase: 'live',
    owners: [...OWNERS],
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
    settings: draftSettings(overrides.settings),
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

test('a timer action bundled with another field still pauses and prompts', async () => {
  // Round 3 removed the separate fast path, so a bundled request runs through the
  // same transaction as everything else. This pins that it still produces the
  // pause-and-prompt state rather than auto-picking.
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

test('GUARD: the PUT does no pool-backed I/O inside its transaction', () => {
  const src = sourceOf('../route.ts');
  // Round 3 removed the fast path; this is the whole PUT callback now.
  const fastPath = src.indexOf('const outcome = await withAppStateKeyTransaction');
  assert.ok(fastPath > 0, 'the PUT must open a key transaction');

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

test('GUARD: every draft-record writer goes through a transaction', () => {
  // This guard used to iterate a HAND-WRITTEN list of four files — the four I
  // happened to be thinking about. `confirm/route.ts` (Reopen) was not among
  // them, so the guard passed while a plain read-then-write sat right there, and
  // it asserted an invariant it never checked. Both reviewers found it.
  //
  // It now DERIVES its list by scanning the draft API directory, so a new writer
  // is covered the moment it exists rather than when someone remembers to add it
  // here. That is the whole point of the guard: catching what the author forgot.
  const apiDir = fileURLToPath(new URL('../', import.meta.url));

  function collectRoutes(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        found.push(...collectRoutes(full));
      } else if (entry.name === 'route.ts') {
        found.push(full);
      }
    }
    return found;
  }

  const routes = collectRoutes(apiDir);
  assert.ok(routes.length >= 5, `expected to find the draft routes, found ${routes.length}`);

  const writers = routes.filter((f) => readFileSync(f, 'utf8').includes('DraftState>'));
  assert.ok(writers.length >= 5, `expected several draft-record writers, found ${writers.length}`);

  for (const file of writers) {
    const src = readFileSync(file, 'utf8');
    const plainWrites = src.split('await setAppState<DraftState>').length - 1;
    if (plainWrites === 0) continue;

    // Draft CREATION is the one allowed exception, and it is allowed for a
    // reason rather than because it was overlooked: it builds a fresh record
    // instead of reading one and writing it back, so it cannot lose a pick. Its
    // own "already exists" check is a separate, much smaller concern.
    const putIndex = src.indexOf('export async function PUT(');
    const creationOnly =
      file.endsWith(`draft${sep}[slug]${sep}[year]${sep}route.ts`) &&
      putIndex > 0 &&
      !src.slice(putIndex).includes('await setAppState<DraftState>');

    assert.ok(
      creationOnly,
      `${file} writes the draft record outside a transaction — every mutation of ` +
        'an existing draft must be serialized (draft creation is the sole exception)'
    );
  }
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

test('Undo works in a LIVE draft with the timer running, mid-round', async () => {
  // Owner requirement (2026-08-15): Undo must remain usable during a live draft.
  // The serialization round must not have made it refuse or stall in the state it
  // is actually used in — timer running, several picks down, mid-round.
  await seedDraft(
    liveExpiredDraft({
      phase: 'live',
      timerState: 'running',
      timerExpiresAt: new Date(Date.now() + 45_000).toISOString(),
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Georgia',
          pickedAt: '2026-08-01T00:00:10.000Z',
          autoSelected: false,
        },
        {
          pickNumber: 2,
          round: 0,
          roundPick: 1,
          owner: 'Bob',
          team: 'Clemson',
          pickedAt: '2026-08-01T00:00:20.000Z',
          autoSelected: false,
        },
      ],
      currentPickIndex: 2,
    })
  );

  const res = await UNPICK(postRequest('unpick'), { params });
  assert.equal(res.status, 200, 'Undo must succeed in a live draft');

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 1, 'the last pick was removed');
  assert.equal(persisted.picks[0]?.team, 'Georgia', 'and the earlier pick is untouched');
  assert.equal(persisted.currentPickIndex, 1, 'the clock is back on Bob');
  assert.equal(persisted.phase, 'live', 'the draft is still live');
  assert.equal(persisted.timerState, 'running', 'and the timer restarted');
});

test('Undo works repeatedly, and after a pick lands through the same lock', async () => {
  // The realistic draft-night sequence: pick, undo, pick again, undo again.
  await seedDraft(
    liveExpiredDraft({
      phase: 'live',
      timerState: 'running',
      timerExpiresAt: new Date(Date.now() + 45_000).toISOString(),
    })
  );

  assert.equal((await PICK(pickRequest('Georgia'), { params })).status, 200, 'first pick');
  assert.equal((await UNPICK(postRequest('unpick'), { params })).status, 200, 'undo it');
  assert.equal((await PICK(pickRequest('Clemson'), { params })).status, 200, 'pick again');
  assert.equal((await UNPICK(postRequest('unpick'), { params })).status, 200, 'undo again');

  const persisted = await readPersisted();
  assert.equal(persisted.picks.length, 0);
  assert.equal(persisted.currentPickIndex, 0);
  assert.equal(persisted.phase, 'live', 'still live and usable');

  // And the undone team is selectable again — an Undo that left the team locked
  // out would be useless in a live draft.
  assert.equal((await PICK(pickRequest('Georgia'), { params })).status, 200, 'reselectable');
});

// ---------------------------------------------------------------------------
// Round 4 — the writer three rounds missed.
//
// Reopen (`DELETE /confirm`) was the last plain read-then-write on the draft
// record. It survived because every round worked from the writers I happened to
// be thinking about; the list was never derived by searching. The guard above
// now scans for writers instead of naming them.
// ---------------------------------------------------------------------------

test('STRUCTURAL: Reopen goes through the draft key lock', async () => {
  await seedDraft(
    liveExpiredDraft({
      phase: 'complete',
      timerState: 'off',
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Georgia',
          pickedAt: '2026-08-01T00:00:10.000Z',
          autoSelected: false,
        },
      ],
      currentPickIndex: 1,
      publishedPicks: 'sig-from-confirm',
    })
  );

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'), draftScope(SLUG));

  await assert.rejects(
    () => REOPEN(postRequest('confirm'), { params }),
    'Reopen must NOT proceed to a write without the lock'
  );

  __setAppStateKeyLockFailureForTests(null);
  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'complete', 'the draft was not reopened');
  assert.equal(persisted.publishedPicks, 'sig-from-confirm', 'the publication is intact');
});

test('Reopen still behaves correctly through the serialized path', async () => {
  await seedDraft(
    liveExpiredDraft({
      phase: 'complete',
      timerState: 'off',
      picks: [
        {
          pickNumber: 1,
          round: 0,
          roundPick: 0,
          owner: 'Alice',
          team: 'Georgia',
          pickedAt: '2026-08-01T00:00:10.000Z',
          autoSelected: false,
        },
      ],
      currentPickIndex: 1,
      publishedPicks: 'sig-from-confirm',
    })
  );

  // Reopen invalidates standings, which needs a request context the bare test
  // runner does not supply — the same helper the confirm suite uses.
  const res = await runWithRevalidateContext(() => REOPEN(postRequest('confirm'), { params }));
  assert.equal(res.status, 200);

  const persisted = await readPersisted();
  assert.equal(persisted.phase, 'live', 'reopened');
  assert.equal(persisted.picks.length, 1, 'picks preserved');
  assert.equal(
    persisted.publishedPicks,
    'sig-from-confirm',
    'the digest is preserved — phase alone retracts the publication'
  );
});

test('the fixture helper merges settings instead of replacing them', async () => {
  // This is the test whose absence hid a real bug: `settings:` sat above
  // `...overrides`, so passing `settings` dropped `totalRounds` and `draftOrder`
  // and the pick route died in `getPickOwner`. Nothing passed `settings` until
  // now, which is the only reason it was invisible.
  await seedDraft(
    liveExpiredDraft({
      phase: 'live',
      timerState: 'off',
      settings: { pickTimerSeconds: null },
    })
  );

  const persisted = await readPersisted();
  assert.equal(persisted.settings.pickTimerSeconds, null, 'the override applied');
  assert.equal(persisted.settings.totalRounds, 2, 'and the defaults survived');
  assert.deepEqual(persisted.settings.draftOrder, OWNERS, 'including the draft order');

  // And the route can actually use it.
  const res = await PICK(pickRequest('Georgia'), { params });
  assert.equal(res.status, 200, 'a pick works against the merged settings');
});

test('a malformed PUT against a missing draft answers 404, not 400', async () => {
  // Ordering preserved from before this slice, and matching the sibling pick
  // route. Round 3 flipped it by returning the parse failure early.
  const res = await PUT(
    new Request(`http://localhost/api/draft/${SLUG}/${YEAR}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: '{not valid json',
    }),
    { params }
  );

  assert.equal(res.status, 404, 'the missing draft is reported before the bad body');
});
