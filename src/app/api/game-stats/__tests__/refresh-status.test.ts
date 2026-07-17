import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
} from '../../../../lib/server/appStateStore.ts';
import { getCachedGameStats, setCachedGameStats } from '../../../../lib/gameStats/cache.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../lib/providerRefreshScope.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
};
const ORIGINAL_FETCH = globalThis.fetch;
const ADMIN_TOKEN = 'test-admin-token';
// Wire stat entries make a row AUTHORITATIVE (provider-present fields); a
// teams row with `stats: []` is identity-only and never persisted by the merge.
const WIRE_STATS = [{ category: 'totalYards', stat: '100' }];

function adminRefresh(): Request {
  return new Request(
    'https://example.com/api/game-stats?year=2026&week=3&seasonType=regular&bypassCache=1',
    { headers: { 'x-admin-token': ADMIN_TOKEN } }
  );
}

function stubJson(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL.ADMIN_API_TOKEN;
  if (ORIGINAL.CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL.CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manual game-stats refresh with a missing CFBD key records a failed attempt (finding #5)', async () => {
  delete MUTABLE_ENV.CFBD_API_KEY;

  const res = await GET(
    new Request(
      'https://example.com/api/game-stats?year=2026&week=3&seasonType=regular&bypassCache=1',
      {
        headers: { 'x-admin-token': ADMIN_TOKEN },
      }
    )
  );
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'CFBD_API_KEY not configured');

  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the missing-key attempt is recorded as failed'
  );
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

// 5th-review finding #5 — manual route shares the cron's empty/nonempty-zero rules.
test('manual refresh: a genuinely empty provider response is a no-op without a durable write', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    games: unknown[];
    meta: { noApplicableData?: boolean; outcome?: string; noopReason?: string };
  };
  assert.deepEqual(body.games, []);
  assert.equal(body.meta.noApplicableData, true);
  // PLATFORM-086H finding #1: the response reports the valid no-op explicitly so
  // the panel never has to infer an outcome from games.length.
  assert.equal(body.meta.outcome, 'noop');
  assert.equal(body.meta.noopReason, 'no-provider-rows');

  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'no empty record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null);
});

test('manual refresh: a nonempty payload with no usable rows resolves as failure (no write)', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  // A row missing its away team is dropped by normalization → zero usable rows.
  stubJson([{ id: 5001, teams: [{ team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] }]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 502);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-no-usable-rows');

  assert.equal(await getCachedGameStats(2026, 3, 'regular'), null, 'no unusable record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-no-usable-rows');
});

test('manual refresh: a usable payload commits and records success', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([
    {
      id: 5001,
      teams: [
        {
          teamId: 1,
          team: 'Alpha',
          conference: 'X',
          homeAway: 'home',
          points: 21,
          stats: WIRE_STATS,
        },
        {
          teamId: 2,
          team: 'Beta',
          conference: 'Y',
          homeAway: 'away',
          points: 14,
          stats: WIRE_STATS,
        },
      ],
    },
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    games: unknown[];
    meta: { cache: string; outcome?: string; rowsCommitted?: number };
  };
  assert.equal(body.games.length, 1);
  assert.equal(body.meta.cache, 'miss');
  assert.equal(body.meta.outcome, 'committed');
  assert.equal(body.meta.rowsCommitted, 1);

  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the usable record is committed');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
});

// Adversarial-review remediation — an identity-only payload (valid ids and team
// names but zero recognized stat categories) is SCHEMA DRIFT, not unpublished
// data: a visible target-local failure, never a silent no-op and never an empty
// durable commit. (A legitimately unpublished week is an EMPTY payload → no-op.)
test('manual refresh: an identity-only payload is a visible no-authoritative-rows failure', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson([
    {
      id: 5001,
      teams: [
        { teamId: 1, team: 'Alpha', conference: 'X', homeAway: 'home', points: 21, stats: [] },
        { teamId: 2, team: 'Beta', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
      ],
    },
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 502);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, 'game-stats-no-authoritative-rows');

  assert.equal(
    await getCachedGameStats(2026, 3, 'regular'),
    null,
    'no empty record is committed for zero-authority rows'
  );
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-no-authoritative-rows');
  assert.equal(status.lastSuccessAt, null, 'no last-success advance for zero coverage');
});

// === PLATFORM-086H — the manual refresh shares the cron's merge contract ===

