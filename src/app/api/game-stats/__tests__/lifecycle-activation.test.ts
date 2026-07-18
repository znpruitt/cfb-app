import assert from 'node:assert/strict';
import test from 'node:test';

// MUST precede the cron route import: the cron captures CFBD_API_KEY in a
// module-load-time constant.
import '../../cron/game-stats/__tests__/_setup/withCfbdKey';
import { GET as cronGet } from '../../cron/game-stats/route';
import { GET as publicGet } from '../route';
import {
  __corruptAppStateFileForTests,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStatePoolForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../lib/gameStats/cache.ts';
import {
  deriveSlateExpectation,
  ingestGameStatsObservations,
} from '../../../../lib/gameStats/ingestion.ts';
import {
  claimGameStatsRecoveryPartition,
  finalizeGameStatsRecoveryClaim,
  readGameStatsRecoveryDisposition,
} from '../../../../lib/gameStats/recoveryDisposition.ts';
import { aggregateOwnerSeasonStats } from '../../../../lib/gameStats/ownerStats.ts';
import { createTeamIdentityResolver } from '../../../../lib/teamIdentity.ts';
import { GAME_STATS_RECOVERY_METADATA_FAILURE_CODE } from '../../../../lib/gameStats/refreshOrchestration.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../lib/providerRefreshScope.ts';
import {
  legacyRowFromWire,
  seedGameStatsPartitionForTests,
  seedGameStatsTeamDatabaseForTests,
  wireGame,
} from '../../../../lib/gameStats/__tests__/fixtures.ts';
import type { Pool } from 'pg';

// PLATFORM-086H3 — end-to-end lifecycle tests for the activated game-stats
// contract: canonical schedule (participants + classification) → validated
// observations → durable merge authority → committed durable reread →
// schedule-relative coverage → bounded recovery disposition → public read →
// analytics projection → truthful availability. Deterministic: no sleeps, no
// live database, no external provider — the provider boundary is a stubbed
// global fetch and the durable boundary is the test-isolated file store (plus
// a scripted fake pg pool for transaction-uncertainty scenarios).

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const ADMIN_TOKEN = 'test-admin-token';

// The season year both routes derive from today's clock.
const YEAR = (() => {
  const d = new Date();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
})();
const WEEK = 3;
const DAYS_AGO = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function readRequest(params: string, admin = false): Request {
  return new Request(`https://example.com/api/game-stats?${params}`, {
    headers: admin ? { 'x-admin-token': ADMIN_TOKEN } : {},
  });
}

function refreshRequest(week = WEEK, seasonType = 'regular', year = YEAR): Request {
  return readRequest(`year=${year}&week=${week}&seasonType=${seasonType}&bypassCache=1`, true);
}

type ScheduleSeed = {
  id: string;
  week?: number;
  seasonType?: 'regular' | 'postseason';
  startDate?: string | null;
  status?: string;
  homeTeam?: string;
  awayTeam?: string;
  neutralSite?: boolean;
};

async function seedSchedule(items: ScheduleSeed[]) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: items.map((it) => ({
      id: it.id,
      week: it.week ?? WEEK,
      seasonType: it.seasonType ?? 'regular',
      startDate: it.startDate === undefined ? DAYS_AGO(10) : it.startDate,
      neutralSite: it.neutralSite ?? false,
      conferenceGame: false,
      homeTeam: it.homeTeam ?? 'Alpha State',
      awayTeam: it.awayTeam ?? 'Beta Tech',
      homeConference: 'X',
      awayConference: 'Y',
      status: it.status ?? 'STATUS_FINAL',
    })),
  });
}

const GAME_A = () => wireGame({ id: 5001 });
const GAME_B = () =>
  wireGame({
    id: 5002,
    home: { school: 'Gamma Poly', teamId: 303 },
    away: { school: 'Delta Agricultural', teamId: 404 },
  });
const GAME_B_SEED: ScheduleSeed = {
  id: '5002',
  homeTeam: 'Gamma Poly',
  awayTeam: 'Delta Agricultural',
};

function statlessGame(id: number) {
  return {
    id,
    teams: [
      {
        teamId: 101,
        team: 'Alpha State',
        conference: 'X',
        homeAway: 'home',
        points: 21,
        stats: [],
      },
      { teamId: 202, team: 'Beta Tech', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
    ],
  };
}

let fetchCalls = 0;
function stubJson(body: unknown) {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}
function stubThrow(message: string) {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error(message);
  }) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedGameStatsTeamDatabaseForTests();
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  MUTABLE_ENV.NODE_ENV = 'development';
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// === Full lifecycle: schedule → observation → merge → committed coverage → read → analytics ===

