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
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../lib/gameStats/cache.ts';
import {
  deriveSlateExpectation,
  ingestGameStatsObservations,
} from '../../../../lib/gameStats/ingestion.ts';
import { aggregateOwnerSeasonStats } from '../../../../lib/gameStats/ownerStats.ts';
import { createTeamIdentityResolver } from '../../../../lib/teamIdentity.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../lib/providerRefreshScope.ts';
import {
  legacyRowFromWire,
  seedGameStatsPartitionForTests,
  wireGame,
} from '../../../../lib/gameStats/__tests__/fixtures.ts';
import type { Pool } from 'pg';

// PLATFORM-086H3 — end-to-end lifecycle tests for the activated game-stats
// contract: canonical schedule → validated observations → durable merge
// authority → committed durable state → coverage/recovery → public read →
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
      neutralSite: false,
      conferenceGame: false,
      homeTeam: `Home ${it.id}`,
      awayTeam: `Away ${it.id}`,
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
function stubForbidden(message: string) {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error(message);
  }) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  MUTABLE_ENV.NODE_ENV = 'development';
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// === Full lifecycle: schedule → observation → merge → coverage → read → analytics ===

test('lifecycle: a scheduled cron run commits v2 evidence the whole stack serves', async () => {
  await seedSchedule([{ id: '5001' }, { id: '5002' }]);
  stubJson([GAME_A(), GAME_B()]);

  const cronRes = await cronGet(cronRequest());
  const cronBody = (await cronRes.json()) as {
    gamesProcessed: number;
    week: number;
    durable?: { outcome: string; inserted: number };
  };
  assert.equal(cronRes.status, 200, JSON.stringify(cronBody));
  assert.equal(cronBody.week, WEEK);
  assert.equal(cronBody.gamesProcessed, 2);
  assert.equal(cronBody.durable?.outcome, 'written');
  assert.equal(fetchCalls, 1, 'one shared provider request for the partition');

  // Durable state is v2 through the merge authority.
  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.equal(stored?.games.length, 2);
  for (const row of stored!.games) {
    assert.equal(row.schemaVersion, 2);
    assert.ok(row.fetchStartedAt, 'observation fence stamped');
  }

  // Committed-state coverage: the provider status advanced only after COMMIT.
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 2);

  // Public read: cache-only, metadata-free.
  stubForbidden('public reads must not call the provider');
  const readRes = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(readRes.status, 200);
  const raw = await readRes.text();
  assert.ok(!raw.includes('schemaVersion'), 'no v2 metadata on the public wire');
  assert.ok(!raw.includes('fetchStartedAt'), 'no fence on the public wire');
  assert.ok(!raw.includes('pointsProvided'), 'no evidence flag on the public wire');
  assert.equal(fetchCalls, 0, 'zero provider calls from the public read');
  const readBody = JSON.parse(raw) as { games: Array<{ providerGameId: number }> };
  assert.deepEqual(readBody.games.map((g) => g.providerGameId).sort(), [5001, 5002]);

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
  stubForbidden('cron must not refetch a satisfied partition');
  const secondRes = await cronGet(cronRequest());
  const secondBody = (await secondRes.json()) as { skipped?: string };
  assert.equal(secondRes.status, 200);
  assert.match(String(secondBody.skipped ?? ''), /already satisfied/i);
  assert.equal(fetchCalls, 0);
});

