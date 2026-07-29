import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
} from '../../../../lib/server/durableOddsStore.ts';
import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
} from '../../../../lib/server/oddsUsageStore.ts';
import {
  acquireOddsRefreshLease,
  readOddsRefreshControl,
} from '../../../../lib/odds/refreshLease.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../../../lib/providerRefreshScope.ts';
import { PROVIDER_DATASET_DESCRIPTORS } from '../../../../lib/providerDatasets.ts';
import { GET } from '../route.ts';
import {
  __resetOddsRouteCacheForTests,
  defaultOddsCacheKey,
  oddsCache,
} from '../routeInternals.ts';

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

test('remediation: a post-commit failure after a valid no-op does not bill the lease backoff', async () => {
  const originalFetch = global.fetch;
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  // The canonical PRELOAD schedule fetch succeeds (context available BEFORE the
  // billed request), the provider returns a valid EMPTY payload (a no-op commit),
  // then the RESPONSE-BUILDING schedule rebuild (after the empty commit resolved
  // the attempt) fails — a throw on the tail AFTER the attempt already resolved as
  // a no-op. The preload/tail split means the schedule endpoint is hit twice: the
  // first call (preload) must succeed, the second (tail) fails.
  let scheduleCalls = 0;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/api/schedule') {
      scheduleCalls += 1;
      if (scheduleCalls === 1) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('boom', { status: 500 });
    }
    if (url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'x-requests-used': '5',
        'x-requests-remaining': '495',
        'x-requests-last': '0',
      },
    });
  }) as typeof fetch;
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 500); // the tail schedule rebuild failed
    assert.ok(scheduleCalls >= 2); // preload succeeded, tail failed
    // The lease resolved as the recorded no-op — backoff RESET, completed-check
    // recorded — NOT reclassified to a billed failure by the catch.
    const control = await readOddsRefreshControl(seasonScopedKey);
    assert.equal(control?.automaticFailureCount, 0);
    assert.ok(control?.lastCompletedCheckAt);
    assert.equal(control?.lease, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('remediation F4: a canonical PRELOAD failure fails before billing (release-only, no /odds)', async () => {
  const originalFetch = global.fetch;
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  // The canonical schedule preload fails — this happens BEFORE the billed `/odds`
  // request, so no credit is spent and the lease must resolve release-only (backoff
  // NOT advanced), not as a billed failure. The odds provider must never be called.
  let oddsProviderCalls = 0;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.hostname === 'api.the-odds-api.com') {
      oddsProviderCalls += 1;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/api/schedule') {
      return new Response('boom', { status: 500 });
    }
    if (url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'canonical-context-unavailable');
    assert.equal(oddsProviderCalls, 0); // never billed the provider
    // release-only: the automatic backoff is NOT advanced by a pre-billing context
    // failure, and no completed-check is recorded (nothing actually refreshed).
    const control = await readOddsRefreshControl(seasonScopedKey);
    assert.equal(control?.automaticFailureCount, 0);
    assert.equal(control?.lease, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('remediation F1: a stale empty refresh never overwrites newer raw odds', async () => {
  const originalFetch = global.fetch;
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  // A newer refresh already committed a populated raw entry (observation in the
  // future relative to this refresh's `now`).
  const futureObs = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await setAppState('odds-cache', seasonScopedKey, {
    data: [
      {
        homeTeam: 'Georgia Bulldogs',
        awayTeam: 'Clemson Tigers',
        commenceTime: '2026-09-05T19:30:00.000Z',
        bookmakers: [],
      },
    ],
    lastFetch: Date.now() + 60 * 60 * 1000,
    usage: null,
    observedAt: futureObs,
  });
  // This refresh gets an empty provider payload.
  installFetch(
    () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '0',
        },
      })
  );
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 200); // a stale no-op serves prior-good
    // The newer populated raw entry was NOT overwritten with an empty entry.
    const durable = await getAppState<{ data: unknown[]; observedAt: string }>(
      'odds-cache',
      seasonScopedKey
    );
    assert.equal(durable?.value.data.length, 1);
    assert.equal(durable?.value.observedAt, futureObs);
  } finally {
    global.fetch = originalFetch;
  }
});

