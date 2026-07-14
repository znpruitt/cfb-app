import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, POST } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __resetOddsUsageStoreForTests,
  setLatestKnownOddsUsage,
} from '../../../../../lib/server/oddsUsageStore.ts';
import type { OddsUsageSnapshot } from '../../../../../lib/api/oddsUsage.ts';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshSuccess,
} from '../../../../../lib/server/providerRefreshStatus.ts';
import {
  globalScope,
  oddsTargetScope,
  seasonPartitionScope,
  weekPartitionScope,
  yearScope,
  type ProviderRefreshScope,
} from '../../../../../lib/providerRefreshScope.ts';
import { defaultOddsCacheKey } from '../../../odds/routeInternals.ts';
import type { ProviderDataset } from '../../../../../lib/providerDatasets.ts';

type FeedRow = {
  dataset: string;
  status: {
    lastSuccessAt: string | null;
    latestAttemptOutcome: string | null;
    source: string | null;
    rowsCommitted: number | null;
    scope: ProviderRefreshScope;
    scopeKey: string;
  };
  legacyStatus: { lastSuccessAt: string | null } | null;
};

async function seedSuccess(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  rows: number
): Promise<void> {
  const attempt = await beginProviderRefreshAttempt(dataset, scope, {
    attemptId: `${dataset}-seed`,
  });
  await recordProviderRefreshSuccess(dataset, scope, {
    attempt,
    source: 'cfbd',
    rowsCommitted: rows,
  });
}

async function feedRows(year: number): Promise<FeedRow[]> {
  const res = await GET(getRequest(ADMIN_TOKEN, year));
  assert.equal(res.status, 200);
  return ((await res.json()) as { datasets: FeedRow[] }).datasets;
}

function oddsSnapshot(remaining: number, capturedAt: string): OddsUsageSnapshot {
  return {
    used: 500 - remaining,
    remaining,
    limit: 500,
    lastCost: 3,
    capturedAt,
    source: 'odds-response-headers',
    sportKey: 'americanfootball_ncaaf',
    markets: ['h2h'],
    regions: ['us'],
    endpointType: 'odds',
    cacheStatus: 'hit',
  };
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ADMIN_TOKEN = 'test-admin-token';

function getRequest(token: string | null = ADMIN_TOKEN, year = 2026): Request {
  const headers: Record<string, string> = {};
  if (token) headers['x-admin-token'] = token;
  return new Request(`https://example.com/api/admin/provider-status?year=${year}`, { headers });
}

function postRequest(body: unknown, token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/admin/provider-status', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetOddsUsageStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
});

test('GET requires admin auth', async () => {
  const res = await GET(getRequest(null));
  assert.equal(res.status, 401);
});

test('GET returns one row per provider dataset with status, setting, and diagnostics', async () => {
  const res = await GET(getRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    datasets: Array<{
      dataset: string;
      descriptor: { label: string };
      status: { lastSuccessAt: string | null };
      setting: { enabled: boolean };
      diagnostics: unknown[];
    }>;
    globalPause: boolean;
  };
  assert.equal(body.datasets.length, 6);
  const datasets = body.datasets.map((d) => d.dataset).sort();
  assert.deepEqual(datasets, [
    'conferences',
    'game-stats',
    'odds',
    'rankings',
    'schedule',
    'scores',
  ]);
  for (const row of body.datasets) {
    assert.ok(row.descriptor.label, 'descriptor present');
    assert.equal(row.setting.enabled, true, 'defaults to enabled');
    assert.ok(Array.isArray(row.diagnostics));
  }
  assert.equal(body.globalPause, false);
});

test('POST set-global-pause persists and is reflected on the next GET', async () => {
  const postRes = await POST(postRequest({ action: 'set-global-pause', paused: true }));
  assert.equal(postRes.status, 200, await postRes.text());

  const getRes = await GET(getRequest());
  const body = (await getRes.json()) as { globalPause: boolean };
  assert.equal(body.globalPause, true);
});

test('POST set-dataset-enabled persists for a CONSUMED dataset (game-stats)', async () => {
  const postRes = await POST(
    postRequest({ action: 'set-dataset-enabled', dataset: 'game-stats', enabled: false })
  );
  assert.equal(postRes.status, 200, await postRes.text());

  const getRes = await GET(getRequest());
  const body = (await getRes.json()) as {
    datasets: Array<{ dataset: string; setting: { enabled: boolean } }>;
  };
  const gameStats = body.datasets.find((d) => d.dataset === 'game-stats');
  assert.equal(gameStats?.setting.enabled, false);
});

