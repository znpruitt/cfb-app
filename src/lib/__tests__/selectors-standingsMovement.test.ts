import assert from 'node:assert/strict';
import test from 'node:test';

import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory } from '../standingsHistory';
import { deriveStandingsMovementByOwner } from '../selectors/standingsMovement';

function row(
  owner: string,
  wins: number,
  losses: number,
  pointDifferential: number
): OwnerStandingsRow {
  return {
    owner,
    wins,
    losses,
    winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
    pointsFor: 100,
    pointsAgainst: 100 - pointDifferential,
    pointDifferential,
    gamesBack: 0,
    finalGames: wins + losses,
  };
}

function historyFromSnapshots(
  snapshots: Array<{
    week: number;
    coverageState?: 'complete' | 'partial' | 'error';
    standings: OwnerStandingsRow[];
  }>
): StandingsHistory {
  return {
    weeks: snapshots.map((snapshot) => snapshot.week),
    byWeek: Object.fromEntries(
      snapshots.map((snapshot) => [
        snapshot.week,
        {
          week: snapshot.week,
          coverage: { state: snapshot.coverageState ?? 'complete', message: null },
          standings: snapshot.standings.map((standing) => ({ ...standing, ties: 0 })),
        },
      ])
    ),
    byOwner: {},
  };
}

test('deriveStandingsMovementByOwner computes up, down, unchanged, and no-prior movement', () => {
  const currentRows = [
    row('Bravo', 4, 1, 20),
    row('Alpha', 4, 1, 15),
    row('Charlie', 2, 3, -10),
    row('Delta', 1, 4, -20),
  ];

  const standingsHistory = historyFromSnapshots([
    {
      week: 5,
      standings: [row('Alpha', 3, 1, 12), row('Bravo', 3, 1, 9), row('Charlie', 2, 2, -2)],
    },
    {
      week: 6,
      standings: currentRows,
    },
  ]);

  const movement = deriveStandingsMovementByOwner({
    rows: currentRows,
    standingsHistory,
  });

  assert.equal(movement.Bravo?.currentRank, 1);
  assert.equal(movement.Bravo?.previousRank, 2);
  assert.equal(movement.Bravo?.rankDelta, 1);

  assert.equal(movement.Alpha?.currentRank, 2);
  assert.equal(movement.Alpha?.previousRank, 1);
  assert.equal(movement.Alpha?.rankDelta, -1);

  assert.equal(movement.Charlie?.currentRank, 3);
  assert.equal(movement.Charlie?.previousRank, 3);
  assert.equal(movement.Charlie?.rankDelta, 0);

  assert.equal(movement.Delta?.currentRank, 4);
  assert.equal(movement.Delta?.previousRank, null);
  assert.equal(movement.Delta?.rankDelta, null);
});

test('deriveStandingsMovementByOwner uses previous resolved week when latest week is partial', () => {
  const currentRows = [row('Alpha', 5, 1, 24), row('Bravo', 5, 1, 22)];

  const standingsHistory = historyFromSnapshots([
    {
      week: 6,
      standings: [row('Alpha', 4, 1, 18), row('Bravo', 4, 1, 12)],
    },
    {
      week: 7,
      coverageState: 'partial',
      standings: [row('Bravo', 5, 1, 21), row('Alpha', 5, 1, 20)],
    },
    {
      week: 8,
      standings: currentRows,
    },
  ]);

  const movement = deriveStandingsMovementByOwner({ rows: currentRows, standingsHistory });

  assert.equal(movement.Alpha?.previousRank, 1);
  assert.equal(movement.Alpha?.rankDelta, 0);
  assert.equal(movement.Bravo?.previousRank, 2);
  assert.equal(movement.Bravo?.rankDelta, 0);
});

test('deriveStandingsMovementByOwner follows canonical ranking order for tie-like records', () => {
  const previousRows = [row('Alpha', 3, 1, 5), row('Bravo', 3, 1, 4), row('Charlie', 3, 1, 3)];

  const currentRows = [row('Charlie', 4, 1, 7), row('Alpha', 4, 1, 6), row('Bravo', 4, 1, 5)];

  const standingsHistory = historyFromSnapshots([
    { week: 4, standings: previousRows },
    { week: 5, standings: currentRows },
  ]);

  const movement = deriveStandingsMovementByOwner({ rows: currentRows, standingsHistory });

  assert.equal(movement.Charlie?.rankDelta, 2);
  assert.equal(movement.Alpha?.rankDelta, -1);
  assert.equal(movement.Bravo?.rankDelta, -1);
});

test('deriveStandingsMovementByOwner returns null movement when no prior resolved week exists', () => {
  const currentRows = [row('Alpha', 1, 0, 7), row('Bravo', 0, 1, -7)];
  const standingsHistory = historyFromSnapshots([{ week: 1, standings: currentRows }]);

  const movement = deriveStandingsMovementByOwner({ rows: currentRows, standingsHistory });

  assert.equal(movement.Alpha?.rankDelta, null);
  assert.equal(movement.Bravo?.rankDelta, null);
});
