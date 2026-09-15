import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
} from '../appStateStore.ts';
import {
  clearPendingStandingsInvalidation,
  dischargePendingStandingsInvalidation,
  drainPendingStandingsInvalidations,
  listPendingStandingsInvalidations,
  recordPendingDrainAttempt,
  recordPendingStandingsInvalidation,
  STANDINGS_INVALIDATION_PENDING_SCOPE,
  type PendingStandingsInvalidation,
} from '../standingsInvalidationPending.ts';

/**
 * PLATFORM-693 — the durable "a bust is still owed" record and its drain.
 *
 * THE CLEAR-DECISION IS TESTED HERE AND NOT AT THE ROUTE, deliberately. The cron
 * harness installs a Next work store so `revalidateTag` succeeds, which means a route
 * test cannot produce a walk that busts nothing — and a mutation clearing the record
 * unconditionally left the route suite GREEN. The route test's name claimed a
 * discrimination it could not make; this file makes it.
 */

async function readPending(year: number): Promise<PendingStandingsInvalidation | null> {
  const row = await getAppState<PendingStandingsInvalidation | null>(
    STANDINGS_INVALIDATION_PENDING_SCOPE,
    String(year)
  );
  return (row?.value as PendingStandingsInvalidation | null) ?? null;
}

const complete = async () => ({ result: 'complete' as const });

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === The record ===

test('recording is idempotent and preserves the ORIGINAL since', async () => {
  await recordPendingStandingsInvalidation(2026, () => '2026-09-01T00:00:00.000Z');
  await recordPendingStandingsInvalidation(2026, () => '2026-09-14T00:00:00.000Z');
  // The AGE of a fault is the useful part. Resetting it on every repeat would make a
  // year that has been stale for a fortnight look like it just broke.
  assert.equal((await readPending(2026))?.since, '2026-09-01T00:00:00.000Z');
});

test('clearing removes the record', async () => {
  await recordPendingStandingsInvalidation(2026);
  await clearPendingStandingsInvalidation(2026);
  assert.equal(await readPending(2026), null);
});

// === The clear-decision — the mutation the route suite could not catch ===

test('a drain whose walk did NOT bust leaves the record standing', async () => {
  // THE DEFECT THIS GUARDS. Clearing here would discard a fault that was never
  // repaired, permanently and silently — #693's own defect relocated into its repair
  // path. `partial` is exactly what an all-benign (E263) walk produces: nothing threw,
  // and nothing was busted.
  await recordPendingStandingsInvalidation(2026, () => '2026-09-01T00:00:00.000Z');
  await drainPendingStandingsInvalidations(async () => ({ result: 'partial' }));

  const still = await readPending(2026);
  assert.ok(still, 'an un-busted year must remain pending');
  assert.equal(still.attempts, 1, 'and the attempt is counted, so a stuck year is visible');
  assert.equal(still.since, '2026-09-01T00:00:00.000Z', 'the original fault age survives');
});

test('a drain whose walk could not read the registry leaves the record standing', async () => {
  await recordPendingStandingsInvalidation(2025);
  await drainPendingStandingsInvalidations(async () => ({ result: 'registry-failed' }));
  assert.ok(await readPending(2025), 'population unknown is not a repair');
});

test('a drain whose walk BUSTED clears the record', async () => {
  await recordPendingStandingsInvalidation(2024);
  await drainPendingStandingsInvalidations(complete);
  assert.equal(await readPending(2024), null);
});

test('a walk that THROWS leaves the record standing and never escapes', async () => {
  // The drain runs inside a cron whose schedule commit already succeeded. Throwing
  // would turn a completed state change into a failure — the CARRIES violation the
  // original swallow existed to prevent.
  await recordPendingStandingsInvalidation(2023);
  await assert.doesNotReject(
    drainPendingStandingsInvalidations(async () => {
      throw new Error('registry exploded');
    })
  );
  assert.equal((await readPending(2023))?.attempts, 1);
});

// === Ordering and the bound ===

test('the drain takes the OLDEST faults first, so a stale year is never starved', async () => {
  await recordPendingStandingsInvalidation(2020, () => '2026-03-01T00:00:00.000Z');
  await recordPendingStandingsInvalidation(2021, () => '2026-01-01T00:00:00.000Z');
  await recordPendingStandingsInvalidation(2022, () => '2026-02-01T00:00:00.000Z');

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'complete' };
  }, 2);

  assert.deepEqual(walked, [2021, 2022], 'oldest since first, capped at the limit');
  assert.ok(await readPending(2020), 'the newest fault waits for the next run');
});

test('a malformed pending record is stepped over, not thrown on', async () => {
  const { setAppState } = await import('../appStateStore.ts');
  await setAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, '2019', {
    nonsense: true,
  } as unknown as PendingStandingsInvalidation);
  await recordPendingStandingsInvalidation(2018);

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'complete' };
  });

  // One unreadable key must not hide the rest.
  assert.deepEqual(walked, [2018]);
});

