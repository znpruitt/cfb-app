import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';
import { deriveFinalOwnedParticipations } from '../../standings.ts';
import type {
  OwnerStandingsSeriesPoint,
  StandingsHistoryStandingRow,
} from '../../standingsHistory.ts';
import {
  IN_SEASON_RECORD_IDS,
  projectHistoricalInSeasonRecordEvidence,
  projectLiveInSeasonRecordEvidence,
  selectAllRecords,
  selectInSeasonRecordProjection,
} from '../leagueRecords.ts';

function standing(
  owner: string,
  wins: number,
  losses: number,
  pointsFor: number,
  pointsAgainst: number
): StandingsHistoryStandingRow {
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

function seriesPoint(
  week: number,
  wins: number,
  losses: number,
  pointsFor: number,
  pointsAgainst: number
): OwnerStandingsSeriesPoint {
  return {
    week,
    wins,
    losses,
    ties: 0,
    winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
    pointsFor,
    pointsAgainst,
    pointDifferential: pointsFor - pointsAgainst,
    gamesBack: 0,
  };
}

function game(key: string, week: number, away: string, home: string): AppGame {
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
    date: `2025-09-${String(week * 7).padStart(2, '0')}T16:00:00.000Z`,
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
        teamId: away,
        displayName: away,
        canonicalName: away,
        rawName: away,
      },
      home: {
        kind: 'team',
        teamId: home,
        displayName: home,
        canonicalName: home,
        rawName: home,
      },
    },
    csvAway: away,
    csvHome: home,
    canAway: away,
    canHome: home,
    awayConf: 'SEC',
    homeConf: 'SEC',
  };
}

function score(away: number, home: number): ScorePack {
  return {
    status: 'final',
    away: { team: 'Away', score: away },
    home: { team: 'Home', score: home },
    time: null,
  };
}

function completedArchive(): {
  archive: SeasonArchive;
  roster: Map<string, string>;
} {
  const games = [game('alice-win', 1, 'Beta', 'Alpha'), game('bob-win', 2, 'Alpha', 'Beta')];
  const scoresByKey = {
    'alice-win': score(20, 40),
    'bob-win': score(28, 35),
  };
  const roster = new Map([
    ['Alpha', 'Alice'],
    ['Beta', 'Bob'],
  ]);
  return {
    roster,
    archive: {
      leagueSlug: 'projection',
      year: 2025,
      archivedAt: '2025-12-01T00:00:00.000Z',
      ownerRosterSnapshot: 'team,owner\nAlpha,Alice\nBeta,Bob\n',
      standingsHistory: {
        weeks: [],
        byWeek: {},
        byOwner: {
          Alice: [seriesPoint(1, 1, 0, 40, 20), seriesPoint(2, 1, 1, 68, 55)],
          Bob: [seriesPoint(1, 0, 1, 20, 40), seriesPoint(2, 1, 1, 55, 68)],
        },
      },
      finalStandings: [standing('Alice', 1, 1, 68, 55), standing('Bob', 1, 1, 55, 68)],
      games,
      scoresByKey,
    },
  };
}

function recordById(records: ReturnType<typeof selectAllRecords>, id: string) {
  return [...records.career, ...records.season, ...records.rivalry, ...records.event].find(
    (record) => record.id === id
  );
}

test('partial-season projection exposes only the six safe ids while a naive archive mints a title', () => {
  const { archive, roster } = completedArchive();

  // Positive control: the legacy complete-season API treats any archive as
  // final and therefore credits the row-zero owner with a championship.
  const naive = selectAllRecords({
    archives: [archive],
    historicalRosters: { [archive.year]: roster },
    currentYear: 2026,
    currentRoster: roster,
  });
  assert.deepEqual(recordById(naive, 'career_titles')?.holders, ['Alice']);

  const liveEvidence = projectLiveInSeasonRecordEvidence({
    seasonYear: archive.year,
    participations: deriveFinalOwnedParticipations(archive.games, roster, archive.scoresByKey),
  });
  const safe = selectInSeasonRecordProjection([liveEvidence]);

  assert.deepEqual(Object.keys(safe), [...IN_SEASON_RECORD_IDS]);
  assert.equal('career_titles' in safe, false);
  assert.equal('single_season_points_low' in safe, false);
});

test('historical and canonical-live projections agree on the completed owned-final set and records', () => {
  const { archive, roster } = completedArchive();
  const historical = projectHistoricalInSeasonRecordEvidence({
    archives: [archive],
    historicalRosters: { [archive.year]: roster },
  });
  const live = projectLiveInSeasonRecordEvidence({
    seasonYear: archive.year,
    participations: deriveFinalOwnedParticipations(archive.games, roster, archive.scoresByKey),
  });
  const ownedFinalIdentity = (entry: (typeof historical.blowouts)[number]) => ({
    gameKey: entry.gameKey,
    winner: entry.winner,
    loser: entry.loser,
    margin: entry.margin,
  });

  assert.deepEqual(
    historical.blowouts.map(ownedFinalIdentity),
    live.blowouts.map(ownedFinalIdentity)
  );
  assert.deepEqual(
    historical.rivalryResults.map(ownedFinalIdentity),
    live.rivalryResults.map(ownedFinalIdentity)
  );
  assert.deepEqual(
    selectInSeasonRecordProjection([historical]),
    selectInSeasonRecordProjection([live])
  );

  const legacy = selectAllRecords({
    archives: [archive],
    historicalRosters: { [archive.year]: roster },
    currentYear: 2026,
    currentRoster: roster,
  });
  const projected = selectInSeasonRecordProjection([historical]);
  for (const id of IN_SEASON_RECORD_IDS) {
    assert.deepEqual(recordById(legacy, id) ?? null, projected[id]);
  }
});
