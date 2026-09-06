import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryExpectationForPlan,
  plannedRunsPerDay,
  SLOW_STEP_MINUTES,
  synthesizePollingCrons,
  type PollingCronPlan,
} from '../pollingCron';
import {
  densePhase,
  derivePollingWindows,
  slowPhase,
  utcHoursCovered,
  type PlannedKickoff,
  type PollingWindow,
} from '../pollingWindows';
import { previousScheduleSlotMs } from '@/lib/server/schedulerDeliveryHealth';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const at = (isoText: string): number => Date.parse(isoText);

/** An October Saturday, the month Item 102's projection is bound by. */
const DAY = at('2026-10-03T00:00:00.000Z');
const NEXT_DAY = DAY + 24 * HOUR;

const confirmed = (isoText: string): PlannedKickoff => ({
  kickoffMs: at(isoText),
  timeConfirmed: true,
});

const windowsFor = (...isoTexts: string[]): PollingWindow[] =>
  derivePollingWindows(isoTexts.map(confirmed)).windows;

const liveScores = (windows: readonly PollingWindow[], dayStartMs = DAY): PollingCronPlan =>
  synthesizePollingCrons(windows, dayStartMs, { denseStepMinutes: 3 });

// ── The coverage checker, and the reason it is written this way ───────────────
//
// Coverage is decided by PRODUCTION's own cron parser, not by a second one
// written here. That is the point: `parseCronField` accepts only `*`, a stepped
// wildcard, a bare integer and comma lists, so a synthesized expression this
// parser cannot read is a synthesized expression System Health cannot read, and
// a checker with its own parser would pass while production went silently blind.

/**
 * Does `cron` fire at least once inside this UTC hour of the planning day?
 *
 * An expression the parser cannot read answers NO here rather than yes: matching
 * nothing, `previousScheduleSlotMs` exhausts its 366-day backstop and returns an
 * instant a year before the hour asked about. So the checker fails closed on the
 * exact class of expression this module exists to avoid emitting.
 */
const firesInHour = (cron: string, hour: number, dayStartMs = DAY): boolean => {
  const hourStart = dayStartMs + hour * HOUR;
  return previousScheduleSlotMs(cron, hourStart + HOUR - 1) >= hourStart;
};

/** Every hour in `hours` that no supplied cron fires in — the under-covered set. */
const uncoveredHours = (crons: readonly string[], hours: readonly number[], dayStartMs = DAY) =>
  hours.filter((hour) => !crons.some((cron) => firesInHour(cron, hour, dayStartMs)));

/** Every UTC hour of the planning day that any window touches, at either rate. */
const armedHoursOf = (windows: readonly PollingWindow[], dayStartMs = DAY): number[] =>
  utcHoursCovered(
    windows.flatMap((window) => [densePhase(window), slowPhase(window)]),
    dayStartMs
  );

// ── 1. The property that matters: never UNDER-cover ──────────────────────────

test('the synthesized crons cover every armed hour of the planning day', () => {
  // A Saturday slate: an afternoon kickoff, a night kickoff, and the tail that
  // runs past midnight into Sunday.
  const windows = windowsFor(
    '2026-10-03T16:00:00.000Z',
    '2026-10-03T19:30:00.000Z',
    '2026-10-03T23:00:00.000Z'
  );
  const plan = liveScores(windows);
  const crons = [plan.dense!.cron, plan.slow.cron];

  assert.deepEqual(uncoveredHours(crons, armedHoursOf(windows)), []);
  // And the same windows projected onto the NEXT day, where only the tail lands.
  const sunday = liveScores(windows, NEXT_DAY);
  assert.deepEqual(
    uncoveredHours([sunday.slow.cron], armedHoursOf(windows, NEXT_DAY), NEXT_DAY),
    []
  );
});

