import assert from 'node:assert/strict';
import test from 'node:test';

import type { StandingsHistory } from '../standingsHistory';
import {
  SEASON_ORIGIN_GAMES_BACK,
  isDrawableTrendSeries,
  seasonOriginApplies,
  selectGamesBackTrend,
  selectWinBars,
  selectWinPctTrend,
} from '../selectors/trends';

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

test('selectWinPctTrend returns empty array when no resolved standings weeks exist', () => {
  const history = buildHistory();
  history.weeks = [2];
  history.byWeek = {
    2: {
      week: 2,
      standings: [],
      coverage: { state: 'partial', message: null },
    },
  };

  const trend = selectWinPctTrend({ standingsHistory: history });
  assert.deepEqual(trend, []);
});

test('selectWinPctTrend excludes owners with no resolved week points', () => {
  const history = buildHistory();
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
    ['Alex', 'Blake']
  );
  assert.ok(!trend.some((series) => series.ownerName === 'Casey'));
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

// ---------------------------------------------------------------------------
// POLISH-014 — the season origin.
//
// Every owner starts 0-0 and level, so a series with any plotted week has a
// second endpoint and one resolved week is an ordinary segment. The origin is
// NOT a point: no week number is right for both charts, so each places it in its
// own coordinate system. See `GamesBackSeries.origin`.
// ---------------------------------------------------------------------------

function originHistory(resolvedWeeks: number[]): StandingsHistory {
  const owners = ['Alice', 'Bob'];
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of resolvedWeeks) {
    byWeek[week] = {
      week,
      standings: owners.map((owner, index) => ({
        owner,
        wins: 1,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: index,
        finalGames: 1,
      })),
      coverage: { state: 'complete', message: null },
      played: true,
      pending: [],
    };
  }
  const byOwner: StandingsHistory['byOwner'] = {};
  owners.forEach((owner, index) => {
    byOwner[owner] = resolvedWeeks.map((week) => ({
      week,
      wins: 1,
      losses: 0,
      ties: 0,
      winPct: 1,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: index,
    }));
  });
  return { weeks: resolvedWeeks, byWeek, byOwner };
}

test('POLISH-014: a series with plotted weeks carries the origin', () => {
  const history = originHistory([1]);
  const gb = selectGamesBackTrend({ standingsHistory: history });
  const wp = selectWinPctTrend({ standingsHistory: history });

  assert.equal(gb.length, 2);
  for (const series of gb) assert.equal(series.origin, SEASON_ORIGIN_GAMES_BACK);
  // Win% deliberately has NONE — 0.000 is the floor of that axis, not "level".
  assert.equal(wp.length, 2);
  assert.ok(!('origin' in wp[0]!), 'win% series must not carry an origin');
});

test('POLISH-014: no resolved weeks means no series, and therefore no origin', () => {
  // The origin must never resurrect a chart for a season that has not started.
  const history = originHistory([1]);
  history.byWeek[1] = { ...history.byWeek[1]!, played: false };

  assert.deepEqual(selectGamesBackTrend({ standingsHistory: history }), []);
  assert.deepEqual(selectWinPctTrend({ standingsHistory: history }), []);
});

test('POLISH-014: both point-based selectors gain the origin together', () => {
  // POLISH-012's hook crash came from these two disagreeing about the empty case
  // while sharing a fiber. They must agree about the origin for the same reason.
  for (const weeks of [[1], [1, 2], []]) {
    const history = originHistory(weeks);
    const gb = selectGamesBackTrend({ standingsHistory: history });
    const wp = selectWinPctTrend({ standingsHistory: history });
    assert.equal(
      gb.length,
      wp.length,
      `series count must match for weeks ${JSON.stringify(weeks)}`
    );
    // What must match is the EMPTY case — POLISH-012's hook crash came from these
    // two disagreeing about whether there was anything to draw. The origin
    // asymmetry cannot cause that: it does not change series counts.
  }
});

