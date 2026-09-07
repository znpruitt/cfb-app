import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySchedule,
  DEAD_DAY_SLOW_CRON,
  dayIsArmed,
  desiredJobState,
  outcomeForExitCode,
} from '../pollingPlannerApply';
import { plannerWindows, resolvePlanningDayStartMs } from '../../schedule/pollingPlanner';
import { pollingCronPlanForJob } from '../schedulerDeliveryHealth';
import { admitPollingPlannerRun, buildPollingPlannerRun } from '../pollingPlannerRecord';
import { evaluateScheduleContract } from '../../../../scripts/lib/qstashSchedule';
import { LIVE_SCORES_DENSE_CONTRACT } from '../../../../scripts/lib/plannerScheduleContracts';

/**
 * PLATFORM-102 slice 4 — the sink. What the planner actually SENDS to QStash for
 * each of the owner's three day-states, what it records, and what never escapes.
 *
 * The request builders are EXERCISED, not mocked away: every assertion below runs
 * through `runManageSchedule`, so the URLs and header blocks are the real ones.
 */

const ms = (iso: string): number => Date.parse(iso);
const TOKEN = 'qstash-token-SECRET-VALUE';
const CRON_SECRET = 'cron-secret-SECRET-VALUE';
const REDACTED_AUTH = 'REDACTED:9f2c-opaque-digest-value';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A real midnight in the recent past — the store bounds `at` against the clock. */
const RECENT_MIDNIGHT = Math.floor((Date.now() - DAY_MS) / DAY_MS) * DAY_MS;

type Call = { url: string; method: string; headers: Record<string, string> };

/**
 * A QStash stand-in that records the REAL requests and answers each one.
 * `schedule` is the readback the GET returns, or null for a 404.
 */
function qstash(options: {
  schedule: Record<string, unknown> | null;
  mutationStatus?: number;
  scheduleId?: string;
}): { deps: { env: Record<string, string | undefined>; fetchImpl: never }; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = async (
    url: string,
    init: { method: string; headers: Record<string, string> }
  ) => {
    calls.push({ url, method: init.method, headers: init.headers });
    if (init.method === 'GET') {
      return options.schedule === null
        ? { status: 404, json: async () => ({}) }
        : { status: 200, json: async () => options.schedule };
    }
    const status = options.mutationStatus ?? 200;
    return {
      status,
      json: async () => ({
        scheduleId: options.scheduleId ?? LIVE_SCORES_DENSE_CONTRACT.scheduleId,
      }),
    };
  };
  return {
    deps: {
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET },
      fetchImpl: fetchImpl as never,
    },
    calls,
  };
}

