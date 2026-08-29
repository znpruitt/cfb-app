import assert from 'node:assert/strict';
import test from 'node:test';

import type { CombinedOdds } from '../../odds.ts';
import type { AppGame } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import { deriveFinalOwnedParticipations } from '../../standings.ts';
import { selectWeeklyOddsUpsets } from '../weeklyOddsUpsets.ts';

function game(key: string, away = 'Underdog', home = 'Favorite'): AppGame {
  return {
    key,
    eventId: key,
    eventKey: key,
    week: 1,
    canonicalWeek: 1,
    providerWeek: 1,
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    date: '2026-09-06T00:00:00.000Z',
    status: 'final',
    rawStatus: 'STATUS_FINAL',
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

function finalScore(away: number, home: number): ScorePack {
  return {
    status: 'final',
    away: { team: 'Underdog', score: away },
    home: { team: 'Favorite', score: home },
    time: null,
  };
}

function odds(spread: number): CombinedOdds {
  return {
    favorite: 'Favorite',
    spread: -spread,
    homeSpread: -spread,
    awaySpread: spread,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 52.5,
    mlHome: -220,
    mlAway: 180,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-05T20:00:00.000Z',
    lineSourceStatus: 'closing',
  };
}

function select(args: {
  games: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam?: Map<string, string>;
  oddsByGameKey: Record<string, CombinedOdds>;
}) {
  const rosterByTeam =
    args.rosterByTeam ??
    new Map([
      ['Underdog', 'Alice'],
      ['Favorite', 'Bob'],
    ]);
  return selectWeeklyOddsUpsets({
    participations: deriveFinalOwnedParticipations(args.games, rosterByTeam, args.scoresByKey),
    week: 1,
    oddsByGameKey: args.oddsByGameKey,
  });
}

test('the shared six-point spread threshold includes -6 and excludes -5.5', () => {
  const atThreshold = game('at-threshold');
  const belowThreshold = game('below-threshold');
  const result = select({
    games: [atThreshold, belowThreshold],
    scoresByKey: {
      'at-threshold': finalScore(31, 24),
      'below-threshold': finalScore(31, 24),
    },
    oddsByGameKey: {
      'at-threshold': odds(6),
      'below-threshold': odds(5.5),
    },
  });

  assert.deepEqual(
    result.map(({ gameKey }) => gameKey),
    ['at-threshold']
  );
});

test('an owned-v-owned upset emits one structured fact with favorite, winner, and line source', () => {
  const upsetGame = game('owned-upset');
  const result = select({
    games: [upsetGame],
    scoresByKey: { 'owned-upset': finalScore(31, 24) },
    oddsByGameKey: { 'owned-upset': odds(7.5) },
  });

  assert.deepEqual(result, [
    {
      gameKey: 'owned-upset',
      week: 1,
      favoriteSide: 'home',
      favoriteTeam: 'Favorite',
      favoriteOwner: 'Bob',
      winnerSide: 'away',
      winnerTeam: 'Underdog',
      winnerOwner: 'Alice',
      winnerScore: 31,
      loserScore: 24,
      spreadMagnitude: 7.5,
      source: 'DraftKings',
      bookmakerKey: 'draftkings',
      lineSourceStatus: 'closing',
    },
  ]);
});

test('a favorite win is not selected as an odds upset', () => {
  const favoriteWin = game('favorite-win');
  assert.deepEqual(
    select({
      games: [favoriteWin],
      scoresByKey: { 'favorite-win': finalScore(17, 28) },
      oddsByGameKey: { 'favorite-win': odds(7.5) },
    }),
    []
  );
});

test('a final result without a line is not selected as an odds upset', () => {
  const noLine = game('no-line');
  assert.deepEqual(
    select({
      games: [noLine],
      scoresByKey: { 'no-line': finalScore(31, 24) },
      oddsByGameKey: {},
    }),
    []
  );
});

test('a NoClaim-only game cannot become a league odds-upset fact', () => {
  const noClaimGame = game('no-claim');
  assert.deepEqual(
    select({
      games: [noClaimGame],
      scoresByKey: { 'no-claim': finalScore(31, 24) },
      rosterByTeam: new Map([
        ['Underdog', 'NoClaim'],
        ['Favorite', 'NoClaim'],
      ]),
      oddsByGameKey: { 'no-claim': odds(7.5) },
    }),
    []
  );
});
