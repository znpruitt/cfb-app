import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getCachedGameStats, getGameStatsKey } from '../../../../../lib/gameStats/cache.ts';
import { seedActiveWriterControl } from '../../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import { legacyRowFromWire, wireGame } from '../../../../../lib/gameStats/__tests__/fixtures.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../../lib/providerRefreshScope.ts';

// PLATFORM-086H3E3 — kickoff-window targeting + evidence resolution + quota
// reserve for the activated cron: a partition polls only while it holds a
// stat-producing game aged [3h, 24h) whose evidence is not satisfied; at most
// ONE partition is fetched per run; the quota reserve refuses truthfully.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const NO_TARGET_SKIP = 'no partition inside the polling window';
const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();

const H = 60 * 60 * 1000;

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

type GameSeed = {
  id: number;
  week: number;
  seasonType?: 'regular' | 'postseason';
  ageHours: number;
  status?: string;
  home?: string;
  away?: string;
};

function scheduleItem(seed: GameSeed) {
  return {
    id: String(seed.id),
    week: seed.week,
    seasonType: seed.seasonType ?? 'regular',
    startDate: new Date(Date.now() - seed.ageHours * H).toISOString(),
    neutralSite: false,
    conferenceGame: false,
    homeTeam: seed.home ?? 'Alpha',
    awayTeam: seed.away ?? 'Beta',
    homeId: seed.id * 10 + 1,
    awayId: seed.id * 10 + 2,
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: seed.status ?? 'STATUS_FINAL',
  };
}

async function seedSchedule(seeds: GameSeed[]) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: seeds.map(scheduleItem),
  });
}

/** A complete, participant-verified stored legacy row for a seeded game. */
function satisfiedRow(seed: GameSeed) {
  return legacyRowFromWire(
    wireGame({
      id: seed.id,
      home: { school: seed.home ?? 'Alpha', teamId: seed.id * 10 + 1 },
      away: { school: seed.away ?? 'Beta', teamId: seed.id * 10 + 2 },
    }),
    seed.week
  );
}

async function seedPartitionRecord(
  week: number,
  seasonType: 'regular' | 'postseason',
  games: unknown[]
) {
  await setAppState('game-stats', getGameStatsKey(YEAR, week, seasonType), {
    year: YEAR,
    week,
    seasonType,
    fetchedAt: new Date().toISOString(),
    games,
  });
}

/** Stub CFBD: healthy /info usage, `payload` for /games/teams; tracks URLs. */
function stubProvider(payload: unknown, remainingCalls = 4000): { urls: string[] } {
  const calls = { urls: [] as string[] };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.urls.push(url);
    const body = url.includes('/info') ? { patronLevel: 1, remainingCalls } : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

test('a window partition with satisfied evidence does NOT poll (no target, no calls)', async () => {
  const seed: GameSeed = { id: 9001, week: 3, ageHours: 5 };
  await seedSchedule([seed]);
  await seedPartitionRecord(3, 'regular', [satisfiedRow(seed)]);
  const calls = stubProvider([]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(calls.urls.length, 0, 'no usage or provider call');
});

test('a games:[] record leaves the window game unresolved → the cron fetches and commits', async () => {
  const seed: GameSeed = { id: 9001, week: 3, ageHours: 5 };
  await seedSchedule([seed]);
  await seedPartitionRecord(3, 'regular', []);
  const calls = stubProvider([
    wireGame({
      id: 9001,
      home: { school: 'Alpha', teamId: 90011 },
      away: { school: 'Beta', teamId: 90012 },
    }),
  ]);

  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; reason?: string; committedGames?: number };
  assert.equal(body.outcome, 'success');
  assert.equal(body.reason, 'written-clean');
  assert.equal(body.committedGames, 1);

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the merged row is durable');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(
    calls.urls.filter((u) => !u.includes('/info')).length,
    1,
    'exactly ONE partition fetch'
  );
});

test('games outside the window never poll: too fresh (<3h) and already left (≥24h)', async () => {
  await seedSchedule([
    { id: 9001, week: 3, ageHours: 2 }, // too fresh
    { id: 9002, week: 4, ageHours: 30 }, // window closed — manual recovery only
  ]);
  const calls = stubProvider([]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(calls.urls.length, 0);
});

test('a disrupted-only window slate yields no target and spends nothing', async () => {
  await seedSchedule([{ id: 9001, week: 3, ageHours: 5, status: 'Canceled' }]);
  const calls = stubProvider([]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(calls.urls.length, 0);
});

test('the earliest unresolved eligible kickoff wins when several partitions are in-window', async () => {
  await seedSchedule([
    { id: 9001, week: 3, ageHours: 5 },
    { id: 9002, week: 4, ageHours: 10, home: 'Gamma', away: 'Delta' }, // earlier kickoff
  ]);
  const calls = stubProvider([]);

  await cronGet(cronRequest());
  const fetches = calls.urls.filter((u) => !u.includes('/info'));
  assert.equal(fetches.length, 1, 'max one partition per run');
  assert.match(fetches[0]!, /week=4/, 'the earlier unresolved kickoff is the target');
});

test('below-reserve usage refuses truthfully and scopes the failure to the target week', async () => {
  const seed: GameSeed = { id: 9001, week: 3, ageHours: 5 };
  await seedSchedule([seed]);
  const calls = stubProvider([], 900);

  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; reason?: string; remaining?: number };
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'quota-below-reserve');
  assert.equal(body.remaining, 900);
  assert.equal(calls.urls.filter((u) => !u.includes('/info')).length, 0, 'no partition fetch');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-quota-below-reserve');
});

