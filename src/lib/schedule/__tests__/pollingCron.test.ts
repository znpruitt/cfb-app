import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryExpectationForPlan,
  IDLE_SLOW_HOUR,
  SLOW_OFFSET_MINUTE,
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
  // And the same windows projected onto the NEXT day, which holds the tail and
  // the last hours of the dense phase.
  const sunday = liveScores(windows, NEXT_DAY);
  assert.deepEqual(
    uncoveredHours(
      [sunday.dense!.cron, sunday.slow.cron],
      armedHoursOf(windows, NEXT_DAY),
      NEXT_DAY
    ),
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
  const underCovering = `1 ${armed.filter((hour) => hour !== dropped).join(',')} * * *`;

  assert.deepEqual(uncoveredHours([underCovering], armed), [dropped]);
  // The real plan covers the very hour the mutilated one drops.
  const plan = liveScores(windows);
  assert.deepEqual(uncoveredHours([plan.dense!.cron, plan.slow.cron], [dropped]), []);
});

test('coverage is a property of the PAIR — each cron covers its own phase, and neither alone', () => {
  // An earlier design widened the slow cron to every armed hour so the guarantee
  // would rest on one expression. It bought nothing measurable — the pair already
  // covers everything — and cost a billed provider call in every dense hour. This
  // test pins the division of labour that replaced it, in both directions.
  const morning = windowsFor('2026-10-03T00:30:00.000Z');
  const plan = liveScores(morning);
  const denseHours = utcHoursCovered(morning.map(densePhase), DAY);
  const tailHours = utcHoursCovered(morning.map(slowPhase), DAY);

  assert.deepEqual(uncoveredHours([plan.dense!.cron, plan.slow.cron], armedHoursOf(morning)), []);
  // Neither expression covers the day on its own — the pair is load-bearing.
  assert.deepEqual(denseHours, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(uncoveredHours([plan.slow.cron], denseHours), denseHours);
  assert.deepEqual(
    uncoveredHours([plan.dense!.cron], tailHours),
    tailHours.filter((hour) => !denseHours.includes(hour))
  );
  // The slow cron is the tail MINUS the hours the dense cron already polls — the
  // subtraction that keeps a single hour from billing two provider calls.
  assert.deepEqual(plan.slow.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.equal(tailHours.includes(8), true, 'hour 8 is a tail hour the dense cron already covers');
  assert.equal(plan.slow.hours.includes(8), false);
});

test('a day with dense hours and NO tail gets a single idle slot, not a whole day of them', () => {
  // The ordinary Saturday: the cluster ends after midnight, so its tail belongs
  // to tomorrow's plan and nothing here needs slow coverage. The schedule still
  // has to hold an expression — one wakeup, not twenty-four, and not a mirror of
  // the dense hours that would bill a second call in each of them.
  const windows = windowsFor('2026-10-03T23:00:00.000Z');
  const plan = liveScores(windows);

  assert.deepEqual(utcHoursCovered(windows.map(slowPhase), DAY), [], 'no tail on this day');
  assert.deepEqual(plan.slow.hours, [IDLE_SLOW_HOUR]);
  assert.equal(plan.slow.cron, '1 0 * * *');
  assert.equal(plannedRunsPerDay(plan).slow, 1);
  // And the day is still fully covered, by the dense cron alone.
  assert.deepEqual(uncoveredHours([plan.dense!.cron], armedHoursOf(windows)), []);
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
  assert.equal(plan.slow.cron, '1 * * * *');
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

  // Kickoff 19:30 − 15m lead = 19:15; dense end 19:30 + 8h = 03:30 next day, so
  // the tail lands entirely on tomorrow and today's slow schedule idles.
  assert.deepEqual(plan.dense!.hours, [19, 20, 21, 22, 23]);
  assert.equal(plan.dense!.cron, '*/3 19,20,21,22,23 * * *');
  assert.deepEqual(plan.slow.hours, [IDLE_SLOW_HOUR]);
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
  // The dense phase covers the whole day, so the tail is tomorrow's and the slow
  // schedule idles rather than doubling every hour of a full slate.
  assert.equal(plan.slow.cron, '1 0 * * *');
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
  assert.deepEqual(plan.slow.hours, [20, 21, 22, 23]);
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
  assert.equal(live.cadenceLabel, 'every 3 min at 19:00–23:00 UTC, hourly (:01) at 00:00 UTC');

  const stats = deliveryExpectationForPlan(
    synthesizePollingCrons(windows, DAY, { denseStepMinutes: 15 })
  );
  assert.equal(stats.cron, '*/15 19,20,21,22,23 * * *');
  assert.equal(stats.graceMs, 30 * MINUTE);
});

test('a dead day derives the slow schedule, since there is no dense one to govern', () => {
  const expectation = deliveryExpectationForPlan(liveScores([]));

  assert.equal(expectation.cron, '1 * * * *');
  assert.equal(expectation.graceMs, 2 * HOUR);
  assert.equal(expectation.cadenceLabel, 'hourly (:01 UTC)');
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
    'every 3 min at 01:00–09:00, 11:00–19:00, 21:00–23:00 UTC, hourly (:01) at 10:00, 20:00 UTC'
  );
});

// ── 4. Cost, the figure Item 102's projection is stated in ───────────────────

test('runs per day counts each schedule at its own rate', () => {
  const plan = liveScores(windowsFor('2026-10-03T19:30:00.000Z'));
  const runs = plannedRunsPerDay(plan);

  assert.equal(runs.dense, 5 * 20);
  // The tail is tomorrow's, so today's slow schedule is the single idle slot.
  assert.equal(runs.slow, 1);
  assert.equal(runs.total, 101);
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

// ── 5. The two guards review found ───────────────────────────────────────────

test('the two schedules never share an HOUR — the primary no-duplicate guarantee', () => {
  // Subtracting the dense hours is what removes the duplicate billed call. The
  // shape that proves it is a multi-cluster day, where an early cluster's 24-hour
  // tail spans the later clusters' dense phases: those hours were in BOTH sets
  // before, twelve of them, each one a second provider call in an hour a game is
  // live. This is the assertion the earlier minute-level sweep should have been.
  for (const kickoffs of [
    ['2026-10-03T02:00:00.000Z', '2026-10-03T12:00:00.000Z', '2026-10-03T22:00:00.000Z'],
    ['2026-10-03T12:30:00.000Z'],
    ['2026-10-03T12:00:00.000Z'],
    ['2026-10-03T23:00:00.000Z'],
  ]) {
    const windows = windowsFor(...kickoffs);
    const plan = liveScores(windows);
    const dense = plan.dense?.hours ?? [];
    const shared = dense.filter((hour) => plan.slow.hours.includes(hour));

    assert.deepEqual(shared, [], `dense and slow share hours for ${kickoffs.join(' ')}`);
    // Still complete: subtracting removed overlap, not coverage.
    assert.deepEqual(
      uncoveredHours(
        [plan.dense?.cron, plan.slow.cron].filter((c) => c !== undefined),
        armedHoursOf(windows)
      ),
      []
    );
  }

  // POSITIVE CONTROL on the fixture, not just on the loop: the three-cluster day
  // genuinely HAS hours in both phases, so the disjointness above is subtraction
  // working rather than an input that could never overlap.
  const fragmented = windowsFor(
    '2026-10-03T02:00:00.000Z',
    '2026-10-03T12:00:00.000Z',
    '2026-10-03T22:00:00.000Z'
  );
  const denseHours = utcHoursCovered(fragmented.map(densePhase), DAY);
  const tailHours = utcHoursCovered(fragmented.map(slowPhase), DAY);
  assert.equal(tailHours.filter((hour) => denseHours.includes(hour)).length, 12);
});

test('no admissible dense step collides with the slow minute, on a CONSTRUCTED shared hour', () => {
  // The second line of defence, and it has to be tested against an hour the two
  // schedules share — which by design they no longer do. An earlier version swept
  // the minutes of a synthesized plan's dense hours and was VACUOUS: that
  // fixture's sets were disjoint, so the slow cron fired 0 times inside the 3,132
  // instants examined and the assertion could not fail for any offset. Build the
  // overlap explicitly instead of hoping a fixture produces one.
  const sharedHour = 12;
  const slowOnSharedHour = `${SLOW_OFFSET_MINUTE} ${sharedHour} * * *`;
  let observedSlowFirings = 0;
  let stepsChecked = 0;

  for (let step = 1; step <= 60; step += 1) {
    let denseCron: string;
    try {
      denseCron = synthesizePollingCrons(windowsFor('2026-10-03T12:30:00.000Z'), DAY, {
        denseStepMinutes: step,
      }).dense!.cron;
    } catch {
      continue; // refused by the validator — its own test is below
    }
    stepsChecked += 1;
    for (let minute = 0; minute < 60; minute += 1) {
      const instant = DAY + sharedHour * HOUR + minute * MINUTE;
      const denseFires = previousScheduleSlotMs(denseCron, instant) === instant;
      const slowFires = previousScheduleSlotMs(slowOnSharedHour, instant) === instant;
      if (slowFires) observedSlowFirings += 1;
      assert.ok(!(denseFires && slowFires), `step ${step} collides at minute ${minute}`);
    }
  }

  assert.equal(stepsChecked, 58, 'every step in 2..59 is admissible and was checked');
  // The observer saw the slow schedule fire — without this the sweep above would
  // pass just as happily against a cron that never fires at all.
  assert.equal(observedSlowFirings, 58, 'one slow firing per step examined');
});

test('a dense step that would land on the slow minute is REFUSED, not merely documented', () => {
  // Both of these were reachable, and both defeated the offset entirely: step 60
  // emitted the offset minute as a literal, making the dense cron byte-identical
  // to the slow one, and step 1 fires every minute including that one. The
  // docstring used to assert this could not happen; now the validator enforces it.
  const windows = windowsFor('2026-10-03T12:00:00.000Z');

  for (const step of [1, 60]) {
    assert.throws(() => synthesizePollingCrons(windows, DAY, { denseStepMinutes: step }), {
      message: new RegExp(`denseStepMinutes ${step} collides`),
    });
  }
  // The steps the two jobs actually run are unaffected.
  for (const step of [3, 15]) {
    assert.ok(synthesizePollingCrons(windows, DAY, { denseStepMinutes: step }).dense);
  }
});

test('a dayStartMs that is not an exact UTC midnight is refused, not silently rotated', () => {
  // `utcHoursCovered` pushes the loop INDEX, so an offset day start rotates the
  // whole hour field — arming six hours early and going dark over the kickoff,
  // which is the one direction a narrowed cron cannot survive.
  const windows = windowsFor('2026-10-03T19:30:00.000Z');

  assert.throws(() => synthesizePollingCrons(windows, DAY + 6 * HOUR, { denseStepMinutes: 3 }), {
    message: /dayStartMs must be an exact UTC midnight/,
  });
  // Non-finite is the worse one: every overlap test fails, so an ARMED day would
  // degrade to the exact shape of a legitimate offseason plan.
  assert.throws(() => synthesizePollingCrons(windows, Number.NaN, { denseStepMinutes: 3 }), {
    message: /dayStartMs must be an exact UTC midnight/,
  });
  // The valid form still works, so the guard is not simply refusing everything.
  assert.equal(
    synthesizePollingCrons(windows, DAY, { denseStepMinutes: 3 }).dense!.cron,
    '*/3 19,20,21,22,23 * * *'
  );
});

test('a window with a non-finite bound is refused, not silently read as an offseason day', () => {
  // The same silent failure `dayStartMs` is guarded against, reached by a
  // different input. A stored plan is JSON, so a null or NaN bound is a real
  // future shape: every overlap test fails, the day yields no dense schedule and
  // an all-day slow one, and that is indistinguishable from a legitimate dead
  // day. Nothing throws on that path, so the policy's own fallback cannot see it
  // either — a live game day would poll hourly straight through kickoff.
  const good = windowsFor('2026-10-03T19:30:00.000Z');
  const corrupt = good.map((window) => ({ ...window, denseEndMs: Number.NaN }));

  assert.throws(() => synthesizePollingCrons(corrupt, DAY, { denseStepMinutes: 3 }), {
    message: /finite startMs, denseEndMs and slowEndMs/,
  });
  // POSITIVE CONTROL: without the guard this input produces the offseason shape
  // rather than an error, which is the whole reason it needs one.
  assert.deepEqual(
    utcHoursCovered(corrupt.map(densePhase), DAY),
    [],
    'the corrupt window covers nothing, exactly like a dead day'
  );
  assert.ok(synthesizePollingCrons(good, DAY, { denseStepMinutes: 3 }).dense);

  // ORDERING fails the same silent way. A marginal inversion yields a garbage
  // single-hour cron; a real one makes the phase an empty span and the armed day
  // reads as the offseason. Neither throws without the guard, so the delivery
  // policy's own fallback cannot see either.
  const inverted = good.map((window) => ({ ...window, denseEndMs: window.startMs - 1 }));
  const backwards = good.map((window) => ({ ...window, slowEndMs: window.startMs - 10 * HOUR }));
  for (const windows of [inverted, backwards]) {
    assert.throws(() => synthesizePollingCrons(windows, DAY, { denseStepMinutes: 3 }), {
      message: /startMs <= denseEndMs <= slowEndMs/,
    });
  }
});

test('the slow schedule cannot be built with a sub-hourly step', () => {
  // A stepped minute field always contains minute 0 — the minute every dense rate
  // fires at — so a sub-hourly slow cadence would silently drop the dispatch
  // offset. Deleting the `slowStepMinutes` option left that hole in the constant
  // feeding the same branch; the slow builder is now its own function and refuses.
  assert.equal(SLOW_STEP_MINUTES >= 60, true, 'the constant the builder guards');
  const plan = liveScores(windowsFor('2026-10-03T12:00:00.000Z'));
  assert.equal(plan.slow.cron.startsWith(`${SLOW_OFFSET_MINUTE} `), true);
  assert.equal(plan.slow.cron.includes('*/'), false, 'never a stepped minute field');
});

// ── 6. The generated shape sweep ─────────────────────────────────────────────
//
// Every finding of the last three review rounds was the same failure: a property
// asserted universally, checked against hand-picked fixtures, and false on a
// shape nobody picked — steps 1 and 60, a three-cluster day, a fully dense day.
// Twice the violating shape was already a fixture in this file and simply was not
// run through the assertion. So the properties are checked here against a
// GENERATED space instead, and the generator is itself controlled: if it stops
// producing each interesting shape, the sweep fails rather than quietly passing.

/** Deterministic PRNG — a fixed seed, so a failure reproduces exactly. */
const makeRandom = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

test('SWEEP: coverage, disjointness and minute non-collision hold across generated day shapes', () => {
  const random = makeRandom(20261003);
  const shapes = { dead: 0, idle: 0, reconciliation: 0, fullyDense: 0 };
  const steps = [3, 15];

  for (let trial = 0; trial < 2_000; trial += 1) {
    // Kickoffs anywhere in a 48-hour band around the planning day, so windows
    // land wholly inside it, straddle either boundary, or miss it entirely.
    const count = Math.floor(random() * 7);
    const kickoffs: PlannedKickoff[] = Array.from({ length: count }, () => ({
      kickoffMs: DAY - 24 * HOUR + Math.floor(random() * 48 * HOUR),
      timeConfirmed: true,
    }));
    const windows = derivePollingWindows(kickoffs).windows;
    const denseStepMinutes = steps[trial % steps.length]!;
    const plan = synthesizePollingCrons(windows, DAY, { denseStepMinutes });
    const denseHours = plan.dense?.hours ?? [];
    const armed = armedHoursOf(windows);
    const shared = denseHours.filter((hour) => plan.slow.hours.includes(hour));
    const label = `trial ${trial} step ${denseStepMinutes} dense=[${denseHours}] slow=[${plan.slow.hours}]`;

    // a. Never under-cover. The one property Item 102 says must hold.
    const crons = [plan.dense?.cron, plan.slow.cron].filter((c) => c !== undefined);
    assert.deepEqual(uncoveredHours(crons, armed), [], `under-covered: ${label}`);

    // b. Disjoint hour sets, with the ONE stated exception: a fully dense day has
    //    no unshared hour for the idle slot, so it shares exactly that hour.
    if (denseHours.length === 24) {
      shapes.fullyDense += 1;
      assert.deepEqual(plan.slow.hours, [IDLE_SLOW_HOUR], `full-day slot moved: ${label}`);
      assert.deepEqual(shared, [IDLE_SLOW_HOUR], `full-day overlap changed: ${label}`);
    } else {
      assert.deepEqual(shared, [], `hour sets overlap: ${label}`);
    }

    // c. Even on a shared hour, the two never fire in the same minute.
    for (const hour of shared) {
      for (let minute = 0; minute < 60; minute += 1) {
        const instant = DAY + hour * HOUR + minute * MINUTE;
        const denseFires = previousScheduleSlotMs(plan.dense!.cron, instant) === instant;
        const slowFires = previousScheduleSlotMs(plan.slow.cron, instant) === instant;
        assert.ok(!(denseFires && slowFires), `minute collision at ${hour}:${minute} — ${label}`);
      }
    }

    // d. The idle slot shares a dense hour ONLY on a fully dense day. This is the
    //    reachability fact the constant's placement rests on: if a future change
    //    makes the mixed case possible, this fails instead of billing duplicates.
    if (plan.slow.hours.length === 1 && denseHours.includes(plan.slow.hours[0]!)) {
      assert.equal(denseHours.length, 24, `idle slot in a dense hour on a mixed day: ${label}`);
    }

    if (windows.length === 0 || armed.length === 0) shapes.dead += 1;
    else if (plan.slow.hours.length === 1 && denseHours.length < 24) shapes.idle += 1;
    else if (denseHours.length < 24) shapes.reconciliation += 1;
  }

  // CONTROL ON THE GENERATOR. Without this the sweep passes just as happily on a
  // space that never reaches the shapes the properties are interesting for — the
  // exact way the previous collision test went vacuous.
  assert.ok(shapes.dead > 0, 'no dead day generated');
  assert.ok(shapes.idle > 0, 'no idle-slot day generated');
  assert.ok(shapes.reconciliation > 0, 'no day with reconciliation hours generated');
  assert.ok(shapes.fullyDense > 0, 'no fully dense day generated — the exception went untested');
});
