import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GET,
  cronRequest,
  runRoute,
  seedSeasonLeague,
  seedSchedule,
  stubProvider,
  gameBody,
  CRITICAL_KICKOFF,
} from './_routeHarness.ts';
import {
  countPendingStandingsInvalidations,
  readPendingStandingsInvalidation,
  recordPendingStandingsInvalidation,
} from '../../../../../lib/server/standingsInvalidationPending.ts';

/**
 * PLATFORM-693 — ROUTE-LEVEL coverage for the pending-invalidation drain.
 *
 * `AGENTS.md:468` makes this mandatory, not optional: *"if deleting the new guard leaves
 * the suite green, the guard is not in the PR's acceptance contract."* Its named failure
 * case is `PLATFORM-086F2H1B` v1 — two automation jobs with the second untested. So the
 * contract here is: DELETE THE DRAIN AND THIS FILE GOES RED.
 *
 * The drain is a PHASE of the existing schedule-refresh cron, not a second automation
 * job, which is why `AGENTS.md:464`'s mandatory planning split does not apply — it shares
 * this run, its authentication, its receipt and its event.
 */

test('a ZERO-TARGET run still drains — the offseason case', async () => {
  // THE CASE THE PLACEMENT EXISTS FOR, and the one that stopped round 2. The drain used
  // to sit AFTER the zero-target return, so it was dead for the entire offseason — the
  // one season in which `admin/cache-historical-schedule` is the path an operator uses,
  // and which by construction refuses protected years and therefore only ever touches
  // years this cron never revisits.
  //
  // No league is seeded, so the run reports a zero-target reason and returns early.
  await recordPendingStandingsInvalidation(2019, () => '2026-09-01T00:00:00.000Z');
  assert.ok(await readPendingStandingsInvalidation(2019), 'precondition: 2019 owes a bust');

  const { res, events } = await runRoute();

  assert.equal(res.status, 200);
  assert.ok(
    ['no-maintenance-target', 'no-automatic-maintenance-target'].includes(
      events[0]?.reason as string
    ),
    `expected a zero-target reason, got ${events[0]?.reason}`
  );
  assert.equal(
    await readPendingStandingsInvalidation(2019),
    undefined,
    'a zero-target run must still drain'
  );
});

test('the cron drains a year the run does not otherwise target', async () => {
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });
  await recordPendingStandingsInvalidation(2019, () => '2026-09-01T00:00:00.000Z');

  await runRoute();

  assert.equal(await readPendingStandingsInvalidation(2019), undefined);
});

test('the drain is bounded, and the overflow survives to the next run', async () => {
  // A rail against pathological growth of the pending set. It asserts no cost model.
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });

  const years = [2011, 2012, 2013, 2014, 2015, 2016];
  for (const [index, year] of years.entries()) {
    await recordPendingStandingsInvalidation(year, () => `2026-0${index + 1}-01T00:00:00.000Z`);
  }

  await runRoute();

  assert.equal(
    await countPendingStandingsInvalidations(),
    years.length - 4,
    'exactly MAX_PENDING_DRAIN_PER_RUN attempted'
  );
});

test('the drain never fails the run, and never alters the refresh outcome', async () => {
  // CARRIES: the schedule commit succeeded. A cache repair that could not be attempted
  // must not turn that into a failure, or change what the refresh reports.
  await seedSeasonLeague(2026);
  await seedSchedule(2026, CRITICAL_KICKOFF);
  stubProvider({ 2026: { regular: gameBody(2026), postseason: '[]' } });
  await recordPendingStandingsInvalidation(2017, () => '2026-01-01T00:00:00.000Z');

  const { res, events } = await runRoute();

  assert.equal(res.status, 200);
  assert.equal(events[0]?.result, 'success', 'the refresh outcome is unchanged by the drain');
});

test('an unauthenticated request drains nothing', async () => {
  // The drain sits INSIDE the authenticated body. A 401 must perform no cache work.
  await recordPendingStandingsInvalidation(2013, () => '2026-05-01T00:00:00.000Z');

  const response = await GET(cronRequest('wrong-secret'));

  assert.equal(response.status, 401);
  assert.ok(
    await readPendingStandingsInvalidation(2013),
    'a rejected request must not have drained anything'
  );
});

/**
 * NOT TESTED HERE, AND THE REASON IS THE HARNESS, NOT AN OVERSIGHT: that the drain's
 * count reaches the RECEIPT. `runRoute` does not persist a scheduler receipt — a probe
 * on a clean run reads `undefined` at `scheduler-execution-status/schedule-refresh` —
 * so a route test cannot observe one no matter how the assertion is written. Asking
 * whether the harness can reach the state comes before rewriting the assertion; a test
 * at the wrong layer is impossible, not weak.
 *
 * The join is covered where each half is observable: the count's derivation from the
 * durable set in `standingsInvalidationPending.test.ts`, and the receipt target's shape
 * and legacy normalization in `schedulerExecutionStatus.test.ts`. What remains unproven
 * by test is only that the cron passes the one to the other — type-enforced, since the
 * argument is required and unnamed, but not behaviourally pinned.
 */
