import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../route';
import {
  providerRefreshScopeKey,
  scoresAggregateScope,
} from '../../../../../lib/providerRefreshScope.ts';
import type { ProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { seasonYearForToday } from '../../../../../lib/scores/normalizers.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2C — the historical score repair records ONE truthful,
// year-scoped provider-refresh attempt whenever provider work is required.
// Auth/validation/active-year/cached exits fabricate no attempt; a durable
// write failure never records success; stored status carries no provider
// bodies, credentials, or storage errors; status recording is best-effort and
// never changes the route's provider/cache outcome.
// ---------------------------------------------------------------------------

const YEAR = 2019;
const ADMIN_TOKEN = 'test-admin-token';
const CFBD_KEY = 'SECRET_KEY_CANARY_cfbd';
const BODY_CANARY = 'SECRET_CANARY_BODY';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const originalFetch = globalThis.fetch;

const SCOPE = scoresAggregateScope(YEAR, ['regular', 'postseason'], ['regular', 'postseason']);
const SCOPE_KEY = providerRefreshScopeKey('scores', SCOPE);

function cfbdGame(seasonType: 'regular' | 'postseason', id: number) {
  return {
    id,
    home_team: 'Alpha U',
    away_team: 'Beta U',
    home_points: 21,
    away_points: 7,
    season_type: seasonType,
    week: 1,
    start_date: `${YEAR}-09-0${id}T00:00:00.000Z`,
    completed: true,
  };
}

type FetchPlan = {
  regular: () => Response;
  postseason: () => Response;
};

let fetchCalls: string[] = [];
let fetchPlan: FetchPlan;

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchMock(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    return url.includes('seasonType=postseason') ? fetchPlan.postseason() : fetchPlan.regular();
  }) as typeof globalThis.fetch;
}

function request(body: unknown, token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/admin/cache-historical-scores', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function statusRow(): Promise<ProviderRefreshStatus | null> {
  const record = await getAppState<ProviderRefreshStatus>('provider-refresh-status', SCOPE_KEY);
  return record?.value ?? null;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  fetchCalls = [];
  fetchPlan = {
    regular: () => okJson([cfbdGame('regular', 1), cfbdGame('regular', 2)]),
    postseason: () => okJson([cfbdGame('postseason', 3)]),
  };
  installFetchMock();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
  MUTABLE_ENV.CFBD_API_KEY = CFBD_KEY;
});

test.after(() => {
  globalThis.fetch = originalFetch;
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  __setAppStateWriteFailureForTests(null);
});

// 1 — auth, invalid body/year, and active-year refusals: no provider call, no attempt.
test('auth/validation/active-year exits fabricate no attempt and call no provider', async () => {
  const unauthorized = await POST(request({ year: YEAR }, null));
  assert.equal(unauthorized.status, 401);

  const badJson = await POST(request('nope{'));
  assert.equal(badJson.status, 400);

  const badYear = await POST(request({ year: 'x' }));
  assert.equal(badYear.status, 400);

  const active = await POST(request({ year: seasonYearForToday() }));
  assert.equal(active.status, 400);
  assert.match(((await active.json()) as { error: string }).error, /active season/);

  assert.deepEqual(fetchCalls, [], 'no provider call');
  assert.equal(await statusRow(), null, 'no fabricated attempt');
});

