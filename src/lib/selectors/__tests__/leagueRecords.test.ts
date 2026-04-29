import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectAllRecords,
  RECORDS_TIE_SUPPRESSION_THRESHOLD,
  tiedAtMax,
  tiedAtMin,
  type SelectAllRecordsInput,
  type RecordEntry,
} from '../leagueRecords.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';
import type { StandingsHistoryStandingRow } from '../../standingsHistory.ts';
import type { AppGame } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import type { OwnerStandingsSeriesPoint } from '../../standingsHistory.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRow(
  owner: string,
  wins: number,
  losses: number,
  opts: { pointsFor?: number; pointsAgainst?: number; gamesBack?: number } = {}
): StandingsHistoryStandingRow {
  const pf = opts.pointsFor ?? wins * 100;
  const pa = opts.pointsAgainst ?? losses * 100;
  return {
    owner,
    wins,
    losses,
    ties: 0,
    winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
    pointsFor: pf,
    pointsAgainst: pa,
    pointDifferential: pf - pa,
    gamesBack: opts.gamesBack ?? 0,
    finalGames: wins + losses,
  };
}

function makeArchive(
  year: number,
  standings: StandingsHistoryStandingRow[],
  opts: {
    games?: AppGame[];
    scoresByKey?: Record<string, ScorePack>;
    byOwner?: Record<string, OwnerStandingsSeriesPoint[]>;
    ownerRosterCsv?: string;
  } = {}
): SeasonArchive {
  // Default roster CSV: derive from standings
  const rosterCsv =
    opts.ownerRosterCsv ??
    [
      'team,owner',
      ...standings.filter((r) => r.owner !== 'NoClaim').map((r) => `${r.owner}Team,${r.owner}`),
    ].join('\n');
  return {
    leagueSlug: 'test',
    year,
    archivedAt: `${year}-12-01T00:00:00Z`,
    ownerRosterSnapshot: rosterCsv,
    standingsHistory: {
      weeks: [],
      byWeek: {},
      byOwner: opts.byOwner ?? {},
    },
    finalStandings: standings,
    games: opts.games ?? [],
    scoresByKey: opts.scoresByKey ?? {},
  };
}

function makeHistoricalRosters(archives: SeasonArchive[]): Record<number, Map<string, string>> {
  const result: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    const roster = new Map<string, string>();
    for (const row of archive.finalStandings) {
      if (row.owner && row.owner !== 'NoClaim') {
        roster.set(`${row.owner}Team`, row.owner);
      }
    }
    result[archive.year] = roster;
  }
  return result;
}

function makeInput(
  archives: SeasonArchive[],
  currentRoster?: Map<string, string>
): SelectAllRecordsInput {
  return {
    archives,
    historicalRosters: makeHistoricalRosters(archives),
    currentYear: Math.max(...archives.map((a) => a.year)) + 1,
    currentRoster: currentRoster ?? new Map(),
  };
}

function findRecord(
  records: ReturnType<typeof selectAllRecords>,
  id: string
): RecordEntry | undefined {
  return [...records.career, ...records.season, ...records.rivalry, ...records.event].find(
    (r) => r.id === id
  );
}

function makeGame(id: string, homeTeam: string, awayTeam: string): AppGame {
  return {
    key: id,
    eventId: id,
    eventKey: id,
    week: 1,
    canonicalWeek: 1,
    providerWeek: 1,
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    date: null,
    status: 'final',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      home: {
        kind: 'team',
        teamId: homeTeam,
        displayName: homeTeam,
        canonicalName: homeTeam,
        rawName: homeTeam,
      },
      away: {
        kind: 'team',
        teamId: awayTeam,
        displayName: awayTeam,
        canonicalName: awayTeam,
        rawName: awayTeam,
      },
    },
    csvHome: `${homeTeam}Team`,
    csvAway: `${awayTeam}Team`,
    canHome: homeTeam,
    canAway: awayTeam,
    homeConf: '',
    awayConf: '',
  };
}

