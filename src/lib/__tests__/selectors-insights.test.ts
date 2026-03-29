import assert from 'node:assert/strict';
import test from 'node:test';

import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory, StandingsHistoryStandingRow } from '../standingsHistory';
import {
  deriveLeagueInsights,
  deriveOverviewInsights,
  deriveStandingsInsights,
  type Insight,
} from '../selectors/insights';

function standingsRow(
  owner: string,
  wins: number,
  losses: number,
  gamesBack: number,
  pointDifferential: number
): OwnerStandingsRow {
  const games = wins + losses;
  return {
    owner,
    wins,
    losses,
    winPct: games > 0 ? wins / games : 0,
    pointsFor: 100 + wins * 10,
    pointsAgainst: 100 + losses * 10,
    pointDifferential,
    gamesBack,
    finalGames: games,
  };
}

function snapshotRow(
  owner: string,
  rank: number,
  wins: number,
  gamesBack: number
): StandingsHistoryStandingRow {
  return {
    owner,
    wins,
    losses: Math.max(0, rank + 1 - wins),
    ties: 0,
    winPct: wins / Math.max(1, rank + 1),
    pointsFor: 100 + wins * 8,
    pointsAgainst: 100 + rank * 4,
    pointDifferential: wins * 6 - rank,
    gamesBack,
    finalGames: rank + 1,
  };
}

function historyFixture(): StandingsHistory {
  const weeks = [1, 2, 3, 4];
  const byWeek = {
    1: {
      week: 1,
      standings: [
        snapshotRow('Alex', 1, 1, 0),
        snapshotRow('Blake', 2, 1, 0),
        snapshotRow('Casey', 3, 0, 1),
        snapshotRow('Drew', 4, 0, 1),
      ],
      coverage: { state: 'complete' as const, message: null },
    },
    2: {
      week: 2,
      standings: [
        snapshotRow('Alex', 1, 2, 0),
        snapshotRow('Casey', 2, 2, 0),
        snapshotRow('Blake', 3, 1, 1),
        snapshotRow('Drew', 4, 0, 2),
      ],
      coverage: { state: 'complete' as const, message: null },
    },
    3: {
      week: 3,
      standings: [
        snapshotRow('Casey', 1, 3, 0),
        snapshotRow('Alex', 2, 2, 1),
        snapshotRow('Drew', 3, 1, 2),
        snapshotRow('Blake', 4, 1, 2),
      ],
      coverage: { state: 'complete' as const, message: null },
    },
    4: {
      week: 4,
      standings: [
        snapshotRow('Drew', 1, 4, 0),
        snapshotRow('Casey', 2, 3, 1),
        snapshotRow('Blake', 3, 2, 2),
        snapshotRow('Alex', 4, 1, 3),
      ],
      coverage: { state: 'complete' as const, message: null },
    },
  };

  return {
    weeks,
    byWeek,
    byOwner: {
      Alex: [
        {
          week: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 108,
          pointsAgainst: 100,
          pointDifferential: 8,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 116,
          pointsAgainst: 104,
          pointDifferential: 12,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 2,
          losses: 1,
          ties: 0,
          winPct: 0.667,
          pointsFor: 124,
          pointsAgainst: 112,
          pointDifferential: 12,
          gamesBack: 1,
        },
        {
          week: 4,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 132,
          pointsAgainst: 120,
          pointDifferential: 12,
          gamesBack: 3,
        },
      ],
      Blake: [
        {
          week: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 106,
          pointsAgainst: 100,
          pointDifferential: 6,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 112,
          pointsAgainst: 108,
          pointDifferential: 4,
          gamesBack: 1,
        },
        {
          week: 3,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 118,
          pointsAgainst: 117,
          pointDifferential: 1,
          gamesBack: 2,
        },
        {
          week: 4,
          wins: 2,
          losses: 2,
          ties: 0,
          winPct: 0.5,
          pointsFor: 124,
          pointsAgainst: 126,
          pointDifferential: -2,
          gamesBack: 2,
        },
      ],
      Casey: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 100,
          pointsAgainst: 108,
          pointDifferential: -8,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 118,
          pointsAgainst: 104,
          pointDifferential: 14,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 126,
          pointsAgainst: 108,
          pointDifferential: 18,
          gamesBack: 0,
        },
        {
          week: 4,
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 134,
          pointsAgainst: 112,
          pointDifferential: 22,
          gamesBack: 1,
        },
      ],
      Drew: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 99,
          pointsAgainst: 110,
          pointDifferential: -11,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 0,
          losses: 2,
          ties: 0,
          winPct: 0,
          pointsFor: 104,
          pointsAgainst: 118,
          pointDifferential: -14,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 112,
          pointsAgainst: 121,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 4,
          wins: 4,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 120,
          pointsAgainst: 124,
          pointDifferential: -4,
          gamesBack: 0,
        },
      ],
    },
  };
}

