import test from 'node:test';
import assert from 'node:assert/strict';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs / is capturable
// under node:test.
import '../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import { SCHEDULE_ROUTE_CACHE, resetScheduleRouteCacheForTests } from '../cache';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshSuccess,
} from '../../../../lib/server/providerRefreshStatus.ts';
import { yearScope } from '../../../../lib/providerRefreshScope.ts';
import { acquireScheduleRefreshLease } from '../../../../lib/schedule/scheduleRefreshLease.ts';

// PLATFORM-663: every refresh this route can reach is a WHOLE-SEASON refresh
// through the shared authority, so the year rollup is the only status scope it
// records. The season- and week-partition scopes this file used to assert against
// belonged to the targeted writers the slice removed — nothing in the route can
// produce them any more, which is the point.
const SCHEDULE_YEAR_SCOPE = yearScope(2027);

type MockFetch = typeof fetch;

function setMockFetch(impl: Parameters<MockFetch>[1] extends never ? never : any) {
  global.fetch = impl as MockFetch;
}

async function runCapturingTags<T>(fn: () => Promise<T>): Promise<{ result: T; tags: string[] }> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, async () => {
    const result = await fn();
    return { result, tags: store.pendingRevalidatedTags };
  });
}

// A CFBD schedule game whose rows all lack a home team, so `mapCfbdScheduleGame`
// drops every one — a nonempty payload that normalizes to zero rows (drift).
function unmappableGames(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({ week: 1, away_team: `Away ${i}` }));
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  delete process.env.ADMIN_API_TOKEN;
});

test('schedule route returns mapped items from CFBD upstream', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  setMockFetch(async (input: URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const requestUrl = new URL(url);

    assert.equal(requestUrl.origin, 'https://api.collegefootballdata.com');
    assert.equal(requestUrl.pathname, '/games');
    assert.equal(
      init?.headers ? (init.headers as Record<string, string>).Authorization : '',
      'Bearer test-cfbd-token'
    );

    const seasonType = requestUrl.searchParams.get('seasonType');
    const body =
      seasonType === 'regular'
        ? [
            {
              week: 1,
              home_team: 'Texas',
              away_team: 'Rice',
              id: 1,
              start_date: '2025-08-30T00:00:00Z',
            },
          ]
        : [
            {
              week: 16,
              homeTeam: 'Georgia',
              awayTeam: 'Ohio State',
              id: 2,
              startDate: '2025-12-20T00:00:00Z',
              neutralSite: true,
              notes: 'Vrbo Fiesta Bowl',
            },
          ];

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('http://localhost/api/schedule?year=2025&seasonType=all');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.items.length, 2);
  assert.equal(json.items[0].homeTeam, 'Texas');
  assert.equal(json.items[1].homeTeam, 'Georgia');
  assert.equal(json.items[1].gamePhase, 'postseason');
  assert.equal(json.items[1].postseasonSubtype, 'bowl');
  assert.equal(json.meta.source, 'cfbd');
});

