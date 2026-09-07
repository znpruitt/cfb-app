import assert from 'node:assert/strict';
import test from 'node:test';

import { synthesizePollingCrons } from '../pollingCron';
import {
  PLANNING_LEAD_MS,
  plannedKickoffsFromRows,
  plannerWindows,
  resolvePlanningDayStartMs,
  wholeDayWindowFor,
} from '../pollingPlanner';
import { RECONCILIATION_GUARANTEE_MS, utcHoursCovered, densePhase } from '../pollingWindows';

/**
 * PLATFORM-102 slice 4 — the two answers slices 1 and 2 explicitly handed to
 * their caller: WHICH day to plan, and what to do with a kickoff whose time is
 * not published.
 */

const ms = (iso: string): number => Date.parse(iso);
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Which day
// ---------------------------------------------------------------------------

test('the scheduled 23:50 run plans TOMORROW, and an ad-hoc run plans today', () => {
  // The whole reason the lead exists. A cron has no date field, so yesterday's
  // hour set fires again today until it is rewritten; the planner therefore has to
  // install a day's expression BEFORE that day starts.
  assert.equal(
    resolvePlanningDayStartMs(ms('2026-10-03T23:50:00Z')),
    ms('2026-10-04T00:00:00Z'),
    'the scheduled run crosses the boundary'
  );
  // An operator re-running it by hand at nine in the morning must plan the day
  // they are actually in. A hardcoded "tomorrow" gets exactly this case wrong,
  // and it is the case a human reaches for.
  assert.equal(
    resolvePlanningDayStartMs(ms('2026-10-04T09:00:00Z')),
    ms('2026-10-04T00:00:00Z'),
    'a recovery run plans the current day'
  );
  assert.equal(PLANNING_LEAD_MS, 60 * 60 * 1000);
});

test('the planning day start is always an exact UTC midnight, which synthesis requires', () => {
  // `synthesizePollingCrons` validates `dayStartMs` rather than trusting it,
  // because an offset day start rotates the whole hour field silently. Generated
  // over the CONTRACT — every minute of a day, plus the boundary either side —
  // rather than over the handful of instants the cron happens to fire at.
  for (let offsetMinutes = -70; offsetMinutes <= 24 * 60 + 70; offsetMinutes += 1) {
    const nowMs = ms('2026-10-03T00:00:00Z') + offsetMinutes * 60_000;
    const dayStart = resolvePlanningDayStartMs(nowMs);
    assert.equal(dayStart % DAY_MS, 0, `offset ${offsetMinutes} produced a non-midnight`);
    // And it is never behind the day `now` is in, nor more than one day ahead.
    const currentDay = Math.floor(nowMs / DAY_MS) * DAY_MS;
    assert.ok(
      dayStart === currentDay || dayStart === currentDay + DAY_MS,
      `offset ${offsetMinutes} jumped to ${new Date(dayStart).toISOString()}`
    );
    // Whatever it returns, synthesis accepts it.
    assert.doesNotThrow(() => synthesizePollingCrons([], dayStart, { denseStepMinutes: 3 }));
  }
});

test('a non-finite clock is refused rather than silently floored', () => {
  // `Math.floor(NaN / DAY)` is NaN, which `validDayStart` would reject one layer
  // down with a message about the day rather than about the clock. Fail at the
  // boundary that owns the input.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => resolvePlanningDayStartMs(bad), /finite/);
  }
});

// ---------------------------------------------------------------------------
// TBD kickoffs — the mapping `PlannedKickoff` names this slice as owing
// ---------------------------------------------------------------------------

test('ONLY an explicit `startTimeTBD: false` counts as a confirmed kickoff', () => {
  // `PlannedKickoff`'s warning, enforced: `timeConfirmed: !row.startTimeTBD` FAILS
  // OPEN, because the flag is optional on the wire and hydrated only when the
  // provider sends a boolean. A row where CFBD omits it must NOT read as
  // confirmed. Mutation target: change the mapping to `!== true` and the
  // undefined/null cases below flip.
  const rows = [
    { startDate: '2026-10-03T19:30:00Z', startTimeTBD: false },
    { startDate: '2026-10-03T20:30:00Z', startTimeTBD: true },
    { startDate: '2026-10-03T21:30:00Z' },
    // `null` is not on the wire type; cast so the runtime mapping is still
    // exercised against a value a tolerant JSON parse could hand it.
    { startDate: '2026-10-03T22:30:00Z', startTimeTBD: null as unknown as boolean },
  ];
  assert.deepEqual(
    plannedKickoffsFromRows(rows).map((k) => k.timeConfirmed),
    [true, false, false, false]
  );
});

test('a row with no usable date contributes nothing at all', () => {
  const rows = [
    { startDate: '2026-10-03T19:30:00Z', startTimeTBD: false },
    { startDate: 'not a date', startTimeTBD: false },
    { startDate: null, startTimeTBD: false },
    { startDate: undefined as unknown as string, startTimeTBD: false },
  ];
  const kickoffs = plannedKickoffsFromRows(rows);
  assert.equal(kickoffs.length, 1);
  assert.equal(kickoffs[0]!.kickoffMs, ms('2026-10-03T19:30:00Z'));
});

