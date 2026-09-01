import assert from 'node:assert/strict';
import test from 'node:test';

// Install the Next work store before the route module loads so this file can
// observe the exact point at which `invalidateStandings` appends its tags.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { weekPartitionScope, yearScope } from '@/lib/providerRefreshScope';
import type { CacheEntry } from '@/lib/scores/cache';
import type { ScorePack } from '@/lib/scores/types';
import {
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import { getProviderRefreshStatus } from '@/lib/server/providerRefreshStatus';
import {
  __setCanonicalStandingsInvalidatorForTests,
  __setCanonicalStandingsWarmerForTests,
} from '@/lib/server/standingsCacheWarmer';

import {
  YEAR,
  resetForTest,
  restoreEnv,
  runCron,
  seedSchedule,
  seedScoreEntry,
  stubProvider,
} from './harness';

test.beforeEach(async () => {
  await resetForTest();
  __setCanonicalStandingsInvalidatorForTests(null);
  __setCanonicalStandingsWarmerForTests(null);
});
test.afterEach(() => {
  __setCanonicalStandingsInvalidatorForTests(null);
  __setCanonicalStandingsWarmerForTests(null);
});
test.after(restoreEnv);

function scoreboardRow(o: {
  id: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  homeId: number;
  awayId: number;
  home: string;
  away: string;
  hp?: number | null;
  ap?: number | null;
  period?: number;
  clock?: string;
}) {
  return {
    id: o.id,
    status: o.status,
    period: o.period ?? null,
    clock: o.clock ?? null,
    homeTeam: { id: o.homeId, name: o.home, points: o.hp ?? null },
    awayTeam: { id: o.awayId, name: o.away, points: o.ap ?? null },
  };
}

function finalPack(id: string, home: string, away: string, hs: number, as: number): ScorePack {
  return {
    id,
    seasonType: 'regular',
    startDate: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    week: 3,
    status: 'final',
    home: { team: home, score: hs },
    away: { team: away, score: as },
    time: null,
  };
}

async function readScores(week: number): Promise<CacheEntry | null> {
  return (await getAppState<CacheEntry>('scores', `${YEAR}-${week}-regular`))?.value ?? null;
}

// ---- Scoreboard happy path + exact-scope status (prompt cases 8, 17, 20) ---

test('a live scoreboard score is written once; exact week-partition status, no year rollup', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  const { urls } = stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'in_progress',
        period: 2,
        clock: '05:00',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 14,
        ap: 7,
      }),
    ],
  });
  const { res, event } = await runCron();

  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  assert.equal(event.reason, 'scoreboard-written-clean');
  assert.equal(event.mode, 'scoreboard');
  assert.equal(event.committedGames, 1);
  assert.equal(event.providerCallAttempted, true);
  assert.equal(urls.filter((u) => u.includes('/scoreboard')).length, 1);
  assert.equal(
    urls.filter((u) => u.includes('/records')).length,
    0,
    'a committed live score is not a committed finalisation'
  );

  const entry = await readScores(3);
  assert.equal(entry!.items[0]!.status, 'Q2 5:00');
  assert.equal(entry!.items[0]!.home.score, 14);
  assert.equal(entry!.itemUpdatedAtById!['401001'] > 0, true);

  const weekStatus = await getProviderRefreshStatus(
    'scores',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(weekStatus.latestAttemptOutcome, 'succeeded');
  const yearStatus = await getProviderRefreshStatus('scores', yearScope(YEAR));
  assert.equal(yearStatus.latestAttemptOutcome, null);
});

test('the live-score writer warms the invalidated league and isolates a warm failure', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  await setAppState('leagues', 'registry', [
    {
      slug: 'league-a',
      displayName: 'League A',
      year: YEAR,
      status: { state: 'season', year: YEAR },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'in_progress',
        period: 2,
        clock: '05:00',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 14,
        ap: 7,
      }),
    ],
  });
  const warmed: Array<{ slug: string; year: number }> = [];
  __setCanonicalStandingsWarmerForTests(async (slug, year) => {
    warmed.push({ slug, year });
    throw new Error('standings warm unavailable');
  });
  const store = {
    route: '/api/cron/live-scores',
    incrementalCache: { revalidateTag: async () => undefined },
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };

  const { res, event } = await workAsyncStorage.run(store as never, () => runCron());

  assert.deepEqual(warmed, [{ slug: 'league-a', year: YEAR }]);
  assert.equal(event.result, 'success', 'warming cannot relabel a committed live-score run');
  assert.equal(res!.status, 200);
  assert.equal((await readScores(3))?.items.length, 1, 'the score commit remains durable');
});

