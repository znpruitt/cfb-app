import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyDurableOddsRecord, type CombinedOdds, type DurableOddsSnapshot } from '../../odds.ts';
import type { AppGame, ScheduleWireItem } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import { __resetTeamDatabaseStoreForTests } from '../../server/teamDatabaseStore.ts';
import {
  __resetDurableOddsStoreForTests,
  setDurableOddsStore,
} from '../../server/durableOddsStore.ts';
import { composeWeeklyRecap } from '../composeWeeklyRecap.ts';
import {
  loadRecapContext,
  loadRecapContextForSeasonScope,
  type WeeklyRecapContext,
} from '../loadRecapContext.ts';

const YEAR = 2026;
const REQUEST_NOW = new Date('2026-09-07T16:00:00.000Z');
const CANONICAL_GAME_KEY = '1-texas-georgia-H';
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

function closingOddsSnapshot(): DurableOddsSnapshot {
  return {
    capturedAt: '2026-09-05T20:00:00.000Z',
    bookmakerKey: 'draftkings',
    favorite: 'Texas',
    source: 'DraftKings',
    spread: -7.5,
    homeSpread: -7.5,
    awaySpread: 7.5,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    moneylineHome: -280,
    moneylineAway: 230,
    total: 51.5,
    overPrice: -110,
    underPrice: -110,
  };
}

function combinedOdds(args: {
  favorite: string;
  homeSpread: number;
  awaySpread: number;
}): CombinedOdds {
  return {
    favorite: args.favorite,
    spread: args.homeSpread,
    homeSpread: args.homeSpread,
    awaySpread: args.awaySpread,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 48.5,
    mlHome: -260,
    mlAway: 210,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-05T20:00:00.000Z',
    lineSourceStatus: 'closing',
  };
}

