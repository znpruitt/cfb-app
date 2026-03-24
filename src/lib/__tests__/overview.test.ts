import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveAutonomousOverviewScope, deriveOverviewSnapshot } from '../overview.ts';
import type { AppGame } from '../schedule.ts';
import type { OwnerStandingsRow, StandingsCoverage } from '../standings.ts';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

const standingsRows: OwnerStandingsRow[] = [
  {
    owner: 'Alice',
    wins: 7,
    losses: 1,
    winPct: 0.875,
    pointsFor: 240,
    pointsAgainst: 180,
    pointDifferential: 60,
    gamesBack: 0,
    finalGames: 8,
  },
  {
    owner: 'Bob',
    wins: 6,
    losses: 2,
    winPct: 0.75,
    pointsFor: 220,
    pointsAgainst: 190,
    pointDifferential: 30,
    gamesBack: 1,
    finalGames: 8,
  },
  {
    owner: 'Cory',
    wins: 5,
    losses: 3,
    winPct: 0.625,
    pointsFor: 210,
    pointsAgainst: 205,
    pointDifferential: 5,
    gamesBack: 2,
    finalGames: 8,
  },
];

const coverage: StandingsCoverage = { state: 'complete', message: null };

test('overview prioritizes owner-vs-owner live games before other owned live games', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
    ['Notre Dame', 'Cory'],
  ]);
  const ownerVsOwner = game({
    key: 'ou-tex',
    csvAway: 'Texas',
    csvHome: 'Oklahoma',
    date: '2026-09-01T19:00:00.000Z',
  });
  const secondary = game({
    key: 'nd-usc',
    csvAway: 'Notre Dame',
    csvHome: 'USC',
    date: '2026-09-01T18:00:00.000Z',
  });

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: [ownerVsOwner, secondary],
    allGames: [ownerVsOwner, secondary],
    rosterByTeam,
    scoresByKey: {
      'ou-tex': {
        status: 'In Progress',
        away: { team: 'Texas', score: 24 },
        home: { team: 'Oklahoma', score: 21 },
        time: null,
      },
      'nd-usc': {
        status: 'In Progress',
        away: { team: 'Notre Dame', score: 17 },
        home: { team: 'USC', score: 10 },
        time: null,
      },
    },
  });

  assert.deepEqual(
    snapshot.liveItems.map((item) => item.bucket.game.key),
    ['ou-tex', 'nd-usc']
  );
  assert.deepEqual(
    snapshot.standingsLeaders.map((row) => row.owner),
    ['Alice', 'Bob', 'Cory']
  );
});

test('overview key matchups keep owned-vs-owned games ahead of other owned-team games for the selected week', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
    ['Notre Dame', 'Cory'],
  ]);
  const ownerVsOwner = game({
    key: 'ou-tex',
    csvAway: 'Texas',
    csvHome: 'Oklahoma',
    date: '2026-09-05T20:00:00.000Z',
  });
  const secondary = game({
    key: 'nd-usc',
    csvAway: 'Notre Dame',
    csvHome: 'USC',
    date: '2026-09-05T18:00:00.000Z',
  });
  const finalGame = game({
    key: 'final-owned',
    csvAway: 'Texas',
    csvHome: 'Rice',
    date: '2026-09-05T16:00:00.000Z',
  });

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: [secondary, finalGame, ownerVsOwner],
    allGames: [secondary, finalGame, ownerVsOwner],
    rosterByTeam,
    scoresByKey: {
      'final-owned': {
        status: 'Final',
        away: { team: 'Texas', score: 31 },
        home: { team: 'Rice', score: 14 },
        time: null,
      },
    },
  });

  assert.deepEqual(
    snapshot.keyMatchups.map((item) => item.bucket.game.key),
    ['ou-tex', 'nd-usc']
  );
});

test('overview shifts to recent-results emphasis when the active slate is complete', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
  ]);
  const finalOwnerVsOwner = game({
    key: 'ou-tex-final',
    csvAway: 'Texas',
    csvHome: 'Oklahoma',
    date: '2026-09-05T20:00:00.000Z',
  });

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: [finalOwnerVsOwner],
    allGames: [finalOwnerVsOwner],
    rosterByTeam,
    scoresByKey: {
      'ou-tex-final': {
        status: 'Final',
        away: { team: 'Texas', score: 31 },
        home: { team: 'Oklahoma', score: 28 },
        time: null,
      },
    },
    selectedWeekLabel: 'Week 2',
  });

  assert.equal(snapshot.context.emphasis, 'recent');
  assert.equal(snapshot.context.highlightsTitle, 'Recent league results');
  assert.deepEqual(snapshot.context.sectionOrder, ['highlights', 'standings', 'matrix', 'live']);
  assert.deepEqual(
    snapshot.keyMatchups.map((item) => item.bucket.game.key),
    ['ou-tex-final']
  );
});

