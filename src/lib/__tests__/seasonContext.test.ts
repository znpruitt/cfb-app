import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSeasonContext } from '../selectors/seasonContext';
import type { StandingsHistory } from '../standingsHistory';

function createHistory(args: { weeks: number[]; resolvedWeeks: number[] }): StandingsHistory {
  const { weeks, resolvedWeeks } = args;

  const byWeek: StandingsHistory['byWeek'] = {};
  const byOwner: StandingsHistory['byOwner'] = {
    Alice: [],
  };

  for (const week of weeks) {
    const resolved = resolvedWeeks.includes(week);
    byWeek[week] = {
      week,
      standings: resolved
        ? [
            {
              owner: 'Alice',
              wins: week,
              losses: 0,
              ties: 0,
              winPct: 1,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: week,
            },
          ]
        : [],
      coverage: {
        state: resolved ? 'complete' : 'partial',
        message: null,
      },
    };

    if (resolved) {
      byOwner.Alice.push({
        week,
        wins: week,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      });
    }
  }

  return {
    weeks,
    byWeek,
    byOwner,
  };
}

test('returns in-season when future postseason weeks are scheduled but unresolved', () => {
  const standingsHistory = createHistory({
    weeks: [12, 13, 14, 16, 17],
    resolvedWeeks: [12, 13, 14],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'in-season');
});

test('returns postseason when latest resolved week is postseason and season is not complete', () => {
  const standingsHistory = createHistory({
    weeks: [14, 15, 16, 17],
    resolvedWeeks: [14, 15, 16],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'postseason');
});

test('returns final when all weeks are resolved', () => {
  const standingsHistory = createHistory({
    weeks: [14, 15, 16],
    resolvedWeeks: [14, 15, 16],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'final');
});

test('returns in-season when no weeks are resolved', () => {
  const standingsHistory = createHistory({
    weeks: [1, 2, 3],
    resolvedWeeks: [],
  });

  assert.equal(selectSeasonContext({ standingsHistory }), 'in-season');
});
