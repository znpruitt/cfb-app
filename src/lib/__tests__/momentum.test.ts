import assert from 'node:assert/strict';
import test from 'node:test';

import type { StandingsHistory } from '../standingsHistory';
import { selectOwnerMomentum } from '../selectors/momentum';

function buildHistory(): StandingsHistory {
  return {
    weeks: [1, 2, 3, 4],
    byWeek: {
      1: {
        week: 1,
        standings: [
          {
            owner: 'Alice',
            wins: 1,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 0,
            finalGames: 1,
          },
          {
            owner: 'Bob',
            wins: 0,
            losses: 1,
            ties: 0,
            winPct: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 1,
          },
          {
            owner: 'Carol',
            wins: 0,
            losses: 1,
            ties: 0,
            winPct: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 1,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          {
            owner: 'Alice',
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 2,
          },
          {
            owner: 'Bob',
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 2,
          },
          {
            owner: 'Carol',
            wins: 0,
            losses: 2,
            ties: 0,
            winPct: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 2,
            finalGames: 2,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [
          {
            owner: 'Bob',
            wins: 2,
            losses: 1,
            ties: 0,
            winPct: 0.667,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 0,
            finalGames: 3,
          },
          {
            owner: 'Alice',
            wins: 2,
            losses: 1,
            ties: 0,
            winPct: 0.667,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 0,
            finalGames: 3,
          },
          {
            owner: 'Carol',
            wins: 1,
            losses: 2,
            ties: 0,
            winPct: 0.333,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 3,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      4: {
        week: 4,
        standings: [],
        coverage: { state: 'partial', message: null },
      },
    },
    byOwner: {
      Alice: [
        {
          week: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
        },
        {
          week: 3,
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
        },
      ],
      Bob: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
        },
        {
          week: 3,
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
        },
      ],
      Carol: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 0,
          losses: 2,
          ties: 0,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
        },
      ],
    },
  };
}

test('selectOwnerMomentum computes deterministic deltas from resolved weeks', () => {
  const momentum = selectOwnerMomentum({ standingsHistory: buildHistory(), windowSize: 2 });

  assert.deepEqual(momentum[0], {
    ownerId: 'Bob',
    deltaWins: 2,
    deltaGamesBack: -1,
    deltaWinPct: 0.667,
  });
  assert.deepEqual(momentum[1], {
    ownerId: 'Carol',
    deltaWins: 1,
    deltaGamesBack: 0,
    deltaWinPct: 0.333,
  });
  assert.deepEqual(momentum[2], {
    ownerId: 'Alice',
    deltaWins: 1,
    deltaGamesBack: 0,
    deltaWinPct: -0.333,
  });
});

test('selectOwnerMomentum handles insufficient week windows by using earliest resolved baseline', () => {
  const momentum = selectOwnerMomentum({ standingsHistory: buildHistory(), windowSize: 10 });

  assert.equal(momentum.length, 3);
  assert.deepEqual(
    momentum.map((item) => item.ownerId),
    ['Bob', 'Carol', 'Alice']
  );
  assert.equal(momentum.find((item) => item.ownerId === 'Alice')?.deltaWins, 1);
});