test('a later successful run replaces a prior failure on the same week partition', async () => {
  const seed: GameSeed = { id: 9001, week: 3, ageHours: 5 };
  await seedSchedule([seed]);

  // Run 1: below reserve → failed.
  stubProvider([], 900);
  await cronGet(cronRequest());
  let status = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'failed');

  // Run 2: healthy usage + persistable payload → succeeded replaces failed.
  stubProvider([
    wireGame({
      id: 9001,
      home: { school: 'Alpha', teamId: 90011 },
      away: { school: 'Beta', teamId: 90012 },
    }),
  ]);
  await cronGet(cronRequest());
  status = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'succeeded');
});

test('an empty provider response is a no-op that keeps the partition polled next run', async () => {
  const seed: GameSeed = { id: 9001, week: 3, ageHours: 5 };
  await seedSchedule([seed]);
  stubProvider([]);

  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; reason?: string };
  assert.equal(body.outcome, 'no-op');
  assert.equal(body.reason, 'empty-response');
  assert.equal(await getCachedGameStats(YEAR, 3, 'regular'), null, 'no empty record written');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null, 'a no-op never advances last-success');
});

// PLATFORM-086H3E3 remediation — every TARGET-RESOLVED failure carries the
// durable reread of the exact partition and never advances last-success. A
// week with one covered game (9001) and one uncovered game (9002) stays an
// unresolved target while its durable record is non-empty, so each failure can
// prove the prior-good evidence survives untouched.
const COVERED: GameSeed = { id: 9001, week: 3, ageHours: 5 };
const UNCOVERED: GameSeed = { id: 9002, week: 3, ageHours: 6, home: 'Gamma', away: 'Delta' };

type FailureBody = {
  outcome?: string;
  reason?: string;
  remaining?: number;
  durable?: { status?: string; availability?: unknown };
};

async function seedPriorGoodTarget() {
  await seedSchedule([COVERED, UNCOVERED]);
  await seedPartitionRecord(3, 'regular', [satisfiedRow(COVERED)]);
}

test('a quota refusal rereads the prior-good partition and never advances last-success', async () => {
  await seedPriorGoodTarget();
  stubProvider([], 900); // below reserve → refuse

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as FailureBody;
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'quota-below-reserve');
  assert.equal(body.durable?.status, 'available', 'the refusal rereads the prior-good partition');

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'a refused run leaves the prior-good record intact');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastSuccessAt, null, 'a refusal never advances last-success');
});

test('a provider-transport failure is labeled provider-fetch-failed with the durable reread', async () => {
  await seedPriorGoodTarget();
  // Healthy /info, but the /games/teams transport throws — a fetch-phase
  // failure, distinct from any ingestion failure.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('network down');
  }) as typeof fetch;

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as FailureBody;
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'provider-fetch-failed');
  assert.notEqual(body.reason, 'ingestion-failed');
  assert.equal(body.durable?.status, 'available', 'a transport failure still rereads prior-good');

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the prior-good record is untouched');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-provider-fetch-failed');
  assert.equal(status.lastSuccessAt, null);
});

test('an ingestion-phase failure carries the interpreter reason (never provider-fetch-failed), rereads prior-good, and never advances last-success', async () => {
  await seedPriorGoodTarget();
  // The fetch SUCCEEDS with a persistable row for the uncovered game, so the
  // run reaches ingestion…
  stubProvider([
    wireGame({
      id: 9002,
      home: { school: 'Gamma', teamId: 90021 },
      away: { school: 'Delta', teamId: 90022 },
    }),
  ]);
  // …but the durable partition WRITE fails. H2 funnels every EXPECTED fault
  // into a typed outcome (here `unavailable`), so this surfaces on the normal
  // interpreter path — status 503, reason `unavailable` — NOT as a transport
  // failure and NOT as the raw-throw `ingestion-failed` catch (which is purely
  // defensive: no store fault reaches it by design). Scoped to `game-stats` so
  // the failure-status write and the durable reread stay healthy.
  __setAppStateWriteFailureForTests(new Error('durable write boom'), 'game-stats');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as FailureBody;
  assert.equal(res.status, 503);
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'unavailable');
  assert.notEqual(body.reason, 'provider-fetch-failed');
  assert.equal(
    body.durable?.status,
    'available',
    'the reread reports prior-good despite the failed write'
  );

  __setAppStateWriteFailureForTests(null);
  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the failed write left the prior-good record intact');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-unavailable');
  assert.equal(status.lastSuccessAt, null, 'a durable-write failure never advances last-success');
});