test('an unconfirmed kickoff arms its published UTC DAY, which is where the real one lands', () => {
  // Measured on the shipped 2026 record: a TBD row parses at UTC hour 4 or 5 and
  // the real kickoff follows 12 to 19 hours later — UTC hours 16 to 24 of the same
  // date. Clustering on the placeholder arms hours 4-12 and goes dark over every
  // one of those, which is the failure this whole planner cannot survive.
  const placeholder = ms('2026-10-03T04:00:00Z');
  const window = wholeDayWindowFor(placeholder);

  assert.equal(window.startMs, ms('2026-10-03T00:00:00Z'));
  assert.equal(window.denseEndMs, ms('2026-10-04T00:00:00Z'));
  // The guarantee runs from the LATEST instant the day could hold a kickoff.
  assert.equal(window.slowEndMs, ms('2026-10-04T00:00:00Z') + RECONCILIATION_GUARANTEE_MS);

  // The real kickoff, wherever in that 12-19h band it lands, is densely covered.
  const dense = utcHoursCovered([densePhase(window)], ms('2026-10-03T00:00:00Z'));
  for (let hour = 16; hour <= 23; hour += 1) {
    assert.ok(dense.includes(hour), `hour ${hour} must be armed for a TBD game`);
  }

  // POSITIVE CONTROL: the mapping this replaces really does go dark there. A
  // window clustered on the placeholder covers hour 4 and not hour 20.
  const clustered = plannerWindows([{ startDate: '2026-10-03T04:00:00Z', startTimeTBD: false }]);
  const clusteredDense = utcHoursCovered(
    clustered.windows.map(densePhase),
    ms('2026-10-03T00:00:00Z')
  );
  assert.ok(clusteredDense.includes(4));
  assert.ok(!clusteredDense.includes(20), 'the placeholder cluster is dark over the real kickoff');
});

test('unconfirmed kickoffs are counted and covered, never dropped', () => {
  const plan = plannerWindows([
    { startDate: '2026-10-03T19:30:00Z', startTimeTBD: false },
    { startDate: '2026-10-10T04:00:00Z', startTimeTBD: true },
    { startDate: '2026-10-17T05:00:00Z' },
  ]);
  assert.equal(plan.plannedKickoffs, 3);
  assert.equal(plan.unconfirmedKickoffs, 2);
  // One cluster from the confirmed kickoff, one whole-day window per TBD row.
  assert.equal(plan.windows.length, 3);
});

test('every window this planner emits satisfies the synthesizer’s contract', () => {
  // GENERATED OVER THE TYPE'S CONTRACT, not over the shapes today's schedule
  // happens to produce (`AGENTS.md`): `synthesizePollingCrons` accepts any window
  // with `startMs <= denseEndMs <= slowEndMs`, and the whole-day windows are a
  // shape `derivePollingWindows` never emits. Sweep confirmed/unconfirmed rows
  // across every UTC hour and both sides of a day boundary.
  const rows: Array<{ startDate: string; startTimeTBD?: boolean }> = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 30, 59]) {
      const iso = `2026-10-${String(3 + (hour % 5)).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
      rows.push({ startDate: iso, startTimeTBD: false });
      rows.push({ startDate: iso, startTimeTBD: true });
    }
  }
  const plan = plannerWindows(rows);
  assert.ok(plan.windows.length > 0);
  for (const window of plan.windows) {
    assert.ok(Number.isFinite(window.startMs));
    assert.ok(window.startMs <= window.denseEndMs);
    assert.ok(window.denseEndMs <= window.slowEndMs);
  }
  // And synthesis accepts the whole set on every day any of them touches.
  for (let day = 0; day < 12; day += 1) {
    const dayStart = ms('2026-10-01T00:00:00Z') + day * DAY_MS;
    assert.doesNotThrow(() =>
      synthesizePollingCrons(plan.windows, dayStart, { denseStepMinutes: 3 })
    );
    assert.doesNotThrow(() =>
      synthesizePollingCrons(plan.windows, dayStart, { denseStepMinutes: 15 })
    );
  }
});

test('the whole season goes in, so cluster boundaries are never moved by pre-filtering', () => {
  // Filtering kickoffs to "near the planning day" is the cheap thing to do and it
  // changes the ANSWER: dropping an early cluster member moves `startMs`, so the
  // surviving window is a different window. `utcHoursCovered` is the only thing
  // entitled to narrow to a day.
  const rows = [
    { startDate: '2026-10-03T16:00:00Z', startTimeTBD: false },
    { startDate: '2026-10-03T19:30:00Z', startTimeTBD: false },
  ];
  const both = plannerWindows(rows);
  const lateOnly = plannerWindows(rows.slice(1));

  assert.equal(both.windows.length, 1, 'they cluster');
  assert.notEqual(
    both.windows[0]!.startMs,
    lateOnly.windows[0]!.startMs,
    'dropping the early kickoff moves the window start'
  );
});
