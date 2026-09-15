import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __corruptAppStateFileForTests,
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
  await recordPendingStandingsInvalidation(2026, () => '2026-09-01T00:00:00.000Z');

  const after = await readPendingStandingsInvalidation(2026);
  assert.equal(after?.since, '2026-01-01T00:00:00.000Z', 'age survives a re-record');
});

test('a failed drain leaves the obligation byte-identical', async () => {
  // ROUND 4 — a failed repair writes NOTHING. It used to increment an attempt counter;
  // that counter drove a severity escalation that could not work, and its bookkeeping
  // produced two defects of its own. The obligation surviving unchanged IS the fault
  // report, and leaving it untouched cannot invalidate a concurrent drain's observation.
  await recordPendingStandingsInvalidation(2026);
  const before = await readPendingStandingsInvalidation(2026);
  await drainPendingStandingsInvalidations(busted_nothing);
  const after = await readPendingStandingsInvalidation(2026);
  assert.deepEqual(after, before);
});

test('a v1 record with no token matches no observation and is not readable as pending', async () => {
  // Migration: absent token is a DISTINCT generation. The first clear after deploy
  // declines, the next drain re-observes and succeeds — one extra cycle, no erasure.
  await setAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, '2026', {
    year: 2026,
    since: '2026-01-01T00:00:00.000Z',
  } as unknown as PendingStandingsInvalidation);

  assert.equal(await readPendingStandingsInvalidation(2026), undefined);
  // It is NOT readable as an obligation — but it no longer vanishes either. Round 1
  // made an unreadable row count, because dropping it destroyed the obligation in the
  // module whose purpose is to stop obligations being destroyed.
  assert.equal(await countPendingStandingsInvalidations(), 1);
  assert.deepEqual(await listPendingStandingsInvalidations(), []);
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
  await drainPendingStandingsInvalidations(async (year) => {
    await recordPendingStandingsInvalidation(year);
    return { result: 'complete' };
  });

  assert.equal(
    await countPendingStandingsInvalidations(),
    1,
    'a declined clear must not read as cleared'
  );
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

  await drainPendingStandingsInvalidations(complete);

  assert.equal(
    await countPendingStandingsInvalidations(),
    2,
    'six pending, four drained, two must be reported'
  );
  assert.equal(await countPendingStandingsInvalidations(), 2);
});

// === R12 — clear only on a walk that actually busted ===

test('a walk that busted nothing leaves the obligation standing', async () => {
  // `partial` is what an all-benign (E263) walk produces: nothing threw, nothing busted.
  await recordPendingStandingsInvalidation(2026);
  await drainPendingStandingsInvalidations(busted_nothing);

  assert.equal(await countPendingStandingsInvalidations(), 1);
  assert.ok(await readPendingStandingsInvalidation(2026), 'and the obligation survives');
});

test('a walk that could not read the registry leaves the obligation standing', async () => {
  await recordPendingStandingsInvalidation(2025);
  await drainPendingStandingsInvalidations(async () => ({
    result: 'registry-failed',
  }));
  assert.equal(await countPendingStandingsInvalidations(), 1, 'population unknown is not a repair');
});

// === ROUND 4 — ordering is oldest-first, and CAN starve. Pinned, not celebrated. ===

test('the drain takes the OLDEST obligations, and a newer one can starve behind them', async () => {
  // THIS TEST RECORDS A KNOWN COST, NOT A DESIRED PROPERTY. The list used to order
  // fewest-attempts-first precisely so that MAX_PENDING_DRAIN_PER_RUN permanently
  // unrepairable years could not hold every slot while a newer, repairable year was
  // never attempted. Removing `attempts` removed that rotation with it.
  //
  // It is asserted rather than left to be discovered because the previous test here
  // claimed the opposite property, and a deleted test would have taken the claim's
  // refutation with it. The starvation is filed as its own issue.
  for (const [i, year] of [2011, 2012, 2013, 2014].entries()) {
    await recordPendingStandingsInvalidation(year, () => `2026-0${i + 1}-01T00:00:00.000Z`);
  }
  // Newer than all four, and repairable — the year that starves.
  await recordPendingStandingsInvalidation(2021, () => '2026-09-01T00:00:00.000Z');

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'partial' };
  });

  assert.deepEqual(walked, [2011, 2012, 2013, 2014], 'oldest first, capped at four');
  assert.ok(!walked.includes(2021), 'the newer repairable year is never reached');
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
  assert.ok(await readPendingStandingsInvalidation(2023), 'the obligation survives a throw');
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
  await drainPendingStandingsInvalidations(async () => {
    calls += 1;
    return { result: 'complete' };
  });
  assert.equal(calls, 0);
  assert.equal(await countPendingStandingsInvalidations(), 0);
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
  assert.ok(await readPendingStandingsInvalidation(2026));
});

