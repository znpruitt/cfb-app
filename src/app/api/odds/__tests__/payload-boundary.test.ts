import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route.ts';
import type { OddsUsageSnapshot } from '../../../../lib/api/oddsUsage.ts';
import {
  __resetOddsRouteCacheForTests,
  createOddsCacheKey,
  defaultOddsCacheKey,
  ODDS_DEFAULT_MARKETS,
  ODDS_DEFAULT_REGIONS,
  oddsCache,
  withOddsTargetLock,
  type NormalizedOddsEvent,
  type SharedOddsCacheEntry,
} from '../routeInternals.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  getLatestKnownOddsUsage,
} from '../../../../lib/server/oddsUsageStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
} from '../../../../lib/server/durableOddsStore.ts';
import { getProviderRefreshStatus } from '../../../../lib/server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../../../lib/providerRefreshScope.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086G2 deferred finding #4 — the Odds provider boundary is truthful:
// non-array and schema-drift payloads FAIL before any durable commit; a genuine
// empty array is classified contextually (prior-good upcoming events for the
// exact target, or near-horizon canonical-schedule games, make it an
// unexpected-empty FAILURE that retains prior-good data; otherwise it is a
// truthful no-op, never a successful empty commit that replaces prior data).
// ---------------------------------------------------------------------------

const SEASON = 2026;
const ODDS_API_HOST = 'api.the-odds-api.com';
const CACHE_KEY = defaultOddsCacheKey(SEASON);
const ODDS_SCOPE = oddsTargetScope(SEASON, 'canonical', CACHE_KEY);

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
  await __deleteDurableOddsStoreFileForTests(SEASON);
  __resetDurableOddsStoreForTests();
  __resetOddsRouteCacheForTests();
  process.env.ODDS_API_KEY = 'test-key';
});

type FetchStub = { oddsCalls(): number; restore(): void };

function installFetchStub(oddsBody: unknown): FetchStub {
  const realFetch = globalThis.fetch;
  let oddsCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    if (url.hostname === ODDS_API_HOST) {
      oddsCalls += 1;
      return new Response(JSON.stringify(oddsBody), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '100',
          'x-requests-remaining': '400',
          'x-requests-last': '3',
        },
      });
    }
    if (url.pathname === '/api/schedule' || url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    oddsCalls: () => oddsCalls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

function refreshRequest(): Request {
  return new Request(`http://localhost/api/odds?year=${SEASON}&refresh=1`);
}

function normalizedEvent(commenceTime: string): NormalizedOddsEvent {
  return { homeTeam: 'Georgia', awayTeam: 'Auburn', commenceTime, bookmakers: [] };
}

async function seedPriorEntry(events: NormalizedOddsEvent[]): Promise<SharedOddsCacheEntry> {
  const entry: SharedOddsCacheEntry = {
    data: events,
    lastFetch: Date.now() - 10 * 60 * 1000,
    usage: null,
  };
  await setAppState('odds-cache', CACHE_KEY, entry);
  oddsCache.entries[CACHE_KEY] = entry;
  return entry;
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function seedSchedule(startDate: string, status = 'scheduled'): Promise<void> {
  await setAppState('schedule', `${SEASON}-all-all`, {
    at: Date.now(),
    items: [
      {
        id: 'g-1',
        week: 7,
        startDate,
        homeTeam: 'Georgia',
        awayTeam: 'Auburn',
        status,
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

test('a non-array odds payload is a FAILURE before commit (nothing cached, no success)', async () => {
  const stub = installFetchStub({ message: 'not events' });
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502, 'a coercible-to-empty payload must not become a 200');
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-invalid-payload');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'odds-invalid-payload');
    assert.equal(status.lastSuccessAt, null, 'a malformed payload never advances last-success');

    assert.equal(await getAppState('odds-cache', CACHE_KEY), null, 'no durable commit');
    assert.equal(oddsCache.entries[CACHE_KEY], undefined, 'no process-cache publication');
  } finally {
    stub.restore();
  }
});

test('a nonempty payload with zero normalizable events is schema-drift FAILURE', async () => {
  // Rows lack team names — a provider field rename would look like this.
  const stub = installFetchStub([{ commence_time: inDays(2), bookmakers: [] }]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-schema-drift');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'odds-schema-drift');
    assert.equal(status.lastSuccessAt, null);
    assert.equal(await getAppState('odds-cache', CACHE_KEY), null, 'no durable commit');
  } finally {
    stub.restore();
  }
});

test('an empty payload over prior-good UPCOMING events is an unexpected-empty FAILURE that retains prior data', async () => {
  const prior = await seedPriorEntry([normalizedEvent(inDays(3))]);
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502, 'losing still-upcoming events is a provider failure');
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-empty-unexpected');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'failed');
    assert.equal(status.lastError?.code, 'odds-empty-unexpected');
    assert.equal(status.lastSuccessAt, null, 'a rejected refresh never advances last-success');

    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 1, 'prior-good durable entry retained');
    assert.equal(durable?.value?.lastFetch, prior.lastFetch, 'durable entry not rewritten');
    assert.equal(
      oddsCache.entries[CACHE_KEY]?.data.length,
      1,
      'no empty process-cache publication'
    );
  } finally {
    stub.restore();
  }
});

test('an empty payload with a near-horizon canonical-schedule game is an unexpected-empty FAILURE', async () => {
  await seedSchedule(inDays(3));
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-empty-unexpected');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'failed');
  } finally {
    stub.restore();
  }
});

test('an empty payload with only far-out schedule games is a valid-absence NO-OP', async () => {
  await seedSchedule(inDays(30));
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200, 'far-out games do not imply posted odds');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'no-op');
    assert.equal(status.lastSuccessAt, null, 'a no-op is not a successful empty commit');
  } finally {
    stub.restore();
  }
});

