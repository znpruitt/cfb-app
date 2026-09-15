import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../appStateStore.ts';
import {
  clearPendingStandingsInvalidation,
  countPendingStandingsInvalidations,
  dischargePendingStandingsInvalidation,
  drainPendingStandingsInvalidations,
  listPendingStandingsInvalidations,
  readPendingStandingsInvalidation,
  recordPendingDrainAttempt,
  recordPendingStandingsInvalidation,
  STANDINGS_INVALIDATION_PENDING_SCOPE,
  type PendingStandingsInvalidation,
} from '../standingsInvalidationPending.ts';

/**
 * PLATFORM-693 v2 — the rebuilt pending-state contract.
 *
 * WHAT THESE TESTS CANNOT PROVE, stated rather than worked around: the STALENESS
 * itself. `unstable_cache` does not exist under `node:test` (`leagueStandings.ts:286`),
 * so the selector falls back to direct compute and there is no data cache to leave
 * stale. No fake is built — a harness that fakes the subject proves only that the fake
 * works. Confirming a stale READ needs a request context.
 *
 * What they do prove is the contract v1 got wrong three times: identity is a token,
 * a clear reports whether it CLEARED, and a count is derived from the thing it names.
 */

async function readRaw(year: number): Promise<unknown> {
  const row = await getAppState<unknown>(STANDINGS_INVALIDATION_PENDING_SCOPE, String(year));
  return row?.value ?? null;
}

const complete = async () => ({ result: 'complete' as const });
const busted_nothing = async () => ({ result: 'partial' as const });

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === R2 — identity is a TOKEN, and it is what makes a re-record visible ===

test('every record is a NEW obligation with a new token', async () => {
  await recordPendingStandingsInvalidation(2026);
  const first = await readPendingStandingsInvalidation(2026);
  await recordPendingStandingsInvalidation(2026);
  const second = await readPendingStandingsInvalidation(2026);

  assert.ok(first?.token && second?.token);
  // THE v1 DEFECT: a re-record reproduced the record byte-for-byte, so the guard could
  // not see the concurrent re-record it existed for.
  assert.notEqual(second.token, first.token, 'a re-record must be a distinguishable generation');
});

test('a re-record preserves the fault AGE and the repair EFFORT', async () => {
  // Three concepts, three fields. Identity changes; age and effort do not.
  await recordPendingStandingsInvalidation(2026, () => '2026-01-01T00:00:00.000Z');
  await recordPendingDrainAttempt(2026);
  await recordPendingDrainAttempt(2026);
  await recordPendingStandingsInvalidation(2026, () => '2026-09-01T00:00:00.000Z');

  const after = await readPendingStandingsInvalidation(2026);
  assert.equal(after?.since, '2026-01-01T00:00:00.000Z', 'age survives a re-record');
  assert.equal(after?.attempts, 2, 'effort survives a re-record');
});

test('a drain attempt does NOT advance the token', async () => {
  // A failed repair is the same obligation, not a new one. Advancing here would
  // invalidate a concurrent drain's observation for a change that is not an obligation.
  await recordPendingStandingsInvalidation(2026);
  const before = await readPendingStandingsInvalidation(2026);
  await recordPendingDrainAttempt(2026);
  const after = await readPendingStandingsInvalidation(2026);
  assert.equal(after?.token, before?.token);
  assert.equal(after?.attempts, 1);
});

test('a v1 record with no token matches no observation and is not readable as pending', async () => {
  // Migration: absent token is a DISTINCT generation. The first clear after deploy
  // declines, the next drain re-observes and succeeds — one extra cycle, no erasure.
  await setAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, '2026', {
    year: 2026,
    since: '2026-01-01T00:00:00.000Z',
    attempts: 0,
  } as unknown as PendingStandingsInvalidation);

  assert.equal(await readPendingStandingsInvalidation(2026), undefined);
  assert.equal(await countPendingStandingsInvalidations(), 0);
});

// === R2 + R7 — the race a counter could not close ===

test('a clear does NOT erase an obligation recorded while the walk ran', async () => {
  // THE RACE. The key transaction serializes the WRITES, not the walk.
  await recordPendingStandingsInvalidation(2026, () => '2026-01-01T00:00:00.000Z');
  const observed = (await readPendingStandingsInvalidation(2026))!;

  // ...a concurrent writer records a NEW obligation mid-walk. In v1 this produced a
  // byte-identical record and the clear proceeded.
  await recordPendingStandingsInvalidation(2026);

  assert.equal(await clearPendingStandingsInvalidation(2026, observed), false);
  assert.ok(await readPendingStandingsInvalidation(2026), 'the newer obligation must survive');
});