test('POST set-dataset-enabled is REJECTED for a planned/unconsumed dataset (finding #7)', async () => {
  for (const dataset of ['scores', 'odds', 'rankings', 'conferences']) {
    const res = await POST(postRequest({ action: 'set-dataset-enabled', dataset, enabled: false }));
    assert.equal(res.status, 400, `${dataset} toggle must be rejected as not-yet-active`);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'dataset-auto-refresh-not-active');
  }
});

test('POST set-dataset-enabled is REJECTED for lifecycle-critical schedule (finding #7)', async () => {
  const res = await POST(
    postRequest({ action: 'set-dataset-enabled', dataset: 'schedule', enabled: false })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'dataset-auto-refresh-not-active');
  assert.match(body.detail, /exempt/i);
});

test('POST rejects an unknown dataset', async () => {
  const res = await POST(
    postRequest({ action: 'set-dataset-enabled', dataset: 'nonsense', enabled: false })
  );
  assert.equal(res.status, 400);
});

test('POST requires admin auth', async () => {
  const res = await POST(postRequest({ action: 'set-global-pause', paused: true }, null));
  assert.equal(res.status, 401);
});

// ---- Rereview finding #1: applicable score partitions are exposed ----

test('GET exposes scoreSeasonTypes (regular-only when no schedule is cached)', async () => {
  const res = await GET(getRequest());
  const body = (await res.json()) as { scoreSeasonTypes: string[] };
  assert.deepEqual(body.scoreSeasonTypes, ['regular']);
});

// ---- Hotfix requirement 6: cache-only availability per dataset ----

test('GET exposes a cacheStates map (absent for every dataset when nothing is cached)', async () => {
  const res = await GET(getRequest());
  const body = (await res.json()) as {
    cacheStates: Record<string, 'available' | 'absent' | 'unknown'>;
  };
  assert.deepEqual(Object.keys(body.cacheStates).sort(), [
    'conferences',
    'game-stats',
    'odds',
    'rankings',
    'schedule',
    'scores',
  ]);
  for (const dataset of Object.keys(body.cacheStates)) {
    assert.equal(body.cacheStates[dataset], 'absent', `${dataset} has no cached data yet`);
  }
});

test('GET reflects seeded cached data as available', async () => {
  await setAppState('conferences', 'snapshot', { at: 1, items: [{ id: 1 }] });
  const res = await GET(getRequest());
  const body = (await res.json()) as {
    cacheStates: Record<string, 'available' | 'absent' | 'unknown'>;
  };
  assert.equal(body.cacheStates.conferences, 'available');
});

// ---- Rereview finding #4: odds usage is read from durable storage ----

// ---- PLATFORM-086A-SCOPED: selected-year admin feed isolation ----

test('a 2026 schedule success is NOT shown on the 2025 schedule card', async () => {
  await seedSuccess('schedule', yearScope(2026), 120);

  const rows2025 = await feedRows(2025);
  const schedule2025 = rows2025.find((r) => r.dataset === 'schedule');
  assert.equal(schedule2025?.status.lastSuccessAt, null, '2025 has no scoped success');
  assert.equal(schedule2025?.status.latestAttemptOutcome, null, 'no 2026 outcome leaks to 2025');
  assert.equal(schedule2025?.status.rowsCommitted, null, 'no 2026 rows leak to 2025');
  assert.equal(schedule2025?.status.source, null, 'no 2026 source leaks to 2025');
  assert.equal(
    schedule2025?.status.scopeKey,
    'schedule:year:2025',
    'card reflects the selected year'
  );

  const rows2026 = await feedRows(2026);
  const schedule2026 = rows2026.find((r) => r.dataset === 'schedule');
  assert.equal(
    schedule2026?.status.lastSuccessAt != null,
    true,
    '2026 card shows the 2026 success'
  );
  assert.equal(schedule2026?.status.rowsCommitted, 120);
});

test('a targeted week-3 game-stats success does NOT establish year-wide game-stats success', async () => {
  await seedSuccess('game-stats', weekPartitionScope(2026, 3, 'regular'), 8);

  const rows = await feedRows(2026);
  const gameStats = rows.find((r) => r.dataset === 'game-stats');
  // The game-stats card reflects the year rollup, which a single week never advances.
  assert.equal(gameStats?.status.lastSuccessAt, null, 'week 3 is not full-season success');
  assert.equal(gameStats?.status.latestAttemptOutcome, null);
  assert.equal(gameStats?.status.scopeKey, 'game-stats:year:2026');
});