test('one scoreboard request serves targets spanning multiple week partitions', async () => {
  await seedSchedule([
    { id: 401001, week: 3, ageHours: 1, home: 'Alabama', away: 'Georgia', homeId: 333, awayId: 61 },
    {
      id: 401002,
      week: 5,
      ageHours: 1,
      home: 'Ohio State',
      away: 'Michigan',
      homeId: 194,
      awayId: 130,
    },
  ]);
  const { urls } = stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'in_progress',
        period: 1,
        clock: '10:00',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 3,
        ap: 0,
      }),
      scoreboardRow({
        id: 401002,
        status: 'in_progress',
        period: 3,
        clock: '02:00',
        homeId: 194,
        awayId: 130,
        home: 'Ohio State',
        away: 'Michigan',
        hp: 21,
        ap: 14,
      }),
    ],
  });
  const { event } = await runCron();
  assert.equal(event.targetPartitions, 2);
  assert.equal(event.committedGames, 2);
  assert.equal(event.result, 'success');
  assert.equal(urls.filter((u) => u.includes('/scoreboard')).length, 1); // exactly one fetch
});

test('an unchanged scoreboard response is a clean no-op (no write, no committed games)', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  await seedScoreEntry(3, 'regular', {
    at: 1000,
    items: [
      {
        id: '401001',
        seasonType: 'regular',
        startDate: null,
        week: 3,
        status: 'Q2 5:00',
        home: { team: 'Alabama', score: 14 },
        away: { team: 'Georgia', score: 7 },
        time: null,
      },
    ],
    itemUpdatedAtById: { '401001': 1000 },
  });
  const { urls } = stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'in_progress',
        period: 2,
        clock: '05:00',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 14,
        ap: 7,
      }),
    ],
  });
  const { event } = await runCron();
  assert.equal(event.result, 'no-op');
  assert.equal(event.reason, 'scoreboard-unchanged-clean');
  assert.equal(event.committedGames, 0);
  assert.equal(event.providerCallAttempted, true);
  assert.equal(urls.filter((url) => url.includes('/scoreboard')).length, 1);
  const status = await getProviderRefreshStatus('scores', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'no-op');
  const entry = await readScores(3);
  assert.equal(entry!.at, 1000); // untouched
});

// ---- Payload classifications (prompt case 13) -----------------------------

async function runWithScoreboard(scoreboard: unknown) {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  stubProvider({ scoreboard });
  return runCron();
}

test('a non-array scoreboard payload is scoreboard-invalid-payload', async () => {
  const { res, event } = await runWithScoreboard({ games: [] });
  assert.equal(event.reason, 'scoreboard-invalid-payload');
  assert.equal(res!.status, 500);
});

test('an empty scoreboard array while targets exist is scoreboard-empty-unexpected', async () => {
  const { event } = await runWithScoreboard([]);
  assert.equal(event.reason, 'scoreboard-empty-unexpected');
});

test('a nonempty scoreboard with no usable rows is scoreboard-schema-drift', async () => {
  const { event } = await runWithScoreboard([{ id: 'bad', status: 'weird' }]);
  assert.equal(event.reason, 'scoreboard-schema-drift');
});

test('usable rows that match no target is scoreboard-no-target-matches', async () => {
  const { event } = await runWithScoreboard([
    scoreboardRow({
      id: 999999,
      status: 'in_progress',
      homeId: 1,
      awayId: 2,
      home: 'Foo',
      away: 'Bar',
    }),
  ]);
  assert.equal(event.reason, 'scoreboard-no-target-matches');
});

// ---- Durable-first transaction failure (prompt case 15) -------------------