test('a clear with the CURRENT obligation still clears', async () => {
  // Positive control: without it, a clear that never clears passes the test above.
  await recordPendingStandingsInvalidation(2026);
  const observed = (await readPendingStandingsInvalidation(2026))!;
  assert.equal(await clearPendingStandingsInvalidation(2026, observed), true);
  assert.equal(await readPendingStandingsInvalidation(2026), undefined);
});

test('a token cannot collide across a clear and a fresh record', async () => {
  // Why identity and not order: a counter restarts after a clear, so a stale
  // observation of "1" would match a freshly recorded "1".
  await recordPendingStandingsInvalidation(2026);
  const stale = (await readPendingStandingsInvalidation(2026))!;
  await clearPendingStandingsInvalidation(2026, stale);
  await recordPendingStandingsInvalidation(2026);

  assert.equal(
    await clearPendingStandingsInvalidation(2026, stale),
    false,
    'a stale observation must never match a post-clear record'
  );
  assert.ok(await readPendingStandingsInvalidation(2026));
});

// === R4 — the clear reports the RESULT, not the attempt ===

test('clearing when nothing is pending reports false', async () => {
  assert.equal(
    await clearPendingStandingsInvalidation(2031, {
      year: 2031,
      token: 'anything',
      since: '2026-01-01T00:00:00.000Z',
      attempts: 0,
    }),
    false
  );
});

test('a drain whose clear did not confirm counts the year as still pending', async () => {
  // v1 incremented `cleared` unconditionally after awaiting a void clear, so four failed
  // clears reported zero still pending — a swallowed failure producing a false
  // all-clear, which is this issue's own defect.
  await recordPendingStandingsInvalidation(2026);
  const observed = (await readPendingStandingsInvalidation(2026))!;

  // The walk succeeds, but a concurrent obligation makes the clear decline.
  const summary = await drainPendingStandingsInvalidations(async (year) => {
    await recordPendingStandingsInvalidation(year);
    return { result: 'complete' };
  });

  assert.equal(summary.stillPending, 1, 'a declined clear must not read as cleared');
  const after = await readPendingStandingsInvalidation(2026);
  assert.ok(after && after.token !== observed.token);
});

// === R5 — stillPending comes from the DURABLE SET, not the drained slice ===

test('a backlog larger than the drain bound is reported, not hidden', async () => {
  // v1 derived `stillPending` from `pending.length`, already capped at the bound, so ten
  // pending years drained four and reported zero while six stayed stale.
  for (const year of [2011, 2012, 2013, 2014, 2015, 2016]) {
    await recordPendingStandingsInvalidation(year, () => `${year}-01-01T00:00:00.000Z`);
  }

  const summary = await drainPendingStandingsInvalidations(complete);

  assert.equal(summary.stillPending, 2, 'six pending, four drained, two must be reported');
  assert.equal(await countPendingStandingsInvalidations(), 2);
});

// === R12 — clear only on a walk that actually busted ===

test('a walk that busted nothing leaves the obligation standing', async () => {
  // `partial` is what an all-benign (E263) walk produces: nothing threw, nothing busted.
  await recordPendingStandingsInvalidation(2026);
  const summary = await drainPendingStandingsInvalidations(busted_nothing);

  assert.equal(summary.stillPending, 1);
  const after = await readPendingStandingsInvalidation(2026);
  assert.equal(after?.attempts, 1, 'and the effort is counted, so a stuck year is visible');
});

test('a walk that could not read the registry leaves the obligation standing', async () => {
  await recordPendingStandingsInvalidation(2025);
  const summary = await drainPendingStandingsInvalidations(async () => ({
    result: 'registry-failed',
  }));
  assert.equal(summary.stillPending, 1, 'population unknown is not a repair');
});

// === R16 — ordering rotates rather than starving ===

test('a permanently failing year YIELDS to a fresher repairable one', async () => {
  // Oldest-first alone lets four unrepairable years hold every slot forever while a
  // fifth, repairable year is never attempted.
  await recordPendingStandingsInvalidation(2020, () => '2026-01-01T00:00:00.000Z');
  await recordPendingDrainAttempt(2020);
  await recordPendingDrainAttempt(2020);
  await recordPendingStandingsInvalidation(2021, () => '2026-06-01T00:00:00.000Z');

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'complete' };
  }, 1);

  assert.deepEqual(walked, [2021], 'fewest attempts first');
});

