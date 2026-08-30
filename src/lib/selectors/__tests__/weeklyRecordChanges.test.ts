import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../../schedule.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';
import type { OwnedFinalParticipation } from '../../standings.ts';
import type { OwnerStandingsSeriesPoint } from '../../standingsHistory.ts';
import { selectWeeklyRecordChanges } from '../weeklyRecordChanges.ts';

function game(key: string, week: number): AppGame {
  return {
    key,
    eventId: key,
    eventKey: key,
    week,
    canonicalWeek: week,
    providerWeek: week,
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    date: `2026-09-${String(week).padStart(2, '0')}T16:00:00.000Z`,
    status: 'final',
    rawStatus: 'final',
    completed: true,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: key,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: {
        kind: 'team',
        teamId: `${key}-away`,
        displayName: `${key}-away`,
        canonicalName: `${key}-away`,
        rawName: `${key}-away`,
      },
      home: {
        kind: 'team',
        teamId: `${key}-home`,
        displayName: `${key}-home`,
        canonicalName: `${key}-home`,
        rawName: `${key}-home`,
      },
    },
    csvAway: `${key}-away`,
    csvHome: `${key}-home`,
    canAway: `${key}-away`,
    canHome: `${key}-home`,
    awayConf: 'SEC',
    homeConf: 'SEC',
  };
}

function participation(owner: string, week: number, pointsFor: number): OwnedFinalParticipation {
  return {
    owner,
    game: game(`${owner}-${week}`, week),
    teamSide: 'home',
    teamName: `${owner} Team`,
    opponentTeamName: `Opponent ${week}`,
    pointsFor,
    pointsAgainst: Math.max(0, pointsFor - 7),
    result: 'win',
  };
}

function ownedMatchup(
  winner: string,
  loser: string,
  week: number,
  winnerPoints = 30,
  loserPoints = 0
): OwnedFinalParticipation[] {
  const matchupGame = game(`${winner}-${loser}-${week}`, week);
  return [
    {
      owner: winner,
      opponentOwner: loser,
      game: matchupGame,
      teamSide: 'home',
      teamName: `${winner} Team`,
      opponentTeamName: `${loser} Team`,
      pointsFor: winnerPoints,
      pointsAgainst: loserPoints,
      result: 'win',
    },
    {
      owner: loser,
      opponentOwner: winner,
      game: matchupGame,
      teamSide: 'away',
      teamName: `${loser} Team`,
      opponentTeamName: `${winner} Team`,
      pointsFor: loserPoints,
      pointsAgainst: winnerPoints,
      result: 'loss',
    },
  ];
}

function point(week: number, pointsFor: number, pointsAgainst: number): OwnerStandingsSeriesPoint {
  return {
    week,
    wins: 1,
    losses: 0,
    ties: 0,
    winPct: 1,
    pointsFor,
    pointsAgainst,
    pointDifferential: pointsFor - pointsAgainst,
    gamesBack: 0,
  };
}

function archive(points: number): SeasonArchive {
  return {
    leagueSlug: 'record-changes',
    year: 2025,
    archivedAt: '2025-12-01T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nAlice Team,Alice\n',
    standingsHistory: {
      weeks: [],
      byWeek: {},
      byOwner: { Alice: [point(1, points, Math.max(0, points - 7))] },
    },
    finalStandings: [
      {
        ...point(1, points, Math.max(0, points - 7)),
        owner: 'Alice',
        finalGames: 1,
      },
    ],
    games: [],
    scoresByKey: {},
  };
}

function changes(args: {
  historicalPoints: number;
  targetWeek: number;
  participations: OwnedFinalParticipation[];
}) {
  return selectWeeklyRecordChanges({
    archives: [archive(args.historicalPoints)],
    historicalRosters: { 2025: new Map([['Alice Team', 'Alice']]) },
    seasonYear: 2026,
    targetWeek: args.targetWeek,
    participations: args.participations,
  });
}

test('record diff reports a holder and value change caused by the explicit target week', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 2,
    participations: [participation('Bob', 1, 40), participation('Bob', 2, 20)],
  });
  const change = result.find((entry) => entry.id === 'single_season_points_high');

  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.previous?.value, 50);
  assert.deepEqual(change?.current?.holders, ['Bob']);
  assert.equal(change?.current?.value, 60);
});

