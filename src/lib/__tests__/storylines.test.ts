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

test('close-finish storyline emits in final context and suppresses leader-gap', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    seasonContext: 'final',
    gamesBackTrend: [gb('Pruitt', 0), gb('Maleski', 1), gb('Ciprys', 3)],
    winPctTrend: [],
    winBars: [],
  });

  assert.equal(storylines[0]?.type, 'close-finish');
  assert.match(storylines[0]?.text ?? '', /edged Maleski/i);
  assert.equal(
    storylines.some((entry) => entry.type === 'leader-gap'),
    false
  );
});

test('final context avoids in-season leader phrasing', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    seasonContext: 'final',
    gamesBackTrend: [gb('Pruitt', 0), gb('Ciprys', 6), gb('Shambaugh', 7)],
    winPctTrend: [],
    winBars: [],
  });

  assert.equal(storylines[0]?.type, 'leader-gap');
  assert.doesNotMatch(storylines[0]?.text ?? '', /leads by/i);
  assert.match(storylines[0]?.text ?? '', /finished first|won the title/i);
});

test('in-season and postseason leader-gap phrasing varies deterministically by gap size', () => {
  const moderateGap = selectLeagueStorylines({
    standingsHistory: null,
    seasonContext: 'in-season',
    gamesBackTrend: [gb('Pruitt', 0), gb('Ciprys', 2), gb('Shambaugh', 4)],
    winPctTrend: [],
    winBars: [],
  });

  const wideGap = selectLeagueStorylines({
    standingsHistory: null,
    seasonContext: 'in-season',
    gamesBackTrend: [gb('Pruitt', 0), gb('Ciprys', 5), gb('Shambaugh', 6)],
    winPctTrend: [],
    winBars: [],
  });

  const repeatedWideGap = selectLeagueStorylines({
    standingsHistory: null,
    seasonContext: 'in-season',
    gamesBackTrend: [gb('Pruitt', 0), gb('Ciprys', 5), gb('Shambaugh', 6)],
    winPctTrend: [],
    winBars: [],
  });

  assert.match(moderateGap[0]?.text ?? '', /ahead by 2 games/i);
  assert.match(wideGap[0]?.text ?? '', /opened a 5 games gap/i);
  assert.equal(wideGap[0]?.text, repeatedWideGap[0]?.text);
});

test('suppresses competing top-of-table narratives when leader-gap already applies', () => {
  const storylines = selectLeagueStorylines({
    standingsHistory: null,
    seasonContext: 'in-season',
    gamesBackTrend: [gb('Leader', 0), gb('Second', 3), gb('Third', 4)],
    winPctTrend: [wp('Leader', 0.7), wp('Second', 0.74)],
    winBars: [bar('Leader', 10, 0.7), bar('Second', 9, 0.74)],
  });

  assert.equal(
    storylines.filter((entry) => ['close-finish', 'leader-gap', 'tight-race'].includes(entry.type))
      .length,
    1
  );
  assert.equal(storylines[0]?.type, 'leader-gap');
});

test('movement and win-pct rules still work with cap enforcement', () => {
  const history = buildHistory([
    {
      week: 10,
      rows: [
        { owner: 'Leader', wins: 10 },
        { owner: 'Mover', wins: 5 },
        { owner: 'PctLeader', wins: 6 },
      ],
    },
    {
      week: 11,
      rows: [
        { owner: 'Leader', wins: 11 },
        { owner: 'Mover', wins: 8 },
        { owner: 'PctLeader', wins: 7 },
      ],
    },
  ]);

  const storylines = selectLeagueStorylines({
    standingsHistory: history,
    seasonContext: 'in-season',
    gamesBackTrend: [gb('Leader', 0), gb('Mover', 3), gb('PctLeader', 4)],
    winPctTrend: [wp('Leader', 0.7), wp('PctLeader', 0.82), wp('Mover', 0.5)],
    winBars: [bar('Leader', 11, 0.7), bar('PctLeader', 7, 0.82), bar('Mover', 8, 0.5)],
  });

  assert.equal(storylines.length, 3);
  assert.deepEqual(
    storylines.map((entry) => entry.type),
    ['leader-gap', 'movement', 'win-pct']
  );
});
