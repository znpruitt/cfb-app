import assert from 'node:assert/strict';
import test from 'node:test';

import type { StandingsHistory } from '../standingsHistory';
import { selectGamesBackTrend } from '../selectors/trends';

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
