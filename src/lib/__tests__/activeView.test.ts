import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCanonicalActiveViewGames, deriveRegularWeekTabs } from '../activeView.ts';
import type { AppGame } from '../schedule.ts';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 0,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 0,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 0,
    date: overrides.date ?? null,
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
      home: { kind: 'placeholder', slotId: 'h', displayName: 'Home' },
      away: { kind: 'placeholder', slotId: 'a', displayName: 'Away' },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'IND',
    homeConf: overrides.homeConf ?? 'IND',
    sources: overrides.sources,
  };
}

test('postseason active view scope uses canonical postseason games instead of stale regular visible state', () => {
  const games = [
    game({ key: 'week-1', week: 1, stage: 'regular' }),
    game({
      key: 'bowl-1',
      week: 18,
      stage: 'bowl',
      postseasonRole: 'bowl',
      label: 'Fiesta Bowl',
    }),
  ];

  const scope = deriveCanonicalActiveViewGames({
    games,
    selectedTab: 'postseason',
    selectedWeek: 1,
  });

  assert.deepEqual(
    scope.map((g) => g.key),
    ['bowl-1']
  );
});

test('deriveRegularWeekTabs keeps week 0 and sorts it before week 1', () => {
  const games = [
    game({ key: 'week-1', week: 1 }),
    game({ key: 'week-0', week: 0 }),
    game({ key: 'bowl', week: 18, stage: 'bowl', postseasonRole: 'bowl' }),
  ];

  assert.deepEqual(deriveRegularWeekTabs(games), [0, 1]);
});

test('week 0 active view returns the week 0 canonical games', () => {
  const games = [
    game({ key: 'week-0-a', week: 0, csvHome: 'Notre Dame', csvAway: 'Navy' }),
    game({ key: 'week-1-a', week: 1, csvHome: 'Texas', csvAway: 'Rice' }),
  ];

  const scope = deriveCanonicalActiveViewGames({
    games,
    selectedTab: 0,
    selectedWeek: 0,
  });

  assert.deepEqual(
    scope.map((g) => g.key),
    ['week-0-a']
  );
});
