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

// ---- Rereview finding #4: odds usage is read from durable storage ----

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