test('deriveLeagueInsights emits deterministic ranked insights with stable ordering', () => {
  const rows = [
    standingsRow('Drew', 4, 0, 0, -4),
    standingsRow('Casey', 3, 1, 1, 22),
    standingsRow('Blake', 2, 2, 2, -2),
    standingsRow('Alex', 1, 3, 3, 12),
  ];
  const standingsHistory = historyFixture();

  const once = deriveLeagueInsights({ rows, standingsHistory, seasonContext: 'in-season' });
  const twice = deriveLeagueInsights({ rows, standingsHistory, seasonContext: 'in-season' });

  assert.deepEqual(once, twice);
  assert.ok(once.length >= 4);
  assert.equal(new Set(once.map((entry) => entry.id)).size, once.length);
  assert.ok(once.some((entry) => entry.type === 'movement' && /rise/i.test(entry.title)));
  assert.ok(once.some((entry) => entry.type === 'collapse' && /drop/i.test(entry.title)));
  assert.ok(once.some((entry) => entry.type === 'surge'));
  assert.ok(once.some((entry) => entry.type === 'toilet_bowl'));
  assert.ok(once.some((entry) => entry.type === 'race'));

  for (let index = 1; index < once.length; index += 1) {
    assert.ok((once[index - 1]?.score ?? 0) >= (once[index]?.score ?? 0));
  }
});

test('deriveLeagueInsights handles early season and no prior movement without false movement headlines', () => {
  const earlyHistory: StandingsHistory = {
    weeks: [1],
    byWeek: {
      1: {
        week: 1,
        standings: [snapshotRow('Alex', 1, 1, 0), snapshotRow('Blake', 2, 0, 1)],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Alex: [
        {
          week: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 100,
          pointsAgainst: 90,
          pointDifferential: 10,
          gamesBack: 0,
        },
      ],
      Blake: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 90,
          pointsAgainst: 100,
          pointDifferential: -10,
          gamesBack: 1,
        },
      ],
    },
  };

  const insights = deriveLeagueInsights({
    rows: [standingsRow('Alex', 1, 0, 0, 10), standingsRow('Blake', 0, 1, 1, -10)],
    standingsHistory: earlyHistory,
    seasonContext: 'in-season',
  });

  assert.equal(
    insights.some((entry) => entry.type === 'movement'),
    false
  );
  assert.equal(
    insights.some((entry) => entry.type === 'collapse'),
    false
  );
  assert.equal(
    insights.some((entry) => entry.type === 'surge'),
    false
  );
  assert.equal(
    insights.some((entry) => entry.type === 'race'),
    true
  );
});

test('deriveLeagueInsights omits tight race insight when season context is final', () => {
  const insights = deriveLeagueInsights({
    rows: [standingsRow('Alex', 9, 3, 0, 30), standingsRow('Blake', 8, 4, 1, 24)],
    standingsHistory: historyFixture(),
    seasonContext: 'final',
  });

  assert.equal(
    insights.some((entry) => entry.type === 'race'),
    false
  );
});