function readback(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheduleId: LIVE_SCORES_DENSE_CONTRACT.scheduleId,
    destination: LIVE_SCORES_DENSE_CONTRACT.destination,
    cron: LIVE_SCORES_DENSE_CONTRACT.cron,
    method: 'GET',
    retries: 0,
    isPaused: false,
    header: { Authorization: [REDACTED_AUTH] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The owner's three day-states, decided from the WINDOWS
// ---------------------------------------------------------------------------

const dayOf = (iso: string): number => resolvePlanningDayStartMs(ms(iso) - 60 * 60 * 1000);

function stateFor(rows: Array<{ startDate: string; startTimeTBD?: boolean }>, dayIso: string) {
  const dayStartMs = dayOf(dayIso);
  const windows = plannerWindows(rows).windows;
  const plan = pollingCronPlanForJob('live-scores', { windows, dayStartMs });
  return { desired: desiredJobState(plan, windows, dayStartMs), plan, windows, dayStartMs };
}

test('GAMES TODAY: dense over the game hours, slow over what is left', () => {
  const { desired } = stateFor(
    [{ startDate: '2026-10-03T19:30:00Z', startTimeTBD: false }],
    '2026-10-03T00:00:00Z'
  );
  assert.deepEqual(desired.dense, { kind: 'armed', cron: '*/3 19,20,21,22,23 * * *' });
  // This day's tail lands after midnight, so the slow schedule holds the idle slot.
  assert.deepEqual(desired.slow, { kind: 'armed', cron: '1 0 * * *' });
});

test('TAIL ONLY: dense is PAUSED and the slow schedule covers yesterday’s tail', () => {
  // A Saturday noon kickoff: its dense phase closes at 20:00 that day (kickoff +
  // the 8h cluster margin) while the 24h reconciliation guarantee runs to noon
  // Sunday. Sunday therefore has NO dense hours of its own and a live tail — so
  // nothing needs three-minute polling, and the tail must not go dark.
  const { desired } = stateFor(
    [{ startDate: '2026-10-03T12:00:00Z', startTimeTBD: false }],
    '2026-10-04T00:00:00Z'
  );
  assert.deepEqual(desired.dense, { kind: 'paused' });
  assert.equal(desired.slow.kind, 'armed');
  assert.notEqual(
    desired.slow.kind === 'armed' ? desired.slow.cron : '',
    DEAD_DAY_SLOW_CRON,
    'a live tail is not a dead day'
  );
});

test('NOTHING AT ALL: dense PAUSED, and the slow schedule drops to one wakeup a day', () => {
  const { desired } = stateFor([], '2026-06-15T00:00:00Z');
  assert.deepEqual(desired.dense, { kind: 'paused' });
  assert.deepEqual(desired.slow, { kind: 'armed', cron: DEAD_DAY_SLOW_CRON });
  assert.equal(DEAD_DAY_SLOW_CRON, '1 0 * * *');
});

test('a dead day is decided from the WINDOWS, never inferred from the expression', () => {
  // THE INFERENCE THAT LOOKS RIGHT AND IS NOT. "No dense cron plus a 24-hour slow
  // cron means a dead day" is false on a shape the planner emits routinely, and a
  // day it calls dead is a day it PAUSES while a live game's final is still being
  // reconciled.
  //
  // Reached through a TBD game, whose whole-day window puts the dense phase on
  // the published date and the entire 24h tail on the day after it. A confirmed
  // kickoff cannot produce this shape — its dense phase and its tail are only 24h
  // apart — which is exactly why generating over the CONTRACT rather than over
  // `derivePollingWindows`' output is the rule.
  const dayStartMs = dayOf('2026-10-04T00:00:00Z');
  const windows = plannerWindows([
    { startDate: '2026-10-03T04:00:00Z', startTimeTBD: true },
  ]).windows;
  const plan = pollingCronPlanForJob('live-scores', { windows, dayStartMs });

  assert.equal(plan.dense, null, 'no dense hours on the day after');
  assert.equal(plan.slow.hours.length, 24, 'and all 24 hours carry the tail');
  // The inference would call this dead. The windows say otherwise.
  assert.equal(dayIsArmed(windows, dayStartMs), true);
  assert.notDeepEqual(desiredJobState(plan, windows, dayStartMs).slow, { kind: 'paused' });
  assert.notEqual(
    (desiredJobState(plan, windows, dayStartMs).slow as { cron: string }).cron,
    DEAD_DAY_SLOW_CRON
  );

  // And a genuinely empty day IS dead.
  assert.equal(dayIsArmed([], dayStartMs), false);
});

// ---------------------------------------------------------------------------
// What is actually sent
// ---------------------------------------------------------------------------

test('an armed schedule already holding the plan sends NOTHING but the read', async () => {
  const { deps, calls } = qstash({ schedule: readback({ cron: '*/3 19,20 * * *' }) });
  const applied = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 19,20 * * *' },
    deps
  );

  assert.equal(applied.outcome, 'unchanged');
  assert.equal(applied.action, 'none');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'GET');
  assert.equal(applied.run?.action, 'skipped');
  assert.equal(applied.run?.previousCron, '*/3 19,20 * * *');
});

