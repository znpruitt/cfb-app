import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLUSTER_LEAD_MS,
  CLUSTER_MARGIN_MS,
  derivePollingWindows,
  utcHoursCovered,
  type PlannedKickoff,
} from '../pollingWindows';

const H = 3_600_000;
const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16);

/** A kickoff whose time CFBD has published. */
const confirmed = (isoText: string): PlannedKickoff => ({
  kickoffMs: at(isoText),
  timeConfirmed: true,
});
/** A `startTimeTBD` row — a real, parseable PLACEHOLDER instant, not a missing one. */
const tbd = (isoText: string): PlannedKickoff => ({
  kickoffMs: at(isoText),
  timeConfirmed: false,
});

const windowsOf = (
  kickoffs: PlannedKickoff[],
  options?: Parameters<typeof derivePollingWindows>[1]
) => derivePollingWindows(kickoffs, options).windows;

test('one kickoff yields one window, lead before and margin after', () => {
  const kickoff = confirmed('2026-09-05T19:00:00.000Z');
  const [window, ...rest] = windowsOf([kickoff]);

  assert.equal(rest.length, 0);
  assert.equal(window!.startMs, kickoff.kickoffMs - CLUSTER_LEAD_MS);
  assert.equal(window!.endMs, kickoff.kickoffMs + CLUSTER_MARGIN_MS);
  assert.equal(window!.kickoffCount, 1);
});

test('the margin runs from the LAST kickoff, not the first', () => {
  // Closing a margin after the cluster OPENED would cut dense polling while later
  // games in the same slate are still live.
  const first = confirmed('2026-09-05T16:00:00.000Z');
  const last = confirmed('2026-09-05T23:30:00.000Z');
  const [window] = windowsOf([first, last]);

  assert.equal(window!.endMs, last.kickoffMs + CLUSTER_MARGIN_MS);
  assert.notEqual(window!.endMs, first.kickoffMs + CLUSTER_MARGIN_MS);
});

test('a gap wider than margin+lead splits the cluster', () => {
  // The split threshold is `margin + lead` (8h15m by default), not `margin` —
  // a kickoff joins when `kickoff − lead` falls at or before the current end.
  const windows = windowsOf([
    confirmed('2026-09-03T23:00:00.000Z'),
    confirmed('2026-09-05T16:00:00.000Z'),
  ]);

  assert.equal(windows.length, 2, 'two days of football are not one window');
  assert.ok(windows[0]!.endMs < windows[1]!.startMs, 'and the cron is OFF between them');
});

test('the split threshold is margin+lead exactly, not margin', () => {
  // Pins the boundary the docstring states. A gap of margin+lead merges; one
  // millisecond more splits. An earlier docstring claimed `margin`, and the only
  // test covering it used a 41-hour gap, so the discrepancy was invisible.
  const base = at('2026-09-05T12:00:00.000Z');
  const threshold = CLUSTER_MARGIN_MS + CLUSTER_LEAD_MS;

  const merged = windowsOf([
    { kickoffMs: base, timeConfirmed: true },
    { kickoffMs: base + threshold, timeConfirmed: true },
  ]);
  const split = windowsOf([
    { kickoffMs: base, timeConfirmed: true },
    { kickoffMs: base + threshold + 1, timeConfirmed: true },
  ]);

  assert.equal(merged.length, 1, 'exactly at the threshold, they merge');
  assert.equal(split.length, 2, 'one millisecond beyond it, they split');
});

test('a chain of games extends the window past any single margin', () => {
  const kickoffs = [0, 3, 6, 9, 12].map((offset) => ({
    kickoffMs: at('2026-09-05T12:00:00.000Z') + offset * H,
    timeConfirmed: true,
  }));
  const windows = windowsOf(kickoffs);

  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.kickoffCount, 5);
  assert.equal(windows[0]!.endMs, kickoffs[4]!.kickoffMs + CLUSTER_MARGIN_MS);
});

test('A TBD KICKOFF NEVER SHAPES A WINDOW, and is handed back rather than dropped', () => {
  // The HIGH finding this signature exists for. CFBD publishes `startTimeTBD`
  // rows with a PLACEHOLDER instant — measured on the shipped 2026 record, all
  // 421 of them parse cleanly at UTC hour 4 or 5, i.e. midnight or 1am Eastern
  // on the game date, 12 to 19 hours before the real kickoff. Clustering on that
  // arms the wrong hours AND leaves the actual kickoff uncovered.
  const placeholder = tbd('2026-11-04T05:00:00.000Z'); // midnight ET, a TBD stand-in
  const real = confirmed('2026-11-05T00:00:00.000Z'); // 7pm ET the next evening

  const plan = derivePollingWindows([placeholder, real]);

  assert.equal(plan.windows.length, 1, 'only the confirmed kickoff shapes a window');
  assert.equal(plan.windows[0]!.startMs, real.kickoffMs - CLUSTER_LEAD_MS);
  assert.ok(
    plan.windows[0]!.startMs > placeholder.kickoffMs,
    'and no window is armed around the placeholder instant'
  );
  assert.deepEqual(plan.unconfirmed, [placeholder], 'the TBD row is RETURNED, not discarded');
});