test('lifecycle: a scheduled cron run commits v2 evidence the whole stack serves', async () => {
  await seedSchedule([{ id: '5001' }, GAME_B_SEED]);
  stubJson([GAME_A(), GAME_B()]);

  const cronRes = await cronGet(cronRequest());
  const cronBody = (await cronRes.json()) as {
    gamesProcessed: number;
    week: number;
    coverage?: { state: string; satisfied: number; expected: number };
  };
  assert.equal(cronRes.status, 200, JSON.stringify(cronBody));
  assert.equal(cronBody.week, WEEK);
  assert.equal(cronBody.gamesProcessed, 2);
  assert.equal(cronBody.coverage?.state, 'complete', 'coverage from the committed reread');
  assert.equal(fetchCalls, 1, 'one shared provider request for the partition');

  // Durable state is v2 through the merge authority.
  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.equal(stored?.games.length, 2);
  for (const row of stored!.games) {
    assert.equal(row.schemaVersion, 2);
    assert.ok(row.fetchStartedAt, 'observation fence stamped');
  }

  // Publication happened only after COMMIT + reread: full success.
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 2);

  // A satisfied partition clears its recovery disposition.
  assert.equal(await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular'), null);

  // Public read: cache-only, metadata-free, coverage-aware.
  stubThrow('public reads must not call the provider');
  const readRes = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(readRes.status, 200);
  const raw = await readRes.text();
  assert.ok(!raw.includes('schemaVersion'), 'no v2 metadata on the public wire');
  assert.ok(!raw.includes('fetchStartedAt'), 'no fence on the public wire');
  assert.ok(!raw.includes('pointsProvided'), 'no evidence flag on the public wire');
  assert.ok(!raw.includes('commitRevision'), 'no partition revision on the public wire');
  assert.equal(fetchCalls, 0, 'zero provider calls from the public read');
  const readBody = JSON.parse(raw) as {
    games: Array<{ providerGameId: number }>;
    meta: { availability?: { state: string } };
  };
  assert.deepEqual(readBody.games.map((g) => g.providerGameId).sort(), [5001, 5002]);
  assert.equal(readBody.meta.availability?.state, 'complete');

  // Analytics projection: owner totals from strictly re-parsed evidence.
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {}, observedNames: [] });
  const roster = new Map([
    ['Alpha State', 'Alice'],
    ['Gamma Poly', 'Grace'],
  ]);
  const seasonStats = aggregateOwnerSeasonStats([stored!.games], roster, resolver, YEAR);
  const alice = seasonStats.find((s) => s.owner === 'Alice');
  assert.ok(alice, 'owner aggregated through the projection');
  assert.equal(alice!.gamesPlayed, 1);
  assert.equal(alice!.points, 31);
  assert.equal(alice!.totalYards, 412);

  // A second cron run finds committed coverage satisfied: zero provider calls.
  stubThrow('cron must not refetch a satisfied partition');
  const secondRes = await cronGet(cronRequest());
  const secondBody = (await secondRes.json()) as { skipped?: string };
  assert.equal(secondRes.status, 200);
  assert.match(String(secondBody.skipped ?? ''), /already satisfied/i);
  assert.equal(fetchCalls, 0);
});

test('lifecycle: a partial commit publishes PARTIAL status and partial public availability', async () => {
  await seedSchedule([{ id: '5001' }, GAME_B_SEED]);
  // Provider supplies only game A.
  stubJson([GAME_A()]);
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as {
    gamesProcessed: number;
    coverage?: { state: string; absent: number };
    detail?: string;
  };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.gamesProcessed, 1);
  assert.equal(body.coverage?.state, 'partial', 'committed coverage, not payload size');
  assert.equal(body.coverage?.absent, 1);

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(
    status.latestAttemptOutcome,
    'partial',
    'a partial partition never reads as full success'
  );

  // Public read reports partial availability while serving committed evidence.
  stubThrow('reads stay provider-free');
  const readRes = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  const readBody = (await readRes.json()) as { meta: { availability?: { state: string } } };
  assert.equal(readBody.meta.availability?.state, 'partial');

  // An authorized refresh completes the partition (manual refresh has no
  // backoff gate) and the status converges to full success.
  stubJson([GAME_A(), GAME_B()]);
  const refresh = await publicGet(refreshRequest());
  assert.equal(refresh.status, 200);
  const refreshBody = (await refresh.json()) as { meta: { availability?: { state: string } } };
  assert.equal(refreshBody.meta.availability?.state, 'complete');
  const finalStatus = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(finalStatus.latestAttemptOutcome, 'succeeded');
});

test('lifecycle: postseason slates recover through the same path', async () => {
  await seedSchedule([
    { id: '5001', startDate: DAYS_AGO(30) },
    { id: '7001', week: 1, seasonType: 'postseason', startDate: DAYS_AGO(3) },
  ]);
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: DAYS_AGO(29),
    games: [legacyRowFromWire(wireGame({ id: 5001 }), WEEK)],
  });
  stubJson([wireGame({ id: 7001 })]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { week: number; seasonType: string; gamesProcessed: number };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.seasonType, 'postseason');
  assert.equal(body.week, 1);
  assert.equal(body.gamesProcessed, 1);
  assert.equal((await getCachedGameStats(YEAR, 1, 'postseason'))?.games.length, 1);
});