async function seedAvailableContext(slug: string): Promise<void> {
  await setAppState('schedule', `${YEAR}-all-all`, { items: [scheduleItem('401000001')] });
  await setAppState(`owners:${slug}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [scoreItem('401000001')],
  });
}

async function seedArchive(slug: string, year: number): Promise<void> {
  const archive: SeasonArchive = {
    leagueSlug: slug,
    year,
    archivedAt: `${year}-12-01T00:00:00.000Z`,
    ownerRosterSnapshot: 'team,owner\nTexas,Prior Alice\nGeorgia,Prior Bob\n',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  };
  await setAppState(`standings-archive:${slug}`, String(year), archive);
}

async function seedPriorArchive(slug: string): Promise<void> {
  await seedArchive(slug, YEAR - 1);
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
    odds: { status: 'available', byGameKey: {} },
    records: { status: 'available', archives: [], historicalRosters: {} },
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
  __resetDurableOddsStoreForTests();
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

test('loader returns typed absence when the schedule cache is genuinely missing', async () => {
  assert.deepEqual(await loadRecapContext('recap-missing', YEAR, REQUEST_NOW.toISOString()), {
    status: 'absent',
    reason: 'schedule',
  });
});

test('loader surfaces a durable read failure as unavailable rather than empty', async () => {
  __setAppStateReadFailureForTests(new Error('schedule read failed'), 'schedule');

  assert.deepEqual(await loadRecapContext('recap-failure', YEAR, REQUEST_NOW.toISOString()), {
    status: 'unavailable',
  });
});

test('loader assembles games, roster, and scores from one cache-only context', async () => {
  await seedAvailableContext('recap-available');
  await seedPriorArchive('recap-available');

  const result = await loadRecapContext('recap-available', YEAR, REQUEST_NOW.toISOString());

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.seasonYear, YEAR);
  assert.equal(result.context.games.length, 1);
  assert.equal(result.context.rosterByTeam.get('Texas'), 'Alice');
  assert.equal(Object.keys(result.context.scoresByKey).length, 1);
  assert.deepEqual(result.context.odds, { status: 'available', byGameKey: {} });
  assert.equal(result.context.records.status, 'available');
  if (result.context.records.status !== 'available') return;
  assert.deepEqual(
    result.context.records.archives.map((archive) => archive.year),
    [YEAR - 1]
  );
  assert.equal(result.context.records.historicalRosters[YEAR - 1]?.get('Texas'), 'Prior Alice');
});

test('loader excludes a same-year archive from historical record evidence', async () => {
  const slug = 'recap-same-year-archive';
  await seedAvailableContext(slug);
  await seedPriorArchive(slug);
  await seedArchive(slug, YEAR);

  const result = await loadRecapContext(slug, YEAR, REQUEST_NOW.toISOString());

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.records.status, 'available');
  if (result.context.records.status !== 'available') return;
  assert.deepEqual(
    result.context.records.archives.map((archive) => archive.year),
    [YEAR - 1]
  );
  assert.equal(result.context.records.historicalRosters[YEAR], undefined);
});

test('loader selects the stored closing line into the per-game odds lookup', async () => {
  await seedAvailableContext('recap-closing-odds');
  await setDurableOddsStore(YEAR, {
    [CANONICAL_GAME_KEY]: {
      ...emptyDurableOddsRecord(CANONICAL_GAME_KEY),
      closingSnapshot: closingOddsSnapshot(),
      closingFrozenAt: '2026-09-06T00:00:00.000Z',
    },
  });

  const result = await loadRecapContext('recap-closing-odds', YEAR, REQUEST_NOW.toISOString());

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.games[0]?.key, CANONICAL_GAME_KEY);
  assert.equal(result.context.odds.status, 'available');
  if (result.context.odds.status !== 'available') return;
  assert.equal(result.context.odds.byGameKey[CANONICAL_GAME_KEY]?.spread, -7.5);
  assert.equal(result.context.odds.byGameKey[CANONICAL_GAME_KEY]?.lineSourceStatus, 'closing');
});

test('loader isolates odds-store uncertainty from the core recap', async () => {
  await seedAvailableContext('recap-odds-failure');
  __setAppStateReadFailureForTests(new Error('odds store read failed'), `durable-odds:${YEAR}`);

  const result = await loadRecapContext('recap-odds-failure', YEAR, REQUEST_NOW.toISOString());
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(result.context.odds, { status: 'unavailable' });
});

test('loader isolates malformed durable odds rows from the core recap', async () => {
  const slug = 'recap-malformed-odds';
  await seedAvailableContext(slug);
  await setAppState(`durable-odds:${YEAR}`, 'store', {
    [CANONICAL_GAME_KEY]: {
      ...emptyDurableOddsRecord(CANONICAL_GAME_KEY),
      closingSnapshot: {
        ...closingOddsSnapshot(),
        spread: 'not-a-number',
      },
      closingFrozenAt: '2026-09-06T00:00:00.000Z',
    },
  });
  __resetDurableOddsStoreForTests();

  const result = await loadRecapContext(slug, YEAR, REQUEST_NOW.toISOString());

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(result.context.odds, { status: 'unavailable' });
});

test('loader isolates malformed archive projections from the core recap', async () => {
  const slug = 'recap-malformed-archive';
  await seedAvailableContext(slug);
  await setAppState(`standings-archive:${slug}`, String(YEAR - 1), {
    leagueSlug: slug,
    year: YEAR - 1,
    archivedAt: `${YEAR - 1}-12-01T00:00:00.000Z`,
    ownerRosterSnapshot: 'team,owner\nTexas,Prior Alice\nGeorgia,Prior Bob\n',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: null,
    games: [],
    scoresByKey: {},
  });

  const result = await loadRecapContext(slug, YEAR, REQUEST_NOW.toISOString());

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(result.context.records, { status: 'unavailable' });
  assert.equal(result.context.games.length, 1);
  assert.equal(result.context.rosterByTeam.get('Texas'), 'Alice');
});

test('loader treats a genuinely empty archive history as available context', async () => {
  await seedAvailableContext('recap-empty-history');

  const result = await loadRecapContext('recap-empty-history', YEAR, REQUEST_NOW.toISOString());

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(result.context.records, {
    status: 'available',
    archives: [],
    historicalRosters: {},
  });
});

test('loader isolates a listed null archive from the core recap', async () => {
  await seedAvailableContext('recap-null-archive');
  await setAppState<SeasonArchive | null>(
    'standings-archive:recap-null-archive',
    String(YEAR - 1),
    null
  );

  const result = await loadRecapContext('recap-null-archive', YEAR, REQUEST_NOW.toISOString());
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(result.context.records, { status: 'unavailable' });
});

test('loader keeps archive uncertainty scoped to record enrichment', async () => {
  await seedAvailableContext('recap-archive-failure');
  await seedPriorArchive('recap-archive-failure');
  __setAppStateReadFailureForTests(
    new Error('archive history read failed'),
    'standings-archive:recap-archive-failure'
  );

  const result = await loadRecapContext('recap-archive-failure', YEAR, REQUEST_NOW.toISOString());
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(result.context.records, { status: 'unavailable' });
});

test('schedule absence wins deterministically over simultaneous archive uncertainty', async () => {
  const slug = 'recap-absence-precedence';
  __setAppStateReadFailureForTests(
    new Error('the archive observer must see this when core data exists'),
    `standings-archive:${slug}`
  );

  assert.deepEqual(await loadRecapContext(slug, YEAR, REQUEST_NOW.toISOString()), {
    status: 'absent',
    reason: 'schedule',
  });

  const controlSlug = 'recap-absence-precedence-control';
  await seedAvailableContext(controlSlug);
  await seedPriorArchive(controlSlug);
  __setAppStateReadFailureForTests(
    new Error('the archive observer sees core-backed requests'),
    `standings-archive:${controlSlug}`
  );
  const positiveControl = await loadRecapContext(controlSlug, YEAR, REQUEST_NOW.toISOString());
  assert.equal(positiveControl.status, 'available');
  if (positiveControl.status !== 'available') return;
  assert.deepEqual(positiveControl.context.records, { status: 'unavailable' });
});

test('inactive lifecycle skips recap context loading, with an active-season positive control', async () => {
  __setAppStateReadFailureForTests(new Error('the active observer must see this'), 'schedule');

  // `null` proves the guard answered; the active control proves the real loader binding.
  assert.equal(
    await loadRecapContextForSeasonScope({
      leagueSlug: 'inactive-recap',
      seasonYear: YEAR,
      leagueStatus: { state: 'offseason' },
      now: REQUEST_NOW,
    }),
    null
  );

  assert.deepEqual(
    await loadRecapContextForSeasonScope({
      leagueSlug: 'active-recap',
      seasonYear: YEAR,
      leagueStatus: { state: 'season', year: YEAR },
      now: REQUEST_NOW,
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
  assert.equal(recap.tileHighlights.length, 3);
  assert.ok(recap.tileHighlights.every((line) => line.kind === 'record-change'));
});

test('composer keeps core results while omitting unavailable record and odds enrichment', () => {
  const recapGame = game();
  const coreContext = context([recapGame], {
    quiet: {
      status: 'final',
      away: { team: 'Georgia', score: 17 },
      home: { team: 'Texas', score: 31 },
      time: null,
    },
  });
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        ...coreContext,
        records: { status: 'unavailable' },
        odds: { status: 'unavailable' },
      },
    },
    REQUEST_NOW,
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.ownerLines.length, 2);
  assert.deepEqual(recap.recordChangeLines, []);
  assert.equal(recap.headToHeadLines.length, 1);
  assert.doesNotMatch(recap.headToHeadLines[0]?.label ?? '', /Odds upset/);
});

test('composer renders an odds upset from resolved sides even when stored favorite copy is wrong', () => {
  const upsetGame = game();
  const upsetContext = context([upsetGame], {
    quiet: {
      status: 'final',
      away: { team: 'Georgia', score: 31 },
      home: { team: 'Texas', score: 17 },
      time: null,
    },
  });
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        ...upsetContext,
        records: { status: 'unavailable' },
        odds: {
          status: 'available',
          byGameKey: {
            quiet: combinedOdds({
              favorite: 'Wrong stored favorite',
              homeSpread: -7.5,
              awaySpread: 7.5,
            }),
          },
        },
      },
    },
    REQUEST_NOW,
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(recap.headToHeadLines.length, 1);
  assert.match(recap.headToHeadLines[0]?.label ?? '', /Odds upset/);
  assert.equal(recap.headToHeadLines[0]?.winner.team, 'Georgia');
  assert.equal(recap.headToHeadLines[0]?.loser.team, 'Texas');
  assert.equal(recap.headToHeadLines[0]?.detail, 'Beat a 7.5-point favorite · 14-point margin');
  assert.equal(recap.tileHighlights.length, 1);
  assert.equal(recap.tileHighlights[0]?.kind, 'game');
  assert.equal(
    recap.tileHighlights[0]?.kind === 'game' ? recap.tileHighlights[0].gameKey : null,
    'quiet'
  );
});

test('composer emits one truthful notable result for a non-head-to-head game', () => {
  const notableGame = game({ key: 'notable', away: 'Purdue', home: 'Texas' });
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context([notableGame], {
        notable: {
          status: 'final',
          away: { team: 'Purdue', score: 27 },
          home: { team: 'Texas', score: 31 },
          time: null,
        },
      }),
    },
    REQUEST_NOW,
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.deepEqual(recap.headToHeadLines, []);
  assert.equal(recap.notableResultLines.length, 1);
  assert.equal(recap.notableResultLines[0]?.gameKey, 'notable');
  assert.equal(recap.notableResultLines[0]?.label, 'Closest game · Biggest margin');
  assert.equal(recap.notableResultLines[0]?.winner.team, 'Texas');
});

test('composer labels broad record ties without claiming the record vanished', () => {
  const owners = ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Frank', 'Grace'];
  const games = owners.map((owner, index) =>
    game({
      key: `broad-tie-${owner}`,
      week: index === 0 ? 1 : 2,
      date: index === 0 ? '2026-09-06T00:00:00.000Z' : '2026-09-13T00:00:00.000Z',
      away: `Opponent ${owner}`,
      home: `Team ${owner}`,
    })
  );
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map(owners.map((owner) => [`Team ${owner}`, owner])),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(0, 50)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-14T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const highScore = recap.recordChangeLines.find(
    (line) => line.id === 'record-single_season_high_score'
  );
  assert.equal(highScore?.value, 'Broad tie');
  assert.doesNotMatch(highScore?.value ?? '', /No longer current/);
  assert.equal(
    highScore?.context,
    '50 pts (2026 Wk 2) · Through Week 2 · Previous: 50 pts (2026 Wk 1) · Alice'
  );
});

test('composer names the directed rivalry when a prior record is no longer current', () => {
  const rivalryGames = [
    game({ key: 'rivalry-one', week: 1, date: '2026-09-06T00:00:00.000Z' }),
    game({ key: 'rivalry-two', week: 2, date: '2026-09-13T00:00:00.000Z' }),
    game({ key: 'rivalry-three', week: 3, date: '2026-09-20T00:00:00.000Z' }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: context(rivalryGames, {
        'rivalry-one': finalScore(10, 20),
        'rivalry-two': finalScore(10, 20),
        'rivalry-three': finalScore(20, 10),
      }),
    },
    new Date('2026-09-21T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const endedRivalries = recap.recordChangeLines.filter(
    (line) => line.id === 'record-lopsided_rivalry' || line.id === 'record-dominance_streak'
  );
  assert.equal(endedRivalries.length, 2);
  assert.ok(endedRivalries.every((line) => line.value === 'No longer current'));
  assert.ok(endedRivalries.every((line) => /Alice over Bob/.test(line.context)));
  assert.ok(endedRivalries.every((line) => !/Broad tie/.test(line.value)));
});

test('composer carries a truthful tied-rivalry predecessor into a sole record', () => {
  const games = [
    game({ key: 'alice-one', week: 1, home: 'Texas', away: 'Georgia' }),
    game({
      key: 'alice-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Georgia',
    }),
    game({
      key: 'alice-three',
      week: 3,
      date: '2026-09-20T00:00:00.000Z',
      home: 'Texas',
      away: 'Georgia',
    }),
    game({ key: 'carol-one', week: 1, home: 'Miami', away: 'Clemson' }),
    game({
      key: 'carol-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Miami',
      away: 'Clemson',
    }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Georgia', 'Bob'],
          ['Miami', 'Carol'],
          ['Clemson', 'Dan'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-21T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const rivalryLines = recap.recordChangeLines.filter(
    (line) => line.id === 'record-lopsided_rivalry' || line.id === 'record-dominance_streak'
  );
  assert.equal(rivalryLines.length, 2);
  assert.ok(rivalryLines.every((line) => /Alice over Bob/.test(line.context)));
  assert.ok(rivalryLines.every((line) => /2 rivalries tied/.test(line.context)));
  assert.ok(rivalryLines.every((line) => !/New league record/.test(line.context)));
});

test('composer names a suppressed broad tie instead of claiming the surviving pair is new', () => {
  const rivalries = [
    ['Alice', 'Bob', 'Texas', 'Georgia'],
    ['Carol', 'Dan', 'Miami', 'Clemson'],
    ['Erin', 'Frank', 'Ohio State', 'Michigan'],
    ['Grace', 'Heidi', 'Oregon', 'Washington'],
  ] as const;
  const games = rivalries.flatMap(([, , winnerTeam, loserTeam], index) => [
    game({
      key: `broad-${index}-one`,
      week: 1,
      date: '2026-09-06T00:00:00.000Z',
      home: winnerTeam,
      away: loserTeam,
    }),
    game({
      key: `broad-${index}-two`,
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: winnerTeam,
      away: loserTeam,
    }),
    ...(index === 0
      ? []
      : [
          game({
            key: `broad-${index}-reverse`,
            week: 3,
            date: '2026-09-20T00:00:00.000Z',
            home: loserTeam,
            away: winnerTeam,
          }),
        ]),
  ]);
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map(
          rivalries.flatMap(([winner, loser, winnerTeam, loserTeam]) => [
            [winnerTeam, winner] as const,
            [loserTeam, loser] as const,
          ])
        ),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-21T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const rivalryLines = recap.recordChangeLines.filter(
    (line) => line.id === 'record-lopsided_rivalry' || line.id === 'record-dominance_streak'
  );
  assert.equal(rivalryLines.length, 2);
  assert.deepEqual(
    rivalryLines.map(({ id, context }) => ({ id, context })),
    [
      {
        id: 'record-lopsided_rivalry',
        context: 'Alice over Bob · Through Week 3 · Previous: 2-game lead · Broad tie',
      },
      {
        id: 'record-dominance_streak',
        context: 'Alice over Bob · Through Week 3 · Previous: 2 straight · Broad tie',
      },
    ]
  );
  assert.ok(rivalryLines.every((line) => !/New league record/.test(line.context)));
});

test('composer preserves unique-to-tied rivalry changes with neutral pair copy', () => {
  const games = [
    game({ key: 'alice-one', week: 1, home: 'Texas', away: 'Georgia' }),
    game({
      key: 'alice-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Georgia',
    }),
    game({
      key: 'alice-three',
      week: 3,
      date: '2026-09-20T00:00:00.000Z',
      home: 'Texas',
      away: 'Georgia',
    }),
    game({ key: 'carol-one', week: 1, home: 'Miami', away: 'Clemson' }),
    game({
      key: 'carol-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Miami',
      away: 'Clemson',
    }),
    game({
      key: 'carol-three',
      week: 4,
      date: '2026-09-27T00:00:00.000Z',
      home: 'Miami',
      away: 'Clemson',
    }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Georgia', 'Bob'],
          ['Miami', 'Carol'],
          ['Clemson', 'Dan'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-28T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const rivalryLines = recap.recordChangeLines.filter(
    (line) => line.id === 'record-lopsided_rivalry' || line.id === 'record-dominance_streak'
  );
  assert.equal(rivalryLines.length, 2);
  assert.ok(rivalryLines.every((line) => /2 rivalries tied/.test(line.context)));
  assert.ok(rivalryLines.every((line) => /Previous: .*Alice over Bob/.test(line.context)));
});

test('composer keeps overlapping tied-pair changes visible when the owner union stays fixed', () => {
  const games = [
    game({ key: 'alice-one', week: 1, home: 'Texas', away: 'Georgia' }),
    game({
      key: 'alice-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Georgia',
    }),
    game({
      key: 'alice-three',
      week: 3,
      date: '2026-09-20T00:00:00.000Z',
      home: 'Georgia',
      away: 'Texas',
    }),
    game({ key: 'alice-carol-one', week: 1, home: 'Texas', away: 'Miami' }),
    game({
      key: 'alice-carol-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Miami',
    }),
    game({
      key: 'bob-carol-one',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Georgia',
      away: 'Miami',
    }),
    game({
      key: 'bob-carol-two',
      week: 3,
      date: '2026-09-20T00:00:00.000Z',
      home: 'Georgia',
      away: 'Miami',
    }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Georgia', 'Bob'],
          ['Miami', 'Carol'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-21T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const rivalryLines = recap.recordChangeLines.filter(
    (line) => line.id === 'record-lopsided_rivalry' || line.id === 'record-dominance_streak'
  );
  assert.equal(rivalryLines.length, 2);
  assert.ok(rivalryLines.every((line) => /2 rivalries tied/.test(line.context)));
  assert.ok(rivalryLines.every((line) => /Bob over Carol joined/.test(line.context)));
  assert.ok(rivalryLines.every((line) => /Alice over Bob dropped out/.test(line.context)));
  assert.ok(rivalryLines.every((line) => !/Previous:/.test(line.context)));
});

test('composer omits a sampled previous score when tied rivalry constituents swap', () => {
  const specs = [
    ['ab-one', 1, '2026-09-06T00:00:00.000Z', 'Texas', 'Georgia'],
    ['ab-two', 2, '2026-09-13T00:00:00.000Z', 'Texas', 'Georgia'],
    ['ab-three', 3, '2026-09-20T00:00:00.000Z', 'Texas', 'Georgia'],
    ['ab-four', 4, '2026-09-27T00:00:00.000Z', 'Georgia', 'Texas'],
    ['cd-one', 1, '2026-09-06T01:00:00.000Z', 'Miami', 'Clemson'],
    ['cd-two', 2, '2026-09-13T01:00:00.000Z', 'Miami', 'Clemson'],
    ['ef-one', 1, '2026-09-06T02:00:00.000Z', 'Ohio State', 'Michigan'],
    ['ab-five', 5, '2026-10-04T00:00:00.000Z', 'Georgia', 'Texas'],
    ['ef-five', 5, '2026-10-04T01:00:00.000Z', 'Ohio State', 'Michigan'],
  ] as const;
  const games = specs.map(([key, week, date, home, away]) => game({ key, week, date, home, away }));
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Georgia', 'Bob'],
          ['Miami', 'Carol'],
          ['Clemson', 'Dan'],
          ['Ohio State', 'Erin'],
          ['Michigan', 'Frank'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-10-05T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const lopsided = recap.recordChangeLines.find((line) => line.id === 'record-lopsided_rivalry');
  assert.equal(lopsided?.value, '2-game lead');
  assert.match(lopsided?.context ?? '', /Erin over Frank joined/);
  assert.match(lopsided?.context ?? '', /Alice over Bob dropped out/);
  assert.doesNotMatch(lopsided?.context ?? '', /Previous:/);
});

test('composer does not duplicate pair names when one sole rivalry replaces another', () => {
  const games = [
    game({ key: 'alice-one', week: 1, home: 'Texas', away: 'Georgia' }),
    game({
      key: 'alice-two',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Georgia',
    }),
    game({
      key: 'alice-three',
      week: 3,
      date: '2026-09-20T00:00:00.000Z',
      home: 'Georgia',
      away: 'Texas',
    }),
    game({
      key: 'carol-one',
      week: 3,
      date: '2026-09-20T01:00:00.000Z',
      home: 'Miami',
      away: 'Clemson',
    }),
    game({
      key: 'carol-two',
      week: 3,
      date: '2026-09-20T02:00:00.000Z',
      home: 'Miami',
      away: 'Clemson',
    }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Georgia', 'Bob'],
          ['Miami', 'Carol'],
          ['Clemson', 'Dan'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-21T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const rivalryLines = recap.recordChangeLines.filter(
    (line) => line.id === 'record-lopsided_rivalry' || line.id === 'record-dominance_streak'
  );
  assert.equal(rivalryLines.length, 2);
  for (const line of rivalryLines) {
    assert.equal(line.context.match(/Carol over Dan/g)?.length, 1);
    assert.equal(line.context.match(/Alice over Bob/g)?.length, 1);
    assert.doesNotMatch(line.context, /joined|dropped out/);
  }
});

test('composer describes tied even-rivalry records as pairs rather than one owner set', () => {
  const games = [
    game({ key: 'alice-win', week: 1, home: 'Texas', away: 'Georgia' }),
    game({
      key: 'bob-win',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Georgia',
      away: 'Texas',
    }),
    game({ key: 'carol-win', week: 1, home: 'Miami', away: 'Clemson' }),
    game({
      key: 'dan-win',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Clemson',
      away: 'Miami',
    }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Georgia', 'Bob'],
          ['Miami', 'Carol'],
          ['Clemson', 'Dan'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-14T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  const evenRivalry = recap.recordChangeLines.find((line) => line.id === 'record-even_rivalry');
  assert.match(evenRivalry?.context ?? '', /2 rivalries tied/);
  assert.doesNotMatch(evenRivalry?.context ?? '', /Alice, Bob, Carol & Dan/);
});

test('composer suppresses a record delta whose displayed value and subject did not change', () => {
  const games = [
    game({ key: 'alice-first', week: 1, home: 'Texas', away: 'Purdue' }),
    game({ key: 'carol-first', week: 1, home: 'Miami', away: 'UCF' }),
    game({
      key: 'alice-latest',
      week: 2,
      date: '2026-09-13T00:00:00.000Z',
      home: 'Texas',
      away: 'Rutgers',
    }),
  ];
  const recap = composeWeeklyRecap(
    {
      status: 'available',
      context: {
        seasonYear: YEAR,
        games,
        rosterByTeam: new Map([
          ['Texas', 'Alice'],
          ['Miami', 'Carol'],
        ]),
        scoresByKey: Object.fromEntries(games.map(({ key }) => [key, finalScore(10, 20)])),
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
    },
    new Date('2026-09-14T16:00:00.000Z'),
    ACTIVE_SCOPE
  );

  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') return;
  assert.equal(
    recap.recordChangeLines.some((line) => line.id === 'record-single_season_blowout'),
    false
  );
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
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
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
      context: {
        seasonYear: YEAR,
        games: tiedGames,
        rosterByTeam,
        scoresByKey,
        records: { status: 'available', archives: [], historicalRosters: {} },
        odds: { status: 'available', byGameKey: {} },
      },
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
