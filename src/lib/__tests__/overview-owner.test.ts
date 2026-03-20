import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveOwnerMatchupMatrix } from '../overview';
import { deriveOwnerViewSnapshot } from '../ownerView';
import type { ScorePack } from '../scores';
import type { AppGame } from '../schedule';
import type { OwnerStandingsRow } from '../standings';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'home',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'away',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

const standingsRows: OwnerStandingsRow[] = [
  {
    owner: 'Alice',
    wins: 4,
    losses: 1,
    winPct: 0.8,
    pointsFor: 150,
    pointsAgainst: 120,
    pointDifferential: 30,
    gamesBack: 0,
    finalGames: 5,
  },
  {
    owner: 'Bob',
    wins: 3,
    losses: 2,
    winPct: 0.6,
    pointsFor: 135,
    pointsAgainst: 128,
    pointDifferential: 7,
    gamesBack: 1,
    finalGames: 5,
  },
  {
    owner: 'Cara',
    wins: 2,
    losses: 3,
    winPct: 0.4,
    pointsFor: 118,
    pointsAgainst: 130,
    pointDifferential: -12,
    gamesBack: 2,
    finalGames: 5,
  },
];

const rosterByTeam = new Map([
  ['Texas', 'Alice'],
  ['Michigan', 'Alice'],
  ['Georgia', 'Bob'],
  ['Oregon', 'Cara'],
]);

test('deriveOwnerMatchupMatrix counts weekly owner matchups and final records', () => {
  const weekGames = [
    game({ key: 'g1', csvAway: 'Texas', csvHome: 'Georgia', status: 'final' }),
    game({ key: 'g2', csvAway: 'Michigan', csvHome: 'Georgia', status: 'final' }),
    game({ key: 'g3', csvAway: 'Oregon', csvHome: 'USC', status: 'scheduled' }),
  ];
  const scoresByKey: Record<string, ScorePack> = {
    g1: {
      home: { team: 'Georgia', score: 21 },
      away: { team: 'Texas', score: 28 },
      status: 'Final',
      time: null,
    },
    g2: {
      home: { team: 'Georgia', score: 24 },
      away: { team: 'Michigan', score: 17 },
      status: 'Final',
      time: null,
    },
  };

  const matrix = deriveOwnerMatchupMatrix({ weekGames, standingsRows, rosterByTeam, scoresByKey });

  assert.deepEqual(matrix.owners, ['Alice', 'Bob', 'Cara']);
  assert.equal(matrix.rows[0]?.cells[1]?.gameCount, 2);
  assert.equal(matrix.rows[0]?.cells[1]?.record, '1–1');
  assert.equal(matrix.rows[1]?.cells[0]?.gameCount, 2);
  assert.equal(matrix.rows[1]?.cells[0]?.record, '1–1');
  assert.equal(matrix.rows[2]?.cells[0]?.gameCount, 0);
});

test('deriveOwnerViewSnapshot builds owner-centric roster, live, and week sections', () => {
  const allGames = [
    game({ key: 'live-game', csvAway: 'Texas', csvHome: 'Georgia', status: 'in_progress' }),
    game({ key: 'sched-game', csvAway: 'Michigan', csvHome: 'USC', status: 'scheduled' }),
    game({ key: 'other-owner', csvAway: 'Oregon', csvHome: 'Washington', status: 'scheduled' }),
  ];
  const weekGames = allGames.slice(0, 2);
  const scoresByKey: Record<string, ScorePack> = {
    'live-game': {
      home: { team: 'Georgia', score: 17 },
      away: { team: 'Texas', score: 20 },
      status: 'In Progress',
      time: null,
    },
  };

  const snapshot = deriveOwnerViewSnapshot({
    selectedOwner: 'Alice',
    standingsRows,
    allGames,
    weekGames,
    rosterByTeam,
    scoresByKey,
  });

  assert.equal(snapshot.selectedOwner, 'Alice');
  assert.equal(snapshot.header?.rank, 1);
  assert.equal(snapshot.header?.record, '4–1');
  assert.equal(snapshot.rosterRows.length, 2);
  assert.equal(snapshot.liveRows.length, 1);
  assert.equal(snapshot.weekRows.length, 2);
  assert.equal(snapshot.weekSummary?.totalGames, 2);
  assert.match(snapshot.weekSummary?.performanceSummary ?? '', /live/i);
  assert.equal(snapshot.rosterRows[0]?.teamName, 'Texas');
});
