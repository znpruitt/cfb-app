import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlannerIntentReader,
  lookupFromStore,
  plannerJobForScheduleId,
  plannerRecordConnectionString,
} from '../../../../scripts/lib/plannerIntentReader';
import {
  GAME_STATS_DENSE_CONTRACT,
  GAME_STATS_SLOW_CONTRACT,
  LIVE_SCORES_DENSE_CONTRACT,
  LIVE_SCORES_SLOW_CONTRACT,
  POLLING_PLANNER_CONTRACT,
} from '../../../../scripts/lib/plannerScheduleContracts';

/**
 * PLATFORM-102 slice 4 — the operator CLI's bridge to the durable record.
 *
 * The interesting behaviour is what it does when it CANNOT answer, because the
 * naive version of this file answers `absent` and the CLI then writes the fixed
 * contract over a cron the planner owns.
 */

test('the four planner-owned schedules resolve to their job; nothing else does', () => {
  assert.equal(plannerJobForScheduleId(LIVE_SCORES_DENSE_CONTRACT.scheduleId), 'live-scores');
  assert.equal(plannerJobForScheduleId(LIVE_SCORES_SLOW_CONTRACT.scheduleId), 'live-scores');
  assert.equal(plannerJobForScheduleId(GAME_STATS_DENSE_CONTRACT.scheduleId), 'game-stats');
  assert.equal(plannerJobForScheduleId(GAME_STATS_SLOW_CONTRACT.scheduleId), 'game-stats');
  // The planner's own trigger is NOT planner-owned — the job that rewrites the
  // others must be recoverable from the repo.
  assert.equal(plannerJobForScheduleId(POLLING_PLANNER_CONTRACT.scheduleId), null);
  assert.equal(plannerJobForScheduleId('turfwar-odds-hourly'), null);
});

test('the record is read through the operator READ-ONLY rail', () => {
  // The documented operator setup has `DATABASE_URL_RO` in `.env.operator.local`
  // and deliberately NO `DATABASE_URL`. Requiring the write credential made
  // `inspect` and `upsert --apply` exit 3 before contacting QStash — measured by
  // review — which broke the routine check, §8l rotation, and the provisioning of
  // the two schedules this slice adds. Reading a record is a SELECT.
  //
  // Mutation target: drop `DATABASE_URL_RO` from the lookup and the first case
  // returns null, which is the exit-3 that broke the CLI.
  assert.equal(
    plannerRecordConnectionString({ DATABASE_URL_RO: 'postgres://ro' }),
    'postgres://ro'
  );
  // The read-only rail WINS when both are present: a record read never needs write
  // access, and `CLAUDE.md` keeps the application off this rail entirely.
  assert.equal(
    plannerRecordConnectionString({
      DATABASE_URL_RO: 'postgres://ro',
      DATABASE_URL: 'postgres://rw',
    }),
    'postgres://ro'
  );
  // A deployed context that has only the write credential is not a special case.
  assert.equal(plannerRecordConnectionString({ DATABASE_URL: 'postgres://rw' }), 'postgres://rw');
  // Blank is absent, not a connection string.
  assert.equal(plannerRecordConnectionString({ DATABASE_URL_RO: '   ' }), null);
  assert.equal(plannerRecordConnectionString({}), null);
});

test('NO CONNECTION AT ALL MEANS NO ANSWER — the fail-closed that this module exists for', async () => {
  // `appStateStore` falls back to a LOCAL FILE outside production when no database
  // is configured, and an operator's laptop deliberately has no `DATABASE_URL`
  // (`CLAUDE.md`: a dev server must never point at production). A reader built
  // naively on that would read an empty local store, answer `absent`, and the CLI
  // would write the fixed contract over the planner's cron.
  //
  // Mutation target: delete the connection-string guard and this returns `absent`,
  // which is the clobber.
  const reader = createPlannerIntentReader({});
  assert.deepEqual(await reader(LIVE_SCORES_DENSE_CONTRACT.scheduleId), { kind: 'unavailable' });

  for (const blank of ['', '   ']) {
    const blanked = createPlannerIntentReader({ DATABASE_URL: blank });
    assert.deepEqual(await blanked(LIVE_SCORES_DENSE_CONTRACT.scheduleId), { kind: 'unavailable' });
  }
});

test('a schedule the planner does not own answers `absent` without touching a store', async () => {
  // The pre-slice-4 behaviour byte for byte, and it makes a mis-wiring safe rather
  // than surprising: no `DATABASE_URL` is consulted, so no store is reached.
  const reader = createPlannerIntentReader({});
  assert.deepEqual(await reader(POLLING_PLANNER_CONTRACT.scheduleId), { kind: 'absent' });
  assert.deepEqual(await reader('turfwar-rankings-2x-daily'), { kind: 'absent' });
});

test('each store state maps to exactly one lookup, and none of them collapse', () => {
  const intent = {
    scheduleId: LIVE_SCORES_DENSE_CONTRACT.scheduleId,
    destination: LIVE_SCORES_DENSE_CONTRACT.destination,
    cron: '*/3 19,20 * * *',
    method: 'GET',
    retries: 0,
  };
  const none = () => ({ kind: 'none' }) as const;

  assert.deepEqual(lookupFromStore({ kind: 'absent' }, none), { kind: 'absent' });
  assert.deepEqual(lookupFromStore({ kind: 'unreadable' }, none), { kind: 'unreadable' });
  // A STORE OUTAGE IS NOT A CORRUPT ROW. Telling an operator a record is "present
  // but unreadable" during an outage sends them looking for a row that may not
  // exist, which is why the two states stay apart all the way down.
  assert.deepEqual(lookupFromStore({ kind: 'failed' }, none), { kind: 'unavailable' });

  // A readable series holding no run for this schedule is the BOOTSTRAP, not a
  // refusal: the first upsert of a schedule the planner has never touched has
  // nothing else to write.
  assert.deepEqual(lookupFromStore({ kind: 'ok', series: {} }, none), { kind: 'absent' });
  assert.deepEqual(
    lookupFromStore({ kind: 'ok', series: {} }, () => ({ kind: 'indeterminate' })),
    {
      kind: 'indeterminate',
    }
  );
  assert.deepEqual(
    lookupFromStore({ kind: 'ok', series: {} }, () => ({ kind: 'intent', intent })),
    {
      kind: 'intent',
      intent,
    }
  );
});
