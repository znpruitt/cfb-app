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
import { composeWeeklyRecap } from '../composeWeeklyRecap.ts';
import {
  loadRecapContext,
  loadRecapContextForSeasonScope,
  type WeeklyRecapContext,
} from '../loadRecapContext.ts';

const YEAR = 2026;
const ACTIVE_SCOPE = {
  leagueStatus: { state: 'season', year: YEAR } as const,
  seasonYear: YEAR,
};

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
    seasonYear: YEAR,
    games,
    rosterByTeam,
    scoresByKey,
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

test('loader assembles games, roster, and scores from one cache-only context', async () => {
  await seedAvailableContext('recap-available');

  const result = await loadRecapContext('recap-available', YEAR);

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.seasonYear, YEAR);
  assert.equal(result.context.games.length, 1);
  assert.equal(result.context.rosterByTeam.get('Texas'), 'Alice');
  assert.equal(Object.keys(result.context.scoresByKey).length, 1);
});

test('inactive lifecycle skips recap context loading, with an active-season positive control', async () => {
  __setAppStateReadFailureForTests(new Error('the active observer must see this'), 'schedule');

  // `null` proves the guard answered; the active control proves the real loader binding.
  assert.equal(
    await loadRecapContextForSeasonScope({
      leagueSlug: 'inactive-recap',
      seasonYear: YEAR,
      leagueStatus: { state: 'offseason' },
    }),
    null
  );

  assert.deepEqual(
    await loadRecapContextForSeasonScope({
      leagueSlug: 'active-recap',
      seasonYear: YEAR,
      leagueStatus: { state: 'season', year: YEAR },
    }),
    { status: 'unavailable' }
  );
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
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
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
  assert.equal(recap.missingResultMessage, null);
});

test('composer preserves a visible no-results state while one sibling keeps the slate unresolved', () => {
  const recapGame = game();
  const abandonedGame = game({
    key: 'abandoned',
    date: '2026-09-06T01:00:00.000Z',
    startTimeTBD: false,
  });
  const recap = composeWeeklyRecap(
    { status: 'available', context: context([recapGame, abandonedGame], {}) },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.deepEqual(recap.ownerLines, []);
  assert.equal(recap.unresolvedMessage, '2 games remain unresolved.');
  assert.equal(recap.abandonedMessage, null);
  assert.equal(recap.missingResultMessage, null);
});

test('composer reports games without results only after every pending sibling clears the gate', () => {
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context(
        [
          game({ key: 'abandoned-one', startTimeTBD: false }),
          game({
            key: 'abandoned-two',
            date: '2026-09-06T01:00:00.000Z',
            startTimeTBD: false,
          }),
        ],
        {}
      ),
    },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.unresolvedMessage, null);
  assert.equal(recap.abandonedMessage, '2 games have no recorded result.');
});

test('composer surfaces a concluded game that is missing a usable result', () => {
  const missingResultGame = {
    ...game(),
    status: 'final' as const,
    rawStatus: 'final',
    completed: true,
  };
  const recap = composeWeeklyRecap(
    { status: 'available', context: context([missingResultGame], {}) },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.missingResultMessage, '1 game. Waiting on complete results.');
});

test('composer keeps context failure separate from genuine absence', () => {
  assert.deepEqual(composeWeeklyRecap({ status: 'unavailable' }, new Date(), ACTIVE_SCOPE), {
    status: 'unavailable',
  });
  assert.deepEqual(
    composeWeeklyRecap({ status: 'absent', reason: 'schedule' }, new Date(), ACTIVE_SCOPE),
    {
      status: 'absent',
    }
  );
});

test('composer suppresses request-time recaps outside the matching active season', () => {
  assert.deepEqual(
    composeWeeklyRecap({ status: 'unavailable' }, new Date(), {
      leagueStatus: { state: 'preseason', year: YEAR },
      seasonYear: YEAR,
    }),
    { status: 'inactive' }
  );
  assert.deepEqual(
    composeWeeklyRecap({ status: 'unavailable' }, new Date(), {
      leagueStatus: { state: 'offseason' },
      seasonYear: YEAR,
    }),
    { status: 'inactive' }
  );
  assert.deepEqual(
    composeWeeklyRecap({ status: 'unavailable' }, new Date(), {
      leagueStatus: { state: 'season', year: YEAR - 1 },
      seasonYear: YEAR,
    }),
    { status: 'inactive' }
  );
});

test('composer refuses an available context from a different season', () => {
  assert.deepEqual(
    composeWeeklyRecap(
      {
        status: 'available',
        context: { ...context([game()], {}), seasonYear: YEAR - 1 },
      },
      new Date('2026-09-07T16:00:00.000Z'),
      ACTIVE_SCOPE
    ),
    { status: 'unavailable' }
  );
});

test('composer keeps internal canonical offsets out of postseason week labels', () => {
  const postseasonGame = {
    ...game(),
    week: 16,
    canonicalWeek: 16,
    providerWeek: 1,
    stage: 'bowl' as const,
  };
  const recap = composeWeeklyRecap(
    { status: 'available', context: context([postseasonGame], {}) },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.weekLabel, 'Bowl');
});
