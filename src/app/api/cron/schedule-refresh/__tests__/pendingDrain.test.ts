import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GET,
  cronRequest,
  runRoute,
  seedSeasonLeague,
  seedSchedule,
  setAppState,
  getAppState,
  stubProvider,
  gameBody,
  CRITICAL_KICKOFF,
} from './_routeHarness.ts';
import {
  STANDINGS_INVALIDATION_PENDING_SCOPE,
  type PendingStandingsInvalidation,
} from '../../../../../lib/server/standingsInvalidationPending.ts';

/**
 * PLATFORM-693 — ROUTE-LEVEL coverage for the pending-invalidation drain.
 *
 * `AGENTS.md:468` makes this mandatory rather than optional: "Widening scope to a
 * second module or job and shipping it without route-level coverage is a scope
 * violation in itself, not merely a test gap — if deleting the new guard leaves the
 * suite green, the guard is not in the PR's acceptance contract." Its named failure
 * case is `PLATFORM-086F2H1B` v1, two automation jobs with the second untested.
 *
 * So the contract these tests encode: DELETE THE DRAIN AND THIS FILE GOES RED.
 *
 * The drain is a PHASE of the existing schedule-refresh cron, not a second automation
 * job, which is why `AGENTS.md:464`'s mandatory planning split does not apply — it
 * shares this run, its authentication, its receipt and its event.
 */

async function seedPending(year: number, since: string): Promise<void> {
  await setAppState<PendingStandingsInvalidation>(
    STANDINGS_INVALIDATION_PENDING_SCOPE,
    String(year),
    { year, since, attempts: 0 }
  );
}

async function readPending(year: number): Promise<PendingStandingsInvalidation | null> {
  const row = await getAppState<PendingStandingsInvalidation | null>(
    STANDINGS_INVALIDATION_PENDING_SCOPE,
    String(year)
  );
  return (row?.value as PendingStandingsInvalidation | null) ?? null;
}

test('the cron drains a pending year the run does NOT otherwise target', async () => {
  // THE CASE THE WHOLE DESIGN EXISTS FOR. `admin/cache-historical-schedule` refuses
  // protected years by construction, so a historical repair's failed bust lands on a
  // year this cron never revisits. If the discharge were tied to "a later refresh of
  // year Y", that fault would be permanent and unclearable — the #721 shape,
  // reintroduced by the fix for it.
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });

  await seedPending(2019, '2026-09-01T00:00:00.000Z');
  assert.ok(await readPending(2019), 'precondition: 2019 is pending');

  await runRoute();

  assert.equal(
    await readPending(2019),
    null,
    '2019 is nowhere in this run’s maintenance targets and must still have been drained'
  );
});

test('a successful drain clears the record through the route', async () => {
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });
  await seedPending(2018, '2026-08-01T00:00:00.000Z');

  await runRoute();

  // NAMED FOR WHAT IT PROVES. This covers the WIRING — the route reaches the drain and
  // a successful walk clears. It cannot cover the converse: the harness installs a work
  // store so `revalidateTag` always succeeds here, and a mutation clearing the record
  // unconditionally left this file green. The clear-DECISION is discriminated in
  // `standingsInvalidationPending.test.ts`, where the walk is injectable.
  assert.equal(await readPending(2018), null);
});

test('the drain is bounded, and the overflow survives to the next run', async () => {
  // The bound is a rail against pathological growth of the pending set. It asserts no
  // cost model: an invalidated entry is rebuilt only when something next reads it.
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });

  const years = [2011, 2012, 2013, 2014, 2015, 2016];
  for (const [index, year] of years.entries()) {
    await seedPending(year, `2026-0${index + 1}-01T00:00:00.000Z`);
  }

  await runRoute();

  const remaining: number[] = [];
  for (const year of years) if (await readPending(year)) remaining.push(year);

  assert.equal(remaining.length, years.length - 4, 'exactly MAX_PENDING_DRAIN_PER_RUN drained');
  // Oldest fault first, so the survivors are the NEWEST — a long-stale year is never
  // starved by a more recent one.
  assert.deepEqual(remaining, [2015, 2016]);
});

test('the drain never fails the run, and never alters the refresh outcome', async () => {
  // CARRIES: the schedule commit succeeded. A cache repair that could not be attempted
  // must not turn that into a failure, or report anything other than what the refresh
  // actually did.
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });
  // A record the validator rejects: the drain must step over it, not throw.
  await setAppState(STANDINGS_INVALIDATION_PENDING_SCOPE, '2017', {
    nonsense: true,
  } as unknown as PendingStandingsInvalidation);

  const { res, events } = await runRoute();

  assert.equal(res.status, 200);
  assert.equal(events[0]?.result, 'success', 'the refresh outcome is unchanged by the drain');
});

test('an unauthenticated request drains nothing', async () => {
  // The drain sits INSIDE the authenticated body. A 401 must not perform cache work.
  await seedPending(2013, '2026-05-01T00:00:00.000Z');

  const response = await GET(cronRequest('wrong-secret'));

  assert.equal(response.status, 401);
  assert.ok(await readPending(2013), 'a rejected request must not have drained anything');
});