test('lifecycle: placeholder slates defer — non-numeric ids AND unresolved numeric participants', async () => {
  await seedSchedule([
    { id: 'cfp-semi-a', week: 1, seasonType: 'postseason', startDate: DAYS_AGO(2) },
    {
      id: '7002',
      week: 1,
      seasonType: 'postseason',
      startDate: DAYS_AGO(2),
      homeTeam: 'TBD',
      awayTeam: 'TBD',
    },
  ]);
  stubThrow('placeholders are not provider-addressable');
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.ok(body.skipped, 'deferred, not fetched');
  assert.equal(fetchCalls, 0, 'a numeric id alone is not placeholder resolution');
});

test('lifecycle: FCS-vs-FCS stays excluded and unscheduled provider rows never merge', async () => {
  await seedSchedule([
    { id: '5001' },
    // A scheduled FCS-vs-FCS game (policy-FCS conferences) is excluded.
    {
      id: '6001',
      homeTeam: 'Little Brook',
      awayTeam: 'Stony Vale',
      // Big Sky is policy-classified FCS.
      status: 'STATUS_FINAL',
    },
  ]);
  // Make the FCS classification real: seed via conferences on the item.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '5001',
        week: WEEK,
        seasonType: 'regular',
        startDate: DAYS_AGO(10),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha State',
        awayTeam: 'Beta Tech',
        homeConference: 'X',
        awayConference: 'Y',
        status: 'STATUS_FINAL',
      },
      {
        id: '6001',
        week: WEEK,
        seasonType: 'regular',
        startDate: DAYS_AGO(10),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Little Brook',
        awayTeam: 'Stony Vale',
        homeConference: 'Big Sky',
        awayConference: 'Big Sky',
        status: 'STATUS_FINAL',
      },
    ],
  });
  // Provider returns the scheduled FBS game, the scheduled-but-excluded FCS
  // game, and an entirely unscheduled game.
  stubJson([
    GAME_A(),
    wireGame({
      id: 6001,
      home: { school: 'Little Brook', teamId: 900 },
      away: { school: 'Stony Vale', teamId: 901 },
    }),
    wireGame({ id: 888_888 }),
  ]);
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.deepEqual(
    stored!.games.map((g) => g.providerGameId),
    [5001],
    'no game identity from statistics; classification excludes FCS-vs-FCS even when scheduled'
  );
});

test('lifecycle: a participant mismatch on a scheduled id is a typed failure, never a write', async () => {
  await seedSchedule([{ id: '5001' }]);
  // The provider claims game 5001 is Gamma Poly vs Delta Agricultural — the
  // canonical schedule says Alpha State vs Beta Tech.
  stubJson([
    wireGame({
      id: 5001,
      home: { school: 'Gamma Poly', teamId: 303 },
      away: { school: 'Delta Agricultural', teamId: 404 },
    }),
  ]);
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 502);
  assert.equal(body.error, 'game-stats-participant-mismatch');
  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'durable state untouched');
});

// === Truthful non-destructive failure handling + bounded cross-run recovery ===

test('lifecycle: an unexpected empty response is a stable FAILURE that never clears prior-good evidence', async () => {
  await seedSchedule([{ id: '5001' }, { id: '6001', week: 4, startDate: DAYS_AGO(2) }]);
  // Committed prior-good evidence for week 3.
  const priorRow = legacyRowFromWire(wireGame({ id: 5001 }), WEEK);
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: DAYS_AGO(9),
    games: [priorRow],
  });

  // The cron targets week 4 (absent) and the provider says [] although the
  // schedule expects a completed game there.
  stubJson([]);
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { error?: string; week?: number };
  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.week, 4);
  assert.equal(body.error, 'game-stats-empty-unexpected');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 4, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-empty-unexpected');
  assert.equal(status.lastSuccessAt, null, 'uncertainty never advances last-success');
  assert.equal(await getCachedGameStats(YEAR, 4, 'regular'), null, 'no empty record fabricated');
  assert.deepEqual(
    (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games,
    [priorRow],
    'prior-good durable evidence untouched'
  );
});

// Repeated-run quota regressions: every unresolved outcome records a durable
// disposition, so an immediately repeated cron run spends ZERO provider calls,
// clears no failure state, and changes no durable evidence.
const UNRESOLVED_RUN_SCENARIOS: Array<{
  name: string;
  stub: () => void;
  expectedCode: string;
  expectedHttp: number;
  /** Transport attempts within the ONE logical provider request (established upstream retry policy). */
  firstRunCalls?: number;
}> = [
  {
    name: 'provider unavailable',
    stub: () => stubThrow('provider connection refused'),
    expectedCode: 'provider-unavailable',
    expectedHttp: 500,
    firstRunCalls: 3, // fetchUpstreamJson retry policy: maxAttempts 3 per request
  },
  {
    name: 'invalid payload',
    stub: () => stubJson({ not: 'an array' }),
    expectedCode: 'game-stats-invalid-payload',
    expectedHttp: 502,
  },
  {
    name: 'schema drift',
    stub: () => stubJson([{ garbage: true }, 17]),
    expectedCode: 'game-stats-schema-drift',
    expectedHttp: 502,
  },
  {
    name: 'unexpected empty',
    stub: () => stubJson([]),
    expectedCode: 'game-stats-empty-unexpected',
    expectedHttp: 502,
  },
  {
    name: 'unmatched-only',
    stub: () => stubJson([wireGame({ id: 999_999 })]),
    expectedCode: 'game-stats-unmatched-observations',
    expectedHttp: 502,
  },
  {
    name: 'unresolved provider identity',
    stub: () => stubJson([wireGame({ id: 5001, home: { school: 'TBD' } })]),
    expectedCode: 'game-stats-unresolved-participant',
    expectedHttp: 502,
  },
  {
    name: 'no persistable observations',
    stub: () => stubJson([statlessGame(5001)]),
    expectedCode: 'game-stats-no-persistable-observations',
    expectedHttp: 502,
  },
];

