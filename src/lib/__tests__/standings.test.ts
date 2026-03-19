import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../schedule.ts';
import { deriveFinalOwnedParticipations, deriveStandings } from '../standings.ts';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2025-08-30T20:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
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
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

test('derive standings includes owned-owned, NoClaim, FCS, and postseason finals while excluding non-final and unowned games', () => {
  const games = [
    game({ key: 'owned-owned', csvAway: 'Alabama', csvHome: 'Georgia' }),
    game({ key: 'noclaim', csvAway: 'Florida State', csvHome: 'Tulane', homeConf: 'AAC' }),
    game({ key: 'fcs', csvAway: 'Kansas State', csvHome: 'South Dakota', homeConf: 'FCS' }),
    game({
      key: 'postseason',
      csvAway: 'Michigan',
      csvHome: 'Washington',
      stage: 'bowl',
      postseasonRole: 'bowl',
      label: 'Rose Bowl',
      week: 18,
    }),
    game({ key: 'scheduled', csvAway: 'Texas', csvHome: 'Baylor' }),
    game({ key: 'unowned', csvAway: 'USC', csvHome: 'UCLA' }),
  ];
  const rosterByTeam = new Map([
    ['Alabama', 'Avery'],
    ['Georgia', 'Blair'],
    ['Florida State', 'Avery'],
    ['Kansas State', 'Avery'],
    ['Michigan', 'Casey'],
  ]);
  const scoresByKey = {
    'owned-owned': {
      status: 'final',
      time: 'Final',
      away: { team: 'Alabama', score: 24 },
      home: { team: 'Georgia', score: 17 },
    },
    noclaim: {
      status: 'final',
      time: 'Final',
      away: { team: 'Florida State', score: 20 },
      home: { team: 'Tulane', score: 31 },
    },
    fcs: {
      status: 'final',
      time: 'Final',
      away: { team: 'Kansas State', score: 35 },
      home: { team: 'South Dakota', score: 10 },
    },
    postseason: {
      status: 'final',
      time: 'Final',
      away: { team: 'Michigan', score: 27 },
      home: { team: 'Washington', score: 20 },
    },
    scheduled: {
      status: 'scheduled',
      time: 'Sat 7:00 PM',
      away: { team: 'Texas', score: 0 },
      home: { team: 'Baylor', score: 0 },
    },
    unowned: {
      status: 'final',
      time: 'Final',
      away: { team: 'USC', score: 30 },
      home: { team: 'UCLA', score: 27 },
    },
  };

  const standings = deriveStandings(games, rosterByTeam, scoresByKey);

  assert.deepEqual(
    standings.rows.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      gamesBack: row.gamesBack,
    })),
    [
      { owner: 'Casey', wins: 1, losses: 0, pointsFor: 27, pointsAgainst: 20, gamesBack: 1 },
      { owner: 'Avery', wins: 2, losses: 1, pointsFor: 79, pointsAgainst: 58, gamesBack: 0 },
      { owner: 'Blair', wins: 0, losses: 1, pointsFor: 17, pointsAgainst: 24, gamesBack: 2 },
    ]
  );
  assert.equal(standings.participations.length, 5);
});

test('self-matchups count as one win and one loss with net-zero differential from both participations', () => {
  const games = [game({ key: 'self', csvAway: 'Texas', csvHome: 'Oklahoma' })];
  const rosterByTeam = new Map([
    ['Texas', 'Alex'],
    ['Oklahoma', 'Alex'],
  ]);
  const scoresByKey = {
    self: {
      status: 'final',
      time: 'Final',
      away: { team: 'Texas', score: 28 },
      home: { team: 'Oklahoma', score: 21 },
    },
  };

  const participations = deriveFinalOwnedParticipations(games, rosterByTeam, scoresByKey);
  const standings = deriveStandings(games, rosterByTeam, scoresByKey);

  assert.equal(participations.length, 2);
  assert.deepEqual(
    participations.map((entry) => ({
      side: entry.teamSide,
      pf: entry.pointsFor,
      pa: entry.pointsAgainst,
      result: entry.result,
    })),
    [
      { side: 'away', pf: 28, pa: 21, result: 'win' },
      { side: 'home', pf: 21, pa: 28, result: 'loss' },
    ]
  );
  assert.deepEqual(standings.rows[0], {
    owner: 'Alex',
    wins: 1,
    losses: 1,
    winPct: 0.5,
    pointsFor: 49,
    pointsAgainst: 49,
    pointDifferential: 0,
    gamesBack: 0,
    finalGames: 2,
  });
});

