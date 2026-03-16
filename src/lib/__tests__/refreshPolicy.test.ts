import assert from 'node:assert/strict';
import test from 'node:test';

import { getRefreshPlan } from '../refreshPolicy';
import type { AppGame } from '../schedule';
import type { ScorePack } from '../scores';

function makeGame(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: overrides.key ?? 'g-1',
    eventId: overrides.eventId ?? 'e-1',
    week: overrides.week ?? 10,
    date: overrides.date ?? '2026-10-10T18:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'k1',
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
    participants:
      overrides.participants ??
      ({
        home: {
          kind: 'team',
          canonicalName: 'Home',
          displayName: 'Home',
          rawName: 'Home',
          teamId: 'home',
        },
        away: {
          kind: 'team',
          canonicalName: 'Away',
          displayName: 'Away',
          rawName: 'Away',
          teamId: 'away',
        },
      } as AppGame['participants']),
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
  };
}

test('suppresses live refresh when there are no visible games', () => {
  const plan = getRefreshPlan({
    season: 2026,
    visibleGames: [],
    scoresByKey: {},
    now: new Date('2026-10-01T12:00:00.000Z'),
  });

  assert.equal(plan.scores.fetchOnStartup, false);
  assert.equal(plan.scores.allowAutoOnFocus, false);
  assert.equal(plan.odds.fetchOnStartup, false);
  assert.equal(plan.odds.manualOnly, true);
});

test('enables score auto-refresh for active in-window games', () => {
  const game = makeGame({ key: 'live', date: '2026-10-01T18:00:00.000Z' });
  const scoresByKey: Record<string, ScorePack> = {
    live: {
      status: 'in progress',
      home: { team: 'Home', score: 10 },
      away: { team: 'Away', score: 7 },
      time: 'Q3',
    },
  };

  const plan = getRefreshPlan({
    season: 2026,
    visibleGames: [game],
    scoresByKey,
    now: new Date('2026-10-01T19:00:00.000Z'),
  });

  assert.equal(plan.scores.fetchOnStartup, true);
  assert.equal(plan.scores.allowAutoOnFocus, true);
  assert.equal(plan.odds.fetchOnStartup, true);
  assert.equal(plan.odds.manualOnly, true);
});

test('suppresses odds and score auto-refresh for stale final historical views', () => {
  const game = makeGame({ key: 'final', date: '2024-09-01T18:00:00.000Z' });
  const scoresByKey: Record<string, ScorePack> = {
    final: {
      status: 'Final',
      home: { team: 'Home', score: 31 },
      away: { team: 'Away', score: 14 },
      time: null,
    },
  };

  const plan = getRefreshPlan({
    season: 2024,
    visibleGames: [game],
    scoresByKey,
    now: new Date('2026-10-01T19:00:00.000Z'),
  });

  assert.equal(plan.scores.allowAutoOnFocus, false);
  assert.equal(plan.scores.manualOnly, true);
  assert.equal(plan.odds.fetchOnStartup, false);
});