test('a plan of only TBD kickoffs arms nothing and says so', () => {
  // Positive control for the test above, and the case a caller must handle:
  // silently returning no windows would leave those games unpolled with no signal.
  const plan = derivePollingWindows([
    tbd('2026-11-04T05:00:00.000Z'),
    tbd('2026-11-11T05:00:00.000Z'),
  ]);

  assert.deepEqual(plan.windows, []);
  assert.equal(plan.unconfirmed.length, 2, 'the caller can see what it still has to cover');
});

test('input order does not matter', () => {
  const early = confirmed('2026-09-03T23:00:00.000Z');
  const late = confirmed('2026-09-05T16:00:00.000Z');
  const windows = windowsOf([late, early]);

  assert.equal(windows.length, 2);
  assert.equal(windows[0]!.startMs, early.kickoffMs - CLUSTER_LEAD_MS, 'output is ascending');
});

test('a non-finite kickoff cannot produce a window', () => {
  // Defensive only. NOTE: this shape occurs ZERO times in the shipped 2026 record
  // — an earlier version of this test claimed the 421 `startTimeTBD` rows as its
  // motivation, which was false: those parse fine and are handled by
  // `timeConfirmed`, not by this check.
  const plan = derivePollingWindows([
    { kickoffMs: Number.NaN, timeConfirmed: true },
    { kickoffMs: Number.POSITIVE_INFINITY, timeConfirmed: true },
  ]);
  assert.deepEqual(plan.windows, []);
});

test('no kickoffs means no windows — the cron goes fully dark', () => {
  assert.deepEqual(derivePollingWindows([]).windows, []);
});

test('the real 2026-09-03 weekend derives as FIVE clusters, not one', () => {
  const kickoffs = [
    '2026-09-03T21:00:00.000Z',
    '2026-09-04T22:00:00.000Z',
    '2026-09-05T15:00:00.000Z',
    '2026-09-05T23:15:00.000Z',
    '2026-09-06T16:00:00.000Z',
    '2026-09-07T23:30:00.000Z',
  ].map(confirmed);

  const windows = windowsOf(kickoffs);

  assert.equal(windows.length, 5);
  assert.deepEqual(
    windows.map((window) => `${iso(window.startMs)} -> ${iso(window.endMs)}`),
    [
      '2026-09-03T20:45 -> 2026-09-04T05:00',
      '2026-09-04T21:45 -> 2026-09-05T06:00',
      '2026-09-05T14:45 -> 2026-09-06T07:15',
      '2026-09-06T15:45 -> 2026-09-07T00:00',
      '2026-09-07T23:15 -> 2026-09-08T07:30',
    ]
  );
  assert.equal(windows[2]!.kickoffCount, 2, 'the Saturday cluster chains its two kickoffs');
});

test('utcHoursCovered projects a window onto the hours a cron can express', () => {
  const windows = windowsOf([confirmed('2026-09-05T19:30:00.000Z')], {
    marginMs: 2 * H,
    leadMs: 15 * 60_000,
  });

  // 19:15 -> 21:30 touches hours 19, 20 and 21: a partial hour still counts,
  // because cron cannot fire for part of an hour.
  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 5)), [19, 20, 21]);
});

test('a window spanning midnight covers the tail of one day and the head of the next', () => {
  const windows = windowsOf([confirmed('2026-09-05T23:00:00.000Z')], {
    marginMs: 3 * H,
    leadMs: 0,
  });

  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 5)), [23]);
  // Hour 2 is NOT covered: the window ends exactly at 02:00 and the interval is
  // half-open, so an hour beginning at the end is untouched. An off-by-one here
  // would arm an extra hour every day.
  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 6)), [0, 1]);
});

test('a day no window touches yields no hours', () => {
  const windows = windowsOf([confirmed('2026-09-05T19:00:00.000Z')]);
  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 9)), []);
  assert.ok(utcHoursCovered(windows, Date.UTC(2026, 8, 5)).length > 0, 'positive control');
});