test('overview uses postseason context when the active slate is postseason-driven', () => {
  const rosterByTeam = new Map([['Texas', 'Alice']]);
  const semifinal = game({
    key: 'semifinal',
    csvAway: 'Texas',
    csvHome: 'Michigan',
    date: '2026-12-31T21:00:00.000Z',
    stage: 'playoff',
    postseasonRole: 'playoff',
  });

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: [semifinal],
    allGames: [semifinal],
    rosterByTeam,
    scoresByKey: {},
    selectedWeekLabel: 'the postseason',
  });

  assert.equal(snapshot.context.scopeLabel, 'Postseason');
  assert.equal(snapshot.context.emphasis, 'upcoming');
  assert.deepEqual(snapshot.context.sectionOrder, ['highlights', 'standings', 'matrix', 'live']);
});

test('overview preserves completed selected-week results even when unrelated owned games are live elsewhere', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
    ['Notre Dame', 'Cory'],
  ]);
  const completedWeekGame = game({
    key: 'completed-week',
    csvAway: 'Texas',
    csvHome: 'Oklahoma',
    date: '2026-09-05T20:00:00.000Z',
  });
  const unrelatedLiveGame = game({
    key: 'unrelated-live',
    csvAway: 'Notre Dame',
    csvHome: 'USC',
    week: 9,
    date: '2026-11-01T20:00:00.000Z',
  });

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: [completedWeekGame],
    allGames: [completedWeekGame, unrelatedLiveGame],
    rosterByTeam,
    scoresByKey: {
      'completed-week': {
        status: 'Final',
        away: { team: 'Texas', score: 31 },
        home: { team: 'Oklahoma', score: 24 },
        time: null,
      },
      'unrelated-live': {
        status: 'In Progress',
        away: { team: 'Notre Dame', score: 17 },
        home: { team: 'USC', score: 10 },
        time: null,
      },
    },
    selectedWeekLabel: 'Week 2',
  });

  assert.equal(snapshot.context.emphasis, 'recent');
  assert.deepEqual(
    snapshot.keyMatchups.map((item) => item.bucket.game.key),
    ['completed-week']
  );
  assert.deepEqual(
    snapshot.liveItems.map((item) => item.bucket.game.key),
    ['unrelated-live']
  );
});

test('overview context stays upcoming when later active-slate games are truncated out of highlights', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
    ['Notre Dame', 'Cory'],
    ['LSU', 'Alice'],
    ['Georgia', 'Bob'],
  ]);
  const earlyFinals = [
    game({ key: 'final-1', csvAway: 'Texas', csvHome: 'Rice', date: '2026-09-05T16:00:00.000Z' }),
    game({
      key: 'final-2',
      csvAway: 'Oklahoma',
      csvHome: 'Tulsa',
      date: '2026-09-05T16:15:00.000Z',
    }),
    game({
      key: 'final-3',
      csvAway: 'Notre Dame',
      csvHome: 'Navy',
      date: '2026-09-05T16:30:00.000Z',
    }),
    game({ key: 'final-4', csvAway: 'LSU', csvHome: 'ULM', date: '2026-09-05T16:45:00.000Z' }),
  ];
  const lateUpcoming = game({
    key: 'upcoming-5',
    csvAway: 'Georgia',
    csvHome: 'Florida',
    date: '2026-09-05T22:00:00.000Z',
  });

  const scoresByKey = {
    'final-1': {
      status: 'Final',
      away: { team: 'Texas', score: 31 },
      home: { team: 'Rice', score: 14 },
      time: null,
    },
    'final-2': {
      status: 'Final',
      away: { team: 'Oklahoma', score: 27 },
      home: { team: 'Tulsa', score: 17 },
      time: null,
    },
    'final-3': {
      status: 'Final',
      away: { team: 'Notre Dame', score: 24 },
      home: { team: 'Navy', score: 20 },
      time: null,
    },
    'final-4': {
      status: 'Final',
      away: { team: 'LSU', score: 35 },
      home: { team: 'ULM', score: 7 },
      time: null,
    },
  };

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: [...earlyFinals, lateUpcoming],
    allGames: [...earlyFinals, lateUpcoming],
    rosterByTeam,
    scoresByKey,
    selectedWeekLabel: 'Week 5',
  });

  assert.equal(snapshot.context.emphasis, 'upcoming');
  assert.equal(snapshot.context.highlightsTitle, 'What matters next');
  assert.deepEqual(
    snapshot.keyMatchups.map((item) => item.bucket.game.key),
    ['upcoming-5']
  );
});