function makeScore(homeScore: number, awayScore: number): ScorePack {
  return {
    status: 'final',
    home: { team: 'home', score: homeScore },
    away: { team: 'away', score: awayScore },
    time: null,
  };
}

// ---------------------------------------------------------------------------
// tiedAtMax / tiedAtMin helpers
// ---------------------------------------------------------------------------

test('tiedAtMax returns single item when no tie', () => {
  const result = tiedAtMax([{ v: 3 }, { v: 1 }, { v: 2 }], (x) => x.v);
  assert.deepEqual(result, [{ v: 3 }]);
});

test('tiedAtMax returns all tied items', () => {
  const result = tiedAtMax([{ v: 3 }, { v: 3 }, { v: 1 }], (x) => x.v);
  assert.equal(result.length, 2);
  assert.ok(result.every((x) => x.v === 3));
});

test('tiedAtMax returns empty for empty input', () => {
  assert.deepEqual(
    tiedAtMax([], (x: { v: number }) => x.v),
    []
  );
});

test('tiedAtMin returns single item when no tie', () => {
  const result = tiedAtMin([{ v: 3 }, { v: 1 }, { v: 2 }], (x) => x.v);
  assert.deepEqual(result, [{ v: 1 }]);
});

test('tiedAtMin returns all tied items', () => {
  const result = tiedAtMin([{ v: 1 }, { v: 1 }, { v: 5 }], (x) => x.v);
  assert.equal(result.length, 2);
  assert.ok(result.every((x) => x.v === 1));
});

// ---------------------------------------------------------------------------
// Empty / no-archive edge cases
// ---------------------------------------------------------------------------

test('returns empty records for empty archives', () => {
  const input = makeInput([]);
  const records = selectAllRecords(input);
  assert.deepEqual(records, { career: [], season: [], rivalry: [], event: [] });
});

// ---------------------------------------------------------------------------
// Career records
// ---------------------------------------------------------------------------