test('a changed plan upserts, and the request is the REAL one, with both secrets', async () => {
  const { deps, calls } = qstash({ schedule: readback() });
  const applied = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 19,20 * * *' },
    deps
  );

  assert.equal(applied.outcome, 'confirmed');
  const upsert = calls.find((call) => call.method === 'POST')!;
  assert.equal(
    upsert.url,
    `https://qstash.upstash.io/v2/schedules/${LIVE_SCORES_DENSE_CONTRACT.destination}`
  );
  // The DERIVED cron reaches QStash, not the fixed constant.
  assert.equal(upsert.headers['Upstash-Cron'], '*/3 19,20 * * *');
  assert.equal(upsert.headers['Upstash-Schedule-Id'], LIVE_SCORES_DENSE_CONTRACT.scheduleId);
  assert.equal(upsert.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(upsert.headers['Upstash-Forward-Authorization'], `Bearer ${CRON_SECRET}`);
  assert.equal(upsert.headers['Upstash-Redact-Fields'], 'header[Authorization]');
  // The row records the intent, and the cron that was in force before it.
  assert.equal(applied.run?.intent.cron, '*/3 19,20 * * *');
  assert.equal(applied.run?.previousCron, LIVE_SCORES_DENSE_CONTRACT.cron);
  assert.equal(applied.run?.action, 'applied');
});

test('PAUSE IS NOT DELETE: the pause endpoint is hit and the schedule stays inspectable', async () => {
  const { deps, calls } = qstash({ schedule: readback() });
  const applied = await applySchedule(LIVE_SCORES_DENSE_CONTRACT, { kind: 'paused' }, deps);

  assert.equal(applied.action, 'pause');
  assert.equal(applied.outcome, 'confirmed');
  const mutation = calls.find((call) => call.method === 'POST')!;
  assert.equal(
    mutation.url,
    `https://qstash.upstash.io/v2/schedules/${LIVE_SCORES_DENSE_CONTRACT.scheduleId}/pause`
  );
  // MUTATION PROOF. Nothing in this branch may mint a DELETE, and nothing may
  // reach the `/v2/schedules/<id>` bare path with a delete verb. Replace
  // `buildPauseRequest` with a delete and both assertions below go red.
  for (const call of calls) {
    assert.notEqual(call.method, 'DELETE', 'a paused schedule must remain retrievable');
  }
  assert.ok(mutation.url.endsWith('/pause'));

  // AND THE SCHEDULE IS STILL THERE: a follow-up read finds it and still compares
  // it, which is the property `inspect`'s tamper signal rests on.
  const after = qstash({ schedule: readback({ isPaused: true }) });
  const recheck = await applySchedule(LIVE_SCORES_DENSE_CONTRACT, { kind: 'paused' }, after.deps);
  assert.equal(recheck.outcome, 'unchanged', 'a second pause is a no-op, not a second request');
  assert.equal(after.calls.length, 1);
  assert.equal(after.calls[0]!.method, 'GET');
});

test('a schedule the plan pauses but that is RUNNING fails the contract check', async () => {
  // MUTATION PROOF for `isPaused` being COMPARED rather than merely carried.
  // Delete the `expectPaused` branch from `evaluateScheduleContract` and this
  // goes green-when-it-should-be-red in both directions below.
  const running = readback({ isPaused: false });
  const paused = readback({ isPaused: true });

  const armedWhenItShouldBePaused = evaluateScheduleContract(LIVE_SCORES_DENSE_CONTRACT, running, {
    expectPaused: true,
  });
  assert.equal(armedWhenItShouldBePaused.ok, false);
  assert.match(armedWhenItShouldBePaused.mismatches.join(' '), /RUNNING but the plan pauses it/);

  const pausedWhenItShouldBeArmed = evaluateScheduleContract(LIVE_SCORES_DENSE_CONTRACT, paused, {
    expectPaused: false,
  });
  assert.equal(pausedWhenItShouldBeArmed.ok, false);
  assert.match(pausedWhenItShouldBeArmed.mismatches.join(' '), /PAUSED but the plan arms it/);

  // Matching states pass, and NO expectation leaves the check exactly as it was —
  // which is what keeps the runbook's "pause one noncritical job, then inspect"
  // procedure from being refused by the very check it creates.
  assert.equal(
    evaluateScheduleContract(LIVE_SCORES_DENSE_CONTRACT, paused, { expectPaused: true }).ok,
    true
  );
  assert.equal(evaluateScheduleContract(LIVE_SCORES_DENSE_CONTRACT, paused).ok, true);
  assert.equal(evaluateScheduleContract(LIVE_SCORES_DENSE_CONTRACT, running).ok, true);
});

