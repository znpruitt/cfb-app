import assert from 'node:assert/strict';
import test from 'node:test';

// MUST precede the '../route' import: sets CFBD_API_KEY before the route captures
// it in a module-load-time constant, so the cron reaches its coverage-based skip
// decision instead of the missing-key early return (finding #3).
import './_setup/withCfbdKey';
import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import {
  legacyRowFromWire,
  seedGameStatsPartitionForTests,
  seedGameStatsTeamDatabaseForTests,
  wireGame,
} from '../../../../../lib/gameStats/__tests__/fixtures.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshFailure,
} from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope, yearScope } from '../../../../../lib/providerRefreshScope.ts';

// PLATFORM-086H3: the cron is the scheduled writer of the ACTIVATED lifecycle.
// It plans schedule-relative recovery over COMMITTED durable coverage, takes at
// most one slate per run, and routes every provider payload through validated
// ingestion into the durable merge authority. These tests pin the cron's
// slate-selection and truthful-outcome behavior; the deep merge/coverage
// semantics live in the gameStats module tests.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const CRON_SECRET = 'test-cron-secret';
const ORIGINAL_FETCH = globalThis.fetch;

// Compute the season year exactly as the route does (seasonYearForToday), so the
// seeded schedule lands under the key the cron will read regardless of run date.
const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();
const WEEK = 3;
const COMPLETED_KICKOFF = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
const DAYS_AGO = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

/** Analytics-eligible durable row — the coverage bar for "already satisfied". */
function eligibleRow(id: number, week = WEEK) {
  return legacyRowFromWire(wireGame({ id }), week);
}

async function seedCompletedSchedule() {
  await seedScheduleItems([
    { id: '5001', week: WEEK, startDate: COMPLETED_KICKOFF, status: 'STATUS_FINAL' },
  ]);
}

type ScheduleSeed = {
  id: string;
  week: number;
  startDate: string;
  status: string;
  seasonType?: 'regular' | 'postseason';
};

async function seedScheduleItems(items: ScheduleSeed[]) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: items.map((it) => ({
      id: it.id,
      week: it.week,
      seasonType: it.seasonType ?? 'regular',
      startDate: it.startDate,
      neutralSite: false,
      conferenceGame: false,
      // Canonical participants must agree with the wire fixture's schools —
      // attachment validation is participant-based, never id-only.
      homeTeam: 'Alpha State',
      awayTeam: 'Beta Tech',
      homeConference: 'X',
      awayConference: 'Y',
      status: it.status,
    })),
  });
}

function stubTeamStats(ids: number[] = [5001]) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(ids.map((id) => wireGame({ id }))), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function stubJson(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function stubThrow(message: string) {
  globalThis.fetch = (async () => {
    throw new Error(message);
  }) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedGameStatsTeamDatabaseForTests();
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('the cron re-fetches a week whose cached record is empty (games:[]), not skips it', async () => {
  await seedCompletedSchedule();
  // A prior empty record must NOT count as coverage — the empty week should repair.
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2020-01-01T00:00:00.000Z',
    games: [],
  });
  stubTeamStats();

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string; gamesProcessed?: number };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.skipped, undefined, 'an empty cached record must not be treated as covered');
  assert.equal(body.gamesProcessed, 1, 'the cron re-fetched and persisted usable stats');

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.equal(stored?.games.length, 1, 'the empty record was repaired with usable content');
  assert.equal(stored?.games[0]?.schemaVersion, 2, 'repair flows through the merge authority');
});

test('the cron skips a week whose committed durable evidence already satisfies coverage', async () => {
  await seedCompletedSchedule();
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [eligibleRow(5001)],
  });
  // Fetch must NOT run when the schedule expectation is already satisfied.
  stubThrow('cron must not fetch when committed coverage is satisfied');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.match(String(body.skipped ?? ''), /already satisfied/i);
});

test('a PARTIAL week (schedule expects more games) is a recovery candidate, and repair preserves prior rows', async () => {
  await seedScheduleItems([
    { id: '5001', week: WEEK, startDate: COMPLETED_KICKOFF, status: 'STATUS_FINAL' },
    { id: '5002', week: WEEK, startDate: COMPLETED_KICKOFF, status: 'STATUS_FINAL' },
  ]);
  const prior = eligibleRow(5001);
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: DAYS_AGO(19),
    games: [prior],
  });
  stubTeamStats([5001, 5002]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as {
    gamesProcessed?: number;
    coverage?: { state: string };
  };
  assert.equal(res.status, 200, JSON.stringify(body));
  // The absent game inserts; the prior legacy row upgrades opportunistically
  // through the same conservative merge (2 accepted durable changes total).
  assert.equal(body.gamesProcessed, 2);
  assert.equal(body.coverage?.state, 'complete', 'committed coverage after the repair');

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.deepEqual(stored!.games.map((g) => g.providerGameId).sort(), [5001, 5002]);
});