for (const scenario of UNRESOLVED_RUN_SCENARIOS) {
  test(`recovery bounding: ${scenario.name} → failure once, then backoff (zero provider calls, nothing cleared)`, async () => {
    await seedSchedule([{ id: '5001' }]);
    scenario.stub();
    const first = await cronGet(cronRequest());
    assert.equal(first.status, scenario.expectedHttp, await first.clone().text());
    assert.equal(
      fetchCalls,
      scenario.firstRunCalls ?? 1,
      'exactly one bounded logical provider request'
    );

    const scope = weekPartitionScope(YEAR, WEEK, 'regular');
    const failedStatus = await getProviderRefreshStatus('game-stats', scope);
    assert.equal(failedStatus.latestAttemptOutcome, 'failed');
    const disposition = await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular');
    assert.ok(disposition, 'a durable recovery disposition was recorded');
    assert.ok(disposition!.nextEligibleAt, 'a bounded next-eligible time exists');

    // Immediately repeated run: the partition is backing off — no tight retry.
    scenario.stub();
    const second = await cronGet(cronRequest());
    const secondBody = (await second.json()) as { skipped?: string };
    assert.equal(second.status, 200);
    assert.match(String(secondBody.skipped ?? ''), /backing off|awaiting operator/i);
    assert.equal(fetchCalls, 0, 'zero provider calls while backing off');

    const statusAfter = await getProviderRefreshStatus('game-stats', scope);
    assert.equal(statusAfter.latestAttemptOutcome, 'failed', 'failure state is not cleared');
    assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no destructive change');
  });
}

for (const injected of ['merge-conflict', 'durable-indeterminate', 'stale-insufficient'] as const) {
  test(`recovery bounding: a persisted ${injected} disposition prevents tight cron retry`, async () => {
    await seedSchedule([{ id: '5001' }]);
    // Seed the disposition through the real claim/finalize lifecycle.
    const claimed = await claimGameStatsRecoveryPartition({
      year: YEAR,
      week: WEEK,
      seasonType: 'regular',
      now: Date.now(),
      coverageFingerprint: 'fp-before',
      scheduleFingerprint: 'sched-1',
    });
    assert.ok(claimed.claimed);
    await finalizeGameStatsRecoveryClaim({
      year: YEAR,
      week: WEEK,
      seasonType: 'regular',
      attemptToken: claimed.claimed ? claimed.claim.attemptToken : '',
      reason: injected,
      now: Date.now(),
      postCoverageFingerprint: 'fp-before',
      priorCoverageFingerprint: 'fp-before',
      scheduleChanged: false,
    });
    stubThrow('backing-off partitions must not be fetched');
    const res = await cronGet(cronRequest());
    const body = (await res.json()) as { skipped?: string };
    assert.equal(res.status, 200);
    assert.match(String(body.skipped ?? ''), /backing off|awaiting operator|claimed/i);
    assert.equal(fetchCalls, 0);
  });
}

test('recovery bounding: a backed-off newest partition rotates to an OLDER eligible candidate', async () => {
  await seedSchedule([
    { id: '2001', week: 2, startDate: DAYS_AGO(17) },
    { id: '3001', week: 3, startDate: DAYS_AGO(10) },
  ]);
  // Run 1: the newest gap (week 3) fails unexpected-empty and backs off.
  stubJson([]);
  const first = await cronGet(cronRequest());
  assert.equal(first.status, 502);
  assert.equal(((await first.json()) as { week?: number }).week, 3);

  // Run 2: selection rotates to week 2, which succeeds — older candidates
  // progress while the newer one backs off.
  stubJson([wireGame({ id: 2001 })]);
  const second = await cronGet(cronRequest());
  const secondBody = (await second.json()) as { week?: number; gamesProcessed?: number };
  assert.equal(second.status, 200, JSON.stringify(secondBody));
  assert.equal(secondBody.week, 2, 'older eligible candidate progressed');
  assert.equal(secondBody.gamesProcessed, 1);
  assert.equal(fetchCalls, 1);
  assert.equal((await getCachedGameStats(YEAR, 2, 'regular'))?.games.length, 1);
  assert.equal(await getCachedGameStats(YEAR, 3, 'regular'), null, 'week 3 untouched');
});