test('an UNREADABLE pause state fails closed rather than coercing to “running”', () => {
  // `runInspect` coerces with `=== true` and is right to, for a note. A COMPARISON
  // may not: `"true"`, `1` or an absent field would otherwise answer "running"
  // with the same confidence as a real `false`.
  for (const bad of ['true', 1, null, undefined, {}]) {
    const result = evaluateScheduleContract(
      LIVE_SCORES_DENSE_CONTRACT,
      readback({ isPaused: bad }),
      { expectPaused: false }
    );
    assert.equal(result.ok, false, `isPaused=${String(bad)} must not read as a boolean`);
    assert.match(result.mismatches.join(' '), /pause state could not be read/);
  }
});

test('a paused schedule that must be armed is upserted AND resumed, in that order', async () => {
  const { deps, calls } = qstash({ schedule: readback({ isPaused: true }) });
  const applied = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 19,20 * * *' },
    deps
  );

  assert.equal(applied.outcome, 'confirmed');
  const posts = calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 2);
  assert.ok(posts[0]!.url.includes('/v2/schedules/https'), 'the upsert lands first');
  assert.ok(posts[1]!.url.endsWith('/resume'));
});

test('a failed resume is reported, not swallowed by the upsert that succeeded', async () => {
  // The dead-day → game-day transition is the one that matters: a dense schedule
  // left paused while games are live is total darkness, so the run must not read
  // as confirmed.
  const calls: Call[] = [];
  const fetchImpl = async (
    url: string,
    init: { method: string; headers: Record<string, string> }
  ) => {
    calls.push({ url, method: init.method, headers: init.headers });
    if (init.method === 'GET')
      return { status: 200, json: async () => readback({ isPaused: true }) };
    if (url.endsWith('/resume')) return { status: 500, json: async () => ({}) };
    return {
      status: 200,
      json: async () => ({ scheduleId: LIVE_SCORES_DENSE_CONTRACT.scheduleId }),
    };
  };
  const applied = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 19,20 * * *' },
    { env: { QSTASH_TOKEN: TOKEN, CRON_SECRET }, fetchImpl: fetchImpl as never }
  );
  assert.equal(applied.outcome, 'indeterminate');
  assert.equal(applied.run?.outcome, 'indeterminate');
});

test('nothing to pause is already the desired state, and nothing is created to pause it', async () => {
  const { deps, calls } = qstash({ schedule: null });
  const applied = await applySchedule(LIVE_SCORES_DENSE_CONTRACT, { kind: 'paused' }, deps);
  assert.equal(applied.outcome, 'unchanged');
  assert.equal(applied.run, null);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
});

test('a missing credential sends NOTHING and records a failure', async () => {
  const calls: Call[] = [];
  const fetchImpl = async (
    url: string,
    init: { method: string; headers: Record<string, string> }
  ) => {
    calls.push({ url, method: init.method, headers: init.headers });
    return { status: 200, json: async () => readback() };
  };
  const applied = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 19 * * *' },
    { env: {}, fetchImpl: fetchImpl as never }
  );
  assert.equal(calls.length, 0, 'fail closed BEFORE a credential is attached to a request');
  assert.equal(applied.outcome, 'failed');
  // `failed` means nothing was sent, so an OLDER intent still governs — which is
  // exactly how the timeline reads it.
  assert.equal(applied.run?.action, 'skipped');
  assert.equal(applied.run?.previousCron, null);
});

