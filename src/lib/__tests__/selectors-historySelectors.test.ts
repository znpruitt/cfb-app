import assert from 'node:assert/strict';
import test from 'node:test';

import { selectOwnerCareer, type OwnerCareerExtras } from '../selectors/historySelectors.ts';
import type { SeasonArchive } from '../seasonArchive.ts';

function makeArchive(year: number, finalStandings: SeasonArchive['finalStandings']): SeasonArchive {
  return {
    leagueSlug: 'test',
    year,
    archivedAt: '2026-01-01T00:00:00.000Z',
    ownerRosterSnapshot: '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings,
    games: [],
    scoresByKey: {},
  };
}

function row(
  owner: string,
  wins: number,
  losses: number,
  pointsFor: number,
  pointsAgainst: number
): SeasonArchive['finalStandings'][number] {
  return {
    owner,
    wins,
    losses,
    ties: 0,
    winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
    pointsFor,
    pointsAgainst,
    pointDifferential: pointsFor - pointsAgainst,
    gamesBack: 0,
    finalGames: wins + losses,
  };
}

test('selectOwnerCareer aggregates new career stat fields from archives', () => {
  const archives: SeasonArchive[] = [
    makeArchive(2024, [row('Alice', 10, 4, 420, 380), row('Bob', 8, 6, 360, 400)]),
    makeArchive(2025, [row('Alice', 12, 2, 500, 350), row('Bob', 6, 8, 340, 400)]),
  ];

  const career = selectOwnerCareer(archives, 'Alice');

  assert.equal(career.totalWins, 22);
  assert.equal(career.totalLosses, 6);
  assert.equal(career.championships, 2);
  assert.equal(career.seasonsPlayed, 2);
  assert.equal(career.totalPoints, 920);
  assert.equal(career.totalPointsAgainst, 730);
  assert.equal(career.totalPointDifferential, 190);
  assert.equal(career.firstSeason, 2024);
  assert.equal(career.isRookie, false);
  // Without extras, optional stats are null
  assert.equal(career.totalTurnoverMargin, null);
  assert.equal(career.totalYards, null);
});

test('selectOwnerCareer reports isRookie true when only one season played', () => {
  const archives: SeasonArchive[] = [
    makeArchive(2025, [row('Carol', 11, 3, 480, 360), row('Dan', 5, 9, 320, 410)]),
  ];

  const career = selectOwnerCareer(archives, 'Carol');
  assert.equal(career.seasonsPlayed, 1);
  assert.equal(career.isRookie, true);
  assert.equal(career.firstSeason, 2025);
});

test('selectOwnerCareer populates totalTurnoverMargin and totalYards from extras map', () => {
  const archives: SeasonArchive[] = [
    makeArchive(2025, [row('Eve', 9, 5, 380, 360), row('Frank', 7, 7, 350, 360)]),
  ];

  const extras: OwnerCareerExtras = new Map([
    ['Eve', { totalYards: 5200, totalTurnoverMargin: 12 }],
  ]);

  const career = selectOwnerCareer(archives, 'Eve', extras);
  assert.equal(career.totalYards, 5200);
  assert.equal(career.totalTurnoverMargin, 12);
});

test('selectOwnerCareer leaves extras null when owner is absent from extras map', () => {
  const archives: SeasonArchive[] = [
    makeArchive(2025, [row('Grace', 9, 5, 380, 360), row('Henry', 7, 7, 350, 360)]),
  ];

  const extras: OwnerCareerExtras = new Map([
    ['Grace', { totalYards: 4800, totalTurnoverMargin: 6 }],
  ]);

  const career = selectOwnerCareer(archives, 'Henry', extras);
  assert.equal(career.totalYards, null);
  assert.equal(career.totalTurnoverMargin, null);
});

test('selectOwnerCareer returns zero-state result for owner not in any archive', () => {
  const archives: SeasonArchive[] = [makeArchive(2025, [row('Alice', 10, 4, 400, 380)])];

  const career = selectOwnerCareer(archives, 'Unknown');
  assert.equal(career.seasonsPlayed, 0);
  assert.equal(career.totalWins, 0);
  assert.equal(career.totalPoints, 0);
  assert.equal(career.firstSeason, null);
  assert.equal(career.isRookie, true);
});