test('manual refresh: a partial provider response merges with prior-good rows, never replaces them', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  await setCachedGameStats({
    year: 2026,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [
      {
        providerGameId: 5001,
        week: 3,
        seasonType: 'regular',
        home: { school: 'Alpha' } as never,
        away: { school: 'Beta' } as never,
      },
    ],
  });
  // The refresh returns ONLY a different game — the prior row must survive.
  stubJson([
    {
      id: 5002,
      teams: [
        {
          teamId: 1,
          team: 'Gamma',
          conference: 'X',
          homeAway: 'home',
          points: 30,
          stats: WIRE_STATS,
        },
        {
          teamId: 2,
          team: 'Delta',
          conference: 'Y',
          homeAway: 'away',
          points: 3,
          stats: WIRE_STATS,
        },
      ],
    },
  ]);

  const res = await GET(adminRefresh());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    games: Array<{ providerGameId: number }>;
    meta: { outcome?: string; rowsCommitted?: number; rowsCached?: number };
  };
  assert.equal(body.meta.outcome, 'committed');
  assert.equal(body.meta.rowsCommitted, 1);
  assert.equal(body.meta.rowsCached, 2);

  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.deepEqual(
    stored?.games.map((g) => g.providerGameId).sort(),
    [5001, 5002],
    'the prior-good row was retained alongside the new row'
  );
});

test('manual refresh: identical provider data is a truthful no-op — no rewrite, no last-success advance', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  const payload = [
    {
      id: 5001,
      teams: [
        {
          teamId: 1,
          team: 'Alpha',
          conference: 'X',
          homeAway: 'home',
          points: 21,
          stats: WIRE_STATS,
        },
        {
          teamId: 2,
          team: 'Beta',
          conference: 'Y',
          homeAway: 'away',
          points: 14,
          stats: WIRE_STATS,
        },
      ],
    },
  ];
  stubJson(payload);
  const first = await GET(adminRefresh());
  assert.equal(first.status, 200);
  const committed = await getCachedGameStats(2026, 3, 'regular');
  const successAfterFirst = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );

  stubJson(payload);
  const second = await GET(adminRefresh());
  assert.equal(second.status, 200);
  const body = (await second.json()) as {
    games: unknown[];
    meta: { outcome?: string; noopReason?: string; rowsCached?: number };
  };
  assert.equal(body.meta.outcome, 'noop');
  assert.equal(body.meta.noopReason, 'no-new-rows');
  assert.equal(body.meta.rowsCached, 1);
  assert.equal(body.games.length, 1, 'the response still carries the cached rows');

  const after = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(after?.fetchedAt, committed?.fetchedAt, 'no durable rewrite for identical data');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(
    status.lastSuccessAt,
    successAfterFirst.lastSuccessAt,
    'a no-change refresh does not advance last-success'
  );
});

// Review remediation — the read→merge→write sequence is a per-week critical
// section, so overlapping refreshes for the same week produce the UNION of
// their rows instead of the later write dropping the earlier one's.

function rawGamePayload(id: number, home: string, away: string) {
  return [
    {
      id,
      teams: [
        {
          teamId: id * 10 + 1,
          team: home,
          conference: 'X',
          homeAway: 'home',
          points: 21,
          stats: WIRE_STATS,
        },
        {
          teamId: id * 10 + 2,
          team: away,
          conference: 'Y',
          homeAway: 'away',
          points: 14,
          stats: WIRE_STATS,
        },
      ],
    },
  ];
}

test('two overlapping manual refreshes adding different games produce the union', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  // Serve a DIFFERENT game to each request so a lost update would be visible.
  const payloads = [rawGamePayload(5001, 'Alpha', 'Beta'), rawGamePayload(5002, 'Gamma', 'Delta')];
  let call = 0;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const [a, b] = await Promise.all([GET(adminRefresh()), GET(adminRefresh())]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.deepEqual(
    stored?.games.map((g) => g.providerGameId).sort(),
    [5001, 5002],
    'neither overlapping refresh lost the other one’s row'
  );
});

test('a failed durable write releases the week lock; the next refresh succeeds', async () => {
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubJson(rawGamePayload(5001, 'Alpha', 'Beta'));
  // Fail ONLY the game-stats data commit; provider-status writes still persist.
  __setAppStateWriteFailureForTests(new Error('game-stats write down'), 'game-stats');
  let failed: Response;
  try {
    failed = await GET(adminRefresh());
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(failed.status, 502, 'the failed write surfaces as a refresh failure');
  const statusAfterFailure = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(2026, 3, 'regular')
  );
  assert.equal(statusAfterFailure.latestAttemptOutcome, 'failed');

  stubJson(rawGamePayload(5001, 'Alpha', 'Beta'));
  const retried = await GET(adminRefresh());
  assert.equal(retried.status, 200, 'the lock is not poisoned by the failed write');
  const stored = await getCachedGameStats(2026, 3, 'regular');
  assert.equal(stored?.games.length, 1, 'the retry committed normally');
});
