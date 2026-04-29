import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeChampionshipSummary,
  groupChampionsByOwner,
  selectMarqueeRecords,
  selectMovers,
  selectRecentPodiums,
  selectSeasonArchiveStrip,
  selectStreaksOrDroughts,
  selectTitleDroughts,
  selectTitleStreaks,
} from '../historyOverview';
import type { LeagueRecords, RecordEntry } from '../leagueRecords';
import type {
  AllTimeStandingRow,
  ChampionshipEntry,
  DynastyDroughtRow,
  MostImprovedEntry,
} from '../historySelectors';
import type { SeasonArchive } from '../../seasonArchive';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeArchive(
  year: number,
  finalStandings: Array<{ owner: string; wins: number; losses: number; gamesBack: number }>
): SeasonArchive {
  return {
    leagueSlug: 'tsc',
    year,
    archivedAt: '2025-01-01T00:00:00Z',
    ownerRosterSnapshot: '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: finalStandings.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      ties: 0,
      winPct: row.wins / Math.max(1, row.wins + row.losses),
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: row.gamesBack,
      finalGames: row.wins + row.losses,
    })),
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
    totalWins: 100,
    totalLosses: 80,
    winPct: 0.555,
    championships,
    seasonsPlayed: 4,
    avgFinish: 3.5,
    totalPointDifferential: 50,
    ...overrides,
  };
}

function makeRecord(category: RecordEntry['category'], id: string): RecordEntry {
  return {
    id,
    category,
    label: `${category} record ${id}`,
    holders: ['Pruitt'],
    value: 100,
    formattedValue: '100',
    gapToSecond: 5,
    secondPlace: { owners: ['Whited'], value: 95 },
  };
}

// ---------------------------------------------------------------------------
// groupChampionsByOwner
// ---------------------------------------------------------------------------