test('standings sort by win percentage, then wins, then point differential', () => {
  const games = [
    game({ key: 'a-win1', csvAway: 'A1', csvHome: 'U1' }),
    game({ key: 'a-win2', csvAway: 'A2', csvHome: 'U2' }),
    game({ key: 'a-loss', csvAway: 'U3', csvHome: 'A3' }),
    game({ key: 'b-win1', csvAway: 'B1', csvHome: 'U4' }),
    game({ key: 'b-win2', csvAway: 'B2', csvHome: 'U5' }),
    game({ key: 'c-win1', csvAway: 'C1', csvHome: 'U6' }),
    game({ key: 'c-win2', csvAway: 'C2', csvHome: 'U7' }),
  ];
  const rosterByTeam = new Map([
    ['A1', 'Alpha'],
    ['A2', 'Alpha'],
    ['A3', 'Alpha'],
    ['B1', 'Beta'],
    ['B2', 'Beta'],
    ['C1', 'Gamma'],
    ['C2', 'Gamma'],
    ['Idle', 'Delta'],
  ]);
  const scoresByKey = {
    'a-win1': {
      status: 'final',
      time: 'Final',
      away: { team: 'A1', score: 30 },
      home: { team: 'U1', score: 20 },
    },
    'a-win2': {
      status: 'final',
      time: 'Final',
      away: { team: 'A2', score: 27 },
      home: { team: 'U2', score: 14 },
    },
    'a-loss': {
      status: 'final',
      time: 'Final',
      away: { team: 'U3', score: 35 },
      home: { team: 'A3', score: 10 },
    },
    'b-win1': {
      status: 'final',
      time: 'Final',
      away: { team: 'B1', score: 21 },
      home: { team: 'U4', score: 17 },
    },
    'b-win2': {
      status: 'final',
      time: 'Final',
      away: { team: 'B2', score: 24 },
      home: { team: 'U5', score: 20 },
    },
    'c-win1': {
      status: 'final',
      time: 'Final',
      away: { team: 'C1', score: 31 },
      home: { team: 'U6', score: 10 },
    },
    'c-win2': {
      status: 'final',
      time: 'Final',
      away: { team: 'C2', score: 17 },
      home: { team: 'U7', score: 14 },
    },
  };

  const standings = deriveStandings(games, rosterByTeam, scoresByKey);

  assert.deepEqual(
    standings.rows.map((row) => row.owner),
    ['Gamma', 'Beta', 'Alpha', 'Delta']
  );
  assert.equal(standings.rows[0].winPct, 1);
  assert.equal(standings.rows[1].winPct, 1);
  assert.equal(standings.rows[2].winPct, 2 / 3);
  assert.equal(standings.rows[3].winPct, 0);
});

test('zero-game owners remain in standings while unexpected final ties stay out of visible standings math', () => {
  const games = [game({ key: 'unexpected-tie', csvAway: 'Texas', csvHome: 'Baylor' })];
  const rosterByTeam = new Map([
    ['Texas', 'Alex'],
    ['Baylor', 'Blake'],
    ['Idle', 'Casey'],
  ]);
  const scoresByKey = {
    'unexpected-tie': {
      status: 'final',
      time: 'Final',
      away: { team: 'Texas', score: 24 },
      home: { team: 'Baylor', score: 24 },
    },
  };

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message ?? ''));
  };

  try {
    const participations = deriveFinalOwnedParticipations(games, rosterByTeam, scoresByKey);
    const standings = deriveStandings(games, rosterByTeam, scoresByKey);

    assert.equal(participations.length, 0);
    assert.deepEqual(
      standings.rows.map((row) => ({ owner: row.owner, wins: row.wins, losses: row.losses })),
      [
        { owner: 'Alex', wins: 0, losses: 0 },
        { owner: 'Blake', wins: 0, losses: 0 },
        { owner: 'Casey', wins: 0, losses: 0 },
      ]
    );
    assert.ok(warnings.some((message) => /Ignoring unexpected final tie/.test(message)));
  } finally {
    console.warn = originalWarn;
  }
});