test('a cold-target empty payload is a NO-OP that still seeds the cache entry (cache contract preserved)', async () => {
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200);

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'no-op');
    assert.equal(status.lastSuccessAt, null);

    // The empty entry replaced nothing, so the cache contract (TTL freshness,
    // honest snapshot time for follow-up reads) is preserved.
    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.deepEqual(durable?.value?.data, []);
    assert.deepEqual(oddsCache.entries[CACHE_KEY]?.data, []);
  } finally {
    stub.restore();
  }
});

test('an empty payload over prior data whose events all KICKED OFF is a NO-OP that does not rewrite the prior entry', async () => {
  const prior = await seedPriorEntry([
    normalizedEvent(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200, 'expired prior events are legitimately absent upstream');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'no-op');

    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 1, 'prior entry is preserved, not emptied');
    assert.equal(durable?.value?.lastFetch, prior.lastFetch, 'prior entry not rewritten');
  } finally {
    stub.restore();
  }
});

test('a nonempty payload with PARTIAL normalizable coverage remains a normal success', async () => {
  const stub = installFetchStub([
    // One usable event…
    {
      home_team: 'Georgia',
      away_team: 'Auburn',
      commence_time: inDays(2),
      bookmakers: [],
    },
    // …one junk row (no team names) — partial coverage is not schema drift.
    { commence_time: inDays(2), bookmakers: [] },
  ]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200);

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'succeeded');
    assert.equal(status.rowsCommitted, 1, 'the usable event committed');
    assert.ok(status.lastSuccessAt, 'a usable nonempty payload still advances last-success');

    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 1);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086G2 Codex P2 remediation — structurally malformed rows are stable
// schema-drift failures (never mid-normalization 500s), and the empty-payload
// evidence check + conditional write are serialized per target so a concurrent
// populated commit can never be clobbered with [].
// ---------------------------------------------------------------------------

