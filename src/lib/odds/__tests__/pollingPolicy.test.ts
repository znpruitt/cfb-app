import assert from 'node:assert/strict';
import test from 'node:test';

import type { OddsRefreshControl } from '../refreshLease.ts';
import {
  collectEligibleOddsGames,
  freshestOddsSignalMs,
  isPregameWindowActive,
  isWithinEarlyOddsPollingHorizon,
  ODDS_BASELINE_CADENCE_MS,
  ODDS_EARLY_CADENCE_MS,
  ODDS_EARLY_KICKOFF_HORIZON_MS,
  ODDS_EXPECTED_KICKOFF_HORIZON_MS,
  ODDS_PREGAME_CADENCE_MS,
  selectOddsPollingDecision,
  type OddsCanonicalGame,
} from '../pollingPolicy.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-05T18:00:00.000Z'); // Sat 13:00 America/Chicago (CDT)

function game(overrides: Partial<OddsCanonicalGame> = {}): OddsCanonicalGame {
  return {
    key: 'g1',
    homeResolved: true,
    awayResolved: true,
    kickoff: new Date(NOW + 2 * DAY).toISOString(),
    rawStatus: 'scheduled',
    ...overrides,
  };
}

function control(overrides: Partial<OddsRefreshControl> = {}): OddsRefreshControl {
  return {
    lease: null,
    lastCompletedCheckAt: null,
    automaticFailureCount: 0,
    automaticNotBefore: null,
    ...overrides,
  };
}

test('polling #21: unresolved, disrupted, invalid-kickoff, past, and beyond-45d games are ineligible', () => {
  // PLATFORM-089 — the horizon literal moved from 8 days to 46. Everything else
  // in this list is untouched: widening WHEN a target exists must not widen WHAT
  // counts as one, so unresolved participants and disrupted games stay out.
  const games: OddsCanonicalGame[] = [
    game({ key: 'unresolved-home', homeResolved: false }),
    game({ key: 'unresolved-away', awayResolved: false }),
    game({ key: 'canceled', rawStatus: 'canceled' }),
    game({ key: 'postponed', rawStatus: 'STATUS_POSTPONED' }),
    game({ key: 'suspended', rawStatus: 'suspended' }),
    game({ key: 'delayed', rawStatus: 'delayed' }),
    game({ key: 'bad-kickoff', kickoff: 'not-a-date' }),
    game({ key: 'null-kickoff', kickoff: null }),
    game({ key: 'past', kickoff: new Date(NOW - HOUR).toISOString() }),
    game({ key: 'beyond-horizon', kickoff: new Date(NOW + 46 * DAY).toISOString() }),
  ];
  assert.equal(collectEligibleOddsGames(games, NOW).length, 0);
  // An empty slate is likewise ineligible.
  assert.deepEqual(
    selectOddsPollingDecision({ games: [], control: control(), rawObservationMs: null, now: NOW }),
    {
      due: false,
      reason: 'no-eligible-target',
    }
  );
  assert.equal(
    selectOddsPollingDecision({ games, control: control(), rawObservationMs: null, now: NOW }).due,
    false
  );
});

test('polling #22: a cold eligible target is baseline due', () => {
  const decision = selectOddsPollingDecision({
    games: [game()],
    control: control(),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: true, cadence: 'baseline' });
});