test('a targeted regular-season schedule success does NOT establish year-wide schedule success', async () => {
  // A season-partition schedule repair writes its own partition key, never the
  // year rollup the card reflects (review remediation finding 1).
  await seedSuccess('schedule', seasonPartitionScope(2026, 'regular'), 90);

  const rows = await feedRows(2026);
  const schedule = rows.find((r) => r.dataset === 'schedule');
  assert.equal(schedule?.status.lastSuccessAt, null, 'a partition repair is not full-year success');
  assert.equal(schedule?.status.latestAttemptOutcome, null);
  assert.equal(schedule?.status.rowsCommitted, null);
  assert.equal(schedule?.status.scopeKey, 'schedule:year:2026', 'card reflects the year rollup');
});

test('a targeted postseason score success does NOT establish year-wide scores success', async () => {
  // A season-partition postseason score repair must not advance the canonical
  // scores year rollup the card renders (review remediation finding 2).
  await seedSuccess('scores', seasonPartitionScope(2026, 'postseason'), 12);

  const rows = await feedRows(2026);
  const scores = rows.find((r) => r.dataset === 'scores');
  assert.equal(scores?.status.lastSuccessAt, null, 'a postseason repair is not full-year success');
  assert.equal(scores?.status.latestAttemptOutcome, null);
  assert.equal(scores?.status.rowsCommitted, null);
  assert.equal(scores?.status.scopeKey, 'scores:year:2026', 'card reflects the year rollup');
});

test('a filtered odds success does NOT establish canonical odds freshness', async () => {
  // A filtered variant writes its own target key.
  await seedSuccess(
    'odds',
    oddsTargetScope(2026, 'filtered', '2026:bookmakers=dk|markets=h2h|regions=us'),
    5
  );

  const rows = await feedRows(2026);
  const odds = rows.find((r) => r.dataset === 'odds');
  assert.equal(
    odds?.status.lastSuccessAt,
    null,
    'canonical odds card is unaffected by a filtered refresh'
  );
  assert.equal(odds?.status.scopeKey, `odds:target:2026:canonical:${defaultOddsCacheKey(2026)}`);
});

test('a canonical odds success DOES show on the canonical odds card', async () => {
  await seedSuccess('odds', oddsTargetScope(2026, 'canonical', defaultOddsCacheKey(2026)), 9);
  const rows = await feedRows(2026);
  const odds = rows.find((r) => r.dataset === 'odds');
  assert.equal(odds?.status.rowsCommitted, 9, 'the canonical target is reflected');
});

test('a global conference status is rendered as global (not falsely year-owned) for any year', async () => {
  await seedSuccess('conferences', globalScope(), 130);

  for (const year of [2025, 2026]) {
    const rows = await feedRows(year);
    const conferences = rows.find((r) => r.dataset === 'conferences');
    assert.deepEqual(
      conferences?.status.scope,
      { kind: 'global' },
      `year ${year} shows global scope`
    );
    assert.equal(
      conferences?.status.rowsCommitted,
      130,
      'the global record is reused for every year'
    );
  }
});

test('a legacy unscoped success is not selected-year truth but is exposed as legacyStatus', async () => {
  await setAppState('provider-refresh-status', 'schedule', {
    dataset: 'schedule',
    lastAttemptAt: '2020-01-01T00:00:00.000Z',
    lastAttemptId: 'legacy',
    latestAttemptOutcome: 'succeeded',
    latestAttemptResolvedAt: '2020-01-01T00:00:00.000Z',
    lastSuccessAt: '2020-01-01T00:00:00.000Z',
    lastError: null,
    source: 'cfbd',
    rowsCommitted: 7,
    partialFailure: false,
  });

  const rows = await feedRows(2026);
  const schedule = rows.find((r) => r.dataset === 'schedule');
  assert.equal(schedule?.status.lastSuccessAt, null, 'legacy success is not 2026 truth');
  assert.equal(
    schedule?.legacyStatus?.lastSuccessAt,
    '2020-01-01T00:00:00.000Z',
    'legacy exposed separately'
  );
});

test('GET reads odds usage from DURABLE storage, not a stale process memo', async () => {
  // This instance's memo holds an older snapshot (400 remaining).
  await setLatestKnownOddsUsage(oddsSnapshot(400, '2026-07-01T00:00:00.000Z'));
  // Another instance updates DURABLE storage directly (20 remaining); this
  // instance's memo is now stale. The status feed must force a durable read.
  await setAppState('odds-usage', 'latest', oddsSnapshot(20, '2026-07-10T00:00:00.000Z'));

  const res = await GET(getRequest());
  const body = (await res.json()) as { oddsUsage: OddsUsageSnapshot | null };
  assert.equal(
    body.oddsUsage?.remaining,
    20,
    'the durable (newer) value is used, not the stale in-process memo (400)'
  );
});
