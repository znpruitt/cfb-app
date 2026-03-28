import assert from 'node:assert/strict';
import test from 'node:test';

import type { StandingsHistory } from '../standingsHistory';
import { selectGamesBackTrend, selectWinBars, selectWinPctTrend } from '../selectors/trends';

function buildHistory(): StandingsHistory {
  return {
    weeks: [0, 1, 2],
    byWeek: {
      0: {
        week: 0,
        standings: [
          {
            owner: 'Alex',
            wins: 1,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 10,
            pointsAgainst: 3,
            pointDifferential: 7,
            gamesBack: 0,
            finalGames: 1,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      1: {
        week: 1,
        standings: [
          {
            owner: 'Alex',
            wins: 2,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 21,
            pointsAgainst: 9,
            pointDifferential: 12,
            gamesBack: 0,
            finalGames: 2,
          },
          {
            owner: 'Blake',
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 17,
            pointsAgainst: 17,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 2,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [],
        coverage: { state: 'partial', message: null },
      },
    },
    byOwner: {
      Alex: [
        {
          week: 0,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 10,
          pointsAgainst: 3,
          pointDifferential: 7,
          gamesBack: 0,
        },
        {
          week: 1,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 21,
          pointsAgainst: 9,
          pointDifferential: 12,
          gamesBack: 0,
        },
      ],
      Blake: [
        {
          week: 0,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 3,
          pointsAgainst: 10,
          pointDifferential: -7,
          gamesBack: 1,
        },
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 17,
          pointsAgainst: 17,
          pointDifferential: 0,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 24,
          pointsAgainst: 30,
          pointDifferential: -6,
          gamesBack: 2,
        },
      ],
    },
  };
}

test('selectGamesBackTrend builds one sorted series per owner from standingsHistory.byOwner', () => {
  const trend = selectGamesBackTrend({ standingsHistory: buildHistory() });

  assert.deepEqual(
    trend.map((series) => series.ownerName),
    ['Alex', 'Blake']
  );
  assert.deepEqual(trend.find((series) => series.ownerName === 'Alex')?.points, [
    { week: 0, value: 0 },
    { week: 1, value: 0 },
  ]);
  assert.deepEqual(trend.find((series) => series.ownerName === 'Blake')?.points, [
    { week: 0, value: 1 },
    { week: 1, value: 1 },
  ]);
});

test('selectGamesBackTrend uses latest standings order with alphabetical fallback for unmapped owners', () => {
  const history = buildHistory();
  history.byWeek[2] = {
    ...history.byWeek[2]!,
    coverage: { state: 'complete', message: null },
    standings: [
      {
        owner: 'Blake',
        wins: 1,
        losses: 2,
        ties: 0,
        winPct: 0.333,
        pointsFor: 24,
        pointsAgainst: 30,
        pointDifferential: -6,
        gamesBack: 2,
        finalGames: 3,
      },
      {
        owner: 'Alex',
        wins: 2,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 21,
        pointsAgainst: 9,
        pointDifferential: 12,
        gamesBack: 0,
        finalGames: 2,
      },
    ],
  };
  history.byOwner['Casey'] = [
    {
      week: 2,
      wins: 1,
      losses: 1,
      ties: 0,
      winPct: 0.5,
      pointsFor: 18,
      pointsAgainst: 18,
      pointDifferential: 0,
      gamesBack: 1.5,
    },
  ];

  const trend = selectGamesBackTrend({ standingsHistory: history });

  assert.deepEqual(
    trend.map((series) => series.ownerName),
    ['Blake', 'Alex', 'Casey']
  );
});

test('selectGamesBackTrend falls back to alphabetical owner ordering when latest standings are unavailable', () => {
  const history = buildHistory();
  history.byWeek[2] = {
    ...history.byWeek[2]!,
    standings: [],
  };

  const trend = selectGamesBackTrend({ standingsHistory: history });
  assert.deepEqual(
    trend.map((series) => series.ownerName),
    ['Alex', 'Blake']
  );
});

test('selectGamesBackTrend truncates future unresolved weeks and avoids flat carry-forward tails', () => {
  const history = buildHistory();
  history.weeks = [0, 1, 2, 3];
  history.byWeek[3] = {
    week: 3,
    standings: [],
    coverage: { state: 'partial', message: null },
  };
  history.byOwner['Alex']!.push({
    week: 2,
    wins: 2,
    losses: 0,
    ties: 0,
    winPct: 1,
    pointsFor: 21,
    pointsAgainst: 9,
    pointDifferential: 12,
    gamesBack: 0,
  });
  history.byOwner['Alex']!.push({
    week: 3,
    wins: 2,
    losses: 0,
    ties: 0,
    winPct: 1,
    pointsFor: 21,
    pointsAgainst: 9,
    pointDifferential: 12,
    gamesBack: 0,
  });

  const trend = selectGamesBackTrend({ standingsHistory: history });
  assert.deepEqual(
    trend.find((series) => series.ownerName === 'Alex')?.points.map((point) => point.week),
    [0, 1]
  );
});

test('selectWinPctTrend builds one sorted series per owner from standingsHistory.byOwner', () => {
  const trend = selectWinPctTrend({ standingsHistory: buildHistory() });

  assert.deepEqual(
    trend.map((series) => series.ownerName),
    ['Alex', 'Blake']
  );
  assert.deepEqual(trend.find((series) => series.ownerName === 'Alex')?.points, [
    { week: 0, value: 1 },
    { week: 1, value: 1 },
  ]);
  assert.deepEqual(trend.find((series) => series.ownerName === 'Blake')?.points, [
    { week: 0, value: 0 },
    { week: 1, value: 0.5 },
  ]);
});

test('selectWinPctTrend uses latest standings order with alphabetical fallback for unmapped owners', () => {
  const history = buildHistory();
  history.byWeek[2] = {
    ...history.byWeek[2]!,
    coverage: { state: 'complete', message: null },
    standings: [
      {
        owner: 'Blake',
        wins: 1,
        losses: 2,
        ties: 0,
        winPct: 0.333,
        pointsFor: 24,
        pointsAgainst: 30,
        pointDifferential: -6,
        gamesBack: 2,
        finalGames: 3,
      },
      {
        owner: 'Alex',
        wins: 2,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 21,
        pointsAgainst: 9,
        pointDifferential: 12,
        gamesBack: 0,
        finalGames: 2,
      },
    ],
  };
  history.byOwner['Casey'] = [
    {
      week: 2,
      wins: 1,
      losses: 1,
      ties: 0,
      winPct: 0.5,
      pointsFor: 18,
      pointsAgainst: 18,
      pointDifferential: 0,
      gamesBack: 1.5,
    },
  ];

  const trend = selectWinPctTrend({ standingsHistory: history });

  assert.deepEqual(
    trend.map((series) => series.ownerName),
    ['Blake', 'Alex', 'Casey']
  );
});

test('selectWinPctTrend truncates unresolved weeks and keeps canonical winPct values', () => {
  const history = buildHistory();
  history.weeks = [0, 1, 2, 3];
  history.byWeek[3] = {
    week: 3,
    standings: [],
    coverage: { state: 'partial', message: null },
  };
  history.byOwner['Blake']!.push({
    week: 3,
    wins: 2,
    losses: 2,
    ties: 0,
    winPct: 0.5,
    pointsFor: 34,
    pointsAgainst: 34,
    pointDifferential: 0,
    gamesBack: 1,
  });

  const trend = selectWinPctTrend({ standingsHistory: history });
  const blakePoints = trend.find((series) => series.ownerName === 'Blake')?.points ?? [];
  assert.deepEqual(
    blakePoints.map((point) => point.week),
    [0, 1]
  );
  assert.deepEqual(
    blakePoints.map((point) => point.value),
    [0, 0.5]
  );
});

test('selectWinBars uses latest resolved standings snapshot values and order', () => {
  const history = buildHistory();
  history.byWeek[2] = {
    week: 2,
    standings: [
      {
        owner: 'Blake',
        wins: 2,
        losses: 1,
        ties: 0,
        winPct: 0.667,
        pointsFor: 31,
        pointsAgainst: 21,
        pointDifferential: 10,
        gamesBack: 0,
        finalGames: 3,
      },
      {
        owner: 'Alex',
        wins: 2,
        losses: 1,
        ties: 0,
        winPct: 0.667,
        pointsFor: 26,
        pointsAgainst: 19,
        pointDifferential: 7,
        gamesBack: 0,
        finalGames: 3,
      },
    ],
    coverage: { state: 'complete', message: null },
  };

  const rows = selectWinBars({ standingsHistory: history });

  assert.deepEqual(
    rows.map((row) => row.ownerName),
    ['Blake', 'Alex']
  );
  assert.deepEqual(rows[0], {
    ownerId: 'Blake',
    ownerName: 'Blake',
    wins: 2,
    losses: 1,
    ties: 0,
    winPct: 0.667,
    gamesBack: 0,
  });
});

test('selectWinBars falls back deterministically when no resolved standings are available', () => {
  const history = buildHistory();
  history.weeks = [2];
  history.byWeek = {
    2: {
      week: 2,
      standings: [],
      coverage: { state: 'partial', message: null },
    },
  };
  history.byOwner = {
    Casey: history.byOwner.Blake ?? [],
    Alex: history.byOwner.Alex ?? [],
  };

  const rows = selectWinBars({ standingsHistory: history });
  assert.deepEqual(rows, []);
});
