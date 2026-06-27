import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPregameOddsSnapshot,
  buildOddsByGame,
  emptyDurableOddsRecord,
  freezeClosingSnapshotIfNeeded,
  reopenClosingSnapshotForDelayedKickoffIfNeeded,
  selectOddsForGame,
  type DurableOddsSnapshot,
} from '../odds.ts';
import type { AppGame } from '../schedule.ts';

function buildSnapshot(capturedAt: string, spread: number, total = 52.5): DurableOddsSnapshot {
  return {
    capturedAt,
    bookmakerKey: 'draftkings',
    favorite: 'Georgia',
    source: 'DraftKings',
    spread,
    homeSpread: spread,
    awaySpread: spread === 0 ? 0 : -spread,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    moneylineHome: -150,
    moneylineAway: 130,
    total,
    overPrice: -108,
    underPrice: -112,
  };
}

function buildGame(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: '1-georgia-clemson-H',
    eventId: 'evt-1',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: '2026-09-01T19:30:00.000Z',
    stage: 'regular',
    status: 'scheduled',
    stageOrder: 1,
    slotOrder: 1,
    eventKey: 'evt-1',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: '101',
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      home: {
        kind: 'team',
        teamId: 'georgia',
        displayName: 'Georgia',
        canonicalName: 'Georgia',
        rawName: 'Georgia',
      },
      away: {
        kind: 'team',
        teamId: 'clemson',
        displayName: 'Clemson',
        canonicalName: 'Clemson',
        rawName: 'Clemson',
      },
    },
    csvAway: 'Clemson',
    csvHome: 'Georgia',
    canAway: 'Clemson',
    canHome: 'Georgia',
    awayConf: 'ACC',
    homeConf: 'SEC',
    ...overrides,
  };
}

test('pre-kickoff refresh updates latestSnapshot', () => {
  const record = emptyDurableOddsRecord('1-georgia-clemson-H');

  const updated = applyPregameOddsSnapshot({
    record,
    snapshot: buildSnapshot('2026-09-01T18:00:00.000Z', -3.5),
    kickoff: '2026-09-01T19:30:00.000Z',
    now: '2026-09-01T18:00:00.000Z',
  });

  assert.equal(updated.latestSnapshot?.spread, -3.5);
  assert.equal(updated.closingSnapshot, null);
});

test('first refresh at or after kickoff freezes closingSnapshot from latestSnapshot', () => {
  const record = {
    ...emptyDurableOddsRecord('1-georgia-clemson-H'),
    latestSnapshot: buildSnapshot('2026-09-01T19:00:00.000Z', -4.0),
  };

  const frozen = freezeClosingSnapshotIfNeeded({
    record,
    kickoff: '2026-09-01T19:30:00.000Z',
    now: '2026-09-01T19:31:00.000Z',
  });

  assert.equal(frozen.closingSnapshot?.spread, -4.0);
  assert.equal(frozen.closingFrozenAt, '2026-09-01T19:31:00.000Z');
});

test('later refreshes do not overwrite closingSnapshot', () => {
  const record = {
    ...emptyDurableOddsRecord('1-georgia-clemson-H'),
    latestSnapshot: buildSnapshot('2026-09-01T19:10:00.000Z', -4.0),
    closingSnapshot: buildSnapshot('2026-09-01T19:10:00.000Z', -4.0),
    closingFrozenAt: '2026-09-01T19:31:00.000Z',
  };

  const next = applyPregameOddsSnapshot({
    record,
    snapshot: buildSnapshot('2026-09-01T19:40:00.000Z', -7.5),
    kickoff: '2026-09-01T19:30:00.000Z',
    now: '2026-09-01T19:40:00.000Z',
  });

  assert.equal(next.closingSnapshot?.spread, -4.0);
  assert.equal(next.closingFrozenAt, '2026-09-01T19:31:00.000Z');
});

test('completed games prefer closingSnapshot in selection logic', () => {
  const selected = selectOddsForGame({
    game: buildGame({ status: 'final' }),
    record: {
      ...emptyDurableOddsRecord('1-georgia-clemson-H'),
      latestSnapshot: buildSnapshot('2026-09-01T19:00:00.000Z', -4.0),
      closingSnapshot: buildSnapshot('2026-09-01T19:10:00.000Z', -3.0),
      closingFrozenAt: '2026-09-01T19:31:00.000Z',
    },
    now: '2026-09-01T23:00:00.000Z',
  });

  assert.equal(selected?.spread, -3.0);
  assert.equal(selected?.lineSourceStatus, 'closing');
});