// 2 — already-cached short-circuit: unchanged response, no provider call, no attempt.
test('already-cached force:false short-circuits with no provider call and no attempt', async () => {
  await setAppState('scores', `${YEAR}-all-regular`, { at: 1, items: [], source: 'cfbd' });
  await setAppState('scores', `${YEAR}-all-postseason`, { at: 1, items: [], source: 'cfbd' });

  const res = await POST(request({ year: YEAR, force: false }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { alreadyCached: true, year: YEAR });
  assert.deepEqual(fetchCalls, []);
  assert.equal(await statusRow(), null);
});

// 5 — clean two-partition repair: one succeeded aggregate attempt after both commits.
test('clean repair records one succeeded year-scoped attempt with exact rows', async () => {
  const res = await POST(request({ year: YEAR }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; scoreCount: number };
  assert.equal(body.success, true);
  assert.equal(body.scoreCount, 3);

  const row = await statusRow();
  assert.ok(row, 'attempt recorded');
  assert.equal(row!.latestAttemptOutcome, 'succeeded');
  assert.equal(row!.rowsCommitted, 3);
  assert.equal(row!.source, 'cfbd');
  assert.equal(row!.partialFailure, false);
  assert.ok(row!.lastSuccessAt, 'confirmed commit time recorded');
  assert.equal(typeof row!.lastSuccessSeq, 'number', 'commit sequence recorded');
  assert.equal(row!.scope.kind, 'year', 'exact year-rollup scope');

  const regular = await getAppState('scores', `${YEAR}-all-regular`);
  const postseason = await getAppState('scores', `${YEAR}-all-postseason`);
  assert.ok(regular && postseason, 'both partitions durably written');
});

// 3 — missing credential AFTER provider work is required: scoped failure that
// preserves prior success.
test('missing CFBD key records a scoped cfbd-api-key-missing failure preserving prior success', async () => {
  // Establish prior-good success first.
  const first = await POST(request({ year: YEAR }));
  assert.equal(first.status, 200);
  const prior = (await statusRow())!;
  assert.ok(prior.lastSuccessAt);

  delete MUTABLE_ENV.CFBD_API_KEY;
  fetchCalls = [];
  // force:true — provider work is required despite the existing cache.
  const res = await POST(request({ year: YEAR, force: true }));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'CFBD_API_KEY missing' });
  assert.deepEqual(fetchCalls, [], 'no provider call without a credential');

  const row = (await statusRow())!;
  assert.equal(row.latestAttemptOutcome, 'failed');
  assert.equal(row.lastError?.code, 'cfbd-api-key-missing');
  assert.equal(row.lastSuccessAt, prior.lastSuccessAt, 'prior success preserved');
  assert.equal(row.rowsCommitted, prior.rowsCommitted);
});

// 4 + 8 — one partition fetch failure: failed aggregate attempt naming the exact
// partition; no data success; canaries never reach stored status.
test('a postseason fetch failure records one failed attempt naming the partition, sans canaries', async () => {
  fetchPlan.postseason = () =>
    new Response(BODY_CANARY, { status: 400, headers: { 'content-type': 'text/plain' } });

  const res = await POST(request({ year: YEAR }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'CFBD API error');

  const row = (await statusRow())!;
  assert.equal(row.latestAttemptOutcome, 'failed');
  assert.equal(row.lastError?.code, 'cfbd-fetch-failed');
  assert.deepEqual(row.failedPartitions, ['postseason']);
  assert.equal(row.lastSuccessAt, null, 'no success recorded');

  const stored = JSON.stringify(row);
  assert.ok(!stored.includes(BODY_CANARY), 'no provider body in status');
  assert.ok(!stored.includes(CFBD_KEY), 'no credential in status');

  assert.equal(await getAppState('scores', `${YEAR}-all-regular`), null, 'no partial data write');
  assert.equal(await getAppState('scores', `${YEAR}-all-postseason`), null);
});

// Codex r1 — an empty partition over PRIOR-GOOD rows is a rejected replacement:
// one failed attempt, no writes, prior rows retained.
test('an empty partition over prior-good rows is rejected before any write', async () => {
  // Prior-good postseason rows exist for the exact key the repair would overwrite.
  await setAppState('scores', `${YEAR}-all-postseason`, {
    at: 1,
    items: [{ id: '9', home: { team: 'A', score: 1 }, away: { team: 'B', score: 0 } }],
    source: 'cfbd',
  });
  fetchPlan.postseason = () => okJson([]);

  // force:true — provider work required despite the partial existing cache.
  const res = await POST(request({ year: YEAR, force: true }));
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /rows are expected for partition\(s\): postseason/);
  assert.match(body.error, /prior cached rows retained/);

  const row = (await statusRow())!;
  assert.equal(row.latestAttemptOutcome, 'failed');
  assert.equal(row.lastError?.code, 'cfbd-empty-unexpected');
  assert.deepEqual(row.failedPartitions, ['postseason']);
  assert.equal(row.lastSuccessAt, null);

  const prior = await getAppState<{ items: unknown[] }>('scores', `${YEAR}-all-postseason`);
  assert.equal(prior?.value?.items?.length, 1, 'prior-good rows retained');
  assert.equal(
    await getAppState('scores', `${YEAR}-all-regular`),
    null,
    'no sibling write on a rejected aggregate'
  );
});

