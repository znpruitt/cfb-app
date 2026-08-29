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

function game(
  args: {
    key?: string;
    week?: number;
    date?: string;
    startTimeTBD?: boolean;
    away?: string;
    home?: string;
  } = {}
): AppGame {
  const key = args.key ?? 'quiet';
  const week = args.week ?? 1;
  const away = args.away ?? 'Georgia';
  const home = args.home ?? 'Texas';
  return {
    key,
    eventId: key,
    eventKey: key,
    week,
    canonicalWeek: week,
    providerWeek: week,
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

function finalScore(away: number, home: number): ScorePack {
  return {
    status: 'final',
    away: { team: 'Away', score: away },
    home: { team: 'Home', score: home },
    time: null,
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
  assert.equal(recap.latestGameDate, '2026-09-05');
  assert.equal(recap.headline, 'Alice takes the week at 1–0');
  assert.equal(recap.isIncomplete, false);
  assert.deepEqual(recap.ownerLines, [
    { owner: 'Alice', recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' },
    { owner: 'Bob', recordLabel: '0–1', pointsLabel: '17 PF · 31 PA' },
  ]);
  assert.deepEqual(recap.leaderLines, [
    {
      id: 'best-record',
      label: 'Best record',
      value: '1–0',
      context: 'Alice · 31 PF',
    },
    {
      id: 'high-score',
      label: 'High score',
      value: '31',
      context: 'Alice · 1–0 on the week',
    },
    {
      id: 'closest-game',
      label: 'Closest game',
      value: '31–17',
      context: 'Alice over Bob · 14-point margin',
    },
  ]);
  assert.deepEqual(recap.tileLeaderLines, recap.leaderLines);
  assert.deepEqual(recap.movementLines, []);
});

test('composer exposes approved movement rows and the compact biggest-riser summary', () => {
  const games = [
    game({ key: 'week-one', week: 1, date: '2026-09-06T00:00:00.000Z' }),
    game({ key: 'week-two', week: 2, date: '2026-09-13T00:00:00.000Z' }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context(games, {
        'week-one': finalScore(31, 10),
        'week-two': finalScore(0, 50),
      }),
    },
    new Date('2026-09-14T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.deepEqual(recap.movementLines, [
    { owner: 'Alice', direction: 'up', deltaLabel: '▲ 1', shiftLabel: '#2 → #1' },
    { owner: 'Bob', direction: 'down', deltaLabel: '▼ 1', shiftLabel: '#1 → #2' },
  ]);
  assert.deepEqual(recap.tileLeaderLines.at(-1), {
    id: 'biggest-riser',
    label: 'Alice',
    value: '▲ 1',
    context: 'Biggest riser · #2 → #1',
    tone: 'positive',
  });
});

test('composer names every owner tied for biggest riser', () => {
  const games = [
    game({ key: 'alice-one', week: 1, home: 'Texas', away: 'Purdue' }),
    game({ key: 'bob-one', week: 1, home: 'Georgia', away: 'Rutgers' }),
    game({ key: 'carol-one', week: 1, home: 'Miami', away: 'Florida State' }),
    game({ key: 'dave-one', week: 1, home: 'Clemson', away: 'UCF' }),
    game({ key: 'eve-one', week: 1, home: 'Oregon', away: 'Washington' }),
    game({ key: 'frank-one', week: 1, home: 'Ohio State', away: 'Michigan' }),
    game({
      key: 'alice-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Purdue',
    }),
    game({
      key: 'bob-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Georgia',
      away: 'Rutgers',
    }),
    game({
      key: 'carol-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Miami',
      away: 'Florida State',
    }),
    game({
      key: 'dave-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Clemson',
      away: 'UCF',
    }),
    game({
      key: 'eve-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Oregon',
      away: 'Washington',
    }),
    game({
      key: 'frank-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Ohio State',
      away: 'Michigan',
    }),
  ];
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Georgia', 'Bob'],
    ['Miami', 'Carol'],
    ['Clemson', 'Dave'],
    ['Oregon', 'Eve'],
    ['Ohio State', 'Frank'],
  ]);
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam,
        scoresByKey: {
          'alice-one': finalScore(10, 70),
          'bob-one': finalScore(10, 60),
          'carol-one': finalScore(10, 50),
          'dave-one': finalScore(50, 10),
          'eve-one': finalScore(60, 10),
          'frank-one': finalScore(70, 10),
          'alice-two': finalScore(110, 10),
          'bob-two': finalScore(110, 10),
          'carol-two': finalScore(110, 10),
          'dave-two': finalScore(10, 110),
          'eve-two': finalScore(10, 110),
          'frank-two': finalScore(10, 110),
        },
      },
    },
    new Date('2026-09-14T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.deepEqual(recap.tileLeaderLines.at(-1), {
    id: 'biggest-riser',
    label: 'Biggest risers',
    value: '▲ 3',
    context: 'Dave, Eve & Frank',
    tone: 'positive',
  });
});