test('lifecycle: a blocked-only partition is never auto-refetched and reads as BLOCKED, not absent', async () => {
  await seedSchedule([{ id: '5001' }]);
  const blockedRow = {
    ...legacyRowFromWire(wireGame({ id: 5001 }), WEEK),
    schemaVersion: 3,
  } as never;
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: DAYS_AGO(9),
    games: [blockedRow],
  });
  stubThrow('blocked partitions must not be fetched');
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.match(String(body.skipped ?? ''), /already satisfied/i);
  assert.equal(fetchCalls, 0);

  const readRes = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  const readBody = (await readRes.json()) as { meta: { availability?: { state: string } } };
  assert.equal(readBody.meta.availability?.state, 'blocked');
  assert.equal(fetchCalls, 0);
});

test('lifecycle: a failed durable write publishes nothing — cache and status stay prior-good', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubJson([GAME_A()]);
  __setAppStateWriteFailureForTests(new Error('durable write down'), 'game-stats');
  try {
    const res = await publicGet(refreshRequest());
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'game-stats-durable-unavailable');
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'durable state untouched');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastSuccessAt, null, 'no publication before durable commit');
});

// === Authorized refresh through the merge authority ===

test('refresh: an authorized refresh writes v2 through the merge authority; a repeat is a fence-only refresh', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubJson([GAME_A()]);
  const first = await publicGet(refreshRequest());
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as {
    games: unknown[];
    meta: { accepted?: number; availability?: { state: string } };
  };
  assert.equal(firstBody.meta.accepted, 1, 'one accepted durable change');
  assert.equal(firstBody.meta.availability?.state, 'complete');
  assert.equal(firstBody.games.length, 1);
  const fence1 = (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games[0]!.fetchStartedAt!;

  // Identical content, strictly newer fetch → durable fence-only refresh.
  stubJson([GAME_A()]);
  const second = await publicGet(refreshRequest());
  const secondBody = (await second.json()) as {
    meta: { accepted?: number; availability?: { state: string } };
  };
  assert.equal(second.status, 200);
  assert.equal(second.status, 200);
  assert.equal(secondBody.meta.accepted, 1, 'the fence-only refresh is an accepted durable change');
  assert.equal(secondBody.meta.availability?.state, 'complete');
  const fence2 = (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games[0]!.fetchStartedAt!;
  assert.ok(fence2 >= fence1, 'freshness evidence advanced durably');

  // The refresh response itself carries no persistence metadata.
  const rawSecond = JSON.stringify(secondBody);
  assert.ok(!rawSecond.includes('schemaVersion'));
  assert.ok(!rawSecond.includes('fetchStartedAt'));
  assert.ok(!rawSecond.includes('pointsProvided'));
});

test('refresh: unauthorized bypass is rejected before any provider access', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubThrow('unauthorized refresh must not reach the provider');
  const res = await publicGet(
    readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular&bypassCache=1`)
  );
  assert.equal(res.status, 401);
  assert.equal(fetchCalls, 0);
});

test('refresh: invalid parameters fail before provider access (year, week, seasonType)', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubThrow('invalid params must not reach the provider');

  const badYear = await publicGet(readRequest(`year=20xx&week=3&bypassCache=1`, true));
  assert.equal(badYear.status, 400);

  const badWeek = await publicGet(readRequest(`year=${YEAR}&week=abc&bypassCache=1`, true));
  assert.equal(badWeek.status, 400);

  const badSeason = await publicGet(
    readRequest(`year=${YEAR}&week=3&seasonType=exhibition&bypassCache=1`, true)
  );
  assert.equal(badSeason.status, 400);
  const badSeasonBody = (await badSeason.json()) as { field?: string };
  assert.equal(badSeasonBody.field, 'seasonType', 'invalid season types are rejected, not coerced');

  assert.equal(fetchCalls, 0);
});

test('refresh: a missing canonical schedule blocks the refresh before quota is spent', async () => {
  stubThrow('no schedule, no provider call');
  const res = await publicGet(refreshRequest());
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-schedule-unavailable');
  assert.equal(fetchCalls, 0);
});

test('refresh: partitions with no canonical eligible target fail before provider access', async () => {
  // The year has schedule rows, but week 9 has none; week 5 is FCS-vs-FCS
  // only; postseason week 2 is placeholder-only.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '5001',
        week: WEEK,
        seasonType: 'regular',
        startDate: DAYS_AGO(10),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha State',
        awayTeam: 'Beta Tech',
        homeConference: 'X',
        awayConference: 'Y',
        status: 'STATUS_FINAL',
      },
      {
        id: '6001',
        week: 5,
        seasonType: 'regular',
        startDate: DAYS_AGO(9),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Little Brook',
        awayTeam: 'Stony Vale',
        homeConference: 'Big Sky',
        awayConference: 'Big Sky',
        status: 'STATUS_FINAL',
      },
      {
        id: '7002',
        week: 2,
        seasonType: 'postseason',
        startDate: DAYS_AGO(2),
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'TBD',
        awayTeam: 'TBD',
        homeConference: null,
        awayConference: null,
        status: 'STATUS_SCHEDULED',
      },
    ],
  });
  stubThrow('no canonical target, no provider call');

  for (const target of [
    { week: 9, seasonType: 'regular' }, // nonexistent week
    { week: 5, seasonType: 'regular' }, // FCS-vs-FCS-only partition
    { week: 2, seasonType: 'postseason' }, // unresolved-placeholder-only partition
  ]) {
    const res = await publicGet(refreshRequest(target.week, target.seasonType));
    assert.equal(res.status, 409, `${target.week} ${target.seasonType}`);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'game-stats-no-canonical-targets');
  }
  assert.equal(fetchCalls, 0);
});

// === Truthful read availability ===

test('reads: ordinary reads are cache-only with coverage-aware availability (fresh, stale, partial, miss)', async () => {
  await seedSchedule([{ id: '5001' }, GAME_B_SEED]);
  const record = {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular' as const,
    fetchedAt: new Date().toISOString(),
    games: [legacyRowFromWire(wireGame({ id: 5001 }), WEEK)],
  };
  await seedGameStatsPartitionForTests(record);
  stubThrow('ordinary reads never call the provider');

  // Fresh partial hit — legacy rows wire-compatible, availability truthful.
  const fresh = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(fresh.status, 200);
  const freshBody = (await fresh.json()) as Record<string, unknown> & {
    meta: { cache: string; stale?: boolean; availability?: { state: string; absent: number } };
  };
  assert.equal(freshBody.meta.cache, 'hit');
  assert.equal(freshBody.meta.stale, undefined);
  assert.equal(freshBody.meta.availability?.state, 'partial', 'game B is absent');
  assert.deepEqual(freshBody.games, JSON.parse(JSON.stringify(record.games)));

  // Stale hit — served truthfully with the stale marker, admin or not.
  await seedGameStatsPartitionForTests({ ...record, fetchedAt: DAYS_AGO(3) });
  for (const admin of [false, true]) {
    const stale = await publicGet(
      readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`, admin)
    );
    assert.equal(stale.status, 200);
    const staleBody = (await stale.json()) as {
      meta: { stale?: boolean; availability?: { state: string } };
    };
    assert.equal(staleBody.meta.stale, true, `stale marker (admin=${admin})`);
    assert.equal(staleBody.meta.availability?.state, 'partial');
  }

  // Miss — refresh-required with truthful absent coverage, admin or not.
  await seedSchedule([{ id: '5001' }, GAME_B_SEED, { id: '9001', week: 9 }]);
  for (const admin of [false, true]) {
    const miss = await publicGet(readRequest(`year=${YEAR}&week=9&seasonType=regular`, admin));
    assert.equal(miss.status, 503, `miss is refresh-required (admin=${admin})`);
    const missBody = (await miss.json()) as {
      error?: string;
      availability?: { state: string };
    };
    assert.equal(missBody.error, 'game stats cache miss: admin refresh required');
    assert.equal(missBody.availability?.state, 'absent');
  }

  assert.equal(fetchCalls, 0, 'zero provider calls across every ordinary read');
});

