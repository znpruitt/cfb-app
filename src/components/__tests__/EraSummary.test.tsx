import assert from 'node:assert/strict';
import test from 'node:test';

import { computeEraSummaryStats } from '../history/EraSummary.tsx';
import type { SeasonArchive } from '../../lib/seasonArchive';
import type { AllTimeStandingRow, ChampionshipEntry } from '../../lib/selectors/historySelectors';

function makeArchive(year: number): SeasonArchive {
  return {
    leagueSlug: 'tsc',
    year,
    archivedAt: '2025-01-01T00:00:00Z',
    ownerRosterSnapshot: '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  };
}

function makeStanding(
  owner: string,
  championships: number,
  overrides: Partial<AllTimeStandingRow> = {}
): AllTimeStandingRow {
  return {
    owner,
    totalWins: 0,
    totalLosses: 0,
    winPct: 0,
    championships,
    seasonsPlayed: 1,
    avgFinish: 1,
    totalPointDifferential: 0,
    ...overrides,
  };
}

test('EraSummary: 8 seasons across 2018-2025 with 4 distinct champions', () => {
  const archives = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(makeArchive);
  const championshipHistory: ChampionshipEntry[] = [
    { year: 2018, champion: 'Hardiman' },
    { year: 2019, champion: 'Whited' },
    { year: 2020, champion: 'Pruitt' },
    { year: 2021, champion: 'BHooper' },
    { year: 2022, champion: 'Whited' },
    { year: 2023, champion: 'Pruitt' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const allTimeStandings: AllTimeStandingRow[] = [
    makeStanding('Pruitt', 3),
    makeStanding('Whited', 3),
    makeStanding('Hardiman', 1),
    makeStanding('BHooper', 1),
    makeStanding('Maleski', 0),
    makeStanding('Klabunde', 0),
    makeStanding('Hopkins', 0),
    makeStanding('Daniels', 0),
  ];
  const activeOwners = new Set([
    'Pruitt',
    'Whited',
    'Hardiman',
    'BHooper',
    'Maleski',
    'Klabunde',
    'Hopkins',
    'Daniels',
  ]);

  const stats = computeEraSummaryStats({
    archives,
    championshipHistory,
    allTimeStandings,
    activeOwners,
  });

  assert.equal(stats.yearRange, '2018–2025');
  assert.equal(stats.seasonCount, 8);
  assert.equal(stats.championCount, 4);
  assert.equal(stats.ownersChasingFirstTitle, 4);
});

test('EraSummary: single-season league shows year (no range) and 1 champion', () => {
  const stats = computeEraSummaryStats({
    archives: [makeArchive(2024)],
    championshipHistory: [{ year: 2024, champion: 'Pruitt' }],
    allTimeStandings: [makeStanding('Pruitt', 1), makeStanding('Whited', 0)],
    activeOwners: new Set(['Pruitt', 'Whited']),
  });

  assert.equal(stats.yearRange, '2024');
  assert.equal(stats.seasonCount, 1);
  assert.equal(stats.championCount, 1);
  assert.equal(stats.ownersChasingFirstTitle, 1);
});

test('EraSummary: empty archives returns null year range and zeroes', () => {
  const stats = computeEraSummaryStats({
    archives: [],
    championshipHistory: [],
    allTimeStandings: [],
    activeOwners: new Set<string>(),
  });

  assert.equal(stats.yearRange, null);
  assert.equal(stats.seasonCount, 0);
  assert.equal(stats.championCount, 0);
  assert.equal(stats.ownersChasingFirstTitle, 0);
});

test('EraSummary: ownersChasingFirstTitle excludes former owners (not in activeOwners)', () => {
  const stats = computeEraSummaryStats({
    archives: [makeArchive(2024)],
    championshipHistory: [{ year: 2024, champion: 'Pruitt' }],
    allTimeStandings: [
      makeStanding('Pruitt', 1),
      makeStanding('FormerOwner', 0), // 0 titles but not in active set
      makeStanding('ActiveOwner', 0), // 0 titles and active
    ],
    activeOwners: new Set(['Pruitt', 'ActiveOwner']),
  });

  assert.equal(stats.ownersChasingFirstTitle, 1);
});

test('EraSummary: distinct champion count uses unique names, not entry count', () => {
  const stats = computeEraSummaryStats({
    archives: [2022, 2023, 2024, 2025].map(makeArchive),
    championshipHistory: [
      { year: 2022, champion: 'Whited' },
      { year: 2023, champion: 'Whited' },
      { year: 2024, champion: 'Pruitt' },
      { year: 2025, champion: 'Whited' },
    ],
    allTimeStandings: [makeStanding('Whited', 3), makeStanding('Pruitt', 1)],
    activeOwners: new Set(['Whited', 'Pruitt']),
  });

  assert.equal(stats.seasonCount, 4);
  assert.equal(stats.championCount, 2);
});