test('an empty pending set drains nothing and calls no walk', async () => {
  let calls = 0;
  await drainPendingStandingsInvalidations(async () => {
    calls += 1;
    return { result: 'complete' };
  });
  assert.equal(calls, 0);
  assert.deepEqual(await listPendingStandingsInvalidations(), []);
});

// === The generation-safe clear (both reviewers) ===

test('a clear does NOT erase an obligation recorded while the walk ran', async () => {
  // THE RACE. A walk takes time; another writer can commit the same year and record a
  // new obligation before the clear lands. The key transaction serializes the WRITES,
  // not the walk. Re-recording preserves `since` on purpose, so `since` alone cannot
  // distinguish generations — `attempts` is what moves.
  await recordPendingStandingsInvalidation(2026, () => '2026-09-01T00:00:00.000Z');
  const observed = (await listPendingStandingsInvalidations())[0]!;

  // ...the newer obligation arrives mid-walk.
  await recordPendingDrainAttempt(2026);

  await clearPendingStandingsInvalidation(2026, observed);
  assert.ok(await readPending(2026), 'a stale clear must not erase the newer obligation');
});

test('a clear with the CURRENT generation still clears', async () => {
  // The positive control: without it, a clear that never clears would pass the test
  // above identically.
  await recordPendingStandingsInvalidation(2026, () => '2026-09-01T00:00:00.000Z');
  const observed = (await listPendingStandingsInvalidations())[0]!;
  await clearPendingStandingsInvalidation(2026, observed);
  assert.equal(await readPending(2026), null);
});

test('clearing when nothing is pending writes nothing', async () => {
  // The single-scope commit site is reachable by NON-ADMIN cold reads, so an
  // unconditional write would put an advisory-lock transaction on every cold public
  // read that commits, and leave a row per refreshed year forever.
  await clearPendingStandingsInvalidation(2031);
  const { listAppStateKeys } = await import('../appStateStore.ts');
  assert.deepEqual(await listAppStateKeys(STANDINGS_INVALIDATION_PENDING_SCOPE), []);
});

// === Ordering rotates rather than starving (both rounds of review) ===

test('a permanently failing year YIELDS to a fresher one instead of starving it', async () => {
  // Oldest-first alone starved: four years whose walks keep failing would hold every
  // slot forever and a fifth, REPAIRABLE year would never be attempted.
  await recordPendingStandingsInvalidation(2020, () => '2026-01-01T00:00:00.000Z');
  await recordPendingDrainAttempt(2020);
  await recordPendingDrainAttempt(2020);
  await recordPendingStandingsInvalidation(2021, () => '2026-06-01T00:00:00.000Z');

  const walked: number[] = [];
  await drainPendingStandingsInvalidations(async (year) => {
    walked.push(year);
    return { result: 'complete' };
  }, 1);

  assert.deepEqual(walked, [2021], 'fewest attempts first, so the newer repairable year runs');
});

// === The attempt counter survives a re-record (a review finding I could not reproduce) ===

test('re-recording a pending year PRESERVES its attempt count', async () => {
  // Review round 2 reported that `attempts: existing?.attempts ?? 0` resets the count
  // to zero on a re-record. `??` falls through only on null/undefined, so it preserves —
  // but the claim is cheap to pin rather than argue, and pinning it stops the next
  // reader re-deriving the same doubt.
  await recordPendingStandingsInvalidation(2022, () => '2026-01-01T00:00:00.000Z');
  await recordPendingDrainAttempt(2022);
  await recordPendingDrainAttempt(2022);
  assert.equal((await readPending(2022))?.attempts, 2);

  await recordPendingStandingsInvalidation(2022, () => '2026-09-01T00:00:00.000Z');
  const after = await readPending(2022);
  assert.equal(after?.attempts, 2, 'a re-record must not reset the attempt count');
  assert.equal(after?.since, '2026-01-01T00:00:00.000Z', 'nor the original fault age');
});

// === Trigger B: the discharge the manual repair path reaches ===

test('discharging a pending year busts and clears it', async () => {
  await recordPendingStandingsInvalidation(2026);
  const result = await dischargePendingStandingsInvalidation(2026, async () => ({
    result: 'complete',
  }));
  assert.deepEqual(result, { attempted: true, cleared: true });
  assert.equal(await readPending(2026), null);
});

test('discharging a year with nothing pending walks nothing', async () => {
  let calls = 0;
  const result = await dischargePendingStandingsInvalidation(2026, async () => {
    calls += 1;
    return { result: 'complete' };
  });
  assert.equal(calls, 0, 'a healthy year must not pay a registry walk on every refresh');
  assert.deepEqual(result, { attempted: false, cleared: false });
});

test('a discharge whose walk did not bust leaves the record standing', async () => {
  await recordPendingStandingsInvalidation(2026);
  const result = await dischargePendingStandingsInvalidation(2026, async () => ({
    result: 'partial',
  }));
  assert.deepEqual(result, { attempted: true, cleared: false });
  assert.ok(await readPending(2026));
});