test('reads: corrupt durable state is a real failure, and a restored store recovers', async () => {
  await __corruptAppStateFileForTests();
  const res = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(res.status, 500);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-durable-read-failed');

  // Restore the store: reads recover with no poisoned module state.
  await __deleteAppStateFileForTests();
  const record = {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular' as const,
    fetchedAt: new Date().toISOString(),
    games: [legacyRowFromWire(wireGame({ id: 5001 }), WEEK)],
  };
  await seedGameStatsPartitionForTests(record);
  const recovered = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(recovered.status, 200);
});

test('reads: a malformed partition shape is reported as invalid, not an empty week', async () => {
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, { games: 'not-an-array' });
  const res = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(res.status, 500);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-durable-state-invalid');
});

// === Concurrency convergence (deterministic, no sleeps) ===

test('concurrency: disjoint same-partition writers converge through the transaction lock', async () => {
  const scheduleItems = [
    {
      id: '5001',
      week: WEEK,
      seasonType: 'regular',
      startDate: DAYS_AGO(10),
      status: 'F',
      homeTeam: 'Alpha State',
      awayTeam: 'Beta Tech',
    },
    {
      id: '5002',
      week: WEEK,
      seasonType: 'regular',
      startDate: DAYS_AGO(10),
      status: 'F',
      homeTeam: 'Gamma Poly',
      awayTeam: 'Delta Agricultural',
    },
  ];
  const resolver = createTeamIdentityResolver({
    teams: [
      { school: 'Alpha State', level: 'FBS' },
      { school: 'Beta Tech', level: 'FBS' },
      { school: 'Gamma Poly', level: 'FBS' },
      { school: 'Delta Agricultural', level: 'FBS' },
    ],
    aliasMap: {},
  });
  const expectation = deriveSlateExpectation({
    scheduleItems,
    resolver,
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: Date.now(),
  });
  const base = { year: YEAR, week: WEEK, seasonType: 'regular' as const, expectation, resolver };
  const [a, b] = await Promise.all([
    ingestGameStatsObservations({ ...base, fetchStartedAt: DAYS_AGO(2), payload: [GAME_A()] }),
    ingestGameStatsObservations({ ...base, fetchStartedAt: DAYS_AGO(1), payload: [GAME_B()] }),
  ]);
  assert.equal(a.kind, 'merged');
  assert.equal(b.kind, 'merged');
  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.deepEqual(
    stored!.games.map((g) => g.providerGameId).sort(),
    [5001, 5002],
    'no lost update between concurrent disjoint writers'
  );
});