test('remediation F1b: the empty guard judges by observation, not lastFetch (split-brain)', async () => {
  const originalFetch = global.fetch;
  const seasonScopedKey = defaultOddsCacheKey(SEASON);
  const now = Date.now();
  // Durable holds the OBSERVATION-newest entry but with an OLD lastFetch; the
  // process memo holds an older observation but a NEWER lastFetch. A lastFetch-based
  // guard would pick the memo (older observation) and wrongly permit an overwrite.
  await setAppState('odds-cache', seasonScopedKey, {
    data: [
      {
        homeTeam: 'Georgia Bulldogs',
        awayTeam: 'Clemson Tigers',
        commenceTime: '2026-09-05T19:30:00.000Z',
        bookmakers: [],
      },
    ],
    lastFetch: now - 2 * 60 * 60 * 1000,
    usage: null,
    observedAt: new Date(now + 60 * 60 * 1000).toISOString(), // newest observation
  });
  oddsCache.entries[seasonScopedKey] = {
    data: [],
    lastFetch: now + 2 * 60 * 60 * 1000, // newest lastFetch
    usage: null,
    observedAt: new Date(now - 60 * 60 * 1000).toISOString(), // older observation
  };
  installFetch(
    () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '0',
        },
      })
  );
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 200);
    // The observation-newer DURABLE entry was NOT overwritten with an empty entry.
    const durable = await getAppState<{ data: unknown[] }>('odds-cache', seasonScopedKey);
    assert.equal(durable?.value.data.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('compatibility #46: a public read performs zero durable writes', async () => {
  const originalFetch = global.fetch;
  installFetch(oddsOk);
  // Any durable write throws — a public read must not perform one.
  __setAppStateWriteFailureForTests(new Error('no writes on a public read'));
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}`));
    assert.equal(res.status, 200);
  } finally {
    __setAppStateWriteFailureForTests(null);
    global.fetch = originalFetch;
  }
});

test('security #7: a manual upstream error returns no raw body and no credential', async () => {
  const originalFetch = global.fetch;
  const BODY_MARKER = 'PROVIDER-BODY-SECRET';
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/api/schedule') {
      return new Response(JSON.stringify({ items: [scheduleItem()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // 403 is not retried, so this resolves fast to a single provider-fetch failure.
    return new Response(`{"message":"${BODY_MARKER}"}`, { status: 403, statusText: 'Forbidden' });
  }) as typeof fetch;
  try {
    const res = await GET(new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`));
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.ok(!text.includes(BODY_MARKER), 'raw provider body must not be returned');
    assert.ok(!text.includes('test-key'), 'credential must not be returned');
    assert.ok(!text.includes('apiKey=test'), 'credential-bearing url must not be returned');
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

test('compatibility #47: the manual route does not import the automatic-cadence modules', async () => {
  // The MANUAL route stays free of the polling/quota/context cadence modules; the
  // C2 cron route (a separate file) owns those.
  const routeSrc = await fs.readFile(path.join(process.cwd(), 'src/app/api/odds/route.ts'), 'utf8');
  for (const cadence of ['pollingPolicy', 'quotaPolicy', 'canonicalOddsContext']) {
    assert.ok(!routeSrc.includes(cadence), `manual route imports cadence module ${cadence}`);
  }
  // The C2 Odds cron route exists.
  await assert.doesNotReject(fs.access(path.join(process.cwd(), 'src/app/api/cron/odds/route.ts')));
});

test('compatibility #48: the Odds provider descriptor is active and setting-consumed (C2)', () => {
  assert.equal(PROVIDER_DATASET_DESCRIPTORS.odds.hasActiveAutomation, true);
  assert.equal(PROVIDER_DATASET_DESCRIPTORS.odds.autoRefreshSettingConsumed, true);
});