test('groupChampionsByOwner: groups years per owner and sorts by title count desc', () => {
  const history: ChampionshipEntry[] = [
    { year: 2018, champion: 'Hardiman' },
    { year: 2021, champion: 'BHooper' },
    { year: 2022, champion: 'Whited' },
    { year: 2023, champion: 'Pruitt' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const rows = groupChampionsByOwner(history);

  assert.equal(rows.length, 4);
  assert.equal(rows[0]!.owner, 'Pruitt');
  assert.equal(rows[0]!.titleCount, 2);
  assert.deepEqual(rows[0]!.years, [2023, 2025]);
  assert.equal(rows[1]!.owner, 'Whited');
  assert.equal(rows[1]!.titleCount, 2);
  assert.deepEqual(rows[1]!.years, [2022, 2024]);
});

test('groupChampionsByOwner: ties on title count broken by most recent year desc', () => {
  const history: ChampionshipEntry[] = [
    { year: 2018, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const rows = groupChampionsByOwner(history);

  // Both have 1 title; Pruitt's year (2025) is more recent than Whited's (2018)
  assert.equal(rows[0]!.owner, 'Pruitt');
  assert.equal(rows[1]!.owner, 'Whited');
});

test('groupChampionsByOwner: marks the most-recent-year holder as reigning', () => {
  const history: ChampionshipEntry[] = [
    { year: 2023, champion: 'Pruitt' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const rows = groupChampionsByOwner(history);

  const pruitt = rows.find((r) => r.owner === 'Pruitt')!;
  const whited = rows.find((r) => r.owner === 'Whited')!;
  assert.equal(pruitt.isReigning, true);
  assert.equal(whited.isReigning, false);
});

test('groupChampionsByOwner: empty history returns empty array', () => {
  assert.deepEqual(groupChampionsByOwner([]), []);
});

test('groupChampionsByOwner: skips Unknown champions', () => {
  const history: ChampionshipEntry[] = [
    { year: 2024, champion: 'Unknown' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const rows = groupChampionsByOwner(history);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.owner, 'Pruitt');
});

// ---------------------------------------------------------------------------
// computeChampionshipSummary
// ---------------------------------------------------------------------------

test('computeChampionshipSummary: counts champions, seasons, and active owners with 0 titles', () => {
  const history: ChampionshipEntry[] = [
    { year: 2023, champion: 'Pruitt' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const ownerRows = groupChampionsByOwner(history);
  const allTime: AllTimeStandingRow[] = [
    makeStanding('Pruitt', 2),
    makeStanding('Whited', 1),
    makeStanding('Maleski', 0),
    makeStanding('Hopkins', 0),
    makeStanding('FormerOwner', 0),
  ];
  const summary = computeChampionshipSummary(
    ownerRows,
    history,
    allTime,
    new Set(['Pruitt', 'Whited', 'Maleski', 'Hopkins'])
  );

  assert.equal(summary.championCount, 2);
  assert.equal(summary.seasonCount, 3);
  assert.equal(summary.stillChasingCount, 2); // Maleski and Hopkins; FormerOwner excluded
});

// ---------------------------------------------------------------------------
// selectRecentPodiums
// ---------------------------------------------------------------------------

test('selectRecentPodiums: returns last 3 archives in descending year order with top-3 slots', () => {
  const archives = [
    makeArchive(2020, [
      { owner: 'A', wins: 50, losses: 30, gamesBack: 0 },
      { owner: 'B', wins: 45, losses: 35, gamesBack: 5 },
      { owner: 'C', wins: 40, losses: 40, gamesBack: 10 },
    ]),
    makeArchive(2024, [
      { owner: 'Whited', wins: 76, losses: 40, gamesBack: 0 },
      { owner: 'Ciprys', wins: 72, losses: 44, gamesBack: 4 },
      { owner: 'Maleski', wins: 69, losses: 47, gamesBack: 7 },
    ]),
    makeArchive(2025, [
      { owner: 'Pruitt', wins: 81, losses: 35, gamesBack: 0 },
      { owner: 'Maleski', wins: 74, losses: 42, gamesBack: 7 },
      { owner: 'Ciprys', wins: 71, losses: 45, gamesBack: 10 },
    ]),
    makeArchive(2023, [
      { owner: 'Pruitt', wins: 73, losses: 43, gamesBack: 0 },
      { owner: 'Whited', wins: 71, losses: 45, gamesBack: 2 },
      { owner: 'Jordan', wins: 64, losses: 52, gamesBack: 9 },
    ]),
  ];

  const blocks = selectRecentPodiums(archives, 3);

  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((b) => b.year),
    [2025, 2024, 2023]
  );
  assert.equal(blocks[0]!.slots[0]!.owner, 'Pruitt');
  assert.equal(blocks[0]!.slots[0]!.wins, 81);
  assert.equal(blocks[0]!.slots[1]!.owner, 'Maleski');
  assert.equal(blocks[0]!.slots[1]!.gamesBack, 7);
  assert.equal(blocks[0]!.slots[2]!.owner, 'Ciprys');
  assert.equal(blocks[0]!.slots[2]!.gamesBack, 10);
});

test('selectRecentPodiums: filters NoClaim out of slots', () => {
  const archives = [
    makeArchive(2025, [
      { owner: 'NoClaim', wins: 0, losses: 0, gamesBack: 0 },
      { owner: 'Pruitt', wins: 81, losses: 35, gamesBack: 0 },
      { owner: 'Maleski', wins: 74, losses: 42, gamesBack: 7 },
      { owner: 'Ciprys', wins: 71, losses: 45, gamesBack: 10 },
    ]),
  ];
  const blocks = selectRecentPodiums(archives, 1);

  assert.equal(blocks[0]!.slots.length, 3);
  assert.deepEqual(
    blocks[0]!.slots.map((s) => s.owner),
    ['Pruitt', 'Maleski', 'Ciprys']
  );
});

test('selectRecentPodiums: handles fewer archives than seasonsToShow', () => {
  const archives = [
    makeArchive(2025, [
      { owner: 'Pruitt', wins: 81, losses: 35, gamesBack: 0 },
      { owner: 'Maleski', wins: 74, losses: 42, gamesBack: 7 },
    ]),
  ];
  const blocks = selectRecentPodiums(archives, 3);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.slots.length, 2);
});

test('selectRecentPodiums: empty archives returns empty array', () => {
  assert.deepEqual(selectRecentPodiums([], 3), []);
});

// ---------------------------------------------------------------------------
// selectMarqueeRecords
// ---------------------------------------------------------------------------

test('selectMarqueeRecords: surfaces 1 from each category (when all 4 have entries)', () => {
  const records: LeagueRecords = {
    career: [makeRecord('career', 'c1'), makeRecord('career', 'c2')],
    season: [makeRecord('season', 's1'), makeRecord('season', 's2')],
    rivalry: [makeRecord('rivalry', 'r1')],
    event: [makeRecord('event', 'e1')],
  };

  const picked = selectMarqueeRecords(records);

  assert.equal(picked.length, 5);
  const categories = picked.map((r) => r.category);
  assert.ok(categories.includes('career'));
  assert.ok(categories.includes('season'));
  assert.ok(categories.includes('rivalry'));
  assert.ok(categories.includes('event'));
});

test('selectMarqueeRecords: extra slot prefers career then season then rivalry then event', () => {
  const records: LeagueRecords = {
    career: [makeRecord('career', 'c1'), makeRecord('career', 'c2')],
    season: [makeRecord('season', 's1')],
    rivalry: [makeRecord('rivalry', 'r1')],
    event: [makeRecord('event', 'e1')],
  };

  const picked = selectMarqueeRecords(records);

  assert.equal(picked.length, 5);
  // 4 from each category + the second career record as the extra
  assert.equal(picked.filter((r) => r.category === 'career').length, 2);
});

test('selectMarqueeRecords: returns fewer than 5 if data does not support 5', () => {
  const records: LeagueRecords = {
    career: [makeRecord('career', 'c1')],
    season: [],
    rivalry: [],
    event: [],
  };

  const picked = selectMarqueeRecords(records);
  assert.equal(picked.length, 1);
});

test('selectMarqueeRecords: empty records returns empty array', () => {
  assert.deepEqual(selectMarqueeRecords({ career: [], season: [], rivalry: [], event: [] }), []);
});

// ---------------------------------------------------------------------------
// selectMovers
// ---------------------------------------------------------------------------

function makeImproved(
  owner: string,
  fromYear: number,
  toYear: number,
  fromFinish: number,
  toFinish: number
): MostImprovedEntry {
  return {
    owner,
    fromYear,
    toYear,
    fromFinish,
    toFinish,
    improvement: fromFinish - toFinish,
  };
}

test('selectMovers: separates climbs and drops, sorted by magnitude', () => {
  const entries: MostImprovedEntry[] = [
    makeImproved('BHooper', 2018, 2021, 13, 1), // +12
    makeImproved('Jordan', 2024, 2025, 4, 13), // -9
    makeImproved('Stevens', 2023, 2024, 5, 12), // -7
    makeImproved('Maleski', 2022, 2023, 8, 2), // +6
    makeImproved('Pruitt', 2018, 2021, 12, 7), // +5
    makeImproved('Carter', 2024, 2025, 10, 15), // -5
  ];

  const buckets = selectMovers(entries, 4);

  assert.deepEqual(
    buckets.climbs.map((c) => c.owner),
    ['BHooper', 'Maleski', 'Pruitt']
  );
  assert.deepEqual(
    buckets.drops.map((d) => d.owner),
    ['Jordan', 'Stevens', 'Carter']
  );
});

test('selectMovers: ties broken by most recent toYear desc, then owner asc', () => {
  const entries: MostImprovedEntry[] = [
    makeImproved('Alpha', 2020, 2021, 5, 2), // +3
    makeImproved('Beta', 2022, 2023, 8, 5), // +3
    makeImproved('Gamma', 2022, 2023, 7, 4), // +3
  ];

  const buckets = selectMovers(entries, 5);
  // Beta and Gamma both have toYear 2023; sorted by owner asc → Beta before Gamma; both before Alpha
  assert.deepEqual(
    buckets.climbs.map((c) => c.owner),
    ['Beta', 'Gamma', 'Alpha']
  );
});

test('selectMovers: limits each bucket to limitEach', () => {
  const entries: MostImprovedEntry[] = Array.from({ length: 8 }, (_, i) =>
    makeImproved(`O${i}`, 2020, 2021, 10, 10 - (i + 1))
  );

  const buckets = selectMovers(entries, 4);
  assert.equal(buckets.climbs.length, 4);
});

test('selectMovers: zero-improvement entries excluded', () => {
  const entries: MostImprovedEntry[] = [
    makeImproved('Static', 2020, 2021, 5, 5), // 0
    makeImproved('Climber', 2020, 2021, 5, 1), // +4
  ];

  const buckets = selectMovers(entries, 4);
  assert.equal(buckets.climbs.length, 1);
  assert.equal(buckets.drops.length, 0);
});

// ---------------------------------------------------------------------------
// selectTitleStreaks
// ---------------------------------------------------------------------------

function makeStreak(owner: string, longestWinStreak: number, years: number[]): DynastyDroughtRow {
  return {
    owner,
    longestWinStreak,
    longestWinStreakYears: years,
    longestDrought: 0,
  };
}

test('selectTitleStreaks: filters out streaks below 2 (single-title runs are not streaks)', () => {
  const rows: DynastyDroughtRow[] = [
    makeStreak('Pruitt', 1, [2025]),
    makeStreak('Whited', 2, [2022, 2023]),
    makeStreak('Maleski', 0, []),
    makeStreak('BHooper', 1, [2021]),
  ];

  const streaks = selectTitleStreaks(rows);

  assert.equal(streaks.length, 1);
  assert.equal(streaks[0]!.owner, 'Whited');
  assert.equal(streaks[0]!.streak, 2);
});

test('selectTitleStreaks: returns empty when no owner has a streak >= 2', () => {
  const rows: DynastyDroughtRow[] = [
    makeStreak('Hardiman', 1, [2018]),
    makeStreak('Pruitt', 1, [2025]),
    makeStreak('BHooper', 1, [2021]),
  ];

  assert.deepEqual(selectTitleStreaks(rows), []);
});

test('selectTitleStreaks: ties on streak length broken by most recent year desc, then owner asc', () => {
  const rows: DynastyDroughtRow[] = [
    makeStreak('Hardiman', 2, [2017, 2018]),
    makeStreak('Pruitt', 2, [2024, 2025]),
    makeStreak('BHooper', 2, [2020, 2021]),
  ];

  const streaks = selectTitleStreaks(rows);
  assert.deepEqual(
    streaks.map((s) => s.owner),
    ['Pruitt', 'BHooper', 'Hardiman']
  );
});

// ---------------------------------------------------------------------------
// selectTitleDroughts
// ---------------------------------------------------------------------------

test('selectTitleDroughts: counts seasons since last title (champions)', () => {
  const history: ChampionshipEntry[] = [
    { year: 2021, champion: 'BHooper' },
    { year: 2022, champion: 'Whited' },
    { year: 2023, champion: 'Pruitt' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const allTime: AllTimeStandingRow[] = [
    makeStanding('Pruitt', 2, { seasonsPlayed: 5 }),
    makeStanding('Whited', 2, { seasonsPlayed: 5 }),
    makeStanding('BHooper', 1, { seasonsPlayed: 5 }),
  ];

  const droughts = selectTitleDroughts({ history, allTimeStandings: allTime });

  const byOwner = new Map(droughts.map((d) => [d.owner, d]));
  // Pruitt won 2025; no seasons after — drought 0
  assert.equal(byOwner.get('Pruitt')!.drought, 0);
  assert.equal(byOwner.get('Pruitt')!.lastTitleYear, 2025);
  // Whited won 2024; 1 season after — drought 1
  assert.equal(byOwner.get('Whited')!.drought, 1);
  assert.equal(byOwner.get('Whited')!.lastTitleYear, 2024);
  // BHooper won 2021; 4 seasons after — drought 4
  assert.equal(byOwner.get('BHooper')!.drought, 4);
  assert.equal(byOwner.get('BHooper')!.lastTitleYear, 2021);
});

test('selectTitleDroughts: never-champions show seasonsPlayed and null lastTitleYear', () => {
  const history: ChampionshipEntry[] = [{ year: 2025, champion: 'Pruitt' }];
  const allTime: AllTimeStandingRow[] = [
    makeStanding('Pruitt', 1, { seasonsPlayed: 1 }),
    makeStanding('Maleski', 0, { seasonsPlayed: 5 }),
  ];

  const droughts = selectTitleDroughts({ history, allTimeStandings: allTime });
  const maleski = droughts.find((d) => d.owner === 'Maleski')!;

  assert.equal(maleski.drought, 5);
  assert.equal(maleski.lastTitleYear, null);
});

test('selectTitleDroughts: skips Unknown champions when computing last-title', () => {
  const history: ChampionshipEntry[] = [
    { year: 2024, champion: 'Unknown' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const allTime: AllTimeStandingRow[] = [
    makeStanding('Pruitt', 1, { seasonsPlayed: 2 }),
    makeStanding('Whited', 0, { seasonsPlayed: 2 }),
  ];

  const droughts = selectTitleDroughts({ history, allTimeStandings: allTime });
  const whited = droughts.find((d) => d.owner === 'Whited')!;

  assert.equal(whited.drought, 2);
  assert.equal(whited.lastTitleYear, null);
});

// ---------------------------------------------------------------------------
// selectStreaksOrDroughts
// ---------------------------------------------------------------------------

test('selectStreaksOrDroughts: returns streaks mode when at least one streak >= 2 exists', () => {
  const dynastyRows: DynastyDroughtRow[] = [
    makeStreak('Whited', 2, [2022, 2023]),
    makeStreak('Pruitt', 1, [2025]),
  ];
  const history: ChampionshipEntry[] = [
    { year: 2022, champion: 'Whited' },
    { year: 2023, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const allTime: AllTimeStandingRow[] = [
    makeStanding('Whited', 2, { seasonsPlayed: 3 }),
    makeStanding('Pruitt', 1, { seasonsPlayed: 3 }),
  ];

  const result = selectStreaksOrDroughts({
    dynastyDroughtRows: dynastyRows,
    history,
    allTimeStandings: allTime,
    limit: 4,
  });

  assert.equal(result.mode, 'streaks');
  assert.equal(result.rows.length, 1);
});

test('selectStreaksOrDroughts: returns droughts mode when no streak >= 2 exists', () => {
  const dynastyRows: DynastyDroughtRow[] = [
    makeStreak('Pruitt', 1, [2025]),
    makeStreak('Whited', 1, [2024]),
    makeStreak('BHooper', 1, [2021]),
  ];
  const history: ChampionshipEntry[] = [
    { year: 2021, champion: 'BHooper' },
    { year: 2024, champion: 'Whited' },
    { year: 2025, champion: 'Pruitt' },
  ];
  const allTime: AllTimeStandingRow[] = [
    makeStanding('Pruitt', 1, { seasonsPlayed: 3 }),
    makeStanding('Whited', 1, { seasonsPlayed: 3 }),
    makeStanding('BHooper', 1, { seasonsPlayed: 3 }),
    makeStanding('Maleski', 0, { seasonsPlayed: 3 }),
  ];

  const result = selectStreaksOrDroughts({
    dynastyDroughtRows: dynastyRows,
    history,
    allTimeStandings: allTime,
    limit: 4,
  });

  assert.equal(result.mode, 'droughts');
  // Sorted by drought desc: Maleski (3) > BHooper (2) > Whited (1) > Pruitt (0)
  if (result.mode === 'droughts') {
    assert.deepEqual(
      result.rows.map((r) => r.owner),
      ['Maleski', 'BHooper', 'Whited', 'Pruitt']
    );
  }
});

test('selectStreaksOrDroughts: caps results at limit', () => {
  const dynastyRows: DynastyDroughtRow[] = [];
  const history: ChampionshipEntry[] = [{ year: 2025, champion: 'Pruitt' }];
  const allTime: AllTimeStandingRow[] = Array.from({ length: 8 }, (_, i) =>
    makeStanding(`Owner${i}`, 0, { seasonsPlayed: i + 1 })
  );

  const result = selectStreaksOrDroughts({
    dynastyDroughtRows: dynastyRows,
    history,
    allTimeStandings: allTime,
    limit: 4,
  });

  assert.equal(result.rows.length, 4);
});

// ---------------------------------------------------------------------------
// selectSeasonArchiveStrip
// ---------------------------------------------------------------------------

test('selectSeasonArchiveStrip: descending by year, preserves champion names', () => {
  const history: ChampionshipEntry[] = [
    { year: 2018, champion: 'Hardiman' },
    { year: 2025, champion: 'Pruitt' },
    { year: 2022, champion: 'Whited' },
  ];
  const items = selectSeasonArchiveStrip(history);

  assert.deepEqual(
    items.map((i) => i.year),
    [2025, 2022, 2018]
  );
  assert.equal(items[0]!.champion, 'Pruitt');
});

test('selectSeasonArchiveStrip: empty history returns empty array', () => {
  assert.deepEqual(selectSeasonArchiveStrip([]), []);
});
