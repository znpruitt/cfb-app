import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../schedule.ts';
import {
  EMPTY_SCORE_HYDRATION_STATE,
  getBootstrapScoreHydrationGames,
  getCanonicalPostseasonGames,
  getCanonicalRegularGames,
  getHydrationSeasonTypes,
  getLazyScoreHydrationGames,
  markScoreHydrationLoaded,
} from '../scoreHydration.ts';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? null,
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
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
        teamId: 'h',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'IND',
    homeConf: overrides.homeConf ?? 'IND',
    sources: overrides.sources,
  };
}

const sampleGames = [
  game({ key: 'reg-1', week: 1, stage: 'regular' }),
  game({
    key: 'ccg',
    week: 15,
    stage: 'conference_championship',
    postseasonRole: 'conference_championship',
  }),
  game({ key: 'bowl', week: 18, stage: 'bowl', postseasonRole: 'bowl' }),
];

test('bootstrap hydration covers regular and postseason scopes so season standings are complete on first load', () => {
  assert.deepEqual(
    getBootstrapScoreHydrationGames({ games: sampleGames, selectedTab: 1 }).map((game) => game.key),
    ['reg-1', 'ccg', 'bowl']
  );
});

test('bootstrap hydration stays season-wide even when app opens on postseason tab', () => {
  assert.deepEqual(
    getBootstrapScoreHydrationGames({ games: sampleGames, selectedTab: 'postseason' }).map(
      (game) => game.key
    ),
    ['reg-1', 'ccg', 'bowl']
  );
});

test('conference championship hydration scope still maps to regular season type', () => {
  assert.deepEqual(getHydrationSeasonTypes(getCanonicalRegularGames(sampleGames)), ['regular']);
});

test('regular hydration does not mark postseason as loaded', () => {
  const next = markScoreHydrationLoaded(EMPTY_SCORE_HYDRATION_STATE, ['regular']);
  assert.deepEqual(next, { regular: true, postseason: false });
});

test('first postseason visit requests canonical postseason games exactly once', () => {
  const firstVisit = getLazyScoreHydrationGames({
    games: sampleGames,
    selectedTab: 'postseason',
    hydrationState: { regular: true, postseason: false },
  });
  assert.deepEqual(
    firstVisit.map((game) => game.key),
    ['bowl']
  );

  const revisited = getLazyScoreHydrationGames({
    games: sampleGames,
    selectedTab: 'postseason',
    hydrationState: { regular: true, postseason: true },
  });
  assert.deepEqual(revisited, []);
});

test('failed lazy postseason attempt does not immediately retry until user revisits tab', () => {
  const blockedRetry = getLazyScoreHydrationGames({
    games: sampleGames,
    selectedTab: 'postseason',
    hydrationState: { regular: true, postseason: false },
    hasAttemptedPostseasonHydration: true,
  });
  assert.deepEqual(blockedRetry, []);

  const revisitRetry = getLazyScoreHydrationGames({
    games: sampleGames,
    selectedTab: 'postseason',
    hydrationState: { regular: true, postseason: false },
    hasAttemptedPostseasonHydration: false,
  });
  assert.deepEqual(
    revisitRetry.map((game) => game.key),
    ['bowl']
  );
});

test('no postseason games keeps lazy postseason hydration idle', () => {
  const regularOnly = getLazyScoreHydrationGames({
    games: getCanonicalRegularGames(sampleGames),
    selectedTab: 'postseason',
    hydrationState: { regular: true, postseason: false },
  });
  assert.deepEqual(regularOnly, []);
});

test('canonical postseason scope excludes conference championship games', () => {
  assert.deepEqual(
    getCanonicalPostseasonGames(sampleGames).map((game) => game.key),
    ['bowl']
  );
});