test('career_points: identifies correct holder and value', () => {
  const archives = [
    makeArchive(2023, [
      makeRow('Alice', 10, 2, { pointsFor: 1500 }),
      makeRow('Bob', 8, 4, { pointsFor: 1000 }),
    ]),
    makeArchive(2024, [
      makeRow('Alice', 9, 3, { pointsFor: 1200 }),
      makeRow('Bob', 10, 2, { pointsFor: 1400 }),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_points');
  assert.ok(r, 'career_points should exist');
  // Alice: 1500+1200=2700, Bob: 1000+1400=2400
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 2700);
  assert.equal(r!.gapToSecond, 300);
  assert.deepEqual(r!.secondPlace?.owners, ['Bob']);
});

test('career_points: tied holders returned lex-sorted', () => {
  const archives = [
    makeArchive(2023, [
      makeRow('Charlie', 10, 2, { pointsFor: 1000 }),
      makeRow('Alice', 10, 2, { pointsFor: 1000 }),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_points');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Alice', 'Charlie']);
});

test('career_points: omitted when ties exceed threshold', () => {
  const owners = Array.from({ length: RECORDS_TIE_SUPPRESSION_THRESHOLD + 1 }, (_, i) =>
    makeRow(String.fromCharCode(65 + i), 10, 2, { pointsFor: 1000 })
  );
  const archives = [makeArchive(2023, owners)];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_points');
  assert.equal(r, undefined);
});

test('career_wins: identifies correct holder', () => {
  const archives = [
    makeArchive(2023, [makeRow('Alice', 12, 0), makeRow('Bob', 6, 6)]),
    makeArchive(2024, [makeRow('Alice', 10, 2), makeRow('Bob', 11, 1)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_wins');
  assert.ok(r);
  // Alice: 22, Bob: 17
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 22);
});

test('career_win_pct: requires MIN_CAREER_SEASONS and returns best pct', () => {
  // Only 2 seasons each — below threshold; record should be absent
  const archives = [
    makeArchive(2023, [makeRow('Alice', 10, 2), makeRow('Bob', 6, 6)]),
    makeArchive(2024, [makeRow('Alice', 9, 3), makeRow('Bob', 11, 1)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_win_pct');
  assert.equal(r, undefined, 'should be absent when owners have < 3 seasons');
});

test('career_win_pct: returns best when threshold met', () => {
  const archives = [
    makeArchive(2022, [makeRow('Alice', 10, 2), makeRow('Bob', 6, 6)]),
    makeArchive(2023, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2024, [makeRow('Alice', 9, 3), makeRow('Bob', 10, 2)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_win_pct');
  assert.ok(r);
  // Alice: 29/36 ≈ 0.806, Bob: 24/36 ≈ 0.667
  assert.deepEqual(r!.holders, ['Alice']);
  assert.ok(r!.value > 0.8);
  assert.equal(r!.formattedValue.endsWith('%'), true);
});

test('career_titles: identifies multi-title holder', () => {
  const archives = [
    makeArchive(2022, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2023, [makeRow('Alice', 11, 1), makeRow('Bob', 9, 3)]),
    makeArchive(2024, [makeRow('Bob', 12, 0), makeRow('Alice', 7, 5)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_titles');
  assert.ok(r);
  // Alice: 2 titles, Bob: 1
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 2);
  assert.equal(r!.formattedValue, '2 titles');
});

test('career_titles: absent when nobody has won', () => {
  // Archives with only one entry (champion), but let's check edge case:
  // No archives means no titles
  const records = selectAllRecords(makeInput([]));
  assert.equal(findRecord(records, 'career_titles'), undefined);
});

test('career_avg_finish: lower average is better', () => {
  const archives = [
    makeArchive(2022, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4), makeRow('Charlie', 5, 7)]),
    makeArchive(2023, [makeRow('Bob', 11, 1), makeRow('Alice', 9, 3), makeRow('Charlie', 5, 7)]),
    makeArchive(2024, [makeRow('Alice', 10, 2), makeRow('Bob', 9, 3), makeRow('Charlie', 5, 7)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_avg_finish');
  assert.ok(r);
  // Alice avg: (1+2+1)/3 = 4/3 ≈ 1.33, Bob: (2+1+2)/3 = 5/3 ≈ 1.67, Charlie: 3/3 = 3
  assert.deepEqual(r!.holders, ['Alice']);
  assert.ok(r!.value < 1.5);
  assert.ok(r!.formattedValue.startsWith('#'));
});

test('career_consistency: most top-3 finishes', () => {
  const archives = [
    makeArchive(2022, [
      makeRow('A', 10, 2),
      makeRow('B', 9, 3),
      makeRow('C', 8, 4),
      makeRow('D', 5, 7),
    ]),
    makeArchive(2023, [
      makeRow('A', 10, 2),
      makeRow('B', 9, 3),
      makeRow('C', 8, 4),
      makeRow('D', 5, 7),
    ]),
    makeArchive(2024, [
      makeRow('A', 10, 2),
      makeRow('B', 9, 3),
      makeRow('D', 8, 4),
      makeRow('C', 5, 7),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_consistency');
  assert.ok(r);
  // A: 3, B: 3, C: 2, D: 1
  assert.deepEqual(r!.holders, ['A', 'B']);
  assert.equal(r!.value, 3);
});

test('career_drought: only active owners; longest drought wins', () => {
  const archives = [
    makeArchive(2020, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2021, [makeRow('Bob', 10, 2), makeRow('Alice', 8, 4)]),
    makeArchive(2022, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2023, [makeRow('Bob', 10, 2), makeRow('Alice', 8, 4)]),
    makeArchive(2024, [makeRow('Bob', 10, 2), makeRow('Alice', 8, 4)]),
  ];
  // latestYear = 2024; Alice last title = 2022 → drought = 2; Bob last title = 2024 → drought = 0
  const currentRoster = new Map([
    ['AliceTeam', 'Alice'],
    ['BobTeam', 'Bob'],
  ]);
  const records = selectAllRecords(makeInput(archives, currentRoster));
  const r = findRecord(records, 'career_drought');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 2);
});

test('career_drought: former owners excluded (not in currentRoster)', () => {
  const archives = [
    makeArchive(2020, [makeRow('Former', 10, 2), makeRow('Active', 8, 4)]),
    makeArchive(2021, [makeRow('Active', 10, 2), makeRow('Former', 8, 4)]),
    makeArchive(2022, [makeRow('Active', 10, 2), makeRow('Former', 8, 4)]),
    makeArchive(2023, [makeRow('Active', 10, 2), makeRow('Former', 8, 4)]),
  ];
  // Only Active is in current roster
  const currentRoster = new Map([['ActiveTeam', 'Active']]);
  const records = selectAllRecords(makeInput(archives, currentRoster));
  const r = findRecord(records, 'career_drought');
  // Active won in 2021-2023 (latestYear=2023), so drought = 0; Active had title in 2023
  // Active's last title = 2023, latestYear = 2023 → drought = 0 → no drought
  // Former is excluded from drought check
  assert.ok(r === undefined || !r!.holders.includes('Former'));
});

test('career_dynasty: consecutive championships streak', () => {
  const archives = [
    makeArchive(2020, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2021, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2022, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2023, [makeRow('Bob', 10, 2), makeRow('Alice', 8, 4)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_dynasty');
  assert.ok(r);
  // Alice: 3 consecutive (2020-2022)
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 3);
  assert.equal(r!.formattedValue, '3 in a row');
});

test('career_dynasty: absent when no one has consecutive titles', () => {
  const archives = [
    makeArchive(2022, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)]),
    makeArchive(2023, [makeRow('Bob', 10, 2), makeRow('Alice', 8, 4)]),
  ];
  const records = selectAllRecords(makeInput(archives));
  // Neither has 2+ consecutive — dynasty requires streak >= 2
  const r = findRecord(records, 'career_dynasty');
  assert.equal(r, undefined);
});

// ---------------------------------------------------------------------------
// Season records
// ---------------------------------------------------------------------------

test('single_season_points_high: highest season total across all owners and years', () => {
  const archives = [
    makeArchive(2023, [
      makeRow('Alice', 10, 2, { pointsFor: 2000 }),
      makeRow('Bob', 8, 4, { pointsFor: 1500 }),
    ]),
    makeArchive(2024, [
      makeRow('Bob', 10, 2, { pointsFor: 2500 }),
      makeRow('Alice', 8, 4, { pointsFor: 1800 }),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'single_season_points_high');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Bob']);
  assert.equal(r!.value, 2500);
  assert.ok(r!.formattedValue.includes('2024'));
});

test('single_season_points_low: lowest season total', () => {
  const archives = [
    makeArchive(2023, [
      makeRow('Alice', 10, 2, { pointsFor: 2000 }),
      makeRow('Bob', 2, 10, { pointsFor: 800 }),
    ]),
    makeArchive(2024, [
      makeRow('Alice', 10, 2, { pointsFor: 1900 }),
      makeRow('Bob', 4, 8, { pointsFor: 900 }),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'single_season_points_low');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Bob']);
  assert.equal(r!.value, 800);
  assert.ok(r!.formattedValue.includes('2023'));
});

test('single_season_high_score: highest single-week score from standingsHistory', () => {
  const byOwner: Record<string, OwnerStandingsSeriesPoint[]> = {
    Alice: [
      {
        week: 1,
        wins: 1,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 180,
        pointsAgainst: 120,
        pointDifferential: 60,
        gamesBack: 0,
      },
      {
        week: 2,
        wins: 2,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 360,
        pointsAgainst: 240,
        pointDifferential: 120,
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
        pointsFor: 120,
        pointsAgainst: 180,
        pointDifferential: -60,
        gamesBack: 1,
      },
      {
        week: 2,
        wins: 1,
        losses: 1,
        ties: 0,
        winPct: 0.5,
        pointsFor: 520,
        pointsAgainst: 380,
        pointDifferential: 140,
        gamesBack: 0,
      },
    ],
  };
  const archives = [
    makeArchive(2024, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4)], { byOwner }),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'single_season_high_score');
  assert.ok(r);
  // Alice week 1: 180, week 2: 180. Bob week 1: 120, week 2: 400.
  // Bob week 2 = 520 - 120 = 400 → highest
  assert.deepEqual(r!.holders, ['Bob']);
  assert.equal(r!.value, 400);
});

test('single_season_blowout: largest margin in owned-vs-owned game', () => {
  const gameId = 'g1';
  const game = makeGame(gameId, 'Alice', 'Bob');
  game.week = 5;

  const archives = [
    makeArchive(2024, [makeRow('Alice', 10, 2), makeRow('Bob', 5, 7)], {
      games: [game],
      scoresByKey: { [gameId]: makeScore(55, 20) },
    }),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'single_season_blowout');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 35);
  assert.ok(r!.formattedValue.includes('2024'));
});

// ---------------------------------------------------------------------------
// Rivalry records
// ---------------------------------------------------------------------------

test('lopsided_rivalry: pair with largest win differential', () => {
  // Alice beats Bob 5×, Bob wins 1×; Charlie and Dave tied 3-3
  const archiveYear = 2024;
  const games: AppGame[] = [
    makeGame('r1', 'Alice', 'Bob'),
    makeGame('r2', 'Alice', 'Bob'),
    makeGame('r3', 'Alice', 'Bob'),
    makeGame('r4', 'Alice', 'Bob'),
    makeGame('r5', 'Alice', 'Bob'),
    makeGame('r6', 'Bob', 'Alice'),
  ];
  games[0]!.week = 1;
  games[1]!.week = 2;
  games[2]!.week = 3;
  games[3]!.week = 4;
  games[4]!.week = 5;
  games[5]!.week = 6;

  const scoresByKey: Record<string, ScorePack> = {
    r1: makeScore(40, 20),
    r2: makeScore(40, 20),
    r3: makeScore(40, 20),
    r4: makeScore(40, 20),
    r5: makeScore(40, 20),
    r6: makeScore(20, 40), // Bob (home) loses, Alice (away) wins → Alice wins
  };
  // Wait: makeGame('r6', 'Bob', 'Alice') → home=BobTeam, away=AliceTeam
  // makeScore(20, 40) → home=20, away=40 → Alice wins
  // Let me re-check: r6 = Bob home, Alice away, score home=20, away=40 → Alice wins game 6

  const archives = [
    makeArchive(archiveYear, [makeRow('Alice', 10, 2), makeRow('Bob', 5, 7)], {
      games,
      scoresByKey,
    }),
  ];

  // historicalRosters needs BobTeam→Bob, AliceTeam→Alice
  const input = makeInput(archives);
  // Override rosters to include both teams properly
  input.historicalRosters[archiveYear] = new Map([
    ['AliceTeam', 'Alice'],
    ['BobTeam', 'Bob'],
  ]);

  const records = selectAllRecords(input);
  const r = findRecord(records, 'lopsided_rivalry');
  assert.ok(r);
  // Alice wins 6, Bob wins 0 → diff = 6
  assert.ok(r!.holders.includes('Alice'));
  assert.ok(r!.holders.includes('Bob'));
  assert.equal(r!.value, 6);
});

test('dominance_streak: longest active consecutive winning streak', () => {
  // Alice beats Bob 4 straight at end of H2H history
  const games: AppGame[] = [
    makeGame('d1', 'Bob', 'Alice'), // Bob wins
    makeGame('d2', 'Alice', 'Bob'), // Alice wins
    makeGame('d3', 'Alice', 'Bob'), // Alice wins
    makeGame('d4', 'Alice', 'Bob'), // Alice wins
    makeGame('d5', 'Alice', 'Bob'), // Alice wins
  ];
  const scoresByKey: Record<string, ScorePack> = {
    d1: makeScore(40, 20), // Bob home wins
    d2: makeScore(40, 20), // Alice home wins
    d3: makeScore(40, 20),
    d4: makeScore(40, 20),
    d5: makeScore(40, 20),
  };
  games.forEach((g, i) => {
    g.week = i + 1;
  });

  const archives = [
    makeArchive(2024, [makeRow('Alice', 10, 2), makeRow('Bob', 5, 7)], { games, scoresByKey }),
  ];
  const input = makeInput(archives);
  input.historicalRosters[2024] = new Map([
    ['AliceTeam', 'Alice'],
    ['BobTeam', 'Bob'],
  ]);

  const records = selectAllRecords(input);
  const r = findRecord(records, 'dominance_streak');
  assert.ok(r);
  // Alice wins last 4 straight
  assert.ok(r!.holders.includes('Alice'));
  assert.equal(r!.value, 4);
});

test('even_rivalry: most games with smallest win differential', () => {
  // Alice and Bob: 3 wins each across 6 games
  const games: AppGame[] = Array.from({ length: 6 }, (_, i) =>
    makeGame(`e${i + 1}`, i % 2 === 0 ? 'Alice' : 'Bob', i % 2 === 0 ? 'Bob' : 'Alice')
  );
  const scoresByKey: Record<string, ScorePack> = {};
  // Alternating wins: Alice(home) wins e1, Bob(home) wins e2, Alice wins e3...
  games.forEach((g, i) => {
    g.week = i + 1;
    // Even index: Alice is home and wins; odd index: Bob is home and wins
    scoresByKey[g.key] = makeScore(40, 20);
  });

  const archives = [
    makeArchive(2024, [makeRow('Alice', 8, 4), makeRow('Bob', 7, 5)], { games, scoresByKey }),
  ];
  const input = makeInput(archives);
  input.historicalRosters[2024] = new Map([
    ['AliceTeam', 'Alice'],
    ['BobTeam', 'Bob'],
  ]);

  const records = selectAllRecords(input);
  const r = findRecord(records, 'even_rivalry');
  assert.ok(r);
  assert.ok(r!.holders.includes('Alice'));
  assert.ok(r!.holders.includes('Bob'));
  assert.equal(r!.value, 6);
});

// ---------------------------------------------------------------------------
// Event records
// ---------------------------------------------------------------------------

test('closest_title_race: smallest gamesBack gap between #1 and #2', () => {
  const archives = [
    makeArchive(2022, [
      makeRow('Alice', 12, 0, { gamesBack: 0 }),
      makeRow('Bob', 6, 6, { gamesBack: 6 }),
    ]),
    makeArchive(2023, [
      makeRow('Alice', 10, 2, { gamesBack: 0 }),
      makeRow('Bob', 9, 3, { gamesBack: 1 }),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'closest_title_race');
  assert.ok(r);
  // 2023 race: 1 GB gap vs 2022: 6 GB gap
  assert.equal(r!.value, 1);
  assert.ok(r!.formattedValue.includes('2023'));
  assert.ok(r!.holders.includes('Alice'));
  assert.ok(r!.holders.includes('Bob'));
});

test('biggest_collapse: largest year-over-year rank drop', () => {
  const archives = [
    makeArchive(2023, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4), makeRow('Charlie', 5, 7)]),
    makeArchive(2024, [
      makeRow('Bob', 10, 2),
      makeRow('Charlie', 8, 4),
      makeRow('Alice', 3, 9), // Alice dropped from 1st to 3rd = 2 positions
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'biggest_collapse');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Alice']);
  assert.equal(r!.value, 2);
  assert.ok(r!.formattedValue.includes('2023→2024'));
});

test('biggest_climb: largest year-over-year rank improvement', () => {
  const archives = [
    makeArchive(2023, [makeRow('Alice', 10, 2), makeRow('Bob', 8, 4), makeRow('Charlie', 3, 9)]),
    makeArchive(2024, [
      makeRow('Charlie', 10, 2), // Charlie jumped from 3rd to 1st = 2 positions
      makeRow('Alice', 8, 4),
      makeRow('Bob', 3, 9),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'biggest_climb');
  assert.ok(r);
  assert.deepEqual(r!.holders, ['Charlie']);
  assert.equal(r!.value, 2);
  assert.ok(r!.formattedValue.includes('2023→2024'));
});

// ---------------------------------------------------------------------------
// Former owner eligibility
// ---------------------------------------------------------------------------

test('former owners eligible for career records (not drought)', () => {
  // Former owner has all the points; active owner has few
  const archives = [
    makeArchive(2022, [
      makeRow('Former', 10, 2, { pointsFor: 5000 }),
      makeRow('Active', 5, 7, { pointsFor: 1000 }),
    ]),
    makeArchive(2023, [
      makeRow('Former', 10, 2, { pointsFor: 5000 }),
      makeRow('Active', 5, 7, { pointsFor: 1000 }),
    ]),
    makeArchive(2024, [makeRow('Active', 10, 2, { pointsFor: 1500 })]),
  ];
  // Active is in current roster; Former is not
  const currentRoster = new Map([['ActiveTeam', 'Active']]);
  const records = selectAllRecords(makeInput(archives, currentRoster));

  const careerPoints = findRecord(records, 'career_points');
  assert.ok(careerPoints);
  // Former: 10000, Active: 3500
  assert.deepEqual(careerPoints!.holders, ['Former']);
  assert.equal(careerPoints!.value, 10000);
});

// ---------------------------------------------------------------------------
// Tie suppression across categories
// ---------------------------------------------------------------------------

test('tie suppression: record omitted when holders exceed threshold', () => {
  // Create enough owners with identical career points to exceed threshold
  const owners = Array.from({ length: RECORDS_TIE_SUPPRESSION_THRESHOLD + 1 }, (_, i) =>
    makeRow(`Owner${i}`, 5, 5, { pointsFor: 1000 })
  );
  const archives = [makeArchive(2024, owners)];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_points');
  assert.equal(r, undefined, 'should be suppressed when tied owners exceed threshold');
});

test('tie suppression: record included when holders at threshold', () => {
  const owners = Array.from({ length: RECORDS_TIE_SUPPRESSION_THRESHOLD }, (_, i) =>
    makeRow(`Owner${i}`, 5, 5, { pointsFor: 1000 })
  );
  const archives = [makeArchive(2024, owners)];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_points');
  assert.ok(r, 'should be included when tied owners exactly equal threshold');
  assert.equal(r!.holders.length, RECORDS_TIE_SUPPRESSION_THRESHOLD);
});

// ---------------------------------------------------------------------------
// NoClaim exclusion
// ---------------------------------------------------------------------------

test('NoClaim is excluded from all records', () => {
  const archives = [
    makeArchive(2023, [
      makeRow('NoClaim', 100, 0, { pointsFor: 99999 }),
      makeRow('Alice', 5, 7, { pointsFor: 500 }),
    ]),
  ];
  const records = selectAllRecords(makeInput(archives));
  const r = findRecord(records, 'career_points');
  assert.ok(r);
  assert.ok(!r!.holders.includes('NoClaim'));
  assert.deepEqual(r!.holders, ['Alice']);
});