// Codex r1 — started schedule games are unexpected-empty evidence even with no
// prior score rows.
test('an empty partition with started schedule games is rejected as unexpected', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        week: 1,
        seasonType: 'postseason',
        startDate: `${YEAR}-12-20T00:00:00.000Z`,
        status: 'final',
      },
    ],
  });
  fetchPlan.postseason = () => okJson([]);

  const res = await POST(request({ year: YEAR }));
  assert.equal(res.status, 502);
  const row = (await statusRow())!;
  assert.equal(row.lastError?.code, 'cfbd-empty-unexpected');
  assert.deepEqual(row.failedPartitions, ['postseason']);
});

// Codex r1 — genuinely absent targets resolve as a NO-OP: no empty commit, no
// last-success advancement.
test('all-empty partitions with no evidence resolve as a no-op with no empty commit', async () => {
  fetchPlan.regular = () => okJson([]);
  fetchPlan.postseason = () => okJson([]);

  const res = await POST(request({ year: YEAR }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; scoreCount: number; noOp?: boolean };
  assert.equal(body.success, true);
  assert.equal(body.scoreCount, 0);
  assert.equal(body.noOp, true);

  const row = (await statusRow())!;
  assert.equal(row.latestAttemptOutcome, 'no-op');
  assert.equal(row.lastSuccessAt, null, 'no-op never advances last-success');

  assert.equal(await getAppState('scores', `${YEAR}-all-regular`), null, 'no empty commit');
  assert.equal(await getAppState('scores', `${YEAR}-all-postseason`), null);
});

// Codex r1 — a valid-absence empty sibling is skipped while the populated
// partition commits: success counts only the committed rows.
test('a valid-absence empty sibling is skipped while the populated partition commits', async () => {
  fetchPlan.postseason = () => okJson([]);
  // No schedule evidence and no prior postseason rows → postseason is valid absence.

  const res = await POST(request({ year: YEAR }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; scoreCount: number };
  assert.equal(body.success, true);
  assert.equal(body.scoreCount, 2, 'only the committed regular rows counted');

  const row = (await statusRow())!;
  assert.equal(row.latestAttemptOutcome, 'succeeded');
  assert.equal(row.rowsCommitted, 2);

  assert.notEqual(await getAppState('scores', `${YEAR}-all-regular`), null);
  assert.equal(
    await getAppState('scores', `${YEAR}-all-postseason`),
    null,
    'valid-absence partition never written'
  );
});

// 6 — durable write failure: failed attempt, no last-success advancement, and a
// generic 500 that never exposes the thrown storage error.
test('a durable write failure records durable-write-failed and never success', async () => {
  __setAppStateWriteFailureForTests(new Error('simulated scores store outage'), 'scores');
  try {
    const res = await POST(request({ year: YEAR }));
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'failed to persist historical scores');
    assert.ok(!JSON.stringify(body).includes('simulated'), 'storage error not exposed');
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  const row = (await statusRow())!;
  assert.equal(row.latestAttemptOutcome, 'failed');
  assert.equal(row.lastError?.code, 'durable-write-failed');
  assert.equal(row.partialFailure, false, 'both writes failed — not partial');
  assert.deepEqual(row.failedPartitions, ['regular', 'postseason']);
  assert.equal(row.lastSuccessAt, null, 'last-success never advanced');
  assert.ok(!JSON.stringify(row).includes('simulated'), 'storage error not stored');
});

// 9 — a status-store failure changes neither the route response nor the durable
// score result (best-effort recording).
test('a status-store failure never changes the route response or durable scores', async () => {
  __setAppStateWriteFailureForTests(new Error('status store outage'), 'provider-refresh-status');
  try {
    const res = await POST(request({ year: YEAR }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; scoreCount: number };
    assert.equal(body.success, true);
    assert.equal(body.scoreCount, 3);
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  const regular = await getAppState('scores', `${YEAR}-all-regular`);
  const postseason = await getAppState('scores', `${YEAR}-all-postseason`);
  assert.ok(regular && postseason, 'durable score writes unaffected');
});
