import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../schedule.ts';
import { deriveStandingsHistory } from '../standingsHistory.ts';

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
        teamId: `${overrides.csvHome ?? 'Home'}-id`,
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: `${overrides.csvAway ?? 'Away'}-id`,
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

test('deriveStandingsHistory builds cumulative snapshots in deterministic week order including week 0', () => {
  const games = [
    game({ key: 'w1-b-win', week: 1, csvAway: 'B-Team', csvHome: 'Unowned-1', status: 'final' }),
    game({ key: 'w0-a-win', week: 0, csvAway: 'A-Team', csvHome: 'Unowned-0', status: 'final' }),
    game({ key: 'w2-owned', week: 2, csvAway: 'A-Team', csvHome: 'B-Team', status: 'final' }),
  ];

  const rosterByTeam = {
    'A-Team': 'Alpha',
    'B-Team': 'Beta',
    Idle: 'Idle Owner',
  };

  const scoresByKey = {
    'w0-a-win': {
      status: 'Final',
      time: 'Final',
      away: { team: 'A-Team', score: 21 },
      home: { team: 'Unowned-0', score: 10 },
    },
    'w1-b-win': {
      status: 'Final',
      time: 'Final',
      away: { team: 'B-Team', score: 31 },
      home: { team: 'Unowned-1', score: 14 },
    },
    'w2-owned': {
      status: 'Final',
      time: 'Final',
      away: { team: 'A-Team', score: 17 },
      home: { team: 'B-Team', score: 24 },
    },
  };

  const history = deriveStandingsHistory({ games, rosterByTeam, scoresByKey });

  assert.deepEqual(history.weeks, [0, 1, 2]);

  assert.deepEqual(
    history.byWeek[0]?.standings.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      gamesBack: row.gamesBack,
      ties: row.ties,
    })),
    [
      { owner: 'Alpha', wins: 1, losses: 0, gamesBack: 0, ties: 0 },
      { owner: 'Beta', wins: 0, losses: 0, gamesBack: 1, ties: 0 },
      { owner: 'Idle Owner', wins: 0, losses: 0, gamesBack: 1, ties: 0 },
    ]
  );

  assert.deepEqual(
    history.byWeek[1]?.standings.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      gamesBack: row.gamesBack,
    })),
    [
      { owner: 'Beta', wins: 1, losses: 0, gamesBack: 0 },
      { owner: 'Alpha', wins: 1, losses: 0, gamesBack: 0 },
      { owner: 'Idle Owner', wins: 0, losses: 0, gamesBack: 1 },
    ]
  );

  assert.deepEqual(
    history.byWeek[2]?.standings.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      gamesBack: row.gamesBack,
    })),
    [
      { owner: 'Beta', wins: 2, losses: 0, gamesBack: 0 },
      { owner: 'Alpha', wins: 1, losses: 1, gamesBack: 1 },
      { owner: 'Idle Owner', wins: 0, losses: 0, gamesBack: 2 },
    ]
  );

  assert.deepEqual(
    history.byOwner.Alpha?.map((point) => point.week),
    [0, 1, 2]
  );
  assert.deepEqual(
    history.byOwner.Beta?.map((point) => point.week),
    [0, 1, 2]
  );
  assert.deepEqual(
    history.byOwner['Idle Owner']?.map((point) => point.week),
    [0, 1, 2]
  );
});

test('deriveStandingsHistory does not count live/scheduled games as final outcomes', () => {
  const games = [
    game({ key: 'final', week: 1, csvAway: 'A-Team', csvHome: 'Unowned', status: 'final' }),
    game({ key: 'live', week: 2, csvAway: 'B-Team', csvHome: 'Unowned-2', status: 'in_progress' }),
    game({ key: 'scheduled', week: 3, csvAway: 'A-Team', csvHome: 'B-Team', status: 'scheduled' }),
  ];

  const rosterByTeam = new Map([
    ['A-Team', 'Alpha'],
    ['B-Team', 'Beta'],
  ]);

  const scoresByKey = {
    final: {
      status: 'Final',
      time: 'Final',
      away: { team: 'A-Team', score: 20 },
      home: { team: 'Unowned', score: 10 },
    },
    live: {
      status: 'In Progress',
      time: 'Q3',
      away: { team: 'B-Team', score: 14 },
      home: { team: 'Unowned-2', score: 7 },
    },
    scheduled: {
      status: 'Scheduled',
      time: 'Sat 7:00 PM',
      away: { team: 'A-Team', score: null },
      home: { team: 'B-Team', score: null },
    },
  };

  const history = deriveStandingsHistory({ games, rosterByTeam, scoresByKey });

  const week2Alpha = history.byWeek[2]?.standings.find((row) => row.owner === 'Alpha');
  const week2Beta = history.byWeek[2]?.standings.find((row) => row.owner === 'Beta');
  const week3Alpha = history.byWeek[3]?.standings.find((row) => row.owner === 'Alpha');
  const week3Beta = history.byWeek[3]?.standings.find((row) => row.owner === 'Beta');

  assert.equal(week2Alpha?.wins, 1);
  assert.equal(week2Beta?.wins, 0);
  assert.equal(week3Alpha?.wins, 1);
  assert.equal(week3Beta?.wins, 0);
});

test('deriveStandingsHistory preserves tie/no-decision semantics and byWeek/byOwner consistency', () => {
  const games = [
    game({ key: 'week-1-tie', week: 1, csvAway: 'A-Team', csvHome: 'B-Team', status: 'final' }),
    game({ key: 'week-2-a-win', week: 2, csvAway: 'A-Team', csvHome: 'Unowned', status: 'final' }),
  ];

  const rosterByTeam = {
    'A-Team': 'Alpha',
    'B-Team': 'Beta',
  };

  const scoresByKey = {
    'week-1-tie': {
      status: 'Final',
      time: 'Final',
      away: { team: 'A-Team', score: 14 },
      home: { team: 'B-Team', score: 14 },
    },
    'week-2-a-win': {
      status: 'Final',
      time: 'Final',
      away: { team: 'A-Team', score: 28 },
      home: { team: 'Unowned', score: 7 },
    },
  };

  const history = deriveStandingsHistory({ games, rosterByTeam, scoresByKey });

  const week1Alpha = history.byWeek[1]?.standings.find((row) => row.owner === 'Alpha');
  const week1Beta = history.byWeek[1]?.standings.find((row) => row.owner === 'Beta');

  assert.equal(week1Alpha?.wins, 0);
  assert.equal(week1Alpha?.losses, 0);
  assert.equal(week1Alpha?.ties, 0);
  assert.equal(week1Beta?.wins, 0);
  assert.equal(week1Beta?.losses, 0);
  assert.equal(week1Beta?.ties, 0);

  for (const owner of Object.keys(history.byOwner)) {
    for (const point of history.byOwner[owner] ?? []) {
      const weekRow = history.byWeek[point.week]?.standings.find((row) => row.owner === owner);
      assert.ok(weekRow);
      assert.equal(point.wins, weekRow?.wins);
      assert.equal(point.losses, weekRow?.losses);
      assert.equal(point.ties, weekRow?.ties);
      assert.equal(point.winPct, weekRow?.winPct);
      assert.equal(point.pointsFor, weekRow?.pointsFor);
      assert.equal(point.pointsAgainst, weekRow?.pointsAgainst);
      assert.equal(point.pointDifferential, weekRow?.pointDifferential);
      assert.equal(point.gamesBack, weekRow?.gamesBack);
    }
  }
});