test('record diff reports a newly tied holder when the value is unchanged', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 1,
    participations: [participation('Bob', 1, 50)],
  });
  const change = result.find((entry) => entry.id === 'single_season_high_score');

  assert.equal(change?.previous?.value, 50);
  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.current?.value, 50);
  assert.deepEqual(change?.current?.holders, ['Alice', 'Bob']);
});

test('record diff reports no movement when the target week changes no safe record', () => {
  assert.deepEqual(
    changes({
      historicalPoints: 100,
      targetWeek: 1,
      participations: [participation('Bob', 1, 40)],
    }),
    []
  );
});

test('record diff observes context movement even when holder and value stay fixed', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 1,
    participations: [participation('Alice', 1, 50)],
  });
  const change = result.find((entry) => entry.id === 'single_season_points_high');

  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.previous?.value, 50);
  assert.equal(change?.previous?.contextString, '2025 season');
  assert.deepEqual(change?.current?.holders, ['Alice']);
  assert.equal(change?.current?.value, 50);
  assert.equal(change?.current?.contextString, '2026 season');
});

test('a target-week tie by the existing holder retains the newest high-score context', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 1,
    participations: [participation('Alice', 1, 50)],
  });
  const change = result.find((entry) => entry.id === 'single_season_high_score');

  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.previous?.contextString, '2025 · Week 1');
  assert.deepEqual(change?.current?.holders, ['Alice']);
  assert.equal(change?.current?.contextString, '2026 · Week 1');
});

test('latest high-score context follows week chronology rather than owner grouping order', () => {
  const result = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 3,
    participations: [
      participation('Alice', 1, 50),
      participation('Bob', 2, 50),
      participation('Alice', 3, 50),
    ],
  });
  const change = result.find((entry) => entry.id === 'single_season_high_score');

  assert.deepEqual(change?.previous?.holders, ['Alice', 'Bob']);
  assert.equal(change?.previous?.contextString, '2026 · Week 2');
  assert.deepEqual(change?.current?.holders, ['Alice', 'Bob']);
  assert.equal(change?.current?.contextString, '2026 · Week 3');
});

test('a target-week blowout tie retains the newest opponent context', () => {
  const result = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 2,
    participations: [...ownedMatchup('Alice', 'Bob', 1), ...ownedMatchup('Alice', 'Carol', 2)],
  });
  const change = result.find((entry) => entry.id === 'single_season_blowout');

  assert.equal(change?.previous?.contextString, 'over Bob · 2026');
  assert.equal(change?.current?.contextString, 'over Carol · 2026');
});

test('record diff distinguishes a newly suppressed broad tie from a vanished record', () => {
  const owners = ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Frank', 'Grace'];
  const result = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 2,
    participations: owners.map((owner, index) =>
      participation(owner, index === owners.length - 1 ? 2 : 1, 50)
    ),
  });
  const change = result.find((entry) => entry.id === 'single_season_high_score');

  assert.equal(change?.current, null);
  assert.deepEqual(change?.suppressedCurrent?.holders, owners);
  assert.equal(change?.suppressedCurrent?.value, 50);
});

test('record diff preserves a broad-tie predecessor when the record becomes displayable', () => {
  const rivalries = [
    ['Alice', 'Bob'],
    ['Carol', 'Dan'],
    ['Erin', 'Frank'],
    ['Grace', 'Heidi'],
  ] as const;
  const result = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 3,
    participations: [
      ...rivalries.flatMap(([winner, loser]) => [
        ...ownedMatchup(winner, loser, 1),
        ...ownedMatchup(winner, loser, 2),
      ]),
      ...rivalries.slice(1).flatMap(([winner, loser]) => ownedMatchup(loser, winner, 3)),
    ],
  });
  const change = result.find((entry) => entry.id === 'lopsided_rivalry');

  assert.equal(change?.previous, null);
  assert.equal(change?.suppressedPrevious?.constituentKeys?.length, 4);
  assert.equal(change?.suppressedPrevious?.formattedValue, '2-game lead');
  assert.equal(change?.current?.contextString, 'Alice over Bob');
});

test('tied rivalry projection uses the record metric instead of one sampled pair score', () => {
  const result = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 5,
    participations: [
      ...ownedMatchup('Alice', 'Bob', 1),
      ...ownedMatchup('Alice', 'Bob', 2),
      ...ownedMatchup('Alice', 'Bob', 3),
      ...ownedMatchup('Bob', 'Alice', 4),
      ...ownedMatchup('Carol', 'Dan', 1),
      ...ownedMatchup('Carol', 'Dan', 2),
      ...ownedMatchup('Erin', 'Frank', 1),
      ...ownedMatchup('Bob', 'Alice', 5),
      ...ownedMatchup('Erin', 'Frank', 5),
    ],
  });
  const change = result.find((entry) => entry.id === 'lopsided_rivalry');

  assert.equal(change?.previous?.formattedValue, '2-game lead');
  assert.equal(change?.current?.formattedValue, '2-game lead');
  assert.notDeepEqual(change?.previous?.constituentKeys, change?.current?.constituentKeys);
});