test('among equal effort, the oldest fault goes first', async () => {
  await recordPendingStandingsInvalidation(2020, () => '2026-06-01T00:00:00.000Z');
  await recordPendingStandingsInvalidation(2021, () => '2026-01-01T00:00:00.000Z');

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'complete' };
  }, 1);

  assert.deepEqual(walked, [2021]);
});

// === R17 — never throws, in every direction ===

test('a walk that THROWS is contained and counted', async () => {
  // The drain runs inside a cron whose schedule commit already succeeded. Throwing
  // would turn a completed state change into a failure.
  await recordPendingStandingsInvalidation(2023);
  await assert.doesNotReject(
    drainPendingStandingsInvalidations(async () => {
      throw new Error('registry exploded');
    })
  );
  assert.equal((await readPendingStandingsInvalidation(2023))?.attempts, 1);
});

test('an unreadable pending row is stepped over, not thrown on', async () => {
  await setAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, '2019', {
    nonsense: true,
  } as unknown as PendingStandingsInvalidation);
  await recordPendingStandingsInvalidation(2018);

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'complete' };
  });

  assert.deepEqual(walked, [2018], 'one unreadable key must not hide the rest');
});

test('an empty pending set walks nothing and reports zero', async () => {
  let calls = 0;
  const summary = await drainPendingStandingsInvalidations(async () => {
    calls += 1;
    return { result: 'complete' };
  });
  assert.equal(calls, 0);
  assert.equal(summary.stillPending, 0);
  assert.deepEqual(await listPendingStandingsInvalidations(), []);
});

// === Trigger B — the discharge the manual repair path reaches ===

test('discharging a pending year busts and clears it', async () => {
  await recordPendingStandingsInvalidation(2026);
  await dischargePendingStandingsInvalidation(2026, complete);
  assert.equal(await readPendingStandingsInvalidation(2026), undefined);
});

test('discharging a year with nothing pending walks nothing', async () => {
  // It runs on EVERY full-season refresh, so it must be free when there is nothing to
  // repair — otherwise the fix taxes every ordinary cron year.
  let calls = 0;
  await dischargePendingStandingsInvalidation(2026, async () => {
    calls += 1;
    return { result: 'complete' };
  });
  assert.equal(calls, 0);
});

test('a discharge whose walk did not bust leaves the obligation standing', async () => {
  await recordPendingStandingsInvalidation(2026);
  await dischargePendingStandingsInvalidation(2026, busted_nothing);
  const after = await readPendingStandingsInvalidation(2026);
  assert.ok(after);
  assert.equal(after.attempts, 1);
});

// === A cleared record is not readable as pending ===

test('a cleared year reports nothing pending', async () => {
  await recordPendingStandingsInvalidation(2026);
  const observed = (await readPendingStandingsInvalidation(2026))!;
  await clearPendingStandingsInvalidation(2026, observed);

  assert.equal(await countPendingStandingsInvalidations(), 0);
  assert.deepEqual(await listPendingStandingsInvalidations(), []);
  // The row may survive as a cleared marker; what must not survive is any reading of it
  // as an outstanding obligation.
  assert.notEqual(await readRaw(2026), undefined);
});

test('a clear that could not reach the store reports FALSE, not success', async () => {
  // THE DEFECT CLASS ITSELF. This function must never throw, so a swallowed store
  // failure that returned `true` would be a false all-clear — exactly what made four
  // failed clears report zero still pending in v1.
  await recordPendingStandingsInvalidation(2026);
  const observed = (await readPendingStandingsInvalidation(2026))!;

  __setAppStateReadFailureForTests(new Error('store unavailable'));
  try {
    assert.equal(await clearPendingStandingsInvalidation(2026, observed), false);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.ok(await readPendingStandingsInvalidation(2026), 'the obligation must survive');
});

/**
 * NOT COVERED, AND THE HARNESS IS WHY: the token re-check INSIDE the transaction.
 *
 * `clearPendingStandingsInvalidation` checks the token twice — once on the advisory read
 * before the lock, once inside it. A mutation removing the INNER check leaves this suite
 * green, because the outer read already catches every mismatch a single-threaded test
 * can produce. The inner check guards the window between the outer read and the lock,
 * and `node:test` cannot open that window: there is no second writer to interleave.
 *
 * Stated rather than papered over, and deliberately kept: it is defence-in-depth for a
 * real concurrency window (two instances, one year), and the alternative — deleting it
 * because no in-process test can reach it — would remove the only protection on the very
 * race the token exists for, in production.
 */