test('completed games fall back to latestSnapshot when closingSnapshot is missing', () => {
  const selected = selectOddsForGame({
    game: buildGame({ status: 'final' }),
    record: {
      ...emptyDurableOddsRecord('1-georgia-clemson-H'),
      latestSnapshot: buildSnapshot('2026-09-01T19:00:00.000Z', -4.5),
      closingSnapshot: null,
      closingFrozenAt: null,
    },
    now: '2026-09-01T23:00:00.000Z',
  });

  assert.equal(selected?.spread, -4.5);
  assert.equal(selected?.lineSourceStatus, 'fallback-latest-for-completed');
});

test('upcoming games use latestSnapshot with latest status', () => {
  const selected = selectOddsForGame({
    game: buildGame({ status: 'scheduled', date: '2026-09-01T20:30:00.000Z' }),
    record: {
      ...emptyDurableOddsRecord('1-georgia-clemson-H'),
      latestSnapshot: buildSnapshot('2026-09-01T18:00:00.000Z', -2.5),
      closingSnapshot: null,
      closingFrozenAt: null,
    },
    now: '2026-09-01T18:30:00.000Z',
  });

  assert.equal(selected?.spread, -2.5);
  assert.equal(selected?.lineSourceStatus, 'latest');
});

test('delayed kickoff reopens an early frozen closing snapshot before the new kickoff', () => {
  const reopened = reopenClosingSnapshotForDelayedKickoffIfNeeded({
    record: {
      ...emptyDurableOddsRecord('1-georgia-clemson-H'),
      latestSnapshot: buildSnapshot('2026-09-01T19:00:00.000Z', -4.0),
      closingSnapshot: buildSnapshot('2026-09-01T19:00:00.000Z', -4.0),
      closingFrozenAt: '2026-09-01T19:31:00.000Z',
    },
    kickoff: '2026-09-01T21:00:00.000Z',
    now: '2026-09-01T20:00:00.000Z',
  });

  assert.equal(reopened.closingSnapshot, null);
  assert.equal(reopened.closingFrozenAt, null);
  assert.equal(reopened.latestSnapshot?.spread, -4.0);
});

// ---------------------------------------------------------------------------
// PLATFORM-031 — the legacy `buildOddsByGame` compatibility path must route
// through the same event-centric, date-aware attachment helper: a dated event
// attaches only to the date-aligned same-pair game, and both the snake_case
// (`commence_time`) and camelCase (`commenceTime`) spellings are honored.
// ---------------------------------------------------------------------------

function samePairGames() {
  return [
    {
      key: 'reg',
      week: 1,
      canHome: 'Georgia',
      canAway: 'Clemson',
      csvHome: 'Georgia',
      csvAway: 'Clemson',
      date: '2026-09-06T20:00:00.000Z',
    },
    {
      key: 'rematch',
      week: 14,
      canHome: 'Georgia',
      canAway: 'Clemson',
      csvHome: 'Georgia',
      csvAway: 'Clemson',
      date: '2026-12-06T20:00:00.000Z',
    },
  ];
}

const SPREAD_BOOK = [
  {
    key: 'draftkings',
    title: 'DraftKings',
    markets: [
      {
        key: 'spreads',
        outcomes: [
          { name: 'Georgia', point: -9.5, price: -110 },
          { name: 'Clemson', point: 9.5, price: -110 },
        ],
      },
    ],
  },
];

test('buildOddsByGame uses date-aware attachment (snake_case commence_time) — no same-pair fan-out', () => {
  const result = buildOddsByGame({
    games: samePairGames(),
    oddsEvents: [
      {
        home_team: 'Georgia',
        away_team: 'Clemson',
        commence_time: '2026-12-06T20:00:00.000Z',
        bookmakers: SPREAD_BOOK,
      },
    ],
    aliasMap: {},
    teams: [],
  });

  assert.deepEqual(Object.keys(result), ['rematch']);
  assert.equal(result.rematch?.spread, -9.5);
});

test('buildOddsByGame honors the camelCase commenceTime spelling for date-aware attachment', () => {
  const result = buildOddsByGame({
    games: samePairGames(),
    oddsEvents: [
      {
        home_team: 'Georgia',
        away_team: 'Clemson',
        commenceTime: '2026-12-06T20:00:00.000Z',
        bookmakers: SPREAD_BOOK,
      },
    ],
    aliasMap: {},
    teams: [],
  });

  assert.deepEqual(Object.keys(result), ['rematch']);
  assert.equal(result.rematch?.spread, -9.5);
});
