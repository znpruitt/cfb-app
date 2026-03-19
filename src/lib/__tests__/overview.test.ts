import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveOverviewSnapshot } from '../overview.ts';
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
