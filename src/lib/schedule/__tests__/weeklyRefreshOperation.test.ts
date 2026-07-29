import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWeeklyScheduleRefreshOperation,
  POSTSEASON_BOUNDARY_LEAD_MS,
} from '../weeklyRefreshOperation.ts';

// Deterministic fixture: a regular season whose latest regular kickoff is fixed,
// plus a postseason game that must NOT drive the boundary.
const LATEST_REGULAR_KICKOFF = Date.parse('2031-11-29T20:00:00.000Z');
const BOUNDARY = LATEST_REGULAR_KICKOFF - POSTSEASON_BOUNDARY_LEAD_MS;

function entryWith(items: unknown[]): unknown {
  return { at: 1, items, partialFailure: false, failedSeasonTypes: [] };
}

const REGULAR_SEASON_ITEMS = [
  {
    id: '1',
    week: 1,
    startDate: '2031-08-30T16:00:00.000Z',
    homeTeam: 'Texas',
    awayTeam: 'Rice',
    status: 'scheduled',
    seasonType: 'regular',
  },
  {
    id: '2',
    week: 14,
    startDate: new Date(LATEST_REGULAR_KICKOFF).toISOString(),
    homeTeam: 'Ohio State',
    awayTeam: 'Michigan',
    status: 'scheduled',
    seasonType: 'regular',
  },
  {
    // A LATER postseason kickoff — must never extend the regular-season boundary.
    id: '3',
    week: 16,
    startDate: '2032-01-10T00:00:00.000Z',
    homeTeam: 'TBD',
    awayTeam: 'TBD',
    status: 'scheduled',
    seasonType: 'postseason',
  },
];

// 7 (route-adjacent) — missing schedule context cannot classify.
test('a missing/absent entry is canonical-context-unavailable', () => {
  for (const entry of [undefined, null, {}, { items: 'nope' }, entryWith([])]) {
    const decision = classifyWeeklyScheduleRefreshOperation({ entry, now: BOUNDARY });
    assert.equal(decision.kind, 'canonical-context-unavailable');
  }
});

// 8 — a schedule with no valid regular kickoff is a context failure.
test('a schedule with no regular-season game with a valid kickoff is context-unavailable', () => {
  const noRegular = entryWith([
    { id: 'p', week: 16, startDate: '2032-01-10T00:00:00.000Z', seasonType: 'postseason' },
  ]);
  const invalidKickoff = entryWith([
    { id: 'r', week: 1, startDate: 'not-a-date', seasonType: 'regular' },
    { id: 'r2', week: 2, startDate: null, seasonType: 'regular' },
  ]);
  for (const entry of [noRegular, invalidKickoff]) {
    const decision = classifyWeeklyScheduleRefreshOperation({ entry, now: BOUNDARY });
    assert.equal(decision.kind, 'canonical-context-unavailable');
  }
});

// 9 — before `latestRegularKickoff − 7 days` → ordinary.
test('before the boundary the operation is ordinary-maintenance', () => {
  const decision = classifyWeeklyScheduleRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    now: BOUNDARY - 1,
  });
  assert.deepEqual(decision, { kind: 'operation', operation: 'ordinary-maintenance' });
});

// 10 — exactly at the boundary → postseason-boundary.
test('exactly at the boundary the operation is postseason-boundary', () => {
  const decision = classifyWeeklyScheduleRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    now: BOUNDARY,
  });
  assert.deepEqual(decision, { kind: 'operation', operation: 'postseason-boundary' });
});

// 11 — after the boundary → postseason-boundary.
test('after the boundary the operation is postseason-boundary', () => {
  const decision = classifyWeeklyScheduleRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    now: BOUNDARY + 60_000,
  });
  assert.deepEqual(decision, { kind: 'operation', operation: 'postseason-boundary' });
});

// 12 — the critical classification persists while the league remains in season
// (time only advances and the latest regular kickoff is fixed, so every later
// invocation classifies critical too — including long after the kickoff).
test('critical classification persists for every later invocation', () => {
  const laterInstants = [
    BOUNDARY,
    LATEST_REGULAR_KICKOFF,
    LATEST_REGULAR_KICKOFF + 30 * 24 * 60 * 60 * 1000, // deep into the postseason
  ];
  for (const now of laterInstants) {
    const decision = classifyWeeklyScheduleRefreshOperation({
      entry: entryWith(REGULAR_SEASON_ITEMS),
      now,
    });
    assert.deepEqual(decision, { kind: 'operation', operation: 'postseason-boundary' });
  }
});

// The boundary must come from the latest REGULAR kickoff — a postseason game with
// a later kickoff must not delay the exempt window.
test('a later postseason kickoff does not extend the ordinary window', () => {
  // At the regular boundary, we are 7d before the LATEST REGULAR kickoff but
  // ~6 weeks before the postseason game — classification must already be critical.
  const decision = classifyWeeklyScheduleRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    now: BOUNDARY,
  });
  assert.deepEqual(decision, { kind: 'operation', operation: 'postseason-boundary' });
});

// Rows without a canonical seasonType fall back to gamePhase (legacy defensive
// behavior mirrored from the schedule route).
test('legacy rows without seasonType classify by gamePhase fallback', () => {
  const legacy = entryWith([
    { id: 'l', week: 12, startDate: new Date(LATEST_REGULAR_KICKOFF).toISOString() },
  ]);
  const decision = classifyWeeklyScheduleRefreshOperation({ entry: legacy, now: BOUNDARY - 1 });
  assert.deepEqual(decision, { kind: 'operation', operation: 'ordinary-maintenance' });
});
