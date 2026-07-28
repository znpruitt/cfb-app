import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  getAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
} from '../../../../lib/server/durableOddsStore.ts';
import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
} from '../../../../lib/server/oddsUsageStore.ts';
import { acquireOddsRefreshLease } from '../../../../lib/odds/refreshLease.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../../../lib/providerRefreshScope.ts';
import { PROVIDER_DATASET_DESCRIPTORS } from '../../../../lib/providerDatasets.ts';
import { GET } from '../route.ts';
import { __resetOddsRouteCacheForTests, defaultOddsCacheKey } from '../routeInternals.ts';

const SEASON = 2026;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteDurableOddsStoreFileForTests(SEASON);
  __resetDurableOddsStoreForTests();
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
  __resetOddsRouteCacheForTests();
  __setAppStateKeyLockFailureForTests(null);
  process.env.ODDS_API_KEY = 'test-key';
});

function scheduleItem() {
  return {
    id: 'game-1',
    week: 1,
    startDate: '2026-09-05T19:30:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Georgia',
    awayTeam: 'Clemson',
    homeConference: 'SEC',
    awayConference: 'ACC',
    status: 'scheduled',
    seasonType: 'regular',
    gamePhase: 'regular',
  };
}

function oddsEventPayload() {
  return [
    {
      home_team: 'Georgia Bulldogs',
      away_team: 'Clemson Tigers',
      commence_time: '2026-09-05T19:30:00.000Z',
      bookmakers: [
        {
          key: 'draftkings',
          title: 'DraftKings',
          markets: [
            {
              key: 'spreads',
              outcomes: [
                { name: 'Georgia', point: -3.5, price: -110 },
                { name: 'Clemson', point: 3.5, price: -110 },
              ],
            },
          ],
        },
      ],
    },
  ];
}

type FetchCounters = { odds: number; schedule: number; conferences: number };

function installFetch(oddsResponder: () => Response): FetchCounters {
  const counters: FetchCounters = { odds: 0, schedule: 0, conferences: 0 };
  global.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw);
    if (url.pathname === '/api/schedule') {
      counters.schedule += 1;
      return new Response(JSON.stringify({ items: [scheduleItem()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/api/conferences') {
      counters.conferences += 1;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    counters.odds += 1;
    return oddsResponder();
  }) as typeof fetch;
  return counters;
}

function oddsOk(): Response {
  return new Response(JSON.stringify(oddsEventPayload()), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-requests-used': '5',
      'x-requests-remaining': '495',
      'x-requests-last': '1',
    },
  });
}

test('convergence #19: a concurrent manual refresh returns 409 with no provider call', async () => {
  const originalFetch = global.fetch;
  // A refresh is already in progress: hold the lease for the canonical target.
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  const held = await acquireOddsRefreshLease({
    seasonScopedKey,
    owner: 'automatic',
    now: Date.now(),
  });
  assert.equal(held.acquired, true);

  const counters = installFetch(oddsOk);
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-refresh-in-progress');
    // No provider call, and no fabricated provider-refresh attempt.
    assert.equal(counters.odds, 0);
    const status = await getProviderRefreshStatus(
      'odds',
      oddsTargetScope(SEASON, 'canonical', seasonScopedKey)
    );
    assert.equal(status.latestAttemptOutcome, null);
    assert.equal(status.lastAttemptId, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('convergence #10: a canonical success is recorded only after the atomic commit', async () => {
  const originalFetch = global.fetch;
  installFetch(oddsOk);
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 200);
    const status = await getProviderRefreshStatus(
      'odds',
      oddsTargetScope(SEASON, 'canonical', seasonScopedKey)
    );
    assert.equal(status.latestAttemptOutcome, 'succeeded');
    assert.ok(status.lastSuccessAt);
    // The per-game durable store received the committed line.
    const store = await getAppState<Record<string, { latestSnapshot?: { homeSpread?: number } }>>(
      'durable-odds:2026',
      'store'
    );
    const record = Object.values(store?.value ?? {})[0];
    assert.equal(record?.latestSnapshot?.homeSpread, -3.5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('convergence #4: a durable-commit failure records failure, never success, retaining prior-good', async () => {
  const originalFetch = global.fetch;
  installFetch(oddsOk);
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  try {
    __setAppStateKeyLockFailureForTests(new Error('durable store down'), 'durable-odds:2026');
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'durable-commit-failed');
    __setAppStateKeyLockFailureForTests(null);

    const status = await getProviderRefreshStatus(
      'odds',
      oddsTargetScope(SEASON, 'canonical', seasonScopedKey)
    );
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastSuccessAt, null);
    // Neither the raw cache nor the durable store was committed.
    assert.equal(await getAppState('odds-cache', seasonScopedKey), null);
    assert.equal(await getAppState('durable-odds:2026', 'store'), null);
  } finally {
    __setAppStateKeyLockFailureForTests(null);
    global.fetch = originalFetch;
  }
});

test('convergence #6: a filtered refresh never seeds the canonical durable store', async () => {
  const originalFetch = global.fetch;
  installFetch(oddsOk);
  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${SEASON}&markets=spreads&refresh=1`)
    );
    assert.equal(res.status, 200);
    // The canonical durable per-game store must remain untouched by a filtered refresh.
    assert.equal(await getAppState('durable-odds:2026', 'store'), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('compatibility #45: a public read never calls the Odds provider', async () => {
  const originalFetch = global.fetch;
  const counters = installFetch(oddsOk);
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}`));
    assert.equal(res.status, 200);
    assert.equal(counters.odds, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('compatibility #46: an authorized manual refresh returns the compatible 200 shape', async () => {
  const originalFetch = global.fetch;
  installFetch(oddsOk);
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      items: Array<{ canonicalGameId: string; odds: { spread: number | null } }>;
      meta: { source: string; season: number; cache: string };
    };
    assert.equal(json.meta.source, 'odds-api');
    assert.equal(json.meta.season, SEASON);
    assert.equal(json.meta.cache, 'miss');
    assert.equal(json.items[0]?.odds.spread, -3.5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('compatibility #47: the route does not import the dormant automatic modules', async () => {
  const routeSrc = await fs.readFile(path.join(process.cwd(), 'src/app/api/odds/route.ts'), 'utf8');
  for (const dormant of ['pollingPolicy', 'quotaPolicy', 'canonicalOddsContext']) {
    assert.ok(!routeSrc.includes(dormant), `route imports dormant module ${dormant}`);
  }
  // There is no odds cron route in C1.
  await assert.rejects(fs.access(path.join(process.cwd(), 'src/app/api/cron/odds')));
});

test('compatibility #48: the Odds provider descriptor stays inactive and setting-unconsumed', () => {
  assert.equal(PROVIDER_DATASET_DESCRIPTORS.odds.hasActiveAutomation, false);
  assert.equal(PROVIDER_DATASET_DESCRIPTORS.odds.autoRefreshSettingConsumed, false);
});
