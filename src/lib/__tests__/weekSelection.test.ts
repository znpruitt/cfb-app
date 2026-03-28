import test from 'node:test';
import assert from 'node:assert/strict';

import type { AppGame } from '../schedule.ts';
import {
  chooseDefaultWeek,
  derivePostLoadDefaultWeekTabSelection,
  deriveRegularWeeks,
  filterGamesForWeek,
} from '../weekSelection.ts';

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

test('deriveRegularWeeks includes week 0 for week-context games', () => {
  const games = [
    game({ key: 'w2', week: 2, date: '2025-09-07T00:00:00.000Z' }),
    game({ key: 'w0', week: 0, date: '2025-08-24T00:00:00.000Z' }),
    game({ key: 'bowl', week: 17, stage: 'bowl', postseasonRole: 'bowl' }),
  ];

  assert.deepEqual(deriveRegularWeeks(games), [0, 2]);
});

test('filterGamesForWeek keeps selected week 0 games', () => {
  const games = [
    game({ key: 'week-0', week: 0, csvHome: 'Notre Dame', csvAway: 'Navy' }),
    game({ key: 'week-1', week: 1, csvHome: 'Texas', csvAway: 'Rice' }),
  ];

  assert.deepEqual(
    filterGamesForWeek(games, 0).map((g) => g.key),
    ['week-0']
  );
});

test('chooseDefaultWeek can return week 0 when it is the active started week', () => {
  const games = [
    game({ key: 'week-0', week: 0, date: '2025-08-24T12:00:00.000Z' }),
    game({ key: 'week-1', week: 1, date: '2025-09-01T12:00:00.000Z' }),
  ];

  const selected = chooseDefaultWeek({
    games,
    regularWeeks: [0, 1],
    nowMs: Date.parse('2025-08-24T13:00:00.000Z'),
  });

  assert.equal(selected, 0);
});

test('derivePostLoadDefaultWeekTabSelection preserves existing selection', () => {
  const decision = derivePostLoadDefaultWeekTabSelection({
    games: [game({ key: 'week-2', week: 2, date: '2025-09-06T12:00:00.000Z' })],
    regularWeeks: [2],
    selectedWeek: 2,
    selectedTab: 2,
  });

  assert.deepEqual(decision, {
    shouldApplyDefaultSelection: false,
    nextSelectedWeek: 2,
    nextSelectedTab: 2,
  });
});

test('derivePostLoadDefaultWeekTabSelection preserves tab when no regular weeks are available', () => {
  const decision = derivePostLoadDefaultWeekTabSelection({
    games: [],
    regularWeeks: [],
    selectedWeek: null,
    selectedTab: 'postseason',
  });

  assert.deepEqual(decision, {
    shouldApplyDefaultSelection: false,
    nextSelectedWeek: null,
    nextSelectedTab: 'postseason',
  });
});

test('derivePostLoadDefaultWeekTabSelection applies default week and tab when week is unset', () => {
  const decision = derivePostLoadDefaultWeekTabSelection({
    games: [game({ key: 'w3', week: 3, date: null }), game({ key: 'w5', week: 5, date: null })],
    regularWeeks: [3, 5],
    selectedWeek: null,
    selectedTab: 'postseason',
  });

  assert.deepEqual(decision, {
    shouldApplyDefaultSelection: true,
    nextSelectedWeek: 3,
    nextSelectedTab: 3,
  });
});
