import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveLeagueSummaryViewModel,
  deriveStandingsContextLabel,
  prioritizeOverviewItems,
} from '../selectors/overview';
import type { OverviewGameItem } from '../overview';
import type { AppGame } from '../schedule';
import type { StandingsCoverage } from '../standings';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? 1,
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
      away: {
        kind: 'team',
        teamId: 'away-id',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
      home: {
        kind: 'team',
        teamId: 'home-id',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

function item(key: string): OverviewGameItem {
  return {
    bucket: {
      game: game({ key }),
      awayOwner: 'Alex',
      homeOwner: 'Blake',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    score: undefined,
    priority: 2,
    sortDate: 0,
  };
}

test('prioritizeOverviewItems keeps highlight order and avoids duplicate labels', () => {
  const items = [item('fallback'), item('top'), item('upset')];
  const ordered = prioritizeOverviewItems({
    items,
    highlightSignals: {
      topMatchupKey: 'top',
      upsetWatchKeys: ['top', 'upset'],
      rankedHighlightKey: 'fallback',
    },
    rankingsByTeamId: new Map(),
    topOwnerNames: new Set(['Alex', 'Blake']),
  });

  assert.deepEqual(
    ordered.map((entry) => entry.item.bucket.game.key),
    ['top', 'upset', 'fallback']
  );
  assert.equal(ordered[0]?.highlightLabel, 'Upset watch');
  assert.equal(ordered[1]?.highlightLabel, 'Upset watch');
  assert.ok(Array.isArray(ordered[0]?.highlightTags));
});

test('deriveLeagueSummaryViewModel reports complete season champion copy', () => {
  const standingsCoverage: StandingsCoverage = { state: 'complete', message: null };
  const summary = deriveLeagueSummaryViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 10,
        losses: 2,
        winPct: 0.833,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 72,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Blake',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 30,
        gamesBack: 1,
        finalGames: 12,
      },
    ],
    context: {
      scopeLabel: 'Postseason',
      scopeDetail: 'the postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [
      {
        bucket: {
          game: game({ key: 'bowl-final', stage: 'bowl', postseasonRole: 'bowl' }),
          awayOwner: 'Alex',
          homeOwner: 'Blake',
          awayIsLeagueTeam: true,
          homeIsLeagueTeam: true,
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 30 },
          home: { team: 'Home', score: 17 },
        },
        priority: 2,
        sortDate: 0,
      },
    ],
    standingsCoverage,
  });

  assert.ok(summary);
  assert.equal(summary?.phase, 'complete');
  assert.equal(summary?.headline, 'Champion: Alex');
  assert.equal(summary?.progressSignal, 'Season complete');
});

test('deriveStandingsContextLabel returns null when leader gap is not tight', () => {
  assert.equal(
    deriveStandingsContextLabel([
      {
        owner: 'Alex',
        wins: 8,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Blake',
        wins: 5,
        losses: 3,
        winPct: 0.625,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 3,
        finalGames: 8,
      },
    ]),
    null
  );
});