test('POLISH-014: drawability counts the origin as an endpoint', () => {
  // One plotted week plus the origin is two endpoints — a line.
  assert.equal(isDrawableTrendSeries({ points: [{}], origin: 0 }), true);
  // Without an origin, one point is a moveto-only path that SVG will not draw.
  assert.equal(isDrawableTrendSeries({ points: [{}], origin: null }), false);
  assert.equal(isDrawableTrendSeries({ points: [], origin: 0 }), false);
  assert.equal(isDrawableTrendSeries({ points: [{}, {}], origin: null }), true);
});

test('POLISH-014: the origin applies only when nothing was PLAYED before the first drawn week', () => {
  // Review's HIGH. Comparing against the first RESOLVED week is not the same
  // question: since PLATFORM-105 a week can be played with incomplete coverage,
  // which makes it unresolved and invisible to the trend selectors. Weeks 1-2
  // played but partial and week 3 resolved would have drawn everyone level
  // immediately before W3, after two weeks of football.
  const history = originHistory([1, 2, 3]);
  history.byWeek[1] = {
    ...history.byWeek[1]!,
    played: true,
    coverage: { state: 'partial', message: 'x' },
  };
  history.byWeek[2] = {
    ...history.byWeek[2]!,
    played: true,
    coverage: { state: 'partial', message: 'x' },
  };

  const drawn = selectGamesBackTrend({ standingsHistory: history });
  const firstDrawnWeek = drawn[0]?.points[0]?.week;
  assert.equal(firstDrawnWeek, 3, 'only week 3 resolves, so week 3 is what gets drawn');
  assert.equal(
    seasonOriginApplies(history, firstDrawnWeek),
    false,
    'two played weeks precede it, so nobody was level immediately before W3'
  );

  // And the control: with nothing played before it, the origin is honest.
  const clean = originHistory([1, 2]);
  assert.equal(seasonOriginApplies(clean, 1), true);
});

test('POLISH-014: the origin does not apply to a recent-week window', () => {
  const history = originHistory([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seasonOriginApplies(history, 3), false, 'weeks 1-2 were played');
  assert.equal(seasonOriginApplies(history, undefined), false, 'nothing drawn, nothing to anchor');
});

test('POLISH-014: a postponed game does not hide the week that was played', () => {
  // Review's second-round MEDIUM, and the OPPOSITE polarity of the first.
  // `played` is `realGames.length > 0 && pending.length === 0`, and `pending`
  // retains postponed games — so one postponed week-1 game leaves that week
  // `played: false` PERMANENTLY while its other games have already moved the
  // cumulative standings. Asking `selectPlayedWeeks` therefore saw no football
  // before week 2 and drew everyone level.
  const history = originHistory([1, 2]);
  history.byWeek[1] = {
    ...history.byWeek[1]!,
    played: false,
    pending: [{ key: 'postponed', week: 1, kickoff: null }],
  };

  // Week 1 is not drawn (unresolved), but its results exist.
  assert.ok(
    history.byWeek[1]!.standings.some((row) => row.finalGames > 0),
    'the fixture must carry week-1 results, or it proves nothing'
  );
  assert.equal(
    seasonOriginApplies(history, 2),
    false,
    'games concluded in week 1, so nobody was level immediately before W2'
  );
});

test('POLISH-014: a genuinely unplayed leading week does not block the origin', () => {
  // The control for the test above: a week with no results is not evidence of
  // football, so the origin remains honest.
  const history = originHistory([1, 2]);
  history.byWeek[1] = {
    ...history.byWeek[1]!,
    played: false,
    standings: history.byWeek[1]!.standings.map((row) => ({
      ...row,
      wins: 0,
      losses: 0,
      finalGames: 0,
      gamesBack: 0,
    })),
  };

  assert.equal(seasonOriginApplies(history, 2), true);
});