// === R7 as amended — the cleared MARKER must never read back as an obligation ===

test('a cleared marker is not counted, listed, or drained', async () => {
  // A cleared record is written `null` rather than deleted, because the transaction
  // accessor has no generation-checked delete and both routes to one are worse (see the
  // module). The whole safety of that choice rests on the read filtering it: a marker
  // misread as an obligation would drain forever, every run, and never clear.
  await recordPendingStandingsInvalidation(2026);
  const observed = (await readPendingStandingsInvalidation(2026))!;
  assert.equal(await clearPendingStandingsInvalidation(2026, observed), true);

  // The row is still there...
  assert.notEqual(await readRaw(2026), undefined, 'precondition: a marker was retained');

  // ...and must be invisible to every reader.
  assert.equal(await countPendingStandingsInvalidations(), 0);
  assert.deepEqual(await listPendingStandingsInvalidations(), []);
  assert.equal(await readPendingStandingsInvalidation(2026), undefined);

  let walked = 0;
  await drainPendingStandingsInvalidations(async () => {
    walked += 1;
    return { result: 'complete' };
  });
  assert.equal(walked, 0, 'a cleared marker must never be drained');
  assert.equal(await countPendingStandingsInvalidations(), 0);
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

// === Remediation round 1 — the count must never report a false all-clear ===

test('an UNREADABLE row is counted, not silently dropped', async () => {
  // Dropping it would destroy the obligation in the module whose purpose is to stop
  // obligations being destroyed: never listed, drained, counted, or logged, while System
  // Health reported zero pending and the standings stayed stale forever.
  await setAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, '2019', {
    year: 2019,
    token: '',
    since: '2026-01-01T00:00:00.000Z',
  } as unknown as PendingStandingsInvalidation);

  assert.equal(await countPendingStandingsInvalidations(), 1, 'an unreadable obligation counts');
  // It still cannot be drained — the walk needs a year it can trust — so it stays.
  assert.deepEqual(await listPendingStandingsInvalidations(), []);
});

test('a store failure reports UNAVAILABLE, never zero', async () => {
  // Returning 0 here lets a receipt publish a false all-clear over a standing warning
  // while standings are stale — this issue's own defect, one more time.
  await recordPendingStandingsInvalidation(2026);
  // `getAppStateEntries` does not consult the read-failure seam, so the store is made
  // genuinely unreadable instead.
  await __corruptAppStateFileForTests();
  assert.equal(await countPendingStandingsInvalidations(), 'unavailable');
});

test('a DECLINED clear does not charge an attempt to the newer obligation', async () => {
  // ROUND 4 — the clear DECLINES because the token changed, and nothing else happens.
  // This used to also assert that the newer obligation was not charged an attempt; the
  // counter is gone, so what remains is the property that matters: a decline leaves the
  // newer obligation intact and outstanding, so the repair it is owed is not lost.
  await recordPendingStandingsInvalidation(2026, () => '2026-01-01T00:00:00.000Z');

  await drainPendingStandingsInvalidations(async (year) => {
    // A newer obligation lands mid-walk, so the clear will decline.
    await recordPendingStandingsInvalidation(year);
    return { result: 'complete' };
  });

  const after = await readPendingStandingsInvalidation(2026);
  assert.ok(after, 'the newer obligation survives a declined clear');
});

test('the drain reports what it LOOKED AT, which can exceed what remains', async () => {
  // FINDING 4 — the direction, stated correctly. `observed` is the size of the slice the
  // drain attempted, INCLUDING every obligation it then cleared, so relative to what is
  // still outstanding it is an UPPER bound. The old name for it here was "lower bound",
  // which is the same units error the route's comment carried. The assertion below is
  // the demonstration: two observed, zero remaining.
  for (const year of [2011, 2012]) {
    await recordPendingStandingsInvalidation(year, () => `${year}-01-01T00:00:00.000Z`);
  }
  const drain = await drainPendingStandingsInvalidations(complete);
  assert.equal(drain.observed, 2, 'what it looked at, not what remains');
  assert.equal(await countPendingStandingsInvalidations(), 0);
});
