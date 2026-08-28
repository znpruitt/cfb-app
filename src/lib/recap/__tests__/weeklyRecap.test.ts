import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame, ScheduleWireItem } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import { __resetTeamDatabaseStoreForTests } from '../../server/teamDatabaseStore.ts';
import { deriveStandingsHistory } from '../../standingsHistory.ts';
import { composeWeeklyRecap } from '../composeWeeklyRecap.ts';
import { loadRecapContext, type WeeklyRecapContext } from '../loadRecapContext.ts';

const YEAR = 2026;

function scheduleItem(id: string): ScheduleWireItem {
  return {
    id,
    week: 1,
    seasonType: 'regular',
    startDate: '2026-09-06T00:00:00.000Z',
    neutralSite: false,
    conferenceGame: true,
    homeTeam: 'Texas',
    awayTeam: 'Georgia',
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: 'STATUS_FINAL',
    completed: true,
  };
}

function scoreItem(id: string) {
  return {
    id,
    week: 1,
    seasonType: 'regular' as const,
    startDate: '2026-09-06T00:00:00.000Z',
    status: 'final',
    home: { team: 'Texas', score: 31 },
    away: { team: 'Georgia', score: 17 },
    time: null,
  };
}

async function seedAvailableContext(slug: string): Promise<void> {
  await setAppState('schedule', `${YEAR}-all-all`, { items: [scheduleItem('401000001')] });
  await setAppState(`owners:${slug}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [scoreItem('401000001')],
  });
}

function game(args: { key?: string; date?: string; startTimeTBD?: boolean } = {}): AppGame {
  const key = args.key ?? 'quiet';
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
    date: args.date ?? '2026-09-06T00:00:00.000Z',
    status: 'scheduled',
    rawStatus: 'scheduled',
    startTimeTBD: args.startTimeTBD ?? true,
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
        teamId: 'Georgia',
        displayName: 'Georgia',
        canonicalName: 'Georgia',
        rawName: 'Georgia',
      },
      home: {
        kind: 'team',
        teamId: 'Texas',
        displayName: 'Texas',
        canonicalName: 'Texas',
        rawName: 'Texas',
      },
    },
    csvAway: 'Georgia',
    csvHome: 'Texas',
    canAway: 'Georgia',
    canHome: 'Texas',
    awayConf: 'SEC',
    homeConf: 'SEC',
  };
}

function context(games: AppGame[], scoresByKey: Record<string, ScorePack>): WeeklyRecapContext {
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Georgia', 'Bob'],
  ]);
  return {
    games,
    rosterByTeam,
    scoresByKey,
    standingsHistory: deriveStandingsHistory({ games, rosterByTeam, scoresByKey }),
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

test('loader returns typed absence when the schedule cache is genuinely missing', async () => {
  assert.deepEqual(await loadRecapContext('recap-missing', YEAR), {
    status: 'absent',
    reason: 'schedule',
  });
});

test('loader surfaces a durable read failure as unavailable rather than empty', async () => {
  __setAppStateReadFailureForTests(new Error('schedule read failed'), 'schedule');

  assert.deepEqual(await loadRecapContext('recap-failure', YEAR), {
    status: 'unavailable',
  });
});

test('loader assembles games, roster, scores, and history from one cache-only context', async () => {
  await seedAvailableContext('recap-available');

  const result = await loadRecapContext('recap-available', YEAR);

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.games.length, 1);
  assert.equal(result.context.rosterByTeam.get('Texas'), 'Alice');
  assert.equal(result.context.standingsHistory.weeks.length, 1);
  assert.equal(Object.keys(result.context.scoresByKey).length, 1);
});

test('composer turns completed owner results into the minimal recap view model', () => {
  const recapGame = game();
  const scoresByKey: Record<string, ScorePack> = {
    quiet: {
      status: 'final',
      away: { team: 'Georgia', score: 17 },
      home: { team: 'Texas', score: 31 },
      time: null,
    },
  };

  const recap = composeWeeklyRecap(
    { status: 'available', context: context([recapGame], scoresByKey) },
    new Date('2026-09-07T16:00:00.000Z')
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.weekLabel, 'Week 1');
  assert.deepEqual(recap.ownerLines, [
    { owner: 'Alice', recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' },
    { owner: 'Bob', recordLabel: '0–1', pointsLabel: '17 PF · 31 PA' },
  ]);
  assert.equal(recap.unresolvedMessage, null);
  assert.equal(recap.abandonedMessage, null);
});

test('composer preserves a visible no-results state and both uncertainty messages', () => {
  const recapGame = game();
  const abandonedGame = game({
    key: 'abandoned',
    date: '2026-09-06T01:00:00.000Z',
    startTimeTBD: false,
  });
  const recap = composeWeeklyRecap(
    { status: 'available', context: context([recapGame, abandonedGame], {}) },
    new Date('2026-09-07T16:00:00.000Z')
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.deepEqual(recap.ownerLines, []);
  assert.equal(recap.unresolvedMessage, '1 game remains unresolved.');
  assert.equal(recap.abandonedMessage, '1 game has no recorded result.');
});

test('composer keeps context failure separate from genuine absence', () => {
  assert.deepEqual(composeWeeklyRecap({ status: 'unavailable' }, new Date()), {
    status: 'unavailable',
  });
  assert.deepEqual(composeWeeklyRecap({ status: 'absent', reason: 'schedule' }, new Date()), {
    status: 'absent',
  });
});
