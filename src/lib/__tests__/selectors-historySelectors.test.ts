import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectAllTimeHeadToHead,
  selectOwnerCareer,
  selectTopRivalries,
  type OwnerCareerExtras,
} from '../selectors/historySelectors.ts';
import type { SeasonArchive } from '../seasonArchive.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';

function makeArchive(
  year: number,
  finalStandings: SeasonArchive['finalStandings'],
  opts: {
    ownerRosterCsv?: string;
    games?: AppGame[];
    scoresByKey?: Record<string, ScorePack>;
  } = {}
): SeasonArchive {
  return {
    leagueSlug: 'test',
    year,
    archivedAt: '2026-01-01T00:00:00.000Z',
    ownerRosterSnapshot: opts.ownerRosterCsv ?? '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings,
    games: opts.games ?? [],
    scoresByKey: opts.scoresByKey ?? {},
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

// ---------------------------------------------------------------------------
// selectAllTimeHeadToHead.latestMeeting
// ---------------------------------------------------------------------------

function makeGame(
  key: string,
  week: number,
  awayOwnerTeam: string,
  homeOwnerTeam: string
): AppGame {
  return {
    key,
    eventId: key,
    eventKey: key,
    week,
    canonicalWeek: week,
    providerWeek: week,
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
        teamId: homeOwnerTeam,
        displayName: homeOwnerTeam,
        canonicalName: homeOwnerTeam,
        rawName: homeOwnerTeam,
      },
      away: {
        kind: 'team',
        teamId: awayOwnerTeam,
        displayName: awayOwnerTeam,
        canonicalName: awayOwnerTeam,
        rawName: awayOwnerTeam,
      },
    },
    csvHome: homeOwnerTeam,
    csvAway: awayOwnerTeam,
    canHome: homeOwnerTeam,
    canAway: awayOwnerTeam,
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

test('selectAllTimeHeadToHead.latestMeeting: tracks most recent meeting across archives', () => {
  const rosterCsv = ['team,owner', 'PruittTeam,Pruitt', 'WhitedTeam,Whited'].join('\n');

  const games2023 = [makeGame('g1', 3, 'PruittTeam', 'WhitedTeam')];
  const scores2023 = { g1: makeScore(20, 35) }; // Pruitt (away) 35, Whited (home) 20 → Pruitt wins

  const games2025 = [
    makeGame('g2', 5, 'WhitedTeam', 'PruittTeam'),
    makeGame('g3', 11, 'PruittTeam', 'WhitedTeam'),
  ];
  const scores2025 = {
    g2: makeScore(28, 14), // Whited (away) 14, Pruitt (home) 28 → Pruitt wins
    g3: makeScore(35, 17), // Pruitt (away) 17, Whited (home) 35 → Whited wins (week 11, latest)
  };

  const archives: SeasonArchive[] = [
    makeArchive(2023, [row('Pruitt', 10, 4, 400, 350), row('Whited', 8, 6, 360, 380)], {
      ownerRosterCsv: rosterCsv,
      games: games2023,
      scoresByKey: scores2023,
    }),
    makeArchive(2025, [row('Pruitt', 11, 3, 420, 340), row('Whited', 9, 5, 380, 360)], {
      ownerRosterCsv: rosterCsv,
      games: games2025,
      scoresByKey: scores2025,
    }),
  ];

  const h2h = selectAllTimeHeadToHead(archives);
  assert.equal(h2h.length, 1);
  const entry = h2h[0]!;
  assert.equal(entry.ownerA, 'Pruitt');
  assert.equal(entry.ownerB, 'Whited');
  // Latest year wins; within 2025, last week (11) is the most recent meeting
  assert.equal(entry.latestMeeting!.year, 2025);
  assert.equal(entry.latestMeeting!.winner, 'Whited');
});

test('selectAllTimeHeadToHead.latestMeeting: returns null when archives have no qualifying matchups', () => {
  // Archive with finalStandings only (no games) → no head-to-head pairings created
  const archives: SeasonArchive[] = [
    makeArchive(2025, [row('Pruitt', 10, 4, 400, 350), row('Whited', 8, 6, 360, 380)]),
  ];

  const h2h = selectAllTimeHeadToHead(archives);
  assert.deepEqual(h2h, []);
});

test('selectTopRivalries: latestMeeting flows through to top rivalries output', () => {
  const rosterCsv = ['team,owner', 'PruittTeam,Pruitt', 'WhitedTeam,Whited'].join('\n');
  const games = [
    makeGame('g1', 1, 'PruittTeam', 'WhitedTeam'),
    makeGame('g2', 8, 'WhitedTeam', 'PruittTeam'),
  ];
  const scores = {
    g1: makeScore(28, 21), // Pruitt away 21, Whited home 28 → Whited wins
    g2: makeScore(14, 20), // Whited away 20, Pruitt home 14 → Whited wins (week 8 latest)
  };

  const archives: SeasonArchive[] = [
    makeArchive(2025, [row('Pruitt', 10, 4, 400, 350), row('Whited', 9, 5, 380, 360)], {
      ownerRosterCsv: rosterCsv,
      games,
      scoresByKey: scores,
    }),
  ];

  const top = selectTopRivalries(archives, 5);
  assert.equal(top.length, 1);
  assert.equal(top[0]!.latestMeeting!.year, 2025);
  assert.equal(top[0]!.latestMeeting!.winner, 'Whited');
});