test('tied even-rivalry projection formats both zero and nonzero gaps invariantly', () => {
  const split = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 4,
    participations: [
      ...ownedMatchup('Carol', 'Dan', 1),
      ...ownedMatchup('Dan', 'Carol', 2),
      ...ownedMatchup('Alice', 'Bob', 3),
      ...ownedMatchup('Bob', 'Alice', 4),
    ],
  }).find((entry) => entry.id === 'even_rivalry');
  const oneGameGap = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 3,
    participations: [
      ...ownedMatchup('Alice', 'Bob', 1),
      ...ownedMatchup('Bob', 'Alice', 2),
      ...ownedMatchup('Bob', 'Alice', 3),
      ...ownedMatchup('Carol', 'Dan', 1),
      ...ownedMatchup('Carol', 'Dan', 2),
      ...ownedMatchup('Dan', 'Carol', 3),
    ],
  }).find((entry) => entry.id === 'even_rivalry');

  assert.equal(split?.current?.formattedValue, 'Even after 2 games');
  assert.equal(oneGameGap?.current?.formattedValue, '1-game gap after 3 games');
  assert.deepEqual(split?.current?.constituentKeys, ['["Alice","Bob"]', '["Carol","Dan"]']);
  assert.deepEqual(oneGameGap?.current?.constituentKeys, ['["Alice","Bob"]', '["Carol","Dan"]']);
});

test('record diff compares rivalry constituents when tied pairs share the same owner union', () => {
  const lopsided = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 3,
    participations: [
      ...ownedMatchup('Alice', 'Bob', 1),
      ...ownedMatchup('Alice', 'Bob', 2),
      ...ownedMatchup('Alice', 'Carol', 1),
      ...ownedMatchup('Alice', 'Carol', 2),
      ...ownedMatchup('Bob', 'Carol', 1),
      ...ownedMatchup('Bob', 'Carol', 2),
      ...ownedMatchup('Bob', 'Alice', 3),
    ],
  });
  const even = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 3,
    participations: [
      ...ownedMatchup('Alice', 'Bob', 1),
      ...ownedMatchup('Bob', 'Alice', 2),
      ...ownedMatchup('Alice', 'Carol', 1),
      ...ownedMatchup('Carol', 'Alice', 2),
      ...ownedMatchup('Bob', 'Carol', 1),
      ...ownedMatchup('Carol', 'Bob', 2),
      ...ownedMatchup('Alice', 'Bob', 3),
    ],
  });

  assert.deepEqual(
    lopsided
      .filter((entry) => entry.id === 'lopsided_rivalry' || entry.id === 'dominance_streak')
      .map((entry) => entry.id),
    ['lopsided_rivalry', 'dominance_streak']
  );
  assert.equal(
    even.some((entry) => entry.id === 'even_rivalry'),
    true
  );
});

test('target-week reversal diffs all three live rivalry records in chronological order', () => {
  const result = selectWeeklyRecordChanges({
    archives: [],
    historicalRosters: {},
    seasonYear: 2026,
    targetWeek: 3,
    participations: [
      ...ownedMatchup('Alice', 'Bob', 1),
      ...ownedMatchup('Alice', 'Bob', 2),
      ...ownedMatchup('Bob', 'Alice', 3),
    ],
  });
  const rivalryChanges = result.filter((entry) =>
    ['lopsided_rivalry', 'even_rivalry', 'dominance_streak'].includes(entry.id)
  );

  assert.deepEqual(
    rivalryChanges.map((entry) => entry.id),
    ['lopsided_rivalry', 'even_rivalry', 'dominance_streak']
  );
  assert.equal(rivalryChanges[0]?.previous?.value, 2);
  assert.equal(rivalryChanges[0]?.current, null);
  assert.equal(rivalryChanges[1]?.previous?.value, 2);
  assert.equal(rivalryChanges[1]?.current?.value, 3);
  assert.equal(rivalryChanges[2]?.previous?.value, 2);
  assert.equal(rivalryChanges[2]?.current, null);
});