// === Transaction uncertainty (scripted fake pg pool; no live database) ===

type FakeQueryResult = { rows: Array<Record<string, unknown>> };

class FakePgPool {
  data = new Map<string, string>();
  failCommit = false;
  commitApplies = true;
  failWrite = false;
  failRollback = false;

  private dispatch(
    pending: Array<{ key: string; value: string }> | null,
    text: string,
    params?: unknown[]
  ) {
    const sql = String(text).trim().toLowerCase();
    if (sql.startsWith('select value, updated_at')) {
      const [scope, key] = params as [string, string];
      const stored = this.data.get(`${scope}::${key}`);
      return {
        result: {
          rows: stored ? [{ value: JSON.parse(stored), updated_at: new Date().toISOString() }] : [],
        } as FakeQueryResult,
        pending,
      };
    }
    if (sql.startsWith('insert into app_state')) {
      if (this.failWrite) throw new Error('write statement rejected');
      const [scope, key, json] = params as [string, string, string];
      // A transaction may stage MULTIPLE rows (e.g. the merge's partition +
      // revision-ledger co-commit); COMMIT applies all of them atomically,
      // exactly as real Postgres does.
      return {
        result: { rows: [] },
        pending: [...(pending ?? []), { key: `${scope}::${key}`, value: json }],
      };
    }
    if (sql === 'commit') {
      if (this.failCommit) {
        if (pending && this.commitApplies) {
          for (const write of pending) this.data.set(write.key, write.value);
        }
        throw new Error('commit confirmation lost');
      }
      if (pending) {
        for (const write of pending) this.data.set(write.key, write.value);
      }
      return { result: { rows: [] }, pending: null };
    }
    if (sql === 'rollback') {
      if (this.failRollback) throw new Error('rollback failed');
      return { result: { rows: [] }, pending: null };
    }
    // begin / advisory lock / DDL / to_regclass
    return { result: { rows: [{ present: true }] }, pending };
  }

  async connect() {
    // One client per transaction; pending writes are transaction-scoped.
    let pending: Array<{ key: string; value: string }> | null = null;
    return {
      query: async (text: string, params?: unknown[]) => {
        const { result, pending: next } = this.dispatch(pending, text, params);
        pending = next;
        return result;
      },
      release: () => {},
    };
  }

  async query(text: string, params?: unknown[]) {
    return this.dispatch(null, text, params).result;
  }

  async end() {}
}

