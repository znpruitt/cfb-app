import assert from 'node:assert/strict';
import test from 'node:test';

import { selectLeagueStorylines } from '../selectors/storylines';
import type { StandingsHistory } from '../standingsHistory';
import type { GamesBackSeries, WinBarsRow, WinPctSeries } from '../selectors/trends';

function buildHistory(
  weeks: Array<{ week: number; rows: Array<{ owner: string; wins: number }> }>
): StandingsHistory {
  const byOwner = weeks.reduce<StandingsHistory['byOwner']>((acc, snapshot) => {
    snapshot.rows.forEach((row) => {
      if (!acc[row.owner]) acc[row.owner] = [];
      acc[row.owner]!.push({
        week: snapshot.week,
        wins: row.wins,
        losses: 0,
        ties: 0,
        winPct: 0.5,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
      });
    });
    return acc;
  }, {});

  return {
    weeks: weeks.map((entry) => entry.week),
    byOwner,
    byWeek: Object.fromEntries(
      weeks.map((entry) => [
        entry.week,
        {
          week: entry.week,
          standings: entry.rows.map((row) => ({
            owner: row.owner,
            wins: row.wins,
            losses: 0,
            ties: 0,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 0,
            finalGames: 0,
          })),
          coverage: { state: 'complete', message: null as string | null },
        },
      ])
    ),
  };
}

function gb(ownerName: string, value: number): GamesBackSeries {
  return { ownerId: ownerName, ownerName, points: [{ week: 1, value }] };
}

function wp(ownerName: string, value: number): WinPctSeries {
  return { ownerId: ownerName, ownerName, points: [{ week: 1, value }] };
}

function bar(ownerName: string, wins: number, winPct: number): WinBarsRow {
  return {
    ownerId: ownerName,
    ownerName,
    wins,
    losses: 0,
    ties: 0,
    winPct,
    gamesBack: 0,
  };
}

test('emits leader-gap storyline when first place has meaningful separation', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    gamesBackTrend: [gb('Pruitt', 0), gb('Ciprys', 3), gb('Shambaugh', 4)],
    winPctTrend: [],
    winBars: [],
  });

  assert.equal(storylines[0]?.type, 'leader-gap');
  assert.match(storylines[0]?.text ?? '', /Pruitt leads by 3 games/);
});

test('emits tight-race storyline when top spots are close', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    gamesBackTrend: [gb('Pruitt', 0), gb('Ciprys', 1), gb('Shambaugh', 1)],
    winPctTrend: [],
    winBars: [],
  });

  assert.equal(storylines[0]?.type, 'tight-race');
  assert.match(storylines[0]?.text ?? '', /top 3 are separated by 1 game/i);
});

test('emits movement storyline when biggest week-over-week move is meaningful', () => {
  const history = buildHistory([
    {
      week: 5,
      rows: [
        { owner: 'Pruitt', wins: 10 },
        { owner: 'Shambaugh', wins: 7 },
      ],
    },
    {
      week: 6,
      rows: [
        { owner: 'Pruitt', wins: 11 },
        { owner: 'Shambaugh', wins: 10 },
      ],
    },
  ]);

  const storylines = selectLeagueStorylines({
    standingsHistory: history,
    gamesBackTrend: [],
    winPctTrend: [],
    winBars: [],
  });

  assert.equal(storylines[0]?.type, 'movement');
  assert.match(
    storylines[0]?.text ?? '',
    /Shambaugh made the biggest move this week, gaining 3 wins/i
  );
});

test('emits win-pct standout storyline when best win percentage is not first in wins', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    gamesBackTrend: [],
    winPctTrend: [wp('Leader', 0.75), wp('Ciprys', 0.81)],
    winBars: [bar('Leader', 12, 0.75), bar('Ciprys', 11, 0.81)],
  });

  assert.equal(storylines[0]?.type, 'win-pct');
  assert.match(storylines[0]?.text ?? '', /Ciprys owns the league's best win percentage/i);
});

test('suppresses tight-race storyline when leader-gap storyline already captures top spread', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    gamesBackTrend: [gb('Leader', 0), gb('Second', 3), gb('Third', 3)],
    winPctTrend: [wp('Leader', 0.7), wp('Second', 0.74)],
    winBars: [bar('Leader', 10, 0.7), bar('Second', 9, 0.74)],
  });

  assert.equal(
    storylines.some((entry) => entry.type === 'tight-race'),
    false
  );
  assert.equal(storylines.length, 2);
});

test('returns empty output when no meaningful storyline triggers', () => {
  const history = buildHistory([
    {
      week: 1,
      rows: [
        { owner: 'A', wins: 1 },
        { owner: 'B', wins: 1 },
      ],
    },
    {
      week: 2,
      rows: [
        { owner: 'A', wins: 2 },
        { owner: 'B', wins: 2 },
      ],
    },
  ]);

  const storylines = selectLeagueStorylines({
    standingsHistory: history,
    gamesBackTrend: [],
    winPctTrend: [wp('A', 0.6), wp('B', 0.6)],
    winBars: [bar('A', 6, 0.6), bar('B', 6, 0.6)],
  });

  assert.deepEqual(storylines, []);
});