test('lifecycle: schedule-relative recovery repairs a partial partition without data loss', async () => {
  await seedSchedule([{ id: '5001' }, { id: '5002' }]);
  // Prior durable evidence for game A only (through the merge authority).
  const expectation = deriveSlateExpectation({
    scheduleItems: [
      { id: '5001', week: WEEK, seasonType: 'regular', startDate: DAYS_AGO(10), status: 'F' },
      { id: '5002', week: WEEK, seasonType: 'regular', startDate: DAYS_AGO(10), status: 'F' },
    ],
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: Date.now(),
  });
  const first = await ingestGameStatsObservations({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchStartedAt: DAYS_AGO(2),
    payload: [GAME_A()],
    expectation,
  });
  assert.equal(first.kind, 'merged');
  const priorFence = (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games[0]!.fetchStartedAt;

  // The cron sees a partial slate (game B absent) and repairs it.
  stubJson([GAME_A(), GAME_B()]);
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { durable?: { inserted: number; refreshed: number } };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.durable?.inserted, 1, 'the missing game was inserted');

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.deepEqual(stored!.games.map((g) => g.providerGameId).sort(), [5001, 5002]);
  const gameA = stored!.games.find((g) => g.providerGameId === 5001)!;
  assert.ok(
    gameA.fetchStartedAt! >= priorFence!,
    'prior evidence preserved or freshness-advanced, never rolled back'
  );
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

test('lifecycle: placeholder-only slates defer — no provider call, placeholders preserved', async () => {
  await seedSchedule([
    { id: 'cfp-semi-a', week: 1, seasonType: 'postseason', startDate: DAYS_AGO(2) },
    { id: 'cfp-semi-b', week: 1, seasonType: 'postseason', startDate: DAYS_AGO(2) },
  ]);
  stubForbidden('placeholders are not provider-addressable');
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.ok(body.skipped, 'deferred, not fetched');
  assert.equal(fetchCalls, 0);
});

test('lifecycle: FCS-vs-FCS games stay excluded — provider rows outside the schedule never merge', async () => {
  await seedSchedule([{ id: '5001' }]);
  // Provider returns the scheduled FBS game AND an unscheduled (FCS-vs-FCS) game.
  stubJson([GAME_A(), wireGame({ id: 888_888 })]);
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.deepEqual(
    stored!.games.map((g) => g.providerGameId),
    [5001],
    'no game identity is ever constructed from a statistics payload'
  );
});

// === Truthful non-destructive failure handling ===

test('lifecycle: an unexpected empty response is a truthful no-op, never a destructive clear', async () => {
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
  const body = (await res.json()) as { skipped?: string; week?: number };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.week, 4);
  assert.match(String(body.skipped ?? ''), /contextually unexpected/i);

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 4, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null, 'uncertainty never advances last-success');
  assert.equal(await getCachedGameStats(YEAR, 4, 'regular'), null, 'no empty record fabricated');
  assert.deepEqual(
    (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games,
    [priorRow],
    'prior-good durable evidence untouched'
  );
});

test('lifecycle: invalid payloads and schema drift fail without touching durable state', async () => {
  await seedSchedule([{ id: '5001' }]);
  const priorRow = legacyRowFromWire(wireGame({ id: 5001, home: { points: 10 } }), WEEK);
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: DAYS_AGO(9),
    games: [{ ...priorRow, home: { ...priorRow.home, raw: {} } }], // ineligible → cron retries
  });

  stubJson({ not: 'an array' });
  let res = await cronGet(cronRequest());
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { error?: string }).error, 'game-stats-invalid-payload');

  stubJson([{ garbage: true }, 17]);
  res = await cronGet(cronRequest());
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { error?: string }).error, 'game-stats-schema-drift');

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.equal(stored!.games[0]!.home.points, 10, 'prior durable evidence preserved');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-schema-drift');
});