async function withFakePg(fn: (pool: FakePgPool) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_URL;
  MUTABLE_ENV.DATABASE_URL = 'postgres://fake-host/fake-db';
  const pool = new FakePgPool();
  __setAppStatePoolForTests(pool as unknown as Pool);
  try {
    await fn(pool);
  } finally {
    if (previous === undefined) delete MUTABLE_ENV.DATABASE_URL;
    else MUTABLE_ENV.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
}

const UNCERTAINTY_RESOLVER = createTeamIdentityResolver({
  teams: [
    { school: 'Alpha State', level: 'FBS' },
    { school: 'Beta Tech', level: 'FBS' },
  ],
  aliasMap: {},
});
const UNCERTAINTY_SLATE = [
  {
    id: '5001',
    week: WEEK,
    seasonType: 'regular' as const,
    startDate: DAYS_AGO(10),
    status: 'F',
    homeTeam: 'Alpha State',
    awayTeam: 'Beta Tech',
  },
];

function uncertaintyInput(fence: string) {
  return {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular' as const,
    fetchStartedAt: fence,
    payload: [GAME_A()],
    expectation: deriveSlateExpectation({
      scheduleItems: UNCERTAINTY_SLATE,
      resolver: UNCERTAINTY_RESOLVER,
      year: YEAR,
      week: WEEK,
      seasonType: 'regular',
      now: Date.now(),
    }),
    resolver: UNCERTAINTY_RESOLVER,
  };
}

test('uncertainty: a lost COMMIT is indeterminate, and the retry is safe and idempotent', async () => {
  await withFakePg(async (pool) => {
    pool.failCommit = true;
    pool.commitApplies = true; // the write actually persisted server-side
    const fence = DAYS_AGO(1);
    const first = await ingestGameStatsObservations(uncertaintyInput(fence));
    assert.equal(first.kind, 'merged');
    if (first.kind === 'merged') {
      assert.equal(first.merge.outcome, 'indeterminate');
      assert.equal(first.merge.indeterminate?.reason, 'transaction-finalize-failed');
      assert.equal(first.merge.indeterminate?.durability, 'unknown');
    }

    // Retry after uncertainty: rereads committed state; identical evidence at
    // an equal fence is a no-write idempotent outcome — no duplication, no
    // rollback, no fabricated success.
    pool.failCommit = false;
    const retry = await ingestGameStatsObservations(uncertaintyInput(fence));
    assert.equal(retry.kind, 'merged');
    if (retry.kind === 'merged') {
      assert.equal(retry.merge.outcome, 'unchanged');
      assert.deepEqual(retry.merge.unchanged, [5001]);
    }
  });
});

test('uncertainty: a rejected write with a failed ROLLBACK is indeterminate; retry recovers', async () => {
  await withFakePg(async (pool) => {
    pool.failWrite = true;
    pool.failRollback = true;
    const fence = DAYS_AGO(1);
    const first = await ingestGameStatsObservations(uncertaintyInput(fence));
    assert.equal(first.kind, 'merged');
    if (first.kind === 'merged') {
      assert.equal(first.merge.outcome, 'indeterminate');
      assert.equal(first.merge.indeterminate?.reason, 'transaction-cleanup-failed');
    }

    pool.failWrite = false;
    pool.failRollback = false;
    const retry = await ingestGameStatsObservations(uncertaintyInput(fence));
    assert.equal(retry.kind, 'merged');
    if (retry.kind === 'merged') {
      assert.equal(retry.merge.outcome, 'written');
      assert.deepEqual(retry.merge.inserted, [5001]);
    }
  });
});

// === Post-claim dual-failure shaping through the cron route (RC 33) ===

type RevalidationFailureBody = {
  error?: string;
  recoveryFailureCode?: string;
  recoveryFailures?: Array<{ partition: string; operation: string; detail: string }>;
  detail?: string;
};

test('cron shaping: schedule-context + finalization dual failure → 500 with BOTH causes, stable code, zero fetches', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubJson([GAME_A()]); // must never be reached

  // Planning reads the schedule once (allowed); the post-claim authoritative
  // reread fails. The claim commit (first recovery write) is allowed; its
  // token-conditional release fails.
  __setAppStateReadFailureForTests(new Error('schedule store down'), 'schedule', {
    afterReads: 1,
  });
  __setAppStateWriteFailureForTests(
    new Error('recovery release store down'),
    'game-stats-recovery',
    { afterWrites: 1 }
  );
  let res: Awaited<ReturnType<typeof cronGet>>;
  try {
    res = await cronGet(cronRequest());
  } finally {
    __setAppStateReadFailureForTests(null);
    __setAppStateWriteFailureForTests(null);
  }
  const body = (await res.json()) as RevalidationFailureBody;
  assert.equal(res.status, 500, JSON.stringify(body));
  assert.match(body.error ?? '', /post-claim revalidation failed \(schedule-context\)/);
  assert.match(body.error ?? '', /schedule store down/, 'primary cause on the wire');
  assert.equal(body.recoveryFailureCode, GAME_STATS_RECOVERY_METADATA_FAILURE_CODE);
  assert.equal(body.recoveryFailures?.length, 1, 'secondary cause on the wire');
  assert.equal(body.recoveryFailures?.[0]?.operation, 'stale-claim-finalize');
  assert.match(body.recoveryFailures?.[0]?.detail ?? '', /recovery release store down/);
  assert.match(body.detail ?? '', /zero provider calls/);
  assert.match(body.detail ?? '', /lease remains bounded/);
  assert.equal(fetchCalls, 0, 'no provider request was made');
});

test('cron shaping: durable-reread + finalization dual failure → 500 with BOTH causes, stable code, zero fetches', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubJson([GAME_A()]); // must never be reached

  // Planning reads partitions via the entries API (unaffected); the post-claim
  // committed-partition reread is the first keyed game-stats read and fails.
  __setAppStateReadFailureForTests(new Error('game-stats partition store down'), 'game-stats');
  __setAppStateWriteFailureForTests(
    new Error('recovery release store down'),
    'game-stats-recovery',
    { afterWrites: 1 }
  );
  let res: Awaited<ReturnType<typeof cronGet>>;
  try {
    res = await cronGet(cronRequest());
  } finally {
    __setAppStateReadFailureForTests(null);
    __setAppStateWriteFailureForTests(null);
  }
  const body = (await res.json()) as RevalidationFailureBody;
  assert.equal(res.status, 500, JSON.stringify(body));
  assert.match(body.error ?? '', /post-claim revalidation failed \(durable-reread\)/);
  assert.match(body.error ?? '', /partition store down/, 'primary cause on the wire');
  assert.equal(body.recoveryFailureCode, GAME_STATS_RECOVERY_METADATA_FAILURE_CODE);
  assert.equal(body.recoveryFailures?.length, 1, 'secondary cause on the wire');
  assert.equal(body.recoveryFailures?.[0]?.operation, 'stale-claim-finalize');
  assert.match(body.recoveryFailures?.[0]?.detail ?? '', /recovery release store down/);
  assert.match(body.detail ?? '', /zero provider calls/);
  assert.equal(fetchCalls, 0, 'no provider request was made');
});
