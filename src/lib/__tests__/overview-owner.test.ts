import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveOwnerMatchupMatrix } from '../overview';
import { deriveOwnerRoster, deriveOwnerViewSnapshot } from '../ownerView';
import type { ScorePack } from '../scores';
import type { AppGame } from '../schedule';
import type { OwnerStandingsRow } from '../standings';

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
        teamId: 'home',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'away',
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
    wins: 4,
    losses: 1,
    winPct: 0.8,
    pointsFor: 150,
    pointsAgainst: 120,
    pointDifferential: 30,
    gamesBack: 0,
    finalGames: 5,
  },
  {
    owner: 'Bob',
    wins: 3,
    losses: 2,
    winPct: 0.6,
    pointsFor: 135,
    pointsAgainst: 128,
    pointDifferential: 7,
    gamesBack: 1,
    finalGames: 5,
  },
  {
    owner: 'Cara',
    wins: 2,
    losses: 3,
    winPct: 0.4,
    pointsFor: 118,
    pointsAgainst: 130,
    pointDifferential: -12,
    gamesBack: 2,
    finalGames: 5,
  },
];

const rosterByTeam = new Map([
  ['Texas', 'Alice'],
  ['Michigan', 'Alice'],
  ['Georgia', 'Bob'],
  ['Oregon', 'Cara'],
]);

test('deriveOwnerMatchupMatrix counts weekly owner matchups and final records', () => {
  const weekGames = [
    game({ key: 'g1', csvAway: 'Texas', csvHome: 'Georgia', status: 'final' }),
    game({ key: 'g2', csvAway: 'Michigan', csvHome: 'Georgia', status: 'final' }),
    game({ key: 'g3', csvAway: 'Oregon', csvHome: 'USC', status: 'scheduled' }),
  ];
  const scoresByKey: Record<string, ScorePack> = {
    g1: {
      home: { team: 'Georgia', score: 21 },
      away: { team: 'Texas', score: 28 },
      status: 'Final',
      time: null,
    },
    g2: {
      home: { team: 'Georgia', score: 24 },
      away: { team: 'Michigan', score: 17 },
      status: 'Final',
      time: null,
    },
  };

  const matrix = deriveOwnerMatchupMatrix({ weekGames, standingsRows, rosterByTeam, scoresByKey });

  assert.deepEqual(matrix.owners, ['Alice', 'Bob', 'Cara']);
  assert.equal(matrix.rows[0]?.cells[1]?.gameCount, 2);
  assert.equal(matrix.rows[0]?.cells[1]?.record, '1–1');
  assert.equal(matrix.rows[1]?.cells[0]?.gameCount, 2);
  assert.equal(matrix.rows[1]?.cells[0]?.record, '1–1');
  assert.equal(matrix.rows[2]?.cells[0]?.gameCount, 0);
});

test('deriveOwnerRoster calculates team records and matchup labels per owned team', () => {
  const games = [
    game({ key: 't-final-win', csvAway: 'Texas', csvHome: 'Georgia', status: 'final' }),
    game({ key: 't-final-loss', csvAway: 'Alabama', csvHome: 'Texas', status: 'final' }),
    game({
      key: 't-upcoming',
      csvAway: 'Texas',
      csvHome: 'LSU',
      status: 'scheduled',
      date: '2026-09-05T17:00:00.000Z',
    }),
    game({
      key: 'm-upcoming',
      csvAway: 'USC',
      csvHome: 'Michigan',
      status: 'scheduled',
      date: '2026-09-04T17:00:00.000Z',
    }),
  ];
  const scoresByKey: Record<string, ScorePack> = {
    't-final-win': {
      home: { team: 'Georgia', score: 21 },
      away: { team: 'Texas', score: 28 },
      status: 'Final',
      time: null,
    },
    't-final-loss': {
      home: { team: 'Texas', score: 14 },
      away: { team: 'Alabama', score: 24 },
      status: 'Final',
      time: null,
    },
  };

  const roster = deriveOwnerRoster('Alice', games, rosterByTeam, scoresByKey);

  assert.deepEqual(roster, [
    {
      teamName: 'Michigan',
      record: '0–0',
      nextOpponent: 'USC',
      nextGameLabel: 'vs USC',
      ownerTeamSide: 'home',
      isNeutralSite: false,
      nextKickoff: '2026-09-04T17:00:00.000Z',
      currentStatus: 'Upcoming',
      currentScore: null,
      liveGameKey: null,
    },
    {
      teamName: 'Texas',
      record: '1–1',
      nextOpponent: 'LSU',
      nextGameLabel: 'at LSU',
      ownerTeamSide: 'away',
      isNeutralSite: false,
      nextKickoff: '2026-09-05T17:00:00.000Z',
      currentStatus: 'Upcoming',
      currentScore: null,
      liveGameKey: null,
    },
  ]);
});

test('deriveOwnerRoster uses neutral-site phrasing for neutral games', () => {
  const games = [
    game({
      key: 'neutral-game',
      csvAway: 'Texas',
      csvHome: 'Michigan',
      neutral: true,
      neutralDisplay: 'vs',
      status: 'scheduled',
    }),
  ];

  const roster = deriveOwnerRoster('Alice', games, rosterByTeam, {});
  const texas = roster.find((row) => row.teamName === 'Texas');

  assert.equal(texas?.nextGameLabel, 'vs Michigan');
  assert.equal(texas?.isNeutralSite, true);
});