test('composer uses count copy when three owners share the exact weekly lead', () => {
  const tiedGames = [
    game({ key: 'alice-win', away: 'Florida', home: 'Texas' }),
    game({ key: 'bob-win', away: 'Clemson', home: 'Georgia' }),
    game({ key: 'carol-win', away: 'Florida', home: 'Miami' }),
  ];
  const rosterByTeam = new Map([
    ['Texas', 'Alice'],
    ['Georgia', 'Bob'],
    ['Miami', 'Carol'],
  ]);
  const scoresByKey: Record<string, ScorePack> = {
    'alice-win': finalScore(17, 31),
    'bob-win': finalScore(17, 31),
    'carol-win': finalScore(17, 31),
  };

  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: { seasonYear: YEAR, games: tiedGames, rosterByTeam, scoresByKey },
    },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.headline, 'Three owners share the week at 1–0');
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
  assert.equal(recap.headline, null);
  assert.equal(recap.isIncomplete, true);
});

test('composer gives populated incomplete weeks a factual visible fallback headline', () => {
  const completed = game({ key: 'completed' });
  const unresolved = game({
    key: 'unresolved',
    date: '2026-09-06T01:00:00.000Z',
    startTimeTBD: true,
  });
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context([completed, unresolved], {
        completed: {
          status: 'final',
          away: { team: 'Georgia', score: 17 },
          home: { team: 'Texas', score: 31 },
          time: null,
        },
      }),
    },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.headline, 'Week 1 results');
  assert.equal(recap.isIncomplete, true);
  assert.equal(recap.ownerLines.length, 2);
});

test('composer gives a fully resolved winless owner week a factual fallback headline', () => {
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context([game({ key: 'winless', away: 'Purdue', home: 'Texas' })], {
        winless: {
          status: 'final',
          away: { team: 'Purdue', score: 31 },
          home: { team: 'Texas', score: 17 },
          time: null,
        },
      }),
    },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.headline, 'Week 1 results');
  assert.equal(recap.isIncomplete, false);
  assert.deepEqual(recap.ownerLines, [
    { owner: 'Alice', recordLabel: '0–1', pointsLabel: '17 PF · 31 PA' },
  ]);
  assert.equal(
    recap.leaderLines.some((line) => line.id === 'best-record'),
    false,
    'a winless week has no best-record leader'
  );
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
  assert.equal(recap.headline, null);
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
  assert.equal(recap.headline, null);
});

test('composer names both owners when the best competitive weekly record is exactly tied', () => {
  const aliceGame = game({ key: 'alice-win', home: 'Texas', away: 'Purdue' });
  const bobGame = game({
    key: 'bob-win',
    date: '2026-09-06T01:00:00.000Z',
    home: 'Georgia',
    away: 'Rutgers',
  });
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context([aliceGame, bobGame], {
        'alice-win': {
          status: 'final',
          away: { team: 'Purdue', score: 17 },
          home: { team: 'Texas', score: 31 },
          time: null,
        },
        'bob-win': {
          status: 'final',
          away: { team: 'Rutgers', score: 17 },
          home: { team: 'Georgia', score: 31 },
          time: null,
        },
      }),
    },
    new Date('2026-09-07T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.headline, 'Alice and Bob share the week at 1–0');
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