test('a durable write failure reports durable-commit-failed and preserves prior-good data', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 1, homeId: 333, awayId: 61 }]);
  await seedScoreEntry(3, 'regular', {
    at: 1000,
    items: [
      {
        id: '401001',
        seasonType: 'regular',
        startDate: null,
        week: 3,
        status: 'Q1 10:00',
        home: { team: 'Alabama', score: 3 },
        away: { team: 'Georgia', score: 0 },
        time: null,
      },
    ],
    itemUpdatedAtById: { '401001': 1000 },
  });
  stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'in_progress',
        period: 3,
        clock: '02:00',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 21,
        ap: 14,
      }),
    ],
  });
  __setAppStateWriteFailureForTests(new Error('durable write boom'), 'scores');

  const { res, event } = await runCron();
  __setAppStateWriteFailureForTests(null);

  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'durable-commit-failed');
  assert.equal(event.committedGames, 0);
  assert.equal(res!.status, 500);
  // Prior-good durable row is untouched.
  const entry = await readScores(3);
  assert.equal(entry!.items[0]!.status, 'Q1 10:00');
  assert.equal(entry!.items[0]!.home.score, 3);
  assert.equal(entry!.at, 1000);
  const weekStatus = await getProviderRefreshStatus(
    'scores',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(weekStatus.latestAttemptOutcome, 'failed');
});

// ---- Scoreboard final becomes pending confirmation (prompt case 18) --------

test('a scoreboard completed row is written final and recorded pending /games confirmation', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 3, homeId: 333, awayId: 61 }]);
  const { urls } = stubProvider({
    // /info is quota-free; the 1,002 boundary leaves the 1,000-call reserve
    // after the maximum one scoreboard + one records request in this run.
    remainingCalls: 1002,
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'completed',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 27,
        ap: 24,
      }),
    ],
    records: [
      {
        year: YEAR,
        teamId: 333,
        team: 'Alabama',
        classification: 'fbs',
        conference: 'SEC',
        total: { games: 3, wins: 2, losses: 1, ties: 0 },
      },
    ],
  });
  const { event } = await runCron();
  assert.equal(event.result, 'success');
  assert.equal(event.committedGames, 1);
  const entry = await readScores(3);
  assert.equal(entry!.items[0]!.status, 'final');
  assert.deepEqual(entry!.pendingFinalConfirmationIds, ['401001']);
  assert.equal(urls.filter((url) => url.includes('/records?year=')).length, 1);
  const records = await getAppState<{ items: Array<{ teamId: number }> }>(
    'team-records',
    String(YEAR)
  );
  assert.equal(records?.value.items[0]?.teamId, 333);
  const recordsStatus = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(recordsStatus.latestAttemptOutcome, 'succeeded');
});

test('standings invalidate before a final-triggered records request can finish', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 3, homeId: 333, awayId: 61 }]);
  await setAppState('leagues', 'registry', [
    {
      slug: 'league-a',
      displayName: 'League A',
      year: YEAR,
      status: 'season',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);

  let releaseRecords!: (payload: unknown) => void;
  const recordsGate = new Promise<unknown>((resolve) => {
    releaseRecords = resolve;
  });
  const { urls } = stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'completed',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 27,
        ap: 24,
      }),
    ],
    records: recordsGate,
  });
  const store = {
    route: '/api/cron/live-scores',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };

  const cron = workAsyncStorage.run(store as never, () => runCron());
  for (let i = 0; i < 100 && !urls.some((url) => url.includes('/records?year=')); i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(
    urls.some((url) => url.includes('/records?year=')),
    'the test held an in-flight records request'
  );
  const invalidatedBeforeRecordsFinished = store.pendingRevalidatedTags.includes(
    `standings:league-a:${YEAR}`
  );

  releaseRecords([
    {
      year: YEAR,
      teamId: 333,
      team: 'Alabama',
      classification: 'fbs',
      conference: 'SEC',
      total: { games: 3, wins: 2, losses: 1, ties: 0 },
    },
  ]);
  const { event } = await cron;

  assert.equal(event.result, 'success');
  assert.equal(
    invalidatedBeforeRecordsFinished,
    true,
    'standings invalidation must precede the slower /records request'
  );
});

