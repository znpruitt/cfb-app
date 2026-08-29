import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../../schedule.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';
import type { OwnedFinalParticipation } from '../../standings.ts';
import type { OwnerStandingsSeriesPoint } from '../../standingsHistory.ts';
import { selectWeeklyRecordChanges } from '../weeklyRecordChanges.ts';

function game(key: string, week: number): AppGame {
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
    date: `2026-09-${String(week * 7).padStart(2, '0')}T16:00:00.000Z`,
    status: 'final',
    rawStatus: 'final',
    completed: true,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: key,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: {
        kind: 'team',
        teamId: `${key}-away`,
        displayName: `${key}-away`,
        canonicalName: `${key}-away`,
        rawName: `${key}-away`,
      },
      home: {
        kind: 'team',
        teamId: `${key}-home`,
        displayName: `${key}-home`,
        canonicalName: `${key}-home`,
        rawName: `${key}-home`,
      },
    },
    csvAway: `${key}-away`,
    csvHome: `${key}-home`,
    canAway: `${key}-away`,
    canHome: `${key}-home`,
    awayConf: 'SEC',
    homeConf: 'SEC',
  };
}

function participation(owner: string, week: number, pointsFor: number): OwnedFinalParticipation {
  return {
    owner,
    game: game(`${owner}-${week}`, week),
    teamSide: 'home',
    teamName: `${owner} Team`,
    opponentTeamName: `Opponent ${week}`,
    pointsFor,
    pointsAgainst: Math.max(0, pointsFor - 7),
    result: 'win',
  };
}

function point(week: number, pointsFor: number, pointsAgainst: number): OwnerStandingsSeriesPoint {
  return {
    week,
    wins: 1,
    losses: 0,
    ties: 0,
    winPct: 1,
    pointsFor,
    pointsAgainst,
    pointDifferential: pointsFor - pointsAgainst,
    gamesBack: 0,
  };
}

function archive(points: number): SeasonArchive {
  return {
    leagueSlug: 'record-changes',
    year: 2025,
    archivedAt: '2025-12-01T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nAlice Team,Alice\n',
    standingsHistory: {
      weeks: [],
      byWeek: {},
      byOwner: { Alice: [point(1, points, Math.max(0, points - 7))] },
    },
    finalStandings: [
      {
        ...point(1, points, Math.max(0, points - 7)),
        owner: 'Alice',
        finalGames: 1,
      },
    ],
    games: [],
    scoresByKey: {},
  };
}

function changes(args: {
  historicalPoints: number;
  targetWeek: number;
  participations: OwnedFinalParticipation[];
}) {
  return selectWeeklyRecordChanges({
    archives: [archive(args.historicalPoints)],
    historicalRosters: { 2025: new Map([['Alice Team', 'Alice']]) },
    seasonYear: 2026,
    targetWeek: args.targetWeek,
    participations: args.participations,
  });
}

test('record diff reports a holder and value change caused by the explicit target week', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 2,
    participations: [participation('Bob', 1, 40), participation('Bob', 2, 20)],
  });
  const change = result.find((entry) => entry.id === 'single_season_points_high');

  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.previous?.value, 50);
  assert.deepEqual(change?.current?.holders, ['Bob']);
  assert.equal(change?.current?.value, 60);
});

test('record diff reports a newly tied holder when the value is unchanged', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 1,
    participations: [participation('Bob', 1, 50)],
  });
  const change = result.find((entry) => entry.id === 'single_season_high_score');

  assert.equal(change?.previous?.value, 50);
  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.current?.value, 50);
  assert.deepEqual(change?.current?.holders, ['Alice', 'Bob']);
});

test('record diff reports no movement when the target week changes no safe record', () => {
  assert.deepEqual(
    changes({
      historicalPoints: 100,
      targetWeek: 1,
      participations: [participation('Bob', 1, 40)],
    }),
    []
  );
});

test('record diff observes context movement even when holder and value stay fixed', () => {
  const result = changes({
    historicalPoints: 50,
    targetWeek: 1,
    participations: [participation('Alice', 1, 50)],
  });
  const change = result.find((entry) => entry.id === 'single_season_points_high');

  assert.deepEqual(change?.previous?.holders, ['Alice']);
  assert.equal(change?.previous?.value, 50);
  assert.equal(change?.previous?.contextString, '2025 season');
  assert.deepEqual(change?.current?.holders, ['Alice']);
  assert.equal(change?.current?.value, 50);
  assert.equal(change?.current?.contextString, '2026 season');
});