test('a full-year manual refresh writes the catalog-backed UTC date to the probe', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  setMockFetch(async (input: URL | string) => {
    const requestUrl = new URL(typeof input === 'string' ? input : input.toString());
    if (requestUrl.pathname !== '/games') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const body =
      requestUrl.searchParams.get('seasonType') === 'regular'
        ? [
            {
              week: 0,
              home_team: 'FCS Alpha',
              away_team: 'FCS Beta',
              id: 1,
              start_date: '2027-08-20T18:00:00Z',
            },
            {
              week: 1,
              home_team: 'Texas',
              away_team: 'Rice',
              id: 2,
              start_date: '2027-08-29T23:30:00-05:00',
            },
          ]
        : [];

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const res = await GET(
    new Request('http://localhost/api/schedule?year=2027&seasonType=all&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );

  assert.equal(res.status, 200, await res.text());
  const probe = await getAppState<{ firstGameDate: string | null }>('schedule-probe', '2027');
  assert.equal(probe?.value?.firstGameDate, '2027-08-30T00:00:00.000Z');
});

test('schedule route returns empty items when upstream array is empty', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  setMockFetch(async () => {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('http://localhost/api/schedule?year=2027&seasonType=regular');
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(json.items, []);
  assert.equal(json.meta.partialFailure, false);
});

test('schedule route returns 502 for seasonType=all when one request fails', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const seasonType = url.searchParams.get('seasonType');

    if (seasonType === 'postseason') {
      return new Response('forbidden', { status: 403 });
    }

    return new Response(JSON.stringify([{ week: 1, home_team: 'Texas', away_team: 'Rice' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('http://localhost/api/schedule?year=2027&seasonType=all');
  const res = await GET(req);
  const json = await res.json();

  // Full-year refresh now flows through the shared authority (PLATFORM-086E1A):
  // a failed required partition rejects the aggregate with the closed reason code
  // and the specific failed partition(s).
  assert.equal(res.status, 502);
  assert.equal(json.code, 'partition-fetch-failed');
  assert.deepEqual(json.detail.failedSeasonTypes, ['postseason']);
});

// ---------------------------------------------------------------------------
// PLATFORM-085C — a NONEMPTY provider payload that normalizes to zero schedule
// rows is schema drift (uncertainty), NOT valid absence. It must not commit as
// a successful-empty refresh nor overwrite prior-good durable schedule state.
// ---------------------------------------------------------------------------

test('schema drift within an all-season refresh reports it as a failed partition and does not commit', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Regular drifts (nonempty → zero); postseason returns a valid game.
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.searchParams.get('seasonType') === 'regular') {
      return new Response(JSON.stringify(unmappableGames(3)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify([{ week: 16, home_team: 'Georgia', away_team: 'Ohio State', id: 2 }]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2027&seasonType=all'));
  const json = await res.json();

  assert.equal(res.status, 502);
  assert.equal(json.code, 'partition-schema-drift');
  assert.deepEqual(json.detail.failedSeasonTypes, ['regular']);

  // Nothing committed under the all-season key.
  assert.equal(await getAppState('schedule', '2027-all-all'), null);
});

test('an all-season refresh with a legitimately empty postseason partition still commits (valid absence)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Regular returns a real game; postseason returns an EMPTY array (before bowls).
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.searchParams.get('seasonType') === 'postseason') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify([
        {
          week: 1,
          home_team: 'Texas',
          away_team: 'Rice',
          id: 1,
          start_date: '2027-09-01T00:00:00Z',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2027&seasonType=all'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].homeTeam, 'Texas');
  assert.equal(json.meta.partialFailure, false, 'empty postseason is valid absence, not a failure');

  // Committed durably under the all-season key.
  const stored = await getAppState<{ items: unknown[] }>('schedule', '2027-all-all');
  assert.equal(stored?.value?.items?.length, 1);
});

test('an all-empty schedule refresh records a no-op, not a success advancing last-success (rereview finding #4)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Seed a prior successful schedule refresh to prove it is preserved.
  const seed = await beginProviderRefreshAttempt('schedule', SCHEDULE_YEAR_SCOPE, {
    attemptId: 'seed',
  });
  await recordProviderRefreshSuccess('schedule', SCHEDULE_YEAR_SCOPE, {
    attempt: seed,
    source: 'cfbd',
    rowsCommitted: 12,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE))
    .lastSuccessAt;
  assert.ok(priorSuccessAt);

  // Every requested partition validly returns zero rows (a future season not yet
  // published).
  setMockFetch(
    async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );

  const res = await GET(
    new Request('http://localhost/api/schedule?year=2027&seasonType=all&bypassCache=1')
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).items, []);

  const status = await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE);
  assert.equal(status.latestAttemptOutcome, 'no-op', 'all-empty resolves as a no-op');
  assert.equal(
    status.lastSuccessAt,
    priorSuccessAt,
    'a no-op does not advance last-success with rowsCommitted:0'
  );
  assert.equal(status.rowsCommitted, 12, 'prior-good rows preserved');

  // No durable schedule was written for this key (valid absence, not a commit).
  const durable = await getAppState('schedule', '2027-all-all');
  assert.equal(durable, null, 'a valid-empty no-op does not write a durable schedule');
});

// ---------------------------------------------------------------------------
// Final-truthfulness finding #2 — a prior-cache read failure during empty-response
// classification must resolve the open attempt as failed (never in-progress), retain
// prior-good, and record no no-op/success.
// ---------------------------------------------------------------------------

test('a prior-cache read failure while classifying an empty response resolves the attempt as failed (finding #2)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Prior-good POPULATED durable schedule + success metadata, to prove retention.
  await setAppState('schedule', '2027-all-all', {
    at: 1,
    items: [
      {
        id: 'prior',
        week: 1,
        startDate: '2027-09-01T00:00:00.000Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeConference: 'Big 12',
        awayConference: 'American',
        status: 'scheduled',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const seed = await beginProviderRefreshAttempt('schedule', SCHEDULE_YEAR_SCOPE, {
    attemptId: 'seed',
  });
  await recordProviderRefreshSuccess('schedule', SCHEDULE_YEAR_SCOPE, {
    attempt: seed,
    source: 'cfbd',
    rowsCommitted: 1,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE))
    .lastSuccessAt;
  assert.ok(priorSuccessAt);

  // Provider validly returns empty, but the prior durable SCHEDULE read used to
  // classify empty-vs-replacement fails. Scope the read failure to 'schedule' so
  // the 'provider-refresh-status' writes still persist (the attempt CAN be recorded).
  setMockFetch(
    async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );
  __setAppStateReadFailureForTests(new Error('durable read boom'), 'schedule');

  const res = await GET(
    new Request('http://localhost/api/schedule?year=2027&seasonType=all&bypassCache=1')
  );
  __setAppStateReadFailureForTests(null);

  // The shared authority (PLATFORM-086E1A) fails FAST when the prior durable
  // schedule state cannot be read — BEFORE the lease or any provider-refresh
  // attempt — so it never begins an attempt that could dangle and never advances a
  // false success. The full-year route surfaces this as a 503 with the closed
  // reason code.
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.code, 'canonical-context-unavailable');

  const status = await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE);
  assert.equal(
    status.latestAttemptOutcome,
    'succeeded',
    'fail-fast begins no attempt — the seeded prior-good status is untouched'
  );
  assert.equal(
    status.lastSuccessAt,
    priorSuccessAt,
    'prior-good last-success is preserved (no no-op/success recorded)'
  );

  // Prior-good durable schedule intact — nothing written on the read-failure path.
  const durable = await getAppState<{ items: unknown[] }>('schedule', '2027-all-all');
  assert.equal(durable?.value?.items?.length, 1, 'prior-good schedule retained');
});

// ---------------------------------------------------------------------------
// 4th-review finding #1 — an all-empty result is classified BEFORE any durable or
// process-cache write. A populated schedule is never replaced by an empty one.
// ---------------------------------------------------------------------------

test('an unexpected all-empty refresh does NOT overwrite a populated durable schedule (finding #1)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Prior-good POPULATED durable schedule under the exact refresh key.
  await setAppState('schedule', '2027-all-all', {
    at: 1,
    items: [
      {
        id: 'prior',
        week: 1,
        startDate: '2027-09-01T00:00:00.000Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeConference: 'Big 12',
        awayConference: 'American',
        status: 'scheduled',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  // Seed prior success metadata to prove it is preserved.
  const seed = await beginProviderRefreshAttempt('schedule', SCHEDULE_YEAR_SCOPE, {
    attemptId: 'seed',
  });
  await recordProviderRefreshSuccess('schedule', SCHEDULE_YEAR_SCOPE, {
    attempt: seed,
    source: 'cfbd',
    rowsCommitted: 1,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE))
    .lastSuccessAt;
  assert.ok(priorSuccessAt);

  // Both partitions now return empty — a suspicious empty replacement.
  setMockFetch(
    async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );

  const res = await GET(
    new Request('http://localhost/api/schedule?year=2027&seasonType=all&bypassCache=1')
  );
  const json = await res.json();

  assert.equal(res.status, 502, JSON.stringify(json));
  assert.equal(json.code, 'empty-replacement-rejected');

  // Prior-good durable schedule is intact — NOT overwritten with an empty snapshot.
  const durable = await getAppState<{ items: Array<{ id: string }> }>('schedule', '2027-all-all');
  assert.equal(durable?.value?.items?.length, 1, 'populated durable schedule preserved');
  assert.equal(durable?.value?.items?.[0]?.id, 'prior');

  // The process cache was NOT mutated with the empty result.
  assert.equal(
    SCHEDULE_ROUTE_CACHE['2027-all-all'],
    undefined,
    'rejected empty must not poison the process cache'
  );

  // Status resolves as failed; prior-good success metadata preserved.
  const status = await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE);
  assert.equal(status.latestAttemptOutcome, 'failed', 'unexpected empty resolves as failed');
  assert.equal(status.lastError?.code, 'schedule-empty-replacement-rejected');
  assert.equal(status.lastSuccessAt, priorSuccessAt, 'prior-good last-success preserved');
  assert.equal(status.rowsCommitted, 1, 'prior-good rows preserved');
});

test('schedule route blocks non-admin upstream rebuild when shared cache is missing', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for non-admin cache miss');
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2026&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 503);
  assert.match(String(json.error ?? ''), /admin refresh required/i);
});

test('schedule route serves stale shared cache to non-admin requests instead of rebuilding', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  await setAppState('schedule', '2026-all-regular', {
    at: Date.now() - 10 * 60 * 60 * 1000,
    items: [{ week: 1, homeTeam: 'Stale Home', awayTeam: 'Away', seasonType: 'regular' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  setMockFetch(async () => {
    throw new Error('upstream fetch should not run for stale non-admin reads');
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2026&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.rebuildRequired, true);
  assert.equal(json.items[0].homeTeam, 'Stale Home');
});

// ---------------------------------------------------------------------------
// PLATFORM-086E1A — the full-year refresh flows through the shared authority; a
// concurrent full-year refresh is a truthful 409 with no provider request.
// ---------------------------------------------------------------------------

test('full-year manual refresh under lease contention maps to HTTP 409 with no provider call', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  // A nonexpired lease is already held for this year (another refresh in flight).
  const held = await acquireScheduleRefreshLease({ year: 2027, now: Date.now() });
  assert.equal(held.acquired, true);

  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const res = await GET(
    new Request('http://localhost/api/schedule?year=2027&seasonType=all&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.code, 'refresh-in-progress');
  assert.equal(fetchCalls, 0, 'the losing full-year caller makes no provider request');
});

// ---------------------------------------------------------------------------
// PLATFORM-663 — targeted schedule repairs must converge on the whole-season
// snapshot. The route no longer commits a per-window durable key; there is ONE
// key per season (`schedule/${year}-all-all`) and every narrower request is a
// projection of it. These tests pin the convergence contract itself, not just
// the new code path: the defect #663 describes is a SECOND key that a repair can
// land in while every whole-season reader keeps serving the first, so the tests
// that matter are the ones asserting no such key can come into existence.
//
// The policies the deleted targeted path duplicated — schema-drift rejection,
// empty-replacement classification, durable-commit-failure resolution,
// observation ordering — are not retested here. They now have exactly one
// implementation, in the shared authority, whose suite owns them
// (`src/lib/schedule/__tests__/fullSeasonScheduleRefresh.test.ts`: "a nonempty
// payload normalizing to zero rows is schema drift", "an all-empty result over
// populated prior-good is rejected", "a genuinely unpublished all-empty result
// is a no-op without a write", "a transaction failure publishes no cache, no
// status success, and no invalidation"). Duplicating them against the route
// would re-create the two-copies problem this slice exists to remove.
// ---------------------------------------------------------------------------

const P663_YEAR = 2027;
const P663_AGGREGATE_KEY = `${P663_YEAR}-all-all`;

/** A canonical durable schedule row, tagged with the partition it belongs to. */
function p663Row(id: string, week: number, seasonType: 'regular' | 'postseason') {
  return {
    id,
    week,
    startDate:
      seasonType === 'postseason'
        ? `${P663_YEAR}-12-31T00:00:00.000Z`
        : `${P663_YEAR}-09-0${Math.min(week, 9)}T00:00:00.000Z`,
    neutralSite: false,
    conferenceGame: false,
    homeTeam: `Home ${id}`,
    awayTeam: `Away ${id}`,
    homeConference: 'Big 12',
    awayConference: 'American',
    status: 'scheduled',
    seasonType,
  };
}

/** Seed a fresh whole-season aggregate spanning two weeks and both partitions. */
async function seedAggregate(at = Date.now()) {
  await setAppState('schedule', P663_AGGREGATE_KEY, {
    at,
    items: [
      p663Row('w1-reg', 1, 'regular'),
      p663Row('w2-reg', 2, 'regular'),
      p663Row('w1-post', 1, 'postseason'),
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

/** Every durable key in the `schedule` scope, so a test can assert what exists. */
async function scheduleKeysPresent(): Promise<string[]> {
  const found: string[] = [];
  const candidates = [
    P663_AGGREGATE_KEY,
    `${P663_YEAR}-all-regular`,
    `${P663_YEAR}-all-postseason`,
    `${P663_YEAR}-1-all`,
    `${P663_YEAR}-2-all`,
  ];
  for (let week = 0; week <= 3; week += 1) {
    candidates.push(`${P663_YEAR}-${week}-regular`, `${P663_YEAR}-${week}-postseason`);
  }
  for (const key of candidates) {
    const record = await getAppState<unknown>('schedule', key);
    if (record?.value != null) found.push(key);
  }
  return found;
}

test('a week request is served as a projection of the aggregate, with no provider call', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  await seedAggregate();

  setMockFetch(async () => {
    throw new Error('a window read must never contact the provider');
  });

  const res = await GET(
    new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=1&seasonType=regular`)
  );
  const json = await res.json();

  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.meta.cache, 'hit');
  assert.deepEqual(
    json.items.map((item: { id: string }) => item.id),
    ['w1-reg']
  );
});

test('week and seasonType narrow independently, and week+all spans both partitions', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  await seedAggregate();
  setMockFetch(async () => {
    throw new Error('a window read must never contact the provider');
  });

  const weekAll = await (
    await GET(new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=1`))
  ).json();
  assert.deepEqual(
    weekAll.items.map((i: { id: string }) => i.id).sort(),
    ['w1-post', 'w1-reg'],
    'a week with no season type spans both partitions'
  );

  const postseasonOnly = await (
    await GET(new Request(`http://localhost/api/schedule?year=${P663_YEAR}&seasonType=postseason`))
  ).json();
  assert.deepEqual(
    postseasonOnly.items.map((i: { id: string }) => i.id),
    ['w1-post'],
    'a season type with no week spans every week of that partition'
  );

  const week2 = await (
    await GET(new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=2`))
  ).json();
  assert.deepEqual(
    week2.items.map((i: { id: string }) => i.id),
    ['w2-reg']
  );
});

test('an authorized window refresh commits ONLY the aggregate key', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  setMockFetch(async (input: URL | string) => {
    const seasonType = new URL(String(input)).searchParams.get('seasonType');
    const body =
      seasonType === 'postseason'
        ? []
        : [{ week: 1, home_team: 'Texas', away_team: 'Rice', id: 9001 }];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const { result: res } = await runCapturingTags(() =>
    GET(
      new Request(
        `http://localhost/api/schedule?year=${P663_YEAR}&week=1&seasonType=regular&bypassCache=1`,
        { headers: { 'x-admin-token': 'admin-token' } }
      )
    )
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));

  // THE CONVERGENCE ASSERTION. Before #663 this request committed
  // `schedule/2027-1-regular`, a key no whole-season reader consults — so the
  // repair was invisible to standings, Insights, the draft board and archives.
  // The aggregate is now the only key that exists, so there is nowhere for a
  // repaired window to hide.
  assert.deepEqual(
    await scheduleKeysPresent(),
    [P663_AGGREGATE_KEY],
    'a window refresh must write the aggregate and nothing else'
  );
});

test('a window refresh and a whole-season read agree about the same game', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  // A populated aggregate carrying the OLD kickoff for the game about to be
  // repaired — the exact pre-#663 divergence setup.
  await setAppState('schedule', P663_AGGREGATE_KEY, {
    at: 1,
    items: [{ ...p663Row('9001', 1, 'regular'), startDate: `${P663_YEAR}-09-01T17:00:00.000Z` }],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  setMockFetch(async (input: URL | string) => {
    const seasonType = new URL(String(input)).searchParams.get('seasonType');
    const body =
      seasonType === 'postseason'
        ? []
        : [
            {
              week: 1,
              home_team: 'Home 9001',
              away_team: 'Away 9001',
              id: 9001,
              start_date: `${P663_YEAR}-09-01T20:30:00.000Z`,
            },
          ];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await runCapturingTags(() =>
    GET(
      new Request(
        `http://localhost/api/schedule?year=${P663_YEAR}&week=1&seasonType=regular&bypassCache=1`,
        { headers: { 'x-admin-token': 'admin-token' } }
      )
    )
  );

  // Read back through BOTH shapes. Pre-#663 the window read served the repaired
  // child while the whole-season read served the untouched aggregate; they must
  // now be the same rows because they are the same record.
  resetScheduleRouteCacheForTests();
  const windowRead = await (
    await GET(new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=1`))
  ).json();
  resetScheduleRouteCacheForTests();
  const seasonRead = await (
    await GET(new Request(`http://localhost/api/schedule?year=${P663_YEAR}`))
  ).json();

  const repaired = `${P663_YEAR}-09-01T20:30:00.000Z`;
  assert.equal(windowRead.items.length, 1, JSON.stringify(windowRead));
  assert.equal(windowRead.items[0].startDate, repaired, 'the window read serves the repair');
  assert.equal(
    seasonRead.items.find((i: { id: string }) => String(i.id) === '9001')?.startDate,
    repaired,
    'the whole-season read serves the SAME repair — this is the #663 contract'
  );

  // And the durable store carries the repair on the one canonical key, which is
  // what every server-side reader (standings, Insights, archives) loads.
  const stored = await getAppState<{ items: Array<{ id: string; startDate: string }> }>(
    'schedule',
    P663_AGGREGATE_KEY
  );
  assert.equal(stored?.value?.items?.[0]?.startDate, repaired);
});

test('a window request never seeds presentation or probe state', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  setMockFetch(async (input: URL | string) => {
    const seasonType = new URL(String(input)).searchParams.get('seasonType');
    return new Response(
      JSON.stringify(
        seasonType === 'postseason'
          ? []
          : [{ week: 1, home_team: 'Texas', away_team: 'Rice', id: 9002 }]
      ),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  await runCapturingTags(() =>
    GET(
      new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=1&bypassCache=1`, {
        headers: { 'x-admin-token': 'admin-token' },
      })
    )
  );

  // The narrow shape drives the same authority now, but it must NOT inherit the
  // whole-season shape's side effects — a window request never had them.
  const probe = await getAppState<unknown>('schedule-probe', String(P663_YEAR));
  assert.equal(probe?.value ?? null, null, 'a window refresh must not write probe state');
});

test('a non-admin window request on an uncached season is a 503, not a provider call', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  setMockFetch(async () => {
    throw new Error('a non-admin miss must never contact the provider');
  });

  const res = await GET(
    new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=1&seasonType=regular`)
  );
  const json = await res.json();
  assert.equal(res.status, 503, JSON.stringify(json));
  assert.match(String(json.error ?? ''), /admin refresh required/i);
});

test('a stale aggregate serves a non-admin window flagged for rebuild', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // REQUIRED for this to be a non-admin request: with no `ADMIN_API_TOKEN`
  // configured, `resolvePlatformAdminDecision` authorizes outside production
  // (`adminAuth.ts:86-90`), so an unset token would make this an ADMIN request
  // and exercise the refresh path instead of the stale-read path.
  process.env.ADMIN_API_TOKEN = 'admin-token';
  await seedAggregate(Date.now() - 3_601_000);

  setMockFetch(async () => {
    throw new Error('a non-admin stale read must never contact the provider');
  });

  const res = await GET(
    new Request(`http://localhost/api/schedule?year=${P663_YEAR}&week=1&seasonType=regular`)
  );
  const json = await res.json();

  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.rebuildRequired, true);
  assert.deepEqual(
    json.items.map((i: { id: string }) => i.id),
    ['w1-reg'],
    'the stale rows are still projected to the requested window'
  );
});

test('the legacy season-partition pair still serves a window when no aggregate exists', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // A store that predates the aggregate — a preview-branch database, or a local
  // file store seeded before #663. The pair is unwritable now but still READ, so
  // such a store is not silently served an empty season.
  await setAppState('schedule', `${P663_YEAR}-all-regular`, {
    at: Date.now(),
    items: [p663Row('legacy-reg', 1, 'regular')],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await setAppState('schedule', `${P663_YEAR}-all-postseason`, {
    at: Date.now(),
    items: [p663Row('legacy-post', 1, 'postseason')],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  setMockFetch(async () => {
    throw new Error('a compatibility read must never contact the provider');
  });

  const res = await GET(
    new Request(`http://localhost/api/schedule?year=${P663_YEAR}&seasonType=postseason`)
  );
  const json = await res.json();

  assert.equal(res.status, 200, JSON.stringify(json));
  assert.deepEqual(
    json.items.map((i: { id: string }) => i.id),
    ['legacy-post'],
    'the pair fallback is projected to the requested window like the aggregate is'
  );
});

test('a window refresh serializes against an in-flight full-season refresh', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  // PLATFORM-663 answered #663's concurrency question by REMOVING the race rather
  // than arbitrating it. The old targeted writer took no lease and locked a
  // different key, so a repair and a full-season refresh could both commit and
  // neither knew the other ran — the aggregate and the partition then disagreed
  // with nothing recording which was newer. A window refresh now drives the one
  // year-scoped authority, so it contends on the same lease and the loser is told
  // so instead of silently writing a second truth.
  const held = await acquireScheduleRefreshLease({ year: P663_YEAR, now: Date.now() });
  assert.equal(held.acquired, true);

  let fetchCalls = 0;
  setMockFetch(async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const res = await GET(
    new Request(
      `http://localhost/api/schedule?year=${P663_YEAR}&week=1&seasonType=regular&bypassCache=1`,
      { headers: { 'x-admin-token': 'admin-token' } }
    )
  );
  const json = await res.json();

  assert.equal(res.status, 409, JSON.stringify(json));
  assert.equal(json.code, 'refresh-in-progress');
  assert.equal(fetchCalls, 0, 'the losing window caller makes no provider request');
  assert.deepEqual(
    await scheduleKeysPresent(),
    [],
    'a lease-losing window refresh writes no schedule key at all'
  );
});