// ---------------------------------------------------------------------------
// previousCron: the field that costs a day's record if it is wrong
// ---------------------------------------------------------------------------

test('a PAUSED schedule contributes NO previousCron, because nothing was in force', async () => {
  // The subtle one. `spanState` treats "the record planned no dense schedule" plus
  // "the next run observed one live" as a CONTRADICTION and reports
  // `plan-incomplete`. Copying a paused schedule's leftover cron into
  // `previousCron` would therefore make every day following a dense-less day
  // report an unreadable plan. A paused schedule's cron is not in force.
  const { deps } = qstash({ schedule: readback({ isPaused: true, cron: '*/3 19,20 * * *' }) });
  const applied = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 21,22 * * *' },
    deps
  );
  assert.equal(applied.run?.previousCron, null);

  // And the same schedule RUNNING does contribute one.
  const running = qstash({ schedule: readback({ isPaused: false, cron: '*/3 19,20 * * *' }) });
  const second = await applySchedule(
    LIVE_SCORES_DENSE_CONTRACT,
    { kind: 'armed', cron: '*/3 21,22 * * *' },
    running.deps
  );
  assert.equal(second.run?.previousCron, '*/3 19,20 * * *');
});

test('a hostile live cron costs the FIELD, never the day’s record', async () => {
  // `parseRun` rejects a WHOLE RUN whose `previousCron` is present and unusable,
  // so an unsanitized readback would let QStash returning junk destroy the day's
  // record — losing the one field that exists to stop delivery health
  // extrapolating. Sanitized at `readScheduleState`, so it degrades to `null`.
  const hostile = ['*/3 * * * *\nrm -rf', 'x'.repeat(500), 'DROP TABLE', '‮0 * * * *', ''];
  for (const cron of hostile) {
    const { deps } = qstash({ schedule: readback({ cron }) });
    const applied = await applySchedule(
      LIVE_SCORES_DENSE_CONTRACT,
      { kind: 'armed', cron: '*/3 19 * * *' },
      deps
    );
    assert.equal(applied.run?.previousCron, null, `cron ${JSON.stringify(cron)} must not survive`);
    // POSITIVE CONTROL: the store really would have refused the run.
    const asRun = (previousCron: string | null) =>
      buildPollingPlannerRun({
        // The store bounds `at` against the clock (5 minutes of future skew), so a
        // fixed future instant would be refused for the WRONG reason and this
        // test would pass without ever exercising `previousCron`.
        at: new Date(Date.now() - 60_000),
        invocationId: null,
        dayStartMs: RECENT_MIDNIGHT,
        windows: [],
        dense: null,
        slow: { ...applied.run!, previousCron },
      });
    assert.equal(
      admitPollingPlannerRun(asRun(cron)),
      null,
      `the store rejects previousCron ${JSON.stringify(cron)}`
    );
    // POSITIVE CONTROL for that control: the identical row with the SANITIZED
    // value is admitted, so the rejection above is about `previousCron` and not
    // about the run's clock, day or shape.
    assert.notEqual(admitPollingPlannerRun(asRun(applied.run!.previousCron)), null);
  }
});

test('exit codes map to the record’s vocabulary without rounding 4 to either side', () => {
  assert.equal(outcomeForExitCode(0), 'confirmed');
  assert.equal(outcomeForExitCode(2), 'refused');
  assert.equal(outcomeForExitCode(3), 'failed');
  assert.equal(outcomeForExitCode(4), 'indeterminate');
  assert.equal(outcomeForExitCode(1), 'failed');
});