test('autonomous overview scope falls back to the default current week when scores are missing', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
  ]);
  const weekOneGame = game({
    key: 'week-1-game',
    week: 1,
    csvAway: 'Texas',
    csvHome: 'Rice',
    date: '2026-09-01T17:00:00.000Z',
  });
  const weekEightGame = game({
    key: 'week-8-game',
    week: 8,
    csvAway: 'Oklahoma',
    csvHome: 'Kansas',
    date: '2026-10-20T17:00:00.000Z',
  });

  const scope = deriveAutonomousOverviewScope({
    games: [weekOneGame, weekEightGame],
    rosterByTeam,
    scoresByKey: {},
    nowMs: Date.parse('2026-10-20T18:00:00.000Z'),
  });

  assert.equal(scope.label, 'Week 8');
  assert.deepEqual(
    scope.games.map((game) => game.key),
    ['week-8-game']
  );
});

test('autonomous overview scope does not let unknown stale slates outrank trusted current-week signals', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
  ]);
  const staleWeek = game({
    key: 'stale-week',
    week: 1,
    csvAway: 'Texas',
    csvHome: 'Rice',
    date: '2026-09-01T17:00:00.000Z',
  });
  const currentWeek = game({
    key: 'current-week',
    week: 8,
    csvAway: 'Oklahoma',
    csvHome: 'Kansas',
    date: '2026-10-20T19:00:00.000Z',
  });

  const scope = deriveAutonomousOverviewScope({
    games: [staleWeek, currentWeek],
    rosterByTeam,
    scoresByKey: {
      'current-week': {
        status: 'Scheduled',
        away: { team: 'Oklahoma', score: null },
        home: { team: 'Kansas', score: null },
        time: null,
      },
    },
    nowMs: Date.parse('2026-10-20T18:00:00.000Z'),
  });

  assert.equal(scope.label, 'Week 8');
  assert.deepEqual(
    scope.games.map((game) => game.key),
    ['current-week']
  );
});

test('recent-results mode shows the latest completed finals first before truncation', () => {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Oklahoma', 'Bob'],
    ['Notre Dame', 'Cory'],
    ['LSU', 'Alice'],
    ['Georgia', 'Bob'],
  ]);
  const completedGames = [
    game({ key: 'final-1', csvAway: 'Texas', csvHome: 'Rice', date: '2026-09-05T16:00:00.000Z' }),
    game({
      key: 'final-2',
      csvAway: 'Oklahoma',
      csvHome: 'Tulsa',
      date: '2026-09-05T17:00:00.000Z',
    }),
    game({
      key: 'final-3',
      csvAway: 'Notre Dame',
      csvHome: 'Navy',
      date: '2026-09-05T18:00:00.000Z',
    }),
    game({ key: 'final-4', csvAway: 'LSU', csvHome: 'ULM', date: '2026-09-05T19:00:00.000Z' }),
    game({
      key: 'final-5',
      csvAway: 'Georgia',
      csvHome: 'Florida',
      date: '2026-09-05T20:00:00.000Z',
    }),
  ];

  const snapshot = deriveOverviewSnapshot({
    standingsRows,
    standingsCoverage: coverage,
    weekGames: completedGames,
    allGames: completedGames,
    rosterByTeam,
    scoresByKey: {
      'final-1': {
        status: 'Final',
        away: { team: 'Texas', score: 31 },
        home: { team: 'Rice', score: 14 },
        time: null,
      },
      'final-2': {
        status: 'Final',
        away: { team: 'Oklahoma', score: 27 },
        home: { team: 'Tulsa', score: 17 },
        time: null,
      },
      'final-3': {
        status: 'Final',
        away: { team: 'Notre Dame', score: 24 },
        home: { team: 'Navy', score: 20 },
        time: null,
      },
      'final-4': {
        status: 'Final',
        away: { team: 'LSU', score: 35 },
        home: { team: 'ULM', score: 7 },
        time: null,
      },
      'final-5': {
        status: 'Final',
        away: { team: 'Georgia', score: 28 },
        home: { team: 'Florida', score: 24 },
        time: null,
      },
    },
    selectedWeekLabel: 'Week 5',
  });

  assert.equal(snapshot.context.emphasis, 'recent');
  assert.deepEqual(
    snapshot.keyMatchups.map((item) => item.bucket.game.key),
    ['final-5', 'final-4', 'final-3', 'final-2']
  );
});