test('a payload containing a null row is schema-drift FAILURE (502), not a normalization 500', async () => {
  const stub = installFetchStub([null]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502, 'a malformed row must classify, not throw a generic 500');
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-schema-drift');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.lastError?.code, 'odds-schema-drift');
    assert.equal(await getAppState('odds-cache', CACHE_KEY), null, 'no durable commit');
  } finally {
    stub.restore();
  }
});

test('one malformed row rejects the whole payload as schema drift and retains prior-good data', async () => {
  const prior = await seedPriorEntry([normalizedEvent(inDays(3))]);
  const stub = installFetchStub([
    // A valid sibling row does not make a structurally broken payload trustworthy.
    { home_team: 'Georgia', away_team: 'Auburn', commence_time: inDays(2), bookmakers: [] },
    { home_team: 'Texas', away_team: 'Rice', bookmakers: {} },
  ]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-schema-drift');

    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 1, 'prior-good durable entry retained');
    assert.equal(durable?.value?.lastFetch, prior.lastFetch, 'durable entry not rewritten');
  } finally {
    stub.restore();
  }
});

test('withOddsTargetLock serializes sections for the same target key', async () => {
  const order: string[] = [];
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => (releaseFirst = resolve));

  const first = withOddsTargetLock('lock-test-key', async () => {
    order.push('first-start');
    await gate;
    order.push('first-end');
  });
  const second = withOddsTargetLock('lock-test-key', async () => {
    order.push('second');
  });

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('an in-flight empty refresh cannot clobber a concurrently committed populated entry', async () => {
  // Hold the per-target lock so the empty refresh's evidence check must queue
  // behind it; commit a populated entry (as a concurrent nonempty refresh
  // would) while it waits, then release. The empty refresh's serialized
  // re-read must see the populated commit and reject the empty payload.
  let releaseLock!: () => void;
  const lockGate = new Promise<void>((resolve) => (releaseLock = resolve));
  const held = withOddsTargetLock(CACHE_KEY, () => lockGate);

  const stub = installFetchStub([]);
  try {
    const pendingEmptyRefresh = GET(refreshRequest());

    // Concurrent populated commit for the same target (future-kickoff event).
    const populated: SharedOddsCacheEntry = {
      data: [normalizedEvent(inDays(3))],
      lastFetch: Date.now(),
      usage: null,
    };
    await setAppState('odds-cache', CACHE_KEY, populated);
    oddsCache.entries[CACHE_KEY] = populated;
    releaseLock();
    await held;

    const res = await pendingEmptyRefresh;
    assert.equal(res.status, 502, 'the serialized re-read must observe the populated commit');
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-empty-unexpected');

    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 1, 'populated durable entry never clobbered by []');
    assert.equal(
      oddsCache.entries[CACHE_KEY]?.data.length,
      1,
      'populated process entry never clobbered by []'
    );
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086G2 nested-schema/usage remediation — nested scalar drift is a
// stable schema-drift rejection (never a committed-then-500 poisoned cache),
// and a retained-data no-op reports the CURRENT captured usage.
// ---------------------------------------------------------------------------

test('malformed nested bookmaker/market/outcome scalars are schema-drift FAILURES, never committed', async () => {
  const validRow = { home_team: 'Georgia', away_team: 'Auburn', commence_time: inDays(2) };
  const malformedVariants: Array<{ label: string; row: unknown }> = [
    { label: 'numeric bookmaker key', row: { ...validRow, bookmakers: [{ key: 5 }] } },
    {
      label: 'numeric bookmaker title',
      row: { ...validRow, bookmakers: [{ key: 'draftkings', title: 7 }] },
    },
    {
      label: 'numeric market key',
      row: { ...validRow, bookmakers: [{ key: 'draftkings', markets: [{ key: 9 }] }] },
    },
    {
      label: 'numeric outcome name',
      row: {
        ...validRow,
        bookmakers: [{ key: 'draftkings', markets: [{ key: 'totals', outcomes: [{ name: 4 }] }] }],
      },
    },
    {
      label: 'string outcome point',
      row: {
        ...validRow,
        bookmakers: [
          {
            key: 'draftkings',
            markets: [
              { key: 'spreads', outcomes: [{ name: 'Georgia', point: 'seven', price: -110 }] },
            ],
          },
        ],
      },
    },
  ];

  for (const variant of malformedVariants) {
    const stub = installFetchStub([variant.row]);
    try {
      const res = await GET(refreshRequest());
      assert.equal(res.status, 502, `${variant.label} must reject, not commit or 500`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, 'odds-schema-drift', variant.label);
      assert.equal(
        await getAppState('odds-cache', CACHE_KEY),
        null,
        `${variant.label}: no durable commit`
      );
      assert.equal(
        oddsCache.entries[CACHE_KEY],
        undefined,
        `${variant.label}: no process-cache publication`
      );
    } finally {
      stub.restore();
    }
  }
});

test('a retained-data no-op reports the CURRENT captured usage, not the retained entry usage', async () => {
  // Prior entry: all events kicked off (valid absence on the next empty
  // payload) and a STALE embedded usage snapshot.
  const staleUsage: OddsUsageSnapshot = {
    used: 50,
    remaining: 450,
    lastCost: 3,
    limit: 500,
    capturedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    source: 'odds-response-headers',
  };
  const prior: SharedOddsCacheEntry = {
    data: [normalizedEvent(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())],
    lastFetch: Date.now() - 10 * 60 * 1000,
    usage: staleUsage,
  };
  await setAppState('odds-cache', CACHE_KEY, prior);
  oddsCache.entries[CACHE_KEY] = prior;

  // The refresh's provider headers report the CURRENT quota (remaining 400).
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200, 'expired prior events → valid-absence no-op');
    const body = (await res.json()) as {
      meta: { usage: { remaining: number } | null };
    };
    assert.equal(
      body.meta.usage?.remaining,
      400,
      'the response reports the freshly captured quota, not the retained entry usage (450)'
    );

    // The retained rows and entry are untouched — only response metadata is current.
    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 1, 'retained rows preserved');
    assert.equal(durable?.value?.lastFetch, prior.lastFetch, 'retained entry not rewritten');
    assert.equal(
      durable?.value?.usage?.remaining,
      450,
      'the stored prior entry keeps its own historical usage'
    );
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086G2 invalid-JSON remediation — a 200 with an unparseable or empty
// body is a stable `odds-invalid-payload` failure (never an uncoded 500), and
// the consumed-credit quota headers are persisted BEFORE body parsing.
// ---------------------------------------------------------------------------

function installRawBodyFetchStub(rawBody: string): FetchStub {
  const realFetch = globalThis.fetch;
  let oddsCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    if (url.hostname === ODDS_API_HOST) {
      oddsCalls += 1;
      return new Response(rawBody, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '100',
          'x-requests-remaining': '400',
          'x-requests-last': '3',
        },
      });
    }
    if (url.pathname === '/api/schedule' || url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    oddsCalls: () => oddsCalls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

for (const [label, rawBody] of [
  ['truncated JSON', '[{"home_team": "Georg'],
  ['empty body', ''],
] as const) {
  test(`a 200 response with ${label} is odds-invalid-payload (502) with usage persisted and prior data retained`, async () => {
    const prior = await seedPriorEntry([
      normalizedEvent(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()),
    ]);
    const stub = installRawBodyFetchStub(rawBody);
    try {
      const res = await GET(refreshRequest());
      assert.equal(res.status, 502, `${label} must classify, not surface an uncoded 500`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, 'odds-invalid-payload');

      const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
      assert.equal(status.latestAttemptOutcome, 'failed');
      assert.equal(status.lastError?.code, 'odds-invalid-payload');
      assert.equal(status.lastSuccessAt, null, 'a malformed body never advances last-success');

      // The request consumed credits — the header snapshot persisted durably
      // even though the body never parsed.
      const usage = await getLatestKnownOddsUsage({ forceRefresh: true });
      assert.equal(usage?.remaining, 400, `${label}: quota headers persisted before parsing`);

      // Prior-good data untouched, durably and in-process.
      const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
      assert.equal(durable?.value?.data.length, 1, 'prior-good durable entry retained');
      assert.equal(durable?.value?.lastFetch, prior.lastFetch, 'durable entry not rewritten');
      assert.equal(oddsCache.entries[CACHE_KEY]?.data.length, 1, 'process entry retained');
    } finally {
      stub.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// PLATFORM-086G2 prior-evidence schedule reconciliation — cached future events
// are reconciled against the current canonical slate (identity + kickoff
// proximity via the existing attachment matcher): disrupted/started/unmatched
// games exculpate stale prior evidence, provably obsolete rows may be replaced
// by a fresh empty commit, and unavailable evidence stays conservative.
// ---------------------------------------------------------------------------

async function seedScheduleItems(
  items: Array<Record<string, unknown>>,
  key = `${SEASON}-all-all`
): Promise<void> {
  await setAppState('schedule', key, {
    at: Date.now(),
    items,
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

function scheduleGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g-ga-au',
    week: 7,
    startDate: inDays(3),
    homeTeam: 'Georgia',
    awayTeam: 'Auburn',
    status: 'scheduled',
    seasonType: 'regular',
    ...overrides,
  };
}

test('a prior event whose game is now CANCELED is exculpated: no-op and the obsolete entry is cleared', async () => {
  await seedPriorEntry([normalizedEvent(inDays(3))]);
  await seedScheduleItems([scheduleGame({ status: 'canceled' })]);

  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200, 'a canceled game legitimately drops from the provider feed');

    const status = await getProviderRefreshStatus('odds', ODDS_SCOPE);
    assert.equal(status.latestAttemptOutcome, 'no-op');
    assert.equal(status.lastSuccessAt, null);

    // Every retained row was provably obsolete → the fresh empty entry commits.
    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.deepEqual(durable?.value?.data, [], 'obsolete rows replaced by the empty entry');
    assert.deepEqual(oddsCache.entries[CACHE_KEY]?.data, []);
  } finally {
    stub.restore();
  }
});

test('postponed/suspended/delayed statuses also exculpate stale prior evidence (no-op, not 502)', async () => {
  for (const gameStatus of ['postponed', 'STATUS_SUSPENDED', 'delayed']) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    __resetOddsRouteCacheForTests();
    await seedPriorEntry([normalizedEvent(inDays(3))]);
    await seedScheduleItems([scheduleGame({ status: gameStatus })]);

    const stub = installFetchStub([]);
    try {
      const res = await GET(refreshRequest());
      assert.equal(res.status, 200, `status=${gameStatus} must be a valid-absence no-op`);
    } finally {
      stub.restore();
    }
  }
});

test('a cached-future event whose game already kicked off per the CURRENT schedule is obsolete', async () => {
  // Rescheduled earlier / played: cached commence is future, slate says started.
  await seedPriorEntry([normalizedEvent(inDays(3))]);
  await seedScheduleItems([
    scheduleGame({
      startDate: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      status: 'final',
    }),
  ]);

  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200, 'the authoritative current kickoff governs, not the cached time');
    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.deepEqual(durable?.value?.data, [], 'provably obsolete row cleared');
  } finally {
    stub.restore();
  }
});

test('a prior event unmatched against a loaded slate is obsolete (no-op + clear)', async () => {
  await seedPriorEntry([normalizedEvent(inDays(3))]); // Georgia/Auburn
  // Slate exists but holds only a far-out different game (no near-horizon
  // expectation, no matching pair).
  await seedScheduleItems([
    scheduleGame({ id: 'g-tx-ri', homeTeam: 'Texas', awayTeam: 'Rice', startDate: inDays(30) }),
  ]);

  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 200);
    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.deepEqual(durable?.value?.data, [], 'unmatched stale row cleared');
  } finally {
    stub.restore();
  }
});

test('one healthy future match keeps the empty payload UNEXPECTED and prevents any clearing', async () => {
  const prior = await seedPriorEntry([
    normalizedEvent(inDays(3)), // Georgia/Auburn — canceled below
    { homeTeam: 'Texas', awayTeam: 'Rice', commenceTime: inDays(10), bookmakers: [] },
  ]);
  await seedScheduleItems([
    scheduleGame({ status: 'canceled' }),
    // Healthy rematch beyond the 7-day horizon: only PRIOR evidence protects it.
    scheduleGame({ id: 'g-tx-ri', homeTeam: 'Texas', awayTeam: 'Rice', startDate: inDays(10) }),
  ]);

  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502, 'a healthy still-upcoming line must not vanish silently');
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-empty-unexpected');

    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
    assert.equal(durable?.value?.data.length, 2, 'no clearing on a rejected refresh');
    assert.equal(durable?.value?.lastFetch, prior.lastFetch, 'prior entry not rewritten');
  } finally {
    stub.restore();
  }
});

