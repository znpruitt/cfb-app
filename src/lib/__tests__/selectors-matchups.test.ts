import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveExcludedGamesSummary,
  deriveMatchupsHeaderCopy,
  deriveOddsAvailabilitySummary,
  deriveOpponentDescriptor,
  deriveOwnerOutcome,
  formatSlateSummaryText,
  summarizeSlateOpponents,
} from '../selectors/matchups.ts';
import type { OwnerSlateGame, OwnerWeekSlate } from '../matchups';
import type { AppGame } from '../schedule';

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

function slateGame(overrides: Partial<OwnerSlateGame>): OwnerSlateGame {
  return {
    owner: overrides.owner ?? 'Alex',
    game: overrides.game ?? game({}),
    ownerTeamSide: overrides.ownerTeamSide ?? 'away',
    ownerTeamId: overrides.ownerTeamId ?? 'away-id',
    ownerTeamName: overrides.ownerTeamName ?? 'Away',
    opponentTeamId: overrides.opponentTeamId ?? 'home-id',
    opponentTeamName: overrides.opponentTeamName ?? 'Home',
    opponentOwner: overrides.opponentOwner,
    isOwnerVsOwner: overrides.isOwnerVsOwner ?? false,
    isOpponentUnownedOrNonLeague: overrides.isOpponentUnownedOrNonLeague ?? true,
  };
}

test('selector derives summary and outcome including self-game edge case', () => {
  const self = slateGame({
    opponentOwner: 'Alex',
    isOwnerVsOwner: true,
    isOpponentUnownedOrNonLeague: false,
  });
  const entries = summarizeSlateOpponents({
    owner: 'Alex',
    games: [self, self],
    opponentOwners: ['Alex'],
    totalGames: 2,
    liveGames: 0,
    finalGames: 2,
    scheduledGames: 0,
    performance: { summary: '1-1', detail: 'x', tone: 'final' },
  } as OwnerWeekSlate);

  assert.equal(
    formatSlateSummaryText({ entries, totalGames: 2, expanded: false }),
    '2 games · vs Self (x2)'
  );

  const outcome = deriveOwnerOutcome({
    slateGame: self,
    score: {
      status: 'final',
      time: 'Final',
      away: { team: 'Away', score: 21 },
      home: { team: 'Home', score: 14 },
    },
  });
  assert.equal(outcome.tone, 'finalSelf');
});

test('selector summarizes header and exclusions deterministically', () => {
  assert.equal(
    deriveMatchupsHeaderCopy({ gamesCount: 3, oddsAvailableCount: 0 }),
    'Odds are unavailable.'
  );
  assert.equal(
    deriveMatchupsHeaderCopy({ gamesCount: 3, oddsAvailableCount: 2 }),
    'Odds available for 2/3 games.'
  );
  assert.equal(
    deriveOddsAvailabilitySummary({ gamesCount: 3, oddsAvailableCount: 2 }),
    'Odds available for 2/3 games.'
  );
  assert.equal(
    deriveExcludedGamesSummary({
      ownerMatchups: [],
      secondaryGames: [],
      otherGames: [{ game: game({}), awayIsLeagueTeam: false, homeIsLeagueTeam: false }],
    }),
    '1 excluded game do not involve owned teams.'
  );
});

test('deriveOpponentDescriptor uses non-owner fallback labels', () => {
  const descriptor = deriveOpponentDescriptor(
    slateGame({
      game: game({
        participants: {
          away: {
            kind: 'team',
            teamId: 'away-id',
            displayName: 'Away',
            canonicalName: 'Away',
            rawName: 'Away',
          },
          home: { kind: 'placeholder', slotId: 'slot-home', displayName: 'Winner G1' },
        },
      }),
      opponentOwner: undefined,
    })
  );

  assert.equal(descriptor, 'Winner G1');
});
