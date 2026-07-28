import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveScheduleLoadApplicationResult,
  isLiveIssue,
  isLiveOddsIssue,
} from '../cfbScheduleAppHelpers.ts';
import type { BuiltSchedule, AppGame } from '../schedule.ts';

test('isLiveOddsIssue matches only odds live issues, and stays a subset of isLiveIssue', () => {
  for (const odds of ['Odds error 402: quota', 'Odds fetch failed: network down']) {
    assert.equal(isLiveOddsIssue(odds), true, odds);
    assert.equal(isLiveIssue(odds), true, odds);
  }
  // Score-side and generic live issues are NOT odds issues (a score-only tick may
  // clear these while leaving an unresolved odds warning intact).
  for (const nonOdds of [
    'Scores fetch failed: boom',
    'Scores week 3 (regular): 502',
    'missing-score-match:g1',
    'No games loaded. CFBD schedule load may have failed.',
    'some unrelated issue',
  ]) {
    assert.equal(isLiveOddsIssue(nonOdds), false, nonOdds);
  }
});

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
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
      home: { kind: 'placeholder', slotId: 'home-slot', displayName: 'Home' },
      away: { kind: 'placeholder', slotId: 'away-slot', displayName: 'Away' },
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

function builtSchedule(overrides: Partial<BuiltSchedule>): BuiltSchedule {
  return {
    games: overrides.games ?? [],
    weeks: overrides.weeks ?? [],
    byes: overrides.byes ?? {},
    conferences: overrides.conferences ?? [],
    issues: overrides.issues ?? [],
    hydrationDiagnostics: overrides.hydrationDiagnostics ?? [],
  };
}

test('deriveScheduleLoadApplicationResult filters transient schedule issues', () => {
  const result = deriveScheduleLoadApplicationResult({
    built: builtSchedule({
      issues: ['out-of-scope-postseason-row:foo', 'identity-unresolved:bar'],
    }),
    selectedWeek: null,
    selectedTab: 'postseason',
    isDebug: false,
  });

  assert.deepEqual(result.nextScheduleIssues, ['identity-unresolved:bar']);
  assert.equal(result.hasGames, false);
  assert.deepEqual(result.regularWeeks, []);
  assert.equal(result.postLoadSelection.shouldApplyDefaultSelection, false);
});

test('deriveScheduleLoadApplicationResult appends actionable hydration diagnostics in debug mode', () => {
  const result = deriveScheduleLoadApplicationResult({
    built: builtSchedule({
      issues: [],
      hydrationDiagnostics: [
        {
          eventId: 'a',
          action: 'template-preserved',
          reason: 'noop',
          fieldsUpdated: [],
          confidence: 'low',
        },
        {
          eventId: 'b',
          action: 'inserted',
          reason: 'missing',
          fieldsUpdated: [],
          confidence: 'high',
        },
      ],
    }),
    selectedWeek: null,
    selectedTab: null,
    isDebug: true,
  });

  assert.deepEqual(result.nextScheduleIssues, ['hydrate:inserted:b:missing']);
});

test('deriveScheduleLoadApplicationResult prepares default week/tab decision for loaded games', () => {
  const result = deriveScheduleLoadApplicationResult({
    built: builtSchedule({
      games: [game({ key: 'w2', week: 2, date: null }), game({ key: 'w4', week: 4, date: null })],
    }),
    selectedWeek: null,
    selectedTab: 'postseason',
    isDebug: false,
  });

  assert.equal(result.hasGames, true);
  assert.deepEqual(result.regularWeeks, [2, 4]);
  assert.deepEqual(result.postLoadSelection, {
    shouldApplyDefaultSelection: true,
    nextSelectedWeek: 2,
    nextSelectedTab: 2,
  });
});