test('filtered targets get schedule EXCULPATION but no positive schedule expectation', async () => {
  const filteredKey = `${SEASON}:${createOddsCacheKey({
    bookmakers: ['draftkings'],
    markets: ODDS_DEFAULT_MARKETS,
    regions: ODDS_DEFAULT_REGIONS,
  })}`;
  const filteredUrl = `http://localhost/api/odds?year=${SEASON}&refresh=1&bookmakers=draftkings`;

  // (a) Disrupted-game exculpation applies to the filtered target's own prior data.
  const priorEntry: SharedOddsCacheEntry = {
    data: [normalizedEvent(inDays(3))],
    lastFetch: Date.now() - 10 * 60 * 1000,
    usage: null,
  };
  await setAppState('odds-cache', filteredKey, priorEntry);
  oddsCache.entries[filteredKey] = priorEntry;
  await seedScheduleItems([scheduleGame({ status: 'canceled' })]);

  const stub = installFetchStub([]);
  try {
    const res = await GET(new Request(filteredUrl));
    assert.equal(res.status, 200, 'filtered prior evidence is exculpated by the disrupted slate');
    const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', filteredKey);
    assert.deepEqual(durable?.value?.data, [], 'obsolete filtered rows cleared');

    // (b) A healthy near-horizon game creates NO positive expectation for a
    // filtered target: a cold filtered refresh returning [] stays a no-op.
    await seedScheduleItems([scheduleGame({ status: 'scheduled', startDate: inDays(3) })]);
    delete oddsCache.entries[filteredKey];
    await setAppState('odds-cache', filteredKey, { data: [], lastFetch: 0, usage: null });
    const cold = await GET(new Request(filteredUrl));
    assert.equal(cold.status, 200, 'no near-horizon expectation for filtered targets');
  } finally {
    stub.restore();
  }
});

test('a failed schedule read preserves conservative prior-event evidence (502, nothing cleared)', async () => {
  const prior = await seedPriorEntry([normalizedEvent(inDays(3))]);
  await seedScheduleItems([scheduleGame({ status: 'canceled' })]);

  __setAppStateReadFailureForTests(new Error('schedule evidence read boom'), 'schedule');
  const stub = installFetchStub([]);
  try {
    const res = await GET(refreshRequest());
    assert.equal(res.status, 502, 'unavailable exculpatory evidence keeps the conservative 502');
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'odds-empty-unexpected');
  } finally {
    __setAppStateReadFailureForTests(null);
    stub.restore();
  }

  const durable = await getAppState<SharedOddsCacheEntry>('odds-cache', CACHE_KEY);
  assert.equal(durable?.value?.data.length, 1, 'nothing cleared without authoritative evidence');
  assert.equal(durable?.value?.lastFetch, prior.lastFetch);
});