test('a records failure does not relabel the shared live-scores run or its score scope', async () => {
  await seedSchedule([{ id: 401001, week: 3, ageHours: 3, homeId: 333, awayId: 61 }]);
  stubProvider({
    scoreboard: [
      scoreboardRow({
        id: 401001,
        status: 'completed',
        homeId: 333,
        awayId: 61,
        home: 'Alabama',
        away: 'Georgia',
        hp: 27,
        ap: 24,
      }),
    ],
    records: { wrong: 'top-level shape' },
  });

  const { event } = await runCron();
  assert.equal(event.result, 'success', 'records health is not scheduler/score health');
  assert.equal(
    (await getProviderRefreshStatus('scores', weekPartitionScope(YEAR, 3, 'regular')))
      .latestAttemptOutcome,
    'succeeded'
  );
  const recordsStatus = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(recordsStatus.latestAttemptOutcome, 'failed');
  assert.equal(recordsStatus.lastError?.code, 'records-invalid-payload');
});

// ---- Final reconciliation (prompt case 19) --------------------------------

async function seedPendingFinal() {
  await seedSchedule([
    { id: 401001, week: 3, ageHours: 4, status: 'STATUS_FINAL', homeId: 333, awayId: 61 },
  ]);
  await seedScoreEntry(3, 'regular', {
    at: 1000,
    items: [finalPack('401001', 'Alabama', 'Georgia', 27, 24)],
    itemUpdatedAtById: { '401001': 1000 },
    pendingFinalConfirmationIds: ['401001'],
  });
}

test('a /games confirmation clears the pending final via /games (never /scoreboard)', async () => {
  await seedPendingFinal();
  const { urls } = stubProvider({
    games: [
      {
        id: 401001,
        home_team: 'Alabama',
        away_team: 'Georgia',
        home_points: 27,
        away_points: 24,
        status: 'final',
      },
    ],
  });
  const { event } = await runCron();
  assert.equal(event.mode, 'final-reconciliation');
  assert.equal(event.result, 'success');
  assert.equal(event.reason, 'final-reconciliation-confirmed');
  // A same-score confirmation is a metadata-only change: 0 committed games, so
  // standings invalidation (gated on committed > 0) does NOT fire (prompt case 17).
  assert.equal(event.committedGames, 0);
  assert.equal(urls.filter((u) => u.includes('/games')).length, 1);
  assert.equal(urls.filter((u) => u.includes('/scoreboard')).length, 0);
  const entry = await readScores(3);
  assert.equal(entry!.pendingFinalConfirmationIds, undefined); // cleared
});

test('a corrected /games final rewrites the score and clears pending', async () => {
  await seedPendingFinal();
  stubProvider({
    games: [
      {
        id: 401001,
        home_team: 'Alabama',
        away_team: 'Georgia',
        home_points: 31,
        away_points: 24,
        status: 'final',
      },
    ],
  });
  const { event } = await runCron();
  assert.equal(event.reason, 'final-reconciliation-confirmed');
  assert.equal(event.committedGames, 1); // score corrected
  const entry = await readScores(3);
  assert.equal(entry!.items[0]!.home.score, 31);
  assert.equal(entry!.pendingFinalConfirmationIds, undefined);
});

test('a malformed /games payload during reconciliation fails cleanly and resolves the attempt', async () => {
  await seedPendingFinal();
  stubProvider({ games: [null, 'garbage', 42] });
  const { res, event } = await runCron();
  assert.equal(event.mode, 'final-reconciliation');
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'final-reconciliation-invalid-payload');
  assert.equal(res!.status, 500);
  // Prior-good pending metadata is preserved.
  const entry = await readScores(3);
  assert.deepEqual(entry!.pendingFinalConfirmationIds, ['401001']);
  // The begun attempt is resolved as a failure, never stranded in-progress.
  const status = await getProviderRefreshStatus('scores', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'failed');
});

test('a not-yet-final /games response leaves the pending final unconfirmed', async () => {
  await seedPendingFinal();
  const { urls } = stubProvider({
    games: [
      {
        id: 401001,
        home_team: 'Alabama',
        away_team: 'Georgia',
        home_points: 27,
        away_points: 24,
        status: 'in_progress',
      },
    ],
  });
  const { event } = await runCron();
  assert.equal(event.result, 'no-op');
  assert.equal(event.reason, 'final-reconciliation-not-confirmed');
  assert.equal(event.providerCallAttempted, true);
  assert.equal(urls.filter((url) => url.includes('/games')).length, 1);
  const status = await getProviderRefreshStatus('scores', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'no-op');
  const entry = await readScores(3);
  assert.deepEqual(entry!.pendingFinalConfirmationIds, ['401001']); // still pending
});