test('lifecycle: provider unavailability is a failure, never confirmed absence', async () => {
  await seedSchedule([{ id: '5001' }]);
  stubThrow('provider connection refused');
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 500);
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastSuccessAt, null);
  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'nothing fabricated');
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
    meta: { durable?: { outcome: string; inserted: number } };
  };
  assert.equal(firstBody.meta.durable?.outcome, 'written');
  assert.equal(firstBody.meta.durable?.inserted, 1);
  assert.equal(firstBody.games.length, 1);
  const fence1 = (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games[0]!.fetchStartedAt!;

  // Identical content, strictly newer fetch → durable fence-only refresh.
  stubJson([GAME_A()]);
  const second = await publicGet(refreshRequest());
  const secondBody = (await second.json()) as {
    meta: { durable?: { outcome: string; refreshed: number } };
  };
  assert.equal(second.status, 200);
  assert.equal(secondBody.meta.durable?.outcome, 'written');
  assert.equal(secondBody.meta.durable?.refreshed, 1);
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
  stubForbidden('unauthorized refresh must not reach the provider');
  const res = await publicGet(
    readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular&bypassCache=1`)
  );
  assert.equal(res.status, 401);
  assert.equal(fetchCalls, 0);
});

test('refresh: invalid query parameters fail before provider access', async () => {
  stubForbidden('invalid params must not reach the provider');
  const res = await publicGet(readRequest(`year=20xx&week=3&bypassCache=1`, true));
  assert.equal(res.status, 400);
  assert.equal(fetchCalls, 0);
});

test('refresh: a missing canonical schedule blocks the refresh before quota is spent', async () => {
  stubForbidden('no schedule, no provider call');
  const res = await publicGet(refreshRequest());
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-schedule-unavailable');
  assert.equal(fetchCalls, 0);
});

// === Truthful read availability ===

test('reads: ordinary reads are cache-only for everyone (fresh, stale, miss)', async () => {
  const record = {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular' as const,
    fetchedAt: new Date().toISOString(),
    games: [legacyRowFromWire(wireGame({ id: 5001 }), WEEK)],
  };
  await seedGameStatsPartitionForTests(record);
  stubForbidden('ordinary reads never call the provider');

  // Fresh hit — legacy rows byte-equivalent, hit meta.
  const fresh = await publicGet(readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`));
  assert.equal(fresh.status, 200);
  const freshBody = (await fresh.json()) as Record<string, unknown> & {
    meta: { cache: string; stale?: boolean };
  };
  assert.equal(freshBody.meta.cache, 'hit');
  assert.equal(freshBody.meta.stale, undefined);
  assert.deepEqual(freshBody.games, JSON.parse(JSON.stringify(record.games)));

  // Stale hit — served truthfully with the stale marker, admin or not.
  await seedGameStatsPartitionForTests({ ...record, fetchedAt: DAYS_AGO(3) });
  for (const admin of [false, true]) {
    const stale = await publicGet(
      readRequest(`year=${YEAR}&week=${WEEK}&seasonType=regular`, admin)
    );
    assert.equal(stale.status, 200);
    const staleBody = (await stale.json()) as { meta: { stale?: boolean } };
    assert.equal(staleBody.meta.stale, true, `stale marker (admin=${admin})`);
  }

  // Miss — refresh-required, not fabricated emptiness, admin or not.
  for (const admin of [false, true]) {
    const miss = await publicGet(readRequest(`year=${YEAR}&week=9&seasonType=regular`, admin));
    assert.equal(miss.status, 503, `miss is refresh-required (admin=${admin})`);
    const missBody = (await miss.json()) as { error?: string };
    assert.equal(missBody.error, 'game stats cache miss: admin refresh required');
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
    { id: '5001', week: WEEK, seasonType: 'regular', startDate: DAYS_AGO(10), status: 'F' },
    { id: '5002', week: WEEK, seasonType: 'regular', startDate: DAYS_AGO(10), status: 'F' },
  ];
  const expectation = deriveSlateExpectation({
    scheduleItems,
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: Date.now(),
  });
  const base = { year: YEAR, week: WEEK, seasonType: 'regular' as const, expectation };
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
    pending: { key: string; value: string } | null,
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
      return { result: { rows: [] }, pending: { key: `${scope}::${key}`, value: json } };
    }
    if (sql === 'commit') {
      if (this.failCommit) {
        if (pending && this.commitApplies) this.data.set(pending.key, pending.value);
        throw new Error('commit confirmation lost');
      }
      if (pending) this.data.set(pending.key, pending.value);
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
    let pending: { key: string; value: string } | null = null;
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

const UNCERTAINTY_SLATE = [
  { id: '5001', week: WEEK, seasonType: 'regular' as const, startDate: DAYS_AGO(10), status: 'F' },
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
      year: YEAR,
      week: WEEK,
      seasonType: 'regular',
      now: Date.now(),
    }),
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
