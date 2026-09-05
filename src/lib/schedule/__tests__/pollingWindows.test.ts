import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLUSTER_LEAD_MS,
  CLUSTER_MARGIN_MS,
  derivePollingWindows,
  utcHoursCovered,
} from '../pollingWindows';

const H = 3_600_000;
const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16);

test('one kickoff yields one window, lead before and margin after', () => {
  const kickoff = at('2026-09-05T19:00:00.000Z');
  const [window, ...rest] = derivePollingWindows([kickoff]);

  assert.equal(rest.length, 0);
  assert.equal(window!.startMs, kickoff - CLUSTER_LEAD_MS);
  assert.equal(window!.endMs, kickoff + CLUSTER_MARGIN_MS);
  assert.equal(window!.kickoffCount, 1);
});

test('the margin runs from the LAST kickoff, not the first', () => {
  // The defect this guards: closing the window a margin after the cluster OPENED
  // would cut dense polling while later games in the same slate are still live.
  const first = at('2026-09-05T16:00:00.000Z');
  const last = at('2026-09-05T23:30:00.000Z');
  const [window] = derivePollingWindows([first, last]);

  assert.equal(window!.endMs, last + CLUSTER_MARGIN_MS);
  assert.notEqual(window!.endMs, first + CLUSTER_MARGIN_MS);
});

test('a gap larger than the margin splits the cluster', () => {
  const thursday = at('2026-09-03T23:00:00.000Z');
  const saturday = at('2026-09-05T16:00:00.000Z');
  const windows = derivePollingWindows([thursday, saturday]);

  assert.equal(windows.length, 2, 'two days of football are not one window');
  assert.equal(windows[0]!.endMs, thursday + CLUSTER_MARGIN_MS);
  assert.equal(windows[1]!.startMs, saturday - CLUSTER_LEAD_MS);
  assert.ok(windows[0]!.endMs < windows[1]!.startMs, 'and the cron is OFF between them');
});

test('games within the margin chain into one window', () => {
  // Positive control for the split above: the same shape, closer together, must
  // NOT split — otherwise "two windows" proves nothing.
  const early = at('2026-09-05T16:00:00.000Z');
  const late = at('2026-09-05T22:00:00.000Z');
  const windows = derivePollingWindows([early, late]);

  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.kickoffCount, 2);
});

test('a chain of games extends the window well past any single margin', () => {
  // Saturday: kickoffs every three hours from noon. The cluster must run to the
  // last one plus the margin, not close after the first gap-free pair.
  const kickoffs = [0, 3, 6, 9, 12].map((offset) => at('2026-09-05T12:00:00.000Z') + offset * H);
  const windows = derivePollingWindows(kickoffs);

  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.kickoffCount, 5);
  assert.equal(windows[0]!.endMs, kickoffs[4]! + CLUSTER_MARGIN_MS);
});

test('input order does not matter and unparseable kickoffs are dropped', () => {
  // 421 of 2026's 3,679 rows carry `startTimeTBD`; a schedule row the planner
  // cannot read must not be able to take the planner down.
  const a = at('2026-09-05T16:00:00.000Z');
  const b = at('2026-09-03T23:00:00.000Z');
  const windows = derivePollingWindows([a, Number.NaN, b, Number.POSITIVE_INFINITY]);

  assert.equal(windows.length, 2);
  assert.ok(windows[0]!.startMs < windows[1]!.startMs, 'output is ascending regardless of input');
  assert.equal(windows[0]!.startMs, b - CLUSTER_LEAD_MS, 'the EARLIER kickoff opens the first');
});

test('no kickoffs means no windows — the cron goes fully dark', () => {
  assert.deepEqual(derivePollingWindows([]), []);
  assert.deepEqual(derivePollingWindows([Number.NaN]), []);
});

test('the real 2026-09-03 weekend derives as FIVE clusters, not one', () => {
  // The shape the item is built on, from the shipped schedule: games Thursday,
  // Friday, the Saturday bulk, Sunday, and Labor Day Monday. Under today's
  // `kickoff + 24h` tail these are one continuous armed block.
  const kickoffs = [
    '2026-09-03T21:00:00.000Z',
    '2026-09-04T22:00:00.000Z',
    '2026-09-05T15:00:00.000Z',
    '2026-09-05T23:15:00.000Z',
    '2026-09-06T16:00:00.000Z',
    '2026-09-07T23:30:00.000Z',
  ].map(at);

  const windows = derivePollingWindows(kickoffs);

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
  const windows = derivePollingWindows([at('2026-09-05T19:30:00.000Z')], {
    marginMs: 2 * H,
    leadMs: 15 * 60_000,
  });
  const hours = utcHoursCovered(windows, Date.UTC(2026, 8, 5));

  // 19:15 -> 21:30 touches hours 19, 20 and 21. A partial hour still counts:
  // cron cannot fire for part of an hour.
  assert.deepEqual(hours, [19, 20, 21]);
});

test('a window spanning midnight covers the tail of one day and the head of the next', () => {
  const windows = derivePollingWindows([at('2026-09-05T23:00:00.000Z')], {
    marginMs: 3 * H,
    leadMs: 0,
  });

  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 5)), [23]);
  // 23:00 -> 02:00. Hour 2 is NOT covered: the window ends exactly at 02:00 and
  // the interval is half-open, so an hour beginning at the end is untouched.
  // Asserted deliberately — an off-by-one here would arm an extra hour every day.
  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 6)), [0, 1]);
});

test('a day no window touches yields no hours', () => {
  const windows = derivePollingWindows([at('2026-09-05T19:00:00.000Z')]);
  assert.deepEqual(utcHoursCovered(windows, Date.UTC(2026, 8, 9)), []);
  // Positive control: the same windows DO cover their own day.
  assert.ok(utcHoursCovered(windows, Date.UTC(2026, 8, 5)).length > 0);
});