test('deriveOwnerRoster prefers live game context over the next scheduled game', () => {
  const games = [
    game({
      key: 'live-game',
      csvAway: 'Texas',
      csvHome: 'Georgia',
      status: 'in_progress',
      date: '2026-09-01T17:00:00.000Z',
    }),
    game({
      key: 'future-game',
      csvAway: 'Texas',
      csvHome: 'LSU',
      status: 'scheduled',
      date: '2026-09-10T17:00:00.000Z',
    }),
  ];
  const scoresByKey: Record<string, ScorePack> = {
    'live-game': {
      home: { team: 'Georgia', score: 17 },
      away: { team: 'Texas', score: 20 },
      status: 'In Progress',
      time: null,
    },
  };

  const roster = deriveOwnerRoster('Alice', games, rosterByTeam, scoresByKey);
  const texas = roster.find((row) => row.teamName === 'Texas');

  assert.deepEqual(texas, {
    teamName: 'Texas',
    record: '0–0',
    nextOpponent: 'Georgia',
    nextGameLabel: 'at Georgia',
    ownerTeamSide: 'away',
    isNeutralSite: false,
    nextKickoff: '2026-09-01T17:00:00.000Z',
    currentStatus: 'Live',
    currentScore: 'Texas 20 - 17 Georgia',
    liveGameKey: 'live-game',
  });
});

test('deriveOwnerViewSnapshot builds owner-centric roster, live, and week sections', () => {
  const allGames = [
    game({ key: 'live-game', csvAway: 'Texas', csvHome: 'Georgia', status: 'in_progress' }),
    game({ key: 'sched-game', csvAway: 'USC', csvHome: 'Michigan', status: 'scheduled' }),
    game({ key: 'other-owner', csvAway: 'Oregon', csvHome: 'Washington', status: 'scheduled' }),
  ];
  const weekGames = allGames.slice(0, 2);
  const scoresByKey: Record<string, ScorePack> = {
    'live-game': {
      home: { team: 'Georgia', score: 17 },
      away: { team: 'Texas', score: 20 },
      status: 'In Progress',
      time: null,
    },
  };

  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows,
    allGames,
    weekGames,
    rosterByTeam,
    scoresByKey,
  });

  assert.equal(snapshot.selectedOwner, 'Alice');
  assert.equal(snapshot.header?.rank, 1);
  assert.equal(snapshot.header?.record, '4–1');
  assert.equal(snapshot.rosterRows.length, 2);
  assert.equal(snapshot.liveRows.length, 1);
  assert.equal(snapshot.weekRows.length, 2);
  assert.equal(snapshot.weekSummary?.totalGames, 2);
  assert.match(snapshot.weekSummary?.performanceSummary ?? '', /live/i);
  assert.equal(snapshot.rosterRows[0]?.teamName, 'Michigan');
  assert.equal(snapshot.rosterRows[0]?.nextGameLabel, 'vs USC');
  assert.equal(snapshot.rosterRows[1]?.teamName, 'Texas');
  assert.equal(snapshot.rosterRows[1]?.nextGameLabel, 'at Georgia');
});

test('deriveOwnerViewSnapshot keeps week rows aligned with summary semantics when final score attachment is missing', () => {
  const allGames = [
    game({ key: 'missing-final', csvAway: 'Texas', csvHome: 'Georgia', status: 'final' }),
  ];

  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows,
    allGames,
    weekGames: allGames,
    rosterByTeam,
    scoresByKey: {},
  });

  assert.equal(snapshot.weekSummary?.performanceSummary, 'Scheduled');
  assert.equal(snapshot.weekSummary?.finalGames, 0);
  assert.equal(snapshot.weekRows[0]?.currentStatus, 'Upcoming');
  assert.equal(snapshot.weekRows[0]?.currentScore, null);
  assert.equal(snapshot.weekRows[0]?.nextGameLabel, 'at Georgia');
});

test('deriveOwnerRoster keeps multi-team owners to one row per team and marks season complete', () => {
  const allGames = [
    game({ key: 'mirror-game', csvAway: 'Texas', csvHome: 'Michigan', status: 'final' }),
  ];
  const scoresByKey: Record<string, ScorePack> = {
    'mirror-game': {
      home: { team: 'Michigan', score: 10 },
      away: { team: 'Texas', score: 14 },
      status: 'Final',
      time: null,
    },
  };

  const roster = deriveOwnerRoster('Alice', allGames, rosterByTeam, scoresByKey);

  assert.deepEqual(roster, [
    {
      teamName: 'Michigan',
      record: '0–1',
      nextOpponent: null,
      nextGameLabel: null,
      ownerTeamSide: 'home',
      isNeutralSite: false,
      nextKickoff: null,
      currentStatus: 'Final',
      currentScore: null,
      liveGameKey: null,
    },
    {
      teamName: 'Texas',
      record: '1–0',
      nextOpponent: null,
      nextGameLabel: null,
      ownerTeamSide: 'home',
      isNeutralSite: false,
      nextKickoff: null,
      currentStatus: 'Final',
      currentScore: null,
      liveGameKey: null,
    },
  ]);
});