// Disrupted-only slates are never selected for retrieval.
test('the cron does not select a disrupted-only latest slate; it picks the older eligible one', async () => {
  await seedScheduleItems([
    // Latest completed slate (week 5) is entirely disrupted → not stat-producing.
    { id: '9001', week: 5, startDate: DAYS_AGO(2), status: 'Canceled' },
    { id: '9002', week: 5, startDate: DAYS_AGO(2), status: 'Postponed' },
    // Older completed slate (week 3) has a real final game → eligible.
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  stubTeamStats();

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { week?: number; gamesProcessed?: number; skipped?: string };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.week, 3, 'the disrupted week 5 is skipped; the eligible week 3 is selected');
  assert.equal(body.gamesProcessed, 1);
});

test('a disrupted-only schedule yields no eligible slate and spends no provider call', async () => {
  await seedScheduleItems([
    { id: '9001', week: 5, startDate: DAYS_AGO(2), status: 'Canceled' },
    { id: '9002', week: 5, startDate: DAYS_AGO(2), status: 'Suspended' },
  ]);
  stubThrow('cron must not fetch when no stat-producing slate exists');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.match(String(body.skipped ?? ''), /no completed weeks/i);
});

test('an OLDER unsatisfied slate is recovered once the newer slates are satisfied', async () => {
  await seedScheduleItems([
    { id: '2001', week: 2, startDate: DAYS_AGO(17), status: 'STATUS_FINAL' },
    { id: '3001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  // The newest slate is satisfied; week 2 was missed (e.g. an outage).
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: DAYS_AGO(9),
    games: [eligibleRow(3001, 3)],
  });
  stubTeamStats([2001]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { week?: number; gamesProcessed?: number };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.week, 2, 'schedule-relative recovery reaches the older gap');
  assert.equal(body.gamesProcessed, 1);
});

// An empty response over EXPECTED completed games is a stable failure
// (PLATFORM-086H3): never "no applicable data", never a durable write, and
// prior-good evidence is preserved.
test('an unexpected empty provider response is a stable failure without a durable write', async () => {
  await seedCompletedSchedule();
  stubJson([]); // CFBD returns [] although a completed game expects stats
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { error?: string; gamesProcessed?: number };
  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'game-stats-empty-unexpected');
  assert.equal(body.gamesProcessed, 0);

  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no empty record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-empty-unexpected');
  assert.equal(status.lastSuccessAt, null, 'an unexpected empty never advances last-success');
});

// SCOPED-STATUS review v2 #1 — the resolved week partition owns the outcome, and
// a later successful run of the same week replaces a prior failure through normal
// attempt ordering.
test('a later successful run replaces a prior failure on the same week partition', async () => {
  await seedCompletedSchedule();
  const scope = weekPartitionScope(YEAR, WEEK, 'regular');
  // A prior failed attempt on this exact week scope (e.g. an earlier missing-key run).
  const priorFail = await beginProviderRefreshAttempt('game-stats', scope, {
    attemptId: 'prior-fail',
  });
  await recordProviderRefreshFailure('game-stats', scope, {
    attempt: priorFail,
    error: 'CFBD_API_KEY not configured',
    code: 'cfbd-api-key-missing',
    status: 500,
  });
  assert.equal(
    (await getProviderRefreshStatus('game-stats', scope)).latestAttemptOutcome,
    'failed',
    'precondition: the week scope starts failed'
  );

  stubTeamStats();
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200, await res.text());

  const status = await getProviderRefreshStatus('game-stats', scope);
  assert.equal(status.latestAttemptOutcome, 'succeeded', 'the later success replaces the failure');
  assert.equal(status.lastError, null);
});

// SCOPED-STATUS review v2 #3 — a local target-resolution failure uses the
// established cron error path and never assigns the failure to an unrelated year
// or week data scope.
test('a target-resolution read failure returns 500 and mutates no game-stats scope', async () => {
  await seedCompletedSchedule();
  // Fail ONLY 'schedule' reads (recovery target resolution) while provider-refresh
  // status reads still succeed for the assertions.
  __setAppStateReadFailureForTests(new Error('schedule read down'), 'schedule');
  let res: Response;
  try {
    res = await cronGet(cronRequest());
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.equal(res.status, 500);

  const yearRollup = await getProviderRefreshStatus('game-stats', yearScope(YEAR));
  assert.equal(yearRollup.latestAttemptOutcome, null, 'no year-scope failure fabricated');
  const week = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(week.latestAttemptOutcome, null, 'no week-scope failure fabricated');
});

test('a durable game-stats read failure during recovery planning is a 500, never treated as absent coverage', async () => {
  await seedCompletedSchedule();
  stubThrow('cron must not fetch when durable coverage could not be read');
  __setAppStateReadFailureForTests(new Error('game-stats read down'), 'game-stats');
  let res: Response;
  try {
    res = await cronGet(cronRequest());
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.equal(res.status, 500, 'a failed durable read is a failure, not inferred absence');
});

test('a nonempty payload that parses to zero observations resolves as schema drift (no write)', async () => {
  await seedCompletedSchedule();
  // A row missing its away team fails observation parsing → zero observations.
  stubJson([
    { id: 5001, teams: [{ teamId: 1, team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] },
  ]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'game-stats-schema-drift');

  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no unusable record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-schema-drift');
});

test('matched observations without category evidence resolve as a content failure (no write)', async () => {
  await seedCompletedSchedule();
  stubJson([
    {
      id: 5001,
      teams: [
        {
          teamId: 101,
          team: 'Alpha State',
          conference: 'X',
          homeAway: 'home',
          points: 21,
          stats: [],
        },
        {
          teamId: 202,
          team: 'Beta Tech',
          conference: 'Y',
          homeAway: 'away',
          points: 14,
          stats: [],
        },
      ],
    },
  ]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'game-stats-no-persistable-observations');
  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null);
});
