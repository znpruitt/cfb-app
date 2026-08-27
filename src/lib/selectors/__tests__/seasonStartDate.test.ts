import assert from 'node:assert/strict';
import test from 'node:test';

import { isAwaitingSeasonStartDate } from '../seasonStartDate.ts';

const START_DATE = '2026-08-29T00:00:00.000Z';

test('awaits before and throughout the inferred UTC season-start date', () => {
  assert.equal(isAwaitingSeasonStartDate(START_DATE, Date.UTC(2026, 7, 28, 23, 59, 59)), true);
  assert.equal(isAwaitingSeasonStartDate(START_DATE, Date.UTC(2026, 7, 29, 0, 0, 0)), true);
  assert.equal(isAwaitingSeasonStartDate(START_DATE, Date.UTC(2026, 7, 29, 23, 59, 59)), true);
});

test('stops awaiting at the midnight immediately after the UTC season-start date', () => {
  assert.equal(isAwaitingSeasonStartDate(START_DATE, Date.UTC(2026, 7, 30, 0, 0, 0)), false);
});

test('normalizes legacy exact-kickoff timestamps to their UTC calendar date', () => {
  const legacyKickoff = '2026-08-29T18:30:00.000Z';
  assert.equal(isAwaitingSeasonStartDate(legacyKickoff, Date.UTC(2026, 7, 29, 23, 0, 0)), true);
  assert.equal(isAwaitingSeasonStartDate(legacyKickoff, Date.UTC(2026, 7, 30, 0, 0, 0)), false);
});

test('missing anchors remain conservative while invalid persisted values expose diagnostics', () => {
  assert.equal(isAwaitingSeasonStartDate(null, Date.UTC(2026, 7, 29)), true);
  assert.equal(isAwaitingSeasonStartDate('not-a-date', Date.UTC(2026, 7, 29)), false);
});