test('deriveLeagueInsights resolves toilet bowl ties deterministically by owner name', () => {
  const tiedHistory: StandingsHistory = {
    weeks: [1, 2, 3, 4],
    byWeek: {
      1: {
        week: 1,
        standings: [
          snapshotRow('Alex', 1, 1, 0),
          snapshotRow('Casey', 2, 0, 1),
          snapshotRow('Blake', 3, 0, 1),
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          snapshotRow('Alex', 1, 2, 0),
          snapshotRow('Blake', 2, 1, 1),
          snapshotRow('Casey', 3, 0, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [
          snapshotRow('Alex', 1, 3, 0),
          snapshotRow('Casey', 2, 1, 2),
          snapshotRow('Blake', 3, 0, 3),
        ],
        coverage: { state: 'complete', message: null },
      },
      4: {
        week: 4,
        standings: [
          snapshotRow('Alex', 1, 4, 0),
          snapshotRow('Blake', 2, 2, 2),
          snapshotRow('Casey', 3, 1, 3),
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Alex: [],
      Blake: [],
      Casey: [],
    },
  };

  const insights = deriveLeagueInsights({
    rows: [
      standingsRow('Alex', 2, 0, 0, 12),
      standingsRow('Blake', 1, 1, 1, 0),
      standingsRow('Casey', 0, 2, 2, -12),
    ],
    standingsHistory: tiedHistory,
    seasonContext: 'in-season',
  });

  const toiletBowl = insights.find((entry) => entry.type === 'toilet_bowl');
  assert.ok(toiletBowl);
  assert.deepEqual(toiletBowl?.owners, ['Blake']);
});

test('deriveLeagueInsights picks best qualifying surge candidate instead of returning null early', () => {
  const standingsHistory: StandingsHistory = {
    weeks: [1, 2, 3],
    byWeek: {
      1: {
        week: 1,
        standings: [snapshotRow('Alex', 1, 2, 0), snapshotRow('Blake', 2, 1, 1)],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [snapshotRow('Alex', 1, 3, 0), snapshotRow('Blake', 2, 1, 2)],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [snapshotRow('Alex', 1, 3, 1), snapshotRow('Blake', 2, 1, 0)],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Alex: [
        {
          week: 1,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 120,
          pointsAgainst: 100,
          pointDifferential: 20,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 130,
          pointsAgainst: 105,
          pointDifferential: 25,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 138,
          pointsAgainst: 122,
          pointDifferential: 16,
          gamesBack: 1,
        },
      ],
      Blake: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 108,
          pointsAgainst: 110,
          pointDifferential: -2,
          gamesBack: 2,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 114,
          pointsAgainst: 123,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 121,
          pointsAgainst: 129,
          pointDifferential: -8,
          gamesBack: 1,
        },
      ],
    },
  };

  const insights = deriveLeagueInsights({
    rows: [standingsRow('Alex', 3, 1, 0, 16), standingsRow('Blake', 1, 3, 3, -8)],
    standingsHistory,
    seasonContext: 'final',
  });

  const surge = insights.find((entry) => entry.type === 'surge');
  assert.ok(surge);
  assert.deepEqual(surge?.owners, ['Blake']);
});

test('deriveLeagueInsights ranks multiple qualifying surge candidates deterministically', () => {
  const standingsHistory = historyFixture();
  const insights = deriveLeagueInsights({
    rows: [
      standingsRow('Drew', 4, 0, 0, -4),
      standingsRow('Casey', 3, 1, 1, 22),
      standingsRow('Blake', 2, 2, 2, -2),
      standingsRow('Alex', 1, 3, 3, 12),
    ],
    standingsHistory,
    seasonContext: 'in-season',
  });

  const surge = insights.find((entry) => entry.type === 'surge');
  assert.ok(surge);
  assert.deepEqual(surge?.owners, ['Drew']);
});

test('deriveLeagueInsights omits surge when no candidate qualifies', () => {
  const standingsHistory: StandingsHistory = {
    weeks: [1, 2, 3],
    byWeek: {
      1: {
        week: 1,
        standings: [
          snapshotRow('Alex', 1, 2, 0),
          snapshotRow('Blake', 2, 1, 1),
          snapshotRow('Casey', 3, 1, 1),
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          snapshotRow('Alex', 1, 3, 0),
          snapshotRow('Blake', 2, 1, 2),
          snapshotRow('Casey', 3, 1, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [
          snapshotRow('Alex', 1, 3, 0),
          snapshotRow('Blake', 2, 1, 2),
          snapshotRow('Casey', 3, 1, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Alex: [
        {
          week: 1,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 120,
          pointsAgainst: 100,
          pointDifferential: 20,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 130,
          pointsAgainst: 105,
          pointDifferential: 25,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 3,
          losses: 1,
          ties: 0,
          winPct: 0.75,
          pointsFor: 138,
          pointsAgainst: 122,
          pointDifferential: 16,
          gamesBack: 0,
        },
      ],
      Blake: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 108,
          pointsAgainst: 110,
          pointDifferential: -2,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 114,
          pointsAgainst: 123,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 121,
          pointsAgainst: 129,
          pointDifferential: -8,
          gamesBack: 2,
        },
      ],
      Casey: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 109,
          pointsAgainst: 111,
          pointDifferential: -2,
          gamesBack: 1,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 115,
          pointsAgainst: 124,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 122,
          pointsAgainst: 130,
          pointDifferential: -8,
          gamesBack: 2,
        },
      ],
    },
  };

  const insights = deriveLeagueInsights({
    rows: [
      standingsRow('Alex', 3, 1, 0, 16),
      standingsRow('Blake', 1, 3, 2, -8),
      standingsRow('Casey', 1, 3, 2, -8),
    ],
    standingsHistory,
    seasonContext: 'final',
  });

  assert.equal(
    insights.some((entry) => entry.type === 'surge'),
    false
  );
});

test('deriveLeagueInsights uses stable mixed-signal ordering for surge candidates', () => {
  const standingsHistory: StandingsHistory = {
    weeks: [1, 2, 3],
    byWeek: {
      1: {
        week: 1,
        standings: [
          snapshotRow('WinsOnly', 1, 2, 0),
          snapshotRow('GamesBackOnly', 2, 1, 2),
          snapshotRow('Neutral', 3, 1, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          snapshotRow('WinsOnly', 1, 3, 0),
          snapshotRow('GamesBackOnly', 2, 1, 2),
          snapshotRow('Neutral', 3, 1, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [
          snapshotRow('GamesBackOnly', 1, 1, 1),
          snapshotRow('WinsOnly', 2, 4, 2),
          snapshotRow('Neutral', 3, 1, 3),
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      WinsOnly: [
        {
          week: 1,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 120,
          pointsAgainst: 100,
          pointDifferential: 20,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 130,
          pointsAgainst: 105,
          pointDifferential: 25,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 4,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 138,
          pointsAgainst: 110,
          pointDifferential: 28,
          gamesBack: 2,
        },
      ],
      GamesBackOnly: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 108,
          pointsAgainst: 110,
          pointDifferential: -2,
          gamesBack: 2,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 114,
          pointsAgainst: 123,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 121,
          pointsAgainst: 129,
          pointDifferential: -8,
          gamesBack: 1,
        },
      ],
      Neutral: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 109,
          pointsAgainst: 111,
          pointDifferential: -2,
          gamesBack: 2,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 115,
          pointsAgainst: 124,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 122,
          pointsAgainst: 130,
          pointDifferential: -8,
          gamesBack: 3,
        },
      ],
    },
  };

  const insights = deriveLeagueInsights({
    rows: [
      standingsRow('GamesBackOnly', 1, 3, 0, -8),
      standingsRow('WinsOnly', 4, 0, 1, 28),
      standingsRow('Neutral', 1, 3, 3, -8),
    ],
    standingsHistory,
    seasonContext: 'final',
  });

  const surge = insights.find((entry) => entry.type === 'surge');
  assert.ok(surge);
  assert.deepEqual(surge?.owners, ['WinsOnly']);
});

test('deriveLeagueInsights surge selection is deterministic for identical mixed-signal input', () => {
  const standingsHistory: StandingsHistory = {
    weeks: [1, 2, 3],
    byWeek: {
      1: {
        week: 1,
        standings: [
          snapshotRow('A', 1, 2, 0),
          snapshotRow('B', 2, 1, 2),
          snapshotRow('C', 3, 1, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
      2: {
        week: 2,
        standings: [
          snapshotRow('A', 1, 3, 0),
          snapshotRow('B', 2, 1, 2),
          snapshotRow('C', 3, 1, 2),
        ],
        coverage: { state: 'complete', message: null },
      },
      3: {
        week: 3,
        standings: [
          snapshotRow('B', 1, 1, 1),
          snapshotRow('A', 2, 4, 1),
          snapshotRow('C', 3, 1, 3),
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      A: [
        {
          week: 1,
          wins: 2,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 120,
          pointsAgainst: 100,
          pointDifferential: 20,
          gamesBack: 0,
        },
        {
          week: 2,
          wins: 3,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 130,
          pointsAgainst: 105,
          pointDifferential: 25,
          gamesBack: 0,
        },
        {
          week: 3,
          wins: 4,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 138,
          pointsAgainst: 110,
          pointDifferential: 28,
          gamesBack: 1,
        },
      ],
      B: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 108,
          pointsAgainst: 110,
          pointDifferential: -2,
          gamesBack: 2,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 114,
          pointsAgainst: 123,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 121,
          pointsAgainst: 129,
          pointDifferential: -8,
          gamesBack: 1,
        },
      ],
      C: [
        {
          week: 1,
          wins: 1,
          losses: 1,
          ties: 0,
          winPct: 0.5,
          pointsFor: 109,
          pointsAgainst: 111,
          pointDifferential: -2,
          gamesBack: 2,
        },
        {
          week: 2,
          wins: 1,
          losses: 2,
          ties: 0,
          winPct: 0.333,
          pointsFor: 115,
          pointsAgainst: 124,
          pointDifferential: -9,
          gamesBack: 2,
        },
        {
          week: 3,
          wins: 1,
          losses: 3,
          ties: 0,
          winPct: 0.25,
          pointsFor: 122,
          pointsAgainst: 130,
          pointDifferential: -8,
          gamesBack: 3,
        },
      ],
    },
  };

  const input = {
    rows: [
      standingsRow('B', 1, 3, 0, -8),
      standingsRow('A', 4, 0, 1, 28),
      standingsRow('C', 1, 3, 3, -8),
    ],
    standingsHistory,
    seasonContext: 'final' as const,
  };

  const first = deriveLeagueInsights(input);
  const second = deriveLeagueInsights(input);

  const firstSurge = first.find((entry) => entry.type === 'surge');
  const secondSurge = second.find((entry) => entry.type === 'surge');
  assert.deepEqual(firstSurge, secondSurge);
  assert.deepEqual(first, second);
});

test('deriveOverviewInsights returns top 3 unique insights in input order', () => {
  const insights: Insight[] = [
    { id: 'a', type: 'race', title: 'A', description: 'A', score: 90, owners: ['A'] },
    { id: 'b', type: 'surge', title: 'B', description: 'B', score: 80, owners: ['B'] },
    { id: 'b', type: 'surge', title: 'B2', description: 'B2', score: 70, owners: ['B'] },
    { id: 'c', type: 'collapse', title: 'C', description: 'C', score: 60, owners: ['C'] },
    { id: 'd', type: 'movement', title: 'D', description: 'D', score: 50, owners: ['D'] },
  ];

  assert.deepEqual(
    deriveOverviewInsights(insights).map((entry) => entry.id),
    ['a', 'b', 'c']
  );
});

test('deriveStandingsInsights filters to standings-relevant types and caps at 2 unique insights', () => {
  const insights: Insight[] = [
    { id: 'move', type: 'movement', title: 'Move', description: 'Move', score: 90, owners: ['A'] },
    { id: 'race', type: 'race', title: 'Race', description: 'Race', score: 88, owners: ['A', 'B'] },
    {
      id: 'collapse',
      type: 'collapse',
      title: 'Collapse',
      description: 'Collapse',
      score: 86,
      owners: ['C'],
    },
    {
      id: 'collapse',
      type: 'collapse',
      title: 'Collapse duplicate',
      description: 'Collapse duplicate',
      score: 85,
      owners: ['C'],
    },
    {
      id: 'toilet',
      type: 'toilet_bowl',
      title: 'Toilet',
      description: 'Toilet',
      score: 84,
      owners: ['D'],
    },
  ];

  assert.deepEqual(
    deriveStandingsInsights(insights).map((entry) => entry.id),
    ['race', 'collapse']
  );
});
