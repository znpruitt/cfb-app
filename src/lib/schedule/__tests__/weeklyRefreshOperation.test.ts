import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPreseasonWeeklyRefreshOperation,
  classifyWeeklyScheduleRefreshOperation,
  POSTSEASON_BOUNDARY_LEAD_MS,
  SEASON_TRANSITION_HANDOFF_LEAD_MS,
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

// ---------------------------------------------------------------------------
// Cycle-1 review remediation.
// ---------------------------------------------------------------------------

// Finding 1 — a latched year stays lifecycle-critical even when a schedule
// change moved the recomputed boundary later (before the new boundary).
test('a latched year classifies postseason-boundary even before the recomputed boundary', () => {
  const decision = classifyWeeklyScheduleRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    now: BOUNDARY - 1, // ordinary by boundary math alone
    latched: true,
  });
  assert.deepEqual(decision, { kind: 'operation', operation: 'postseason-boundary' });
});

test('context-unavailability takes precedence over the latch', () => {
  const decision = classifyWeeklyScheduleRefreshOperation({
    entry: entryWith([]),
    now: BOUNDARY,
    latched: true,
  });
  assert.equal(decision.kind, 'canonical-context-unavailable');
});

// Finding 2 — a PRESENT-but-unrecognized seasonType is malformed context, never
// a regular-season row that could extend the boundary.
test('a present-but-invalid seasonType poisons the entry as context-unavailable', () => {
  const withMalformed = entryWith([
    ...REGULAR_SEASON_ITEMS,
    {
      id: 'bad',
      week: 15,
      // A LATER kickoff than the latest regular game: if this row were counted
      // as regular it would extend the boundary and revert critical to ordinary.
      startDate: '2032-01-10T00:00:00.000Z',
      seasonType: 'post-season', // malformed — not the canonical vocabulary
    },
  ]);
  const decision = classifyWeeklyScheduleRefreshOperation({ entry: withMalformed, now: BOUNDARY });
  assert.equal(decision.kind, 'canonical-context-unavailable');
});

// ---------------------------------------------------------------------------
// PLATFORM-086E1B1 — the pure PRESEASON classifier: cache-armed early preseason
// gets ordinary weekly maintenance; unarmed / final-seven-day preseason defers
// to the daily season-transition cron; genuine context failures never become a
// transition deferral.
// ---------------------------------------------------------------------------

const FIRST_KICKOFF = Date.parse('2031-08-30T16:00:00.000Z');
const HANDOFF = FIRST_KICKOFF - SEASON_TRANSITION_HANDOFF_LEAD_MS;
const ARMED_PROBE = {
  year: 2031,
  baseCachedAt: '2031-05-01T00:00:00.000Z',
  firstGameDate: new Date(FIRST_KICKOFF).toISOString(),
};

// 3 — no probe record → transition owner.
test('preseason: no probe record defers to season-transition', () => {
  for (const probe of [undefined, null, 'garbage', []]) {
    const decision = classifyPreseasonWeeklyRefreshOperation({
      entry: entryWith(REGULAR_SEASON_ITEMS),
      probe,
      now: HANDOFF - 1,
    });
    assert.deepEqual(decision, { kind: 'season-transition-owner' });
  }
});

// 4/5/6 — missing baseCachedAt / missing firstGameDate / invalid firstGameDate.
test('preseason: unarmed or invalid probe fields defer to season-transition', () => {
  const variants = [
    { ...ARMED_PROBE, baseCachedAt: null }, // missing baseCachedAt
    { ...ARMED_PROBE, baseCachedAt: '' }, // empty baseCachedAt
    { ...ARMED_PROBE, firstGameDate: null }, // missing firstGameDate
    { ...ARMED_PROBE, firstGameDate: 'not-a-date' }, // invalid firstGameDate
  ];
  for (const probe of variants) {
    const decision = classifyPreseasonWeeklyRefreshOperation({
      entry: entryWith(REGULAR_SEASON_ITEMS),
      probe,
      now: HANDOFF - 1,
    });
    assert.deepEqual(decision, { kind: 'season-transition-owner' }, JSON.stringify(probe));
  }
});

// 7/8/9 — exact boundary, inside seven days, and after kickoff all defer.
test('preseason: at/inside the seven-day handoff (and after kickoff) defers to season-transition', () => {
  for (const now of [HANDOFF, HANDOFF + 1, FIRST_KICKOFF, FIRST_KICKOFF + 60_000]) {
    const decision = classifyPreseasonWeeklyRefreshOperation({
      entry: entryWith(REGULAR_SEASON_ITEMS),
      probe: ARMED_PROBE,
      now,
    });
    assert.deepEqual(decision, { kind: 'season-transition-owner' }, String(now));
  }
});

// 10 — cache-armed early preseason classifies preseason-maintenance.
test('preseason: armed probe + populated schedule more than 7 days out → preseason-maintenance', () => {
  const decision = classifyPreseasonWeeklyRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    probe: ARMED_PROBE,
    now: HANDOFF - 1,
  });
  assert.deepEqual(decision, { kind: 'operation', operation: 'preseason-maintenance' });
});

// 20/21 — armed early-preseason probe with a missing/empty canonical schedule is
// a CONTEXT failure (the probe claims a cached schedule), never a deferral.
test('preseason: armed probe with missing/empty canonical schedule is context-unavailable', () => {
  for (const entry of [undefined, null, entryWith([])]) {
    const decision = classifyPreseasonWeeklyRefreshOperation({
      entry,
      probe: ARMED_PROBE,
      now: HANDOFF - 1,
    });
    assert.equal(decision.kind, 'canonical-context-unavailable');
  }
});

// 22 — malformed canonical season type is a context failure in preseason too.
test('preseason: a present-but-invalid seasonType is context-unavailable', () => {
  const malformed = entryWith([
    ...REGULAR_SEASON_ITEMS,
    { id: 'bad', week: 2, startDate: '2031-09-06T00:00:00.000Z', seasonType: 'pre-season' },
  ]);
  const decision = classifyPreseasonWeeklyRefreshOperation({
    entry: malformed,
    probe: ARMED_PROBE,
    now: HANDOFF - 1,
  });
  assert.equal(decision.kind, 'canonical-context-unavailable');
});

// The handoff comparison must be EXACTLY the season-transition `shouldFetch`
// comparison (>= at firstGameDate − 7d), so 1ms before the boundary is E1B's and
// the boundary itself is season-transition's.
test('preseason: the handoff boundary is exclusive on the E1B side (now < firstGame − 7d)', () => {
  const before = classifyPreseasonWeeklyRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    probe: ARMED_PROBE,
    now: HANDOFF - 1,
  });
  assert.deepEqual(before, { kind: 'operation', operation: 'preseason-maintenance' });
  const at = classifyPreseasonWeeklyRefreshOperation({
    entry: entryWith(REGULAR_SEASON_ITEMS),
    probe: ARMED_PROBE,
    now: HANDOFF,
  });
  assert.deepEqual(at, { kind: 'season-transition-owner' });
});