test('POSITIVE CONTROL: the coverage checker rejects a cron that drops one armed hour', () => {
  // Without this the test above proves only that the checker says yes — a
  // property test that has never seen a violation is not evidence it would catch
  // one. Take the real plan and delete a single hour from the hour field.
  const windows = windowsFor('2026-10-03T16:00:00.000Z', '2026-10-03T23:00:00.000Z');
  const armed = armedHoursOf(windows);
  const dropped = armed[Math.floor(armed.length / 2)]!;
  const underCovering = `0 ${armed.filter((hour) => hour !== dropped).join(',')} * * *`;

  assert.deepEqual(uncoveredHours([underCovering], armed), [dropped]);
  // The real plan covers the very hour the mutilated one drops.
  const plan = liveScores(windows);
  assert.deepEqual(uncoveredHours([plan.dense!.cron, plan.slow.cron], [dropped]), []);
});

test('the slow schedule alone covers every armed hour — dense is purely additive', () => {
  // The invariant the design rests on. A slow cron built from the TAIL hours
  // alone would leave the guarantee to a union of two expressions: here it would
  // cover 08:00–23:00 and drop the morning entirely, and on a Saturday night it
  // would cover nothing at all, since that cluster's tail is all Sunday.
  const morning = windowsFor('2026-10-03T00:30:00.000Z');
  const plan = liveScores(morning);
  const tailOnlyHours = utcHoursCovered(morning.map(slowPhase), DAY);

  assert.deepEqual(uncoveredHours([plan.slow.cron], armedHoursOf(morning)), []);
  // The tail-only alternative, spelled out and rejected: hours 0–7 are dense
  // hours with no tail over them, and it drops every one.
  assert.deepEqual(
    uncoveredHours([`0 ${tailOnlyHours.join(',')} * * *`], armedHoursOf(morning)),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
  // And the Saturday-night shape, where the tail projects onto the day not at all.
  assert.deepEqual(utcHoursCovered(windowsFor('2026-10-03T23:00:00.000Z').map(slowPhase), DAY), []);
});

test('A RANGE hour field is unreadable to the production parser — hence comma lists', () => {
  // `parseCronField` handles `*`, a stepped wildcard, an integer and comma lists.
  // `12-23` parses to an EMPTY set, so the expression matches nothing at all —
  // it covers none of the hours it appears to name, and delivery health would
  // compute a required slot from a schedule that does not exist, with nothing
  // failing. This is why the synthesizer emits the list form only.
  assert.deepEqual(uncoveredHours(['*/3 12-23 * * *'], [12, 23]), [12, 23]);
  assert.deepEqual(uncoveredHours(['*/3 12,23 * * *'], [12, 23]), []);

  const plan = liveScores(windowsFor('2026-10-03T16:00:00.000Z'));
  assert.equal(plan.dense!.cron.includes('-'), false);
  assert.equal(plan.slow.cron.includes('-'), false);
  assert.equal(plan.dense!.cron, '*/3 15,16,17,18,19,20,21,22,23 * * *');
});

// ── 2. The three plan shapes ─────────────────────────────────────────────────

test('no windows at all is the offseason: no dense schedule, hourly all day', () => {
  const plan = liveScores([]);

  assert.equal(plan.dense, null);
  assert.equal(plan.slow.cron, '0 * * * *');
  assert.deepEqual(
    plan.slow.hours,
    Array.from({ length: 24 }, (_, hour) => hour)
  );
  assert.equal(plan.slow.stepMinutes, SLOW_STEP_MINUTES);
  // No cron can mean "never", so the schedule stays present and delivery health
  // keeps a subject. It is the same rule as any dead day, not a special case.
  assert.equal(plannedRunsPerDay(plan).total, 24);
});

test('windows covering part of a day narrow the dense hours to that part', () => {
  const windows = windowsFor('2026-10-03T19:30:00.000Z');
  const plan = liveScores(windows);

  // Kickoff 19:30 − 15m lead = 19:15; dense end 19:30 + 8h = 03:30 next day.
  assert.deepEqual(plan.dense!.hours, [19, 20, 21, 22, 23]);
  assert.equal(plan.dense!.cron, '*/3 19,20,21,22,23 * * *');
  assert.deepEqual(plan.slow.hours, [19, 20, 21, 22, 23]);
});

test('windows covering a full day collapse the hour field to `*`', () => {
  // Kickoffs every eight hours merge into one cluster spanning the whole day.
  const windows = windowsFor(
    '2026-10-02T20:00:00.000Z',
    '2026-10-03T04:00:00.000Z',
    '2026-10-03T12:00:00.000Z',
    '2026-10-03T20:00:00.000Z'
  );
  const plan = liveScores(windows);

  assert.equal(windows.length, 1);
  assert.equal(plan.dense!.cron, '*/3 * * * *');
  assert.equal(plan.slow.cron, '0 * * * *');
  assert.deepEqual(uncoveredHours([plan.dense!.cron], armedHoursOf(windows)), []);
});

test('the dense/slow boundary lands where the dense phase ends, not where polling stops', () => {
  // One 12:00 kickoff: dense to 20:00, reconciliation to 12:00 the next day. On
  // the planning day hours 11–19 are dense and 20–23 are tail, and the boundary
  // is what a cron built from the dense windows alone would drop — the failure
  // `pollingWindows.ts:88` records.
  const windows = windowsFor('2026-10-03T12:00:00.000Z');
  const plan = liveScores(windows);

  // Dense stops at 20:00 exactly, so hour 20 is not a dense hour: an hour counts
  // as covered only when a span overlaps part of it.
  assert.deepEqual(plan.dense!.hours, [11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual(plan.slow.hours, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  // Hours 20–23 are covered ONLY by the slow schedule.
  assert.deepEqual(uncoveredHours([plan.dense!.cron], [20, 21, 22, 23]), [20, 21, 22, 23]);
  assert.deepEqual(uncoveredHours([plan.slow.cron], [20, 21, 22, 23]), []);
});

// ── 3. Delivery expectation ──────────────────────────────────────────────────

test('an armed day derives the dense cadence and exactly today’s grace', () => {
  const windows = windowsFor('2026-10-03T19:30:00.000Z');

  const live = deliveryExpectationForPlan(liveScores(windows));
  assert.equal(live.cron, '*/3 19,20,21,22,23 * * *');
  assert.equal(live.graceMs, 6 * MINUTE);
  assert.equal(live.cadenceLabel, 'every 3 min at 19:00–23:00 UTC, hourly at 19:00–23:00 UTC');

  const stats = deliveryExpectationForPlan(
    synthesizePollingCrons(windows, DAY, { denseStepMinutes: 15 })
  );
  assert.equal(stats.cron, '*/15 19,20,21,22,23 * * *');
  assert.equal(stats.graceMs, 30 * MINUTE);
});

test('a dead day derives the slow schedule, since there is no dense one to govern', () => {
  const expectation = deliveryExpectationForPlan(liveScores([]));

  assert.equal(expectation.cron, '0 * * * *');
  assert.equal(expectation.graceMs, 2 * HOUR);
  assert.equal(expectation.cadenceLabel, 'hourly (top of hour UTC)');
});

test('a fragmented day names each armed stretch', () => {
  // Three clusters is the most a day can hold — a cluster's dense phase alone
  // runs eight hours — so the label stays bounded without a cap.
  const windows = windowsFor(
    '2026-10-03T02:00:00.000Z',
    '2026-10-03T12:00:00.000Z',
    '2026-10-03T22:00:00.000Z'
  );
  const label = deliveryExpectationForPlan(liveScores(windows)).cadenceLabel;

  assert.equal(windows.length, 3);
  assert.equal(
    label,
    'every 3 min at 01:00–09:00, 11:00–19:00, 21:00–23:00 UTC, hourly at 01:00–23:00 UTC'
  );
});

// ── 4. Cost, the figure Item 102's projection is stated in ───────────────────

test('runs per day counts each schedule at its own rate', () => {
  const plan = liveScores(windowsFor('2026-10-03T19:30:00.000Z'));
  const runs = plannedRunsPerDay(plan);

  assert.equal(runs.dense, 5 * 20);
  assert.equal(runs.slow, 5);
  assert.equal(runs.total, 105);
  // Against 480/day today, on a day carrying a night kickoff.
  assert.ok(runs.total < 480);
});

test('a minute step outside 1..60 is refused rather than silently emitted', () => {
  // `*/0` and `*/61` are expressions the production parser drops on the floor.
  assert.throws(() => synthesizePollingCrons([], DAY, { denseStepMinutes: 0 }), {
    message: /denseStepMinutes/,
  });
  assert.throws(() => synthesizePollingCrons([], DAY, { denseStepMinutes: 61 }), {
    message: /denseStepMinutes/,
  });
});