test('polling #23: a completed check younger than six hours is not baseline due', () => {
  const decision = selectOddsPollingDecision({
    games: [game()],
    control: control({ lastCompletedCheckAt: new Date(NOW - 5 * HOUR).toISOString() }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: false, reason: 'refresh-not-due' });
});

test('polling #24: the six-hour boundary is baseline due', () => {
  const decision = selectOddsPollingDecision({
    games: [game()],
    control: control({
      lastCompletedCheckAt: new Date(NOW - ODDS_BASELINE_CADENCE_MS).toISOString(),
    }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: true, cadence: 'baseline' });
});

test('polling #25: inside the 6h pre-kickoff window the 2h cadence applies', () => {
  // Kickoff 3h ahead → pregame window active. A 3h-old check is NOT baseline-due
  // (< 6h) but IS pregame-due (>= 2h).
  const games = [game({ kickoff: new Date(NOW + 3 * HOUR).toISOString() })];
  const decision = selectOddsPollingDecision({
    games,
    control: control({ lastCompletedCheckAt: new Date(NOW - 3 * HOUR).toISOString() }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: true, cadence: 'pregame' });
  assert.equal(isPregameWindowActive(games, NOW), true);
});

test('polling #26: the two-hour boundary inside the window is due', () => {
  const games = [game({ kickoff: new Date(NOW + 3 * HOUR).toISOString() })];
  const decision = selectOddsPollingDecision({
    games,
    control: control({
      lastCompletedCheckAt: new Date(NOW - ODDS_PREGAME_CADENCE_MS).toISOString(),
    }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: true, cadence: 'pregame' });
  // A younger-than-2h check inside the window is not due.
  const notDue = selectOddsPollingDecision({
    games,
    control: control({ lastCompletedCheckAt: new Date(NOW - HOUR).toISOString() }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(notDue, { due: false, reason: 'refresh-not-due' });
});

test('polling #27: after a date’s first kickoff, later games do not extend acceleration', () => {
  // Same Central date (Sat): first kickoff already started (1h ago), a later game
  // 3h ahead. The date’s window keys on the FIRST kickoff (now past), so a 3h-old
  // check is not due (it would be, were the window still active).
  const games = [
    game({ key: 'started', kickoff: new Date(NOW - HOUR).toISOString() }),
    game({ key: 'later', kickoff: new Date(NOW + 3 * HOUR).toISOString() }),
  ];
  assert.equal(isPregameWindowActive(games, NOW), false);
  const decision = selectOddsPollingDecision({
    games,
    control: control({ lastCompletedCheckAt: new Date(NOW - 3 * HOUR).toISOString() }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: false, reason: 'refresh-not-due' });
  // But there IS still an eligible (future) game, so it is not "no target".
  assert.equal(collectEligibleOddsGames(games, NOW).length, 1);
});

test('polling #28: a future date receives its own pregame window', () => {
  // Today’s first game already kicked off; a game tomorrow at 12:00 CDT.
  const tomorrowNoonCentral = Date.parse('2026-09-06T17:00:00.000Z'); // Sun 12:00 CDT
  const games = [
    game({ key: 'today-started', kickoff: new Date(NOW - HOUR).toISOString() }),
    game({ key: 'tomorrow', kickoff: new Date(tomorrowNoonCentral).toISOString() }),
  ];
  // 9h before tomorrow’s kickoff → not accelerated yet.
  assert.equal(isPregameWindowActive(games, tomorrowNoonCentral - 9 * HOUR), false);
  // 3h before tomorrow’s kickoff → tomorrow’s own window is active.
  assert.equal(isPregameWindowActive(games, tomorrowNoonCentral - 3 * HOUR), true);
});

test('polling #29: DST boundaries group by America/Chicago calendar date', () => {
  // Fall-back weekend: Oct 31 18:00 CDT and Nov 1 12:00 CST are different Central
  // dates, so Nov 1 gets its own window.
  const fall = [
    game({ key: 'oct31', kickoff: '2026-10-31T23:00:00.000Z' }), // 18:00 CDT Oct 31
    game({ key: 'nov1', kickoff: '2026-11-01T18:00:00.000Z' }), // 12:00 CST Nov 1
  ];
  // now = 07:00 CST Nov 1 (13:00Z), 5h before the Nov 1 kickoff → pregame active.
  assert.equal(isPregameWindowActive(fall, Date.parse('2026-11-01T13:00:00.000Z')), true);

  // Spring-forward weekend: Mar 7 23:00 CST and Mar 8 15:00 CDT are different dates.
  const spring = [
    game({ key: 'mar7', kickoff: '2026-03-08T05:00:00.000Z' }), // 23:00 CST Mar 7
    game({ key: 'mar8', kickoff: '2026-03-08T20:00:00.000Z' }), // 15:00 CDT Mar 8
  ];
  // now = 11:00 CDT Mar 8 (16:00Z), 4h before the Mar 8 kickoff → pregame active.
  assert.equal(isPregameWindowActive(spring, Date.parse('2026-03-08T16:00:00.000Z')), true);
});

test('polling #30: automatic backoff suppresses an otherwise-due target', () => {
  const decision = selectOddsPollingDecision({
    games: [game()],
    control: control({ automaticNotBefore: new Date(NOW + HOUR).toISOString() }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: false, reason: 'automatic-backoff' });
});

test('polling #31: a valid no-op completion suppresses an immediate repeat', () => {
  const decision = selectOddsPollingDecision({
    games: [game()],
    control: control({ lastCompletedCheckAt: new Date(NOW).toISOString() }),
    rawObservationMs: null,
    now: NOW,
  });
  assert.deepEqual(decision, { due: false, reason: 'refresh-not-due' });
  // The raw observation is also honored as a freshness signal.
  const viaRaw = selectOddsPollingDecision({
    games: [game()],
    control: control(),
    rawObservationMs: NOW - HOUR,
    now: NOW,
  });
  assert.deepEqual(viaRaw, { due: false, reason: 'refresh-not-due' });
});

// ---------------------------------------------------------------------------
// PLATFORM-089 — the staged early horizon.
//
// Production on 2026-08-09: the canonical 2026 refresh had committed 125 rows on
// Jul 29, then aged into `odds-cache-stale` while every hourly invocation
// answered `skipped / no-eligible-target · 0 eligible game(s)`. Useful data
// existed and the policy would not maintain it. These pin the boundaries of the
// fix EXACTLY, because "45 days" and "24 hours" are only meaningful if the edges
// are where they claim to be.
// ---------------------------------------------------------------------------

test('polling #32: 46 days out is no target, exactly 45 days is an early target', () => {
  const beyond = [
    game({ kickoff: new Date(NOW + ODDS_EARLY_KICKOFF_HORIZON_MS + 1).toISOString() }),
  ];
  assert.equal(collectEligibleOddsGames(beyond, NOW).length, 0);
  assert.deepEqual(
    selectOddsPollingDecision({
      games: beyond,
      control: control(),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: false, reason: 'no-eligible-target' }
  );

  // Exactly 45 days: eligible, and a cold target is due at the EARLY cadence.
  const atHorizon = [
    game({ kickoff: new Date(NOW + ODDS_EARLY_KICKOFF_HORIZON_MS).toISOString() }),
  ];
  assert.equal(collectEligibleOddsGames(atHorizon, NOW).length, 1);
  assert.deepEqual(
    selectOddsPollingDecision({
      games: atHorizon,
      control: control(),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: true, cadence: 'early' }
  );

  // The exported predicate agrees at both edges, and rejects a past kickoff.
  assert.equal(isWithinEarlyOddsPollingHorizon(NOW + ODDS_EARLY_KICKOFF_HORIZON_MS, NOW), true);
  assert.equal(
    isWithinEarlyOddsPollingHorizon(NOW + ODDS_EARLY_KICKOFF_HORIZON_MS + 1, NOW),
    false
  );
  assert.equal(isWithinEarlyOddsPollingHorizon(NOW - 1, NOW), false);
  assert.equal(isWithinEarlyOddsPollingHorizon(Number.NaN, NOW), false);
});

test('polling #33: between 7 and 45 days the cadence is 24 hours, at the exact boundary', () => {
  const games = [game({ kickoff: new Date(NOW + 20 * DAY).toISOString() })];

  // Cold → due, early.
  assert.deepEqual(
    selectOddsPollingDecision({ games, control: control(), rawObservationMs: null, now: NOW }),
    { due: true, cadence: 'early' }
  );

  // A check 23h59m old is NOT due — this is the quota guard for the widened
  // horizon: one billed request per day out here, not one per hourly delivery.
  assert.deepEqual(
    selectOddsPollingDecision({
      games,
      control: control({
        lastCompletedCheckAt: new Date(NOW - ODDS_EARLY_CADENCE_MS + 60_000).toISOString(),
      }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: false, reason: 'refresh-not-due' }
  );

  // Exactly 24h old → due.
  assert.deepEqual(
    selectOddsPollingDecision({
      games,
      control: control({
        lastCompletedCheckAt: new Date(NOW - ODDS_EARLY_CADENCE_MS).toISOString(),
      }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: true, cadence: 'early' }
  );

  // A 6h-old check would be baseline-due inside 7 days; out here it is NOT — the
  // stage, not just the label, has to change.
  assert.deepEqual(
    selectOddsPollingDecision({
      games,
      control: control({
        lastCompletedCheckAt: new Date(NOW - ODDS_BASELINE_CADENCE_MS).toISOString(),
      }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: false, reason: 'refresh-not-due' }
  );
});

test('polling #34: exactly 7 days out is the normal 6-hour cadence, not early', () => {
  const atNormal = [
    game({ kickoff: new Date(NOW + ODDS_EXPECTED_KICKOFF_HORIZON_MS).toISOString() }),
  ];
  // A 6h-old check at exactly the 7-day boundary is baseline-due.
  assert.deepEqual(
    selectOddsPollingDecision({
      games: atNormal,
      control: control({
        lastCompletedCheckAt: new Date(NOW - ODDS_BASELINE_CADENCE_MS).toISOString(),
      }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: true, cadence: 'baseline' }
  );
  // One millisecond further out is early, and that same 6h-old check is not due.
  const justBeyond = [
    game({ kickoff: new Date(NOW + ODDS_EXPECTED_KICKOFF_HORIZON_MS + 1).toISOString() }),
  ];
  assert.deepEqual(
    selectOddsPollingDecision({
      games: justBeyond,
      control: control({
        lastCompletedCheckAt: new Date(NOW - ODDS_BASELINE_CADENCE_MS).toISOString(),
      }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: false, reason: 'refresh-not-due' }
  );
});

test('polling #35: the NEAREST eligible kickoff sets the stage', () => {
  // A distant game must not slow the check down when a near one is moving.
  const mixed = [
    game({ key: 'distant', kickoff: new Date(NOW + 30 * DAY).toISOString() }),
    game({ key: 'near', kickoff: new Date(NOW + 2 * DAY).toISOString() }),
  ];
  assert.deepEqual(
    selectOddsPollingDecision({
      games: mixed,
      control: control({
        lastCompletedCheckAt: new Date(NOW - ODDS_BASELINE_CADENCE_MS).toISOString(),
      }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: true, cadence: 'baseline' }
  );
});

test('polling #36: durable backoff still overrides the early cadence', () => {
  assert.deepEqual(
    selectOddsPollingDecision({
      games: [game({ kickoff: new Date(NOW + 20 * DAY).toISOString() })],
      control: control({ automaticNotBefore: new Date(NOW + HOUR).toISOString() }),
      rawObservationMs: null,
      now: NOW,
    }),
    { due: false, reason: 'automatic-backoff' }
  );
});

test('polling #37: the freshest-signal helper takes the max and never invents one', () => {
  // The shared helper the Odds DIAGNOSTIC reuses, so health and the cron cannot
  // disagree about when the provider was last successfully asked.
  assert.equal(freshestOddsSignalMs(null, null), null);
  assert.equal(freshestOddsSignalMs(control(), null), null);
  assert.equal(freshestOddsSignalMs(null, NOW - HOUR), NOW - HOUR);

  // A no-op completion is NEWER than the raw snapshot → it wins.
  assert.equal(
    freshestOddsSignalMs(control({ lastCompletedCheckAt: new Date(NOW).toISOString() }), NOW - DAY),
    NOW
  );
  // ...and an older completion never drags a fresh snapshot backwards.
  assert.equal(
    freshestOddsSignalMs(control({ lastCompletedCheckAt: new Date(NOW - DAY).toISOString() }), NOW),
    NOW
  );
  // An unparseable timestamp is ignored, not treated as now.
  assert.equal(freshestOddsSignalMs(control({ lastCompletedCheckAt: 'not-a-date' }), null), null);
});
