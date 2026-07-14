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
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshSuccess,
} from '../../../../lib/server/providerRefreshStatus.ts';
import {
  seasonPartitionScope,
  weekPartitionScope,
  yearScope,
} from '../../../../lib/providerRefreshScope.ts';

// Schedule status scope now reflects the ACTUAL refresh target (finding 1): a
// full-year (seasonType=all) refresh records the year rollup, while a single
// season-type refresh records its season partition. Tests use the scope matching
// the request they issue.
const SCHEDULE_YEAR_SCOPE = yearScope(2027);
const SCHEDULE_REGULAR_SCOPE = seasonPartitionScope(2027, 'regular');
const SCHEDULE_POSTSEASON_SCOPE = seasonPartitionScope(2027, 'postseason');

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

  assert.equal(res.status, 502);
  assert.equal(json.error, 'partial upstream error');
  assert.deepEqual(json.detail.failedSeasonTypes, ['postseason']);
});

// ---------------------------------------------------------------------------
// PLATFORM-085C — a NONEMPTY provider payload that normalizes to zero schedule
// rows is schema drift (uncertainty), NOT valid absence. It must not commit as
// a successful-empty refresh nor overwrite prior-good durable schedule state.
// ---------------------------------------------------------------------------

test('schema drift (nonempty → zero rows) is rejected and does not overwrite prior-good durable schedule', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  // Prior-good durable schedule for this exact refresh key.
  await setAppState('schedule', '2027-all-regular', {
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
  // A league is registered so that IF the route invalidated standings it would
  // emit a tag — the drift path must emit none.
  await setAppState('leagues', 'registry', [
    { slug: 'alpha', displayName: 'Alpha', year: 2027, createdAt: '2027-01-01T00:00:00.000Z' },
  ]);

  // bypassCache=1 forces a refetch; upstream returns nonempty rows that all drop.
  setMockFetch(async () => {
    return new Response(JSON.stringify(unmappableGames(5)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const { result: res, tags } = await runCapturingTags(() =>
    GET(
      new Request('http://localhost/api/schedule?year=2027&seasonType=regular&bypassCache=1', {
        headers: { 'x-admin-token': 'admin-token' },
      })
    )
  );
  const json = await res.json();

  assert.equal(res.status, 502, JSON.stringify(json));
  assert.match(String(json.error ?? ''), /schema drift/i);

  // Prior-good durable schedule is intact — NOT overwritten with an empty snapshot.
  const stored = await getAppState<{ items: Array<{ id: string }> }>(
    'schedule',
    '2027-all-regular'
  );
  assert.equal(stored?.value?.items?.length, 1);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good schedule retained');

  // No standings invalidation from a schema-drifted (uncommitted) refresh.
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

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
  assert.equal(json.error, 'partial upstream error');
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

test('a durable commit failure resolves the schedule attempt as failed (rereview finding #6)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // Seed a prior successful schedule refresh so we can prove it is preserved.
  // This test refreshes seasonType=regular, which records the regular season
  // partition scope (finding 1) — the seed + reads use that same scope.
  const seed = await beginProviderRefreshAttempt('schedule', SCHEDULE_REGULAR_SCOPE, {
    attemptId: 'seed',
  });
  await recordProviderRefreshSuccess('schedule', SCHEDULE_REGULAR_SCOPE, {
    attempt: seed,
    source: 'cfbd',
    rowsCommitted: 5,
  });
  const priorSuccessAt = (await getProviderRefreshStatus('schedule', SCHEDULE_REGULAR_SCOPE))
    .lastSuccessAt;
  assert.ok(priorSuccessAt);

  setMockFetch(async () => {
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

  // The provider fetch succeeds but the durable SCHEDULE commit fails. Scope the
  // failure to 'schedule' so the best-effort status write (a different scope)
  // still persists — otherwise the failure record itself would be swallowed.
  __setAppStateWriteFailureForTests(new Error('durable write unavailable'), 'schedule');
  let res: Response;
  try {
    res = await GET(
      new Request('http://localhost/api/schedule?year=2027&seasonType=regular&bypassCache=1')
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(res.status, 500, 'a persistence failure is surfaced as an error, not a success');

  const status = await getProviderRefreshStatus('schedule', SCHEDULE_REGULAR_SCOPE);
  assert.equal(status.latestAttemptOutcome, 'failed', 'the open attempt is resolved as failed');
  assert.equal(status.lastError?.code, 'schedule-durable-commit-failed');
  assert.equal(status.lastSuccessAt, priorSuccessAt, 'prior-good last-success is preserved');
  assert.equal(status.rowsCommitted, 5, 'prior-good row count preserved');
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

  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.detail?.code, 'schedule-prior-cache-read-failed');

  const status = await getProviderRefreshStatus('schedule', SCHEDULE_YEAR_SCOPE);
  assert.equal(
    status.latestAttemptOutcome,
    'failed',
    'the open attempt resolves as failed, never left in-progress'
  );
  assert.equal(status.lastError?.code, 'schedule-prior-cache-read-failed');
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
  assert.match(String(json.error ?? ''), /no games/i);

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

test('a valid inapplicable postseason-empty refresh resolves as a no-op without any write (finding #1)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';

  // No prior-good postseason schedule cached: postseason before any bowls exist.
  setMockFetch(
    async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  );

  const res = await GET(
    new Request('http://localhost/api/schedule?year=2027&seasonType=postseason&bypassCache=1')
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).items, []);

  // Nothing durable was written for the postseason key, and the process cache is clean.
  assert.equal(await getAppState('schedule', '2027-all-postseason'), null);
  assert.equal(SCHEDULE_ROUTE_CACHE['2027-all-postseason'], undefined);

  const status = await getProviderRefreshStatus('schedule', SCHEDULE_POSTSEASON_SCOPE);
  assert.equal(status.latestAttemptOutcome, 'no-op', 'inapplicable postseason empty is a no-op');
  assert.equal(status.lastSuccessAt, null, 'a no-op never advances last-success');
});

test('schedule route bypassCache=1 forces an upstream refetch', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';

  let fetchCount = 0;
  setMockFetch(async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify([
        { week: 1, home_team: `Home ${fetchCount}`, away_team: 'Away', id: fetchCount },
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  });

  const first = await GET(
    new Request('http://localhost/api/schedule?year=2026&seasonType=regular&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
  const firstJson = await first.json();

  const second = await GET(
    new Request('http://localhost/api/schedule?year=2026&seasonType=regular&bypassCache=1', {
      headers: { 'x-admin-token': 'admin-token' },
    })
  );
  const secondJson = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 2);
  assert.equal(firstJson.meta.cache, 'miss');
  assert.equal(secondJson.meta.cache, 'miss');
  assert.equal(firstJson.items[0].homeTeam, 'Home 1');
  assert.equal(secondJson.items[0].homeTeam, 'Home 2');
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

test('stale shared schedule cache entries are refetched instead of treated as permanently fresh', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  let fetchCount = 0;

  await setAppState('schedule', '2026-all-regular', {
    at: Date.now() - 3_601_000,
    items: [{ week: 1, homeTeam: 'Stale Home', awayTeam: 'Away', seasonType: 'regular' }],
    partialFailure: false,
    failedSeasonTypes: [],
  });

  setMockFetch(async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify([{ week: 1, home_team: 'Fresh Home', away_team: 'Away', id: fetchCount }]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  });

  const res = await GET(new Request('http://localhost/api/schedule?year=2026&seasonType=regular'));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(fetchCount, 1);
  assert.equal(json.meta.cache, 'miss');
  assert.equal(json.items[0].homeTeam, 'Fresh Home');
});

// ---------------------------------------------------------------------------
// SCOPED-STATUS review v2 #2 — a specific week with NO season type
// (`seasonType` normalized to 'all') spans TWO week partitions. Each applicable
// child resolves INDEPENDENTLY: its own week-partition status, never a combined
// outcome coerced onto the regular week scope. The aggregate HTTP response
// contract is preserved.
// ---------------------------------------------------------------------------

const WA_YEAR = 2027;
const WA_WEEK = 1;
const WA_REGULAR = weekPartitionScope(WA_YEAR, WA_WEEK, 'regular');
const WA_POSTSEASON = weekPartitionScope(WA_YEAR, WA_WEEK, 'postseason');
const WA_REGULAR_KEY = `${WA_YEAR}-${WA_WEEK}-regular`;
const WA_POSTSEASON_KEY = `${WA_YEAR}-${WA_WEEK}-postseason`;
// The pre-split `${year}-${week}-all` aggregate is now a READ-ONLY legacy
// compatibility fallback (WEEK-ALL-READ-COMPOSITION remediation): composed reads
// consult it only for a partition with no exact child cache, and NO code path ever
// writes, replaces, or deletes it.
const WA_LEGACY_KEY = `${WA_YEAR}-${WA_WEEK}-all`;

// A canonical schedule row tagged with its `seasonType` — the field composition
// partitions the legacy aggregate by (never a raw provider label).
function scheduleRow(id: string, seasonType: 'regular' | 'postseason') {
  return {
    id,
    week: WA_WEEK,
    startDate:
      seasonType === 'postseason' ? '2027-12-31T00:00:00.000Z' : '2027-09-01T00:00:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: `${id}-home`,
    awayTeam: `${id}-away`,
    homeConference: 'X',
    awayConference: 'Y',
    status: 'scheduled',
    seasonType,
  };
}

// Seed a durable child cache for one partition (the authoritative post-split source).
function seedChild(seasonType: 'regular' | 'postseason', ids: string[], at: number = Date.now()) {
  return setAppState('schedule', `${WA_YEAR}-${WA_WEEK}-${seasonType}`, {
    at,
    items: ids.map((id) => scheduleRow(id, seasonType)),
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

// Seed a pre-split `${year}-${week}-all` aggregate holding rows for BOTH partitions,
// tagged by canonical `seasonType` — the legacy read-only fallback.
function seedLegacyAggregate(
  rows: Array<{ id: string; seasonType: 'regular' | 'postseason' }>,
  at: number = Date.now()
) {
  return setAppState('schedule', WA_LEGACY_KEY, {
    at,
    items: rows.map((r) => scheduleRow(r.id, r.seasonType)),
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

// Seed ONLY the in-process cache (no durable write) for one partition — used to
// exercise the process-vs-durable freshness contract of `resolveChildCache`.
function seedProcessChild(
  seasonType: 'regular' | 'postseason',
  ids: string[],
  at: number = Date.now()
) {
  SCHEDULE_ROUTE_CACHE[`${WA_YEAR}-${WA_WEEK}-${seasonType}`] = {
    at,
    items: ids.map((id) => scheduleRow(id, seasonType)),
    partialFailure: false,
    failedSeasonTypes: [],
  };
}

// A cache-only (no bypassCache) week+all read — the composition read path.
function weekAllCacheOnlyRequest() {
  return new Request(`http://localhost/api/schedule?year=${WA_YEAR}&week=${WA_WEEK}`);
}

// Per-partition mock for a week+all refresh. 'ok' → one mappable game, 'empty' →
// valid absence ([]), 'fail' → a non-array payload (immediate schema-drift
// failure, no retry delay).
function setWeekAllMock(spec: {
  regular: 'ok' | 'empty' | 'fail';
  postseason: 'ok' | 'empty' | 'fail';
}) {
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const st = url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
    const mode = spec[st];
    if (mode === 'fail') {
      return new Response(JSON.stringify({ error: 'drift' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (mode === 'empty') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const game =
      st === 'postseason'
        ? {
            week: WA_WEEK,
            home_team: 'Georgia',
            away_team: 'Texas',
            id: 91,
            start_date: '2027-12-31T00:00:00Z',
          }
        : {
            week: WA_WEEK,
            home_team: 'Alpha',
            away_team: 'Beta',
            id: 11,
            start_date: '2027-09-01T00:00:00Z',
          };
    return new Response(JSON.stringify([game]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

// A week with no seasonType → normalized to 'all'; bypassCache forces the refresh.
function weekAllRequest() {
  return new Request(`http://localhost/api/schedule?year=${WA_YEAR}&week=${WA_WEEK}&bypassCache=1`);
}

test('week+all: both partitions succeed → independent child commits, no rollup, no materialized aggregate', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  setWeekAllMock({ regular: 'ok', postseason: 'ok' });
  const res = await GET(weekAllRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.items.length, 2, 'the combined response carries both partitions');

  const reg = await getProviderRefreshStatus('schedule', WA_REGULAR);
  const post = await getProviderRefreshStatus('schedule', WA_POSTSEASON);
  assert.equal(reg.latestAttemptOutcome, 'succeeded');
  assert.equal(reg.rowsCommitted, 1, 'regular status carries ONLY its own row count');
  assert.equal(post.latestAttemptOutcome, 'succeeded');
  assert.equal(post.rowsCommitted, 1, 'postseason status carries ONLY its own row count');

  const yr = await getProviderRefreshStatus('schedule', yearScope(WA_YEAR));
  assert.equal(yr.latestAttemptOutcome, null, 'no year rollup is written by a week refresh');

  // Each child persisted its OWN authoritative cache key; NO combined
  // `${year}-${week}-all` aggregate is materialized (read-time composition only).
  const regChild = await getAppState<{ items: unknown[] }>('schedule', WA_REGULAR_KEY);
  const postChild = await getAppState<{ items: unknown[] }>('schedule', WA_POSTSEASON_KEY);
  assert.equal(regChild?.value.items.length, 1, 'regular child cache persisted');
  assert.equal(postChild?.value.items.length, 1, 'postseason child cache persisted');
  assert.equal(
    await getAppState('schedule', WA_LEGACY_KEY),
    null,
    'no materialized `${year}-${week}-all` aggregate entry is written'
  );

  // A cache-only read (no bypassCache) COMPOSES the aggregate from the child caches
  // WITHOUT any provider call — the read contract the split path regressed, restored
  // without a second authoritative copy.
  setMockFetch(async () => {
    throw new Error('cache-only week+all read must not call upstream');
  });
  const cached = await GET(weekAllCacheOnlyRequest());
  assert.equal(cached.status, 200);
  const cachedJson = await cached.json();
  assert.equal(cachedJson.items.length, 2, 'the composed read serves both child partitions');
  assert.equal(cachedJson.meta.cache, 'hit');
});

test('week+all: regular succeeds while postseason fails → independent records, legacy aggregate untouched', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // A legacy aggregate exists; a partial failure must NOT mutate or replace it.
  await seedLegacyAggregate(
    [
      { id: 'leg-reg', seasonType: 'regular' },
      { id: 'leg-post', seasonType: 'postseason' },
    ],
    Date.now() - 1000
  );
  setWeekAllMock({ regular: 'ok', postseason: 'fail' });
  const res = await GET(weekAllRequest());
  assert.notEqual(res.status, 200, 'a partition failure fails the aggregate action');

  const reg = await getProviderRefreshStatus('schedule', WA_REGULAR);
  const post = await getProviderRefreshStatus('schedule', WA_POSTSEASON);
  assert.equal(
    reg.latestAttemptOutcome,
    'succeeded',
    'regular is NOT marked failed by the postseason failure'
  );
  assert.equal(reg.rowsCommitted, 1);
  assert.equal(reg.lastError, null);
  assert.equal(post.latestAttemptOutcome, 'failed', 'postseason owns its own failure');

  // The legacy aggregate is a read-only fallback — never mutated by a refresh.
  const legacy = await getAppState<{ items: Array<{ id: string }> }>('schedule', WA_LEGACY_KEY);
  assert.equal(legacy?.value.items.length, 2, 'the legacy aggregate is untouched by the refresh');
});

test('week+all: a valid-empty postseason (no prior rows anywhere) is a no-op, not a failure', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  setWeekAllMock({ regular: 'ok', postseason: 'empty' });
  const res = await GET(weekAllRequest());
  assert.equal(res.status, 200, 'a valid-empty sibling does not fail the aggregate');
  const json = await res.json();
  assert.equal(json.items.length, 1, 'only regular contributes rows');

  const reg = await getProviderRefreshStatus('schedule', WA_REGULAR);
  const post = await getProviderRefreshStatus('schedule', WA_POSTSEASON);
  assert.equal(reg.latestAttemptOutcome, 'succeeded');
  assert.equal(
    post.latestAttemptOutcome,
    'no-op',
    'an inapplicable postseason week with no prior-good rows is a truthful no-op'
  );

  // The empty postseason wrote no child cache; only the applicable regular child is
  // persisted, and no aggregate is materialized.
  assert.equal(await getAppState('schedule', WA_POSTSEASON_KEY), null, 'empty writes no child');
  assert.equal(
    (await getAppState<{ items: unknown[] }>('schedule', WA_REGULAR_KEY))?.value.items.length,
    1
  );
  assert.equal(await getAppState('schedule', WA_LEGACY_KEY), null);
});

test('week+all: a provider [] for a partition covered ONLY by the legacy aggregate is an empty replacement, not a no-op', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // Pre-split aggregate carries postseason games; NO postseason child key exists.
  // A provider [] would drop those legacy-covered games on the composed read, so it
  // must be classified as an unexpected empty replacement (recorded failure), NOT a
  // valid no-op — the empty-classification consults the legacy aggregate as prior-good.
  await seedLegacyAggregate([
    { id: 'leg-reg', seasonType: 'regular' },
    { id: 'leg-post', seasonType: 'postseason' },
  ]);
  setWeekAllMock({ regular: 'ok', postseason: 'empty' });
  const res = await GET(weekAllRequest());
  assert.notEqual(res.status, 200, 'an empty over legacy-covered games fails the aggregate action');

  const post = await getProviderRefreshStatus('schedule', WA_POSTSEASON);
  assert.equal(
    post.latestAttemptOutcome,
    'failed',
    'a [] over legacy-covered postseason games is a failure, not a silent no-op'
  );

  // No data loss: the legacy aggregate is retained, so a composed read still serves
  // the legacy postseason rows (and the freshly committed regular child).
  const legacy = await getAppState<{ items: Array<{ id: string }> }>('schedule', WA_LEGACY_KEY);
  assert.ok(
    legacy?.value.items.some((i) => i.id === 'leg-post'),
    'the legacy postseason rows are retained (never dropped by the failed empty)'
  );
});

test('week+all: a later regular-only week refresh updates its own scope, not the postseason week', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  setWeekAllMock({ regular: 'ok', postseason: 'ok' });
  await GET(weekAllRequest());
  assert.equal(
    (await getProviderRefreshStatus('schedule', WA_POSTSEASON)).latestAttemptOutcome,
    'succeeded'
  );

  // A later single-partition regular week-1 refresh records against the SAME
  // regular week scope (updating it) and must not touch the postseason week.
  setMockFetch(
    async () =>
      new Response(
        JSON.stringify([
          {
            week: WA_WEEK,
            home_team: 'Gamma',
            away_team: 'Delta',
            id: 12,
            start_date: '2027-09-02T00:00:00Z',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
  );
  const res = await GET(
    new Request(
      `http://localhost/api/schedule?year=${WA_YEAR}&week=${WA_WEEK}&seasonType=regular&bypassCache=1`
    )
  );
  assert.equal(res.status, 200);

  const reg = await getProviderRefreshStatus('schedule', WA_REGULAR);
  assert.equal(reg.latestAttemptOutcome, 'succeeded', 'the regular week scope updated');
  assert.equal(reg.rowsCommitted, 1);
  const post = await getProviderRefreshStatus('schedule', WA_POSTSEASON);
  assert.equal(
    post.latestAttemptOutcome,
    'succeeded',
    'the postseason week status is not collided/overwritten by a regular-only refresh'
  );
});

test('week+all: a targeted regular-only repair is immediately reflected by the composed read (no stale aggregate)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // An initial week+all refresh commits both children (regular id 11, postseason id 91).
  setWeekAllMock({ regular: 'ok', postseason: 'ok' });
  await GET(weekAllRequest());

  // A targeted regular-only repair commits NEW regular rows (id 777).
  setMockFetch(async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    assert.equal(
      url.searchParams.get('seasonType'),
      'regular',
      'only the regular child is repaired'
    );
    return new Response(
      JSON.stringify([
        {
          week: WA_WEEK,
          home_team: 'Repaired',
          away_team: 'Team',
          id: 777,
          start_date: '2027-09-03T00:00:00Z',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
  const repair = await GET(
    new Request(
      `http://localhost/api/schedule?year=${WA_YEAR}&week=${WA_WEEK}&seasonType=regular&bypassCache=1`
    )
  );
  assert.equal(repair.status, 200);

  // A cache-only week+all read must serve the REPAIRED regular rows (777) plus the
  // unchanged postseason child (91) — never a pre-repair aggregate snapshot (the v3
  // materialized-aggregate staleness this remediation removes).
  setMockFetch(async () => {
    throw new Error('coherent composed read must not call upstream');
  });
  const composed = await GET(weekAllCacheOnlyRequest());
  assert.equal(composed.status, 200);
  const ids = (await composed.json()).items.map((i: { id: string }) => i.id);
  assert.ok(ids.includes('777'), 'the composed read reflects the repaired regular child');
  assert.ok(ids.includes('91'), 'the postseason child is retained');
  assert.ok(!ids.includes('11'), 'the pre-repair regular rows are gone');
});

test('week+all: explicit seasonType=all with a week behaves the same as the omitted form', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  setWeekAllMock({ regular: 'ok', postseason: 'ok' });
  const res = await GET(
    new Request(
      `http://localhost/api/schedule?year=${WA_YEAR}&week=${WA_WEEK}&seasonType=all&bypassCache=1`
    )
  );
  assert.equal(res.status, 200);
  assert.equal(
    (await getProviderRefreshStatus('schedule', WA_REGULAR)).latestAttemptOutcome,
    'succeeded'
  );
  assert.equal(
    (await getProviderRefreshStatus('schedule', WA_POSTSEASON)).latestAttemptOutcome,
    'succeeded'
  );
});

test('week+all: both partitions empty → no-op response, no rollup, no child/aggregate writes', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  setWeekAllMock({ regular: 'empty', postseason: 'empty' });
  const res = await GET(weekAllRequest());
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).items, []);

  assert.equal(
    (await getProviderRefreshStatus('schedule', WA_REGULAR)).latestAttemptOutcome,
    'no-op'
  );
  assert.equal(
    (await getProviderRefreshStatus('schedule', WA_POSTSEASON)).latestAttemptOutcome,
    'no-op'
  );
  assert.equal(
    (await getProviderRefreshStatus('schedule', yearScope(WA_YEAR))).latestAttemptOutcome,
    null,
    'no year rollup'
  );

  // Both partitions were valid no-ops — no child caches and no aggregate are written.
  assert.equal(await getAppState('schedule', WA_REGULAR_KEY), null);
  assert.equal(await getAppState('schedule', WA_POSTSEASON_KEY), null);
  assert.equal(await getAppState('schedule', WA_LEGACY_KEY), null);
});

// ---------------------------------------------------------------------------
// WEEK-ALL-READ-COMPOSITION — cache-only week+all reads COMPOSE from the exact
// child partitions, falling back to the legacy aggregate only for a partition with
// no child cache. The materialized `${year}-${week}-all` aggregate is gone.
// ---------------------------------------------------------------------------

test('week+all: a pre-split legacy aggregate with no child caches is served via read-time composition', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  await seedLegacyAggregate([
    { id: 'leg-reg', seasonType: 'regular' },
    { id: 'leg-post', seasonType: 'postseason' },
  ]);
  setMockFetch(async () => {
    throw new Error('composed legacy read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.items.length, 2, 'both legacy partitions are composed into the response');

  // The legacy aggregate is a read-only fallback — never mutated or promoted by a read.
  const legacy = await getAppState<{ items: unknown[] }>('schedule', WA_LEGACY_KEY);
  assert.equal(legacy?.value.items.length, 2, 'the legacy aggregate is untouched by the read');
});

test('week+all: an exact child cache takes precedence over legacy aggregate rows for the same partition', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // Legacy has both partitions; a fresh regular CHILD supersedes the legacy regular.
  await seedLegacyAggregate([
    { id: 'leg-reg', seasonType: 'regular' },
    { id: 'leg-post', seasonType: 'postseason' },
  ]);
  await seedChild('regular', ['child-reg']);
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const ids = (await res.json()).items.map((i: { id: string }) => i.id).sort();
  // regular from the CHILD (not 'leg-reg'); postseason falls back to legacy.
  assert.deepEqual(ids, ['child-reg', 'leg-post']);
});

test('week+all: composes truthfully with only one partition cached (incomplete coverage)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  await seedChild('regular', ['solo-reg']);
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.meta.cache, 'hit');
  assert.deepEqual(
    json.items.map((i: { id: string }) => i.id),
    ['solo-reg'],
    'only the cached regular partition is served; the absent postseason contributes nothing'
  );
});

test('week+all: a full miss (no child, no legacy) blocks non-admin reads with 503', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token'; // make the anonymous read non-admin
  setMockFetch(async () => {
    throw new Error('non-admin full-miss read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 503);
  assert.match(String((await res.json()).error ?? ''), /admin refresh required/i);
});

test('week+all: a stale composed view is served to non-admins flagged for rebuild', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  const staleAt = Date.now() - 10 * 60 * 60 * 1000;
  await seedChild('regular', ['stale-reg'], staleAt);
  await seedChild('postseason', ['stale-post'], staleAt);
  setMockFetch(async () => {
    throw new Error('stale non-admin read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.meta.stale, true);
  assert.equal(json.meta.rebuildRequired, true);
  assert.equal(json.items.length, 2);
});

test('week+all: a fresh partition paired with a stale partition composes to a stale view', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  await seedChild('regular', ['fresh-reg'], Date.now());
  await seedChild('postseason', ['stale-post'], Date.now() - 10 * 60 * 60 * 1000);
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(
    json.meta.stale,
    true,
    'the oldest contributing partition makes the whole composed view stale'
  );
  assert.equal(json.items.length, 2, 'both partitions are still served');
});

// ---------------------------------------------------------------------------
// WEEK-ALL-COMPOSITION-FRESHNESS — (1) an EXPIRED process child must re-read
// durable storage so a newer durable child (another instance / a targeted repair)
// is never masked; (2) an EMPTY legacy partition extraction is absence and must
// contribute neither rows NOR a stale timestamp.
// ---------------------------------------------------------------------------

test('week+all: an EXPIRED process child does not mask a newer durable child (finding 1)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // Local process mirror holds OLD, now-expired regular rows while durable storage
  // has NEWER regular rows (another instance committed, or a targeted repair).
  seedProcessChild('regular', ['old-reg'], Date.now() - 10 * 60 * 60 * 1000);
  seedProcessChild('postseason', ['post'], Date.now());
  await seedChild('regular', ['new-reg'], Date.now());
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  const ids = json.items.map((i: { id: string }) => i.id);
  assert.ok(ids.includes('new-reg'), 'the newer durable regular child is served');
  assert.ok(!ids.includes('old-reg'), 'the expired process rows are not served');
  assert.equal(json.meta.cache, 'hit');
  assert.notEqual(json.meta.stale, true, 'the fresh durable child is not stale');
  // The local process mirror is refreshed from durable data.
  assert.equal(
    SCHEDULE_ROUTE_CACHE[`${WA_YEAR}-${WA_WEEK}-regular`]?.items?.[0]?.id,
    'new-reg',
    'the process mirror is updated from durable storage after reload'
  );
});

test('week+all: an EXPIRED process postseason child reloads from durable (finding 1 symmetric)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  seedProcessChild('regular', ['reg'], Date.now());
  seedProcessChild('postseason', ['old-post'], Date.now() - 10 * 60 * 60 * 1000);
  await seedChild('postseason', ['new-post'], Date.now());
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const ids = (await res.json()).items.map((i: { id: string }) => i.id);
  assert.ok(ids.includes('new-post'), 'the newer durable postseason child is served');
  assert.ok(!ids.includes('old-post'), 'the expired process postseason rows are not served');
});

test('week+all: a FRESH process child is served without any durable read (finding 1 fast path)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  seedProcessChild('regular', ['proc-reg'], Date.now());
  seedProcessChild('postseason', ['proc-post'], Date.now());
  // Any durable read would throw — two fresh process children must satisfy the read
  // via the fast path with NO durable access.
  __setAppStateReadFailureForTests(new Error('durable read must not run on the fast path'));
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  let res: Response;
  try {
    res = await GET(weekAllCacheOnlyRequest());
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.equal(res.status, 200, 'fresh process children satisfy the read with no durable access');
  const json = await res.json();
  assert.equal(json.meta.cache, 'hit');
  assert.equal(json.items.length, 2);
});

test('week+all: an EXPIRED process child with no durable row is not served as a fresh hit (finding 1)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token'; // make the read non-admin
  // Both partitions have ONLY an expired process entry and NO durable backing — an
  // expired process entry is absence (not a fresh hit), so this is a full miss.
  seedProcessChild('regular', ['stale-reg'], Date.now() - 10 * 60 * 60 * 1000);
  seedProcessChild('postseason', ['stale-post'], Date.now() - 10 * 60 * 60 * 1000);
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 503, 'expired process-only children are a miss, not a stale hit');
  assert.match(String((await res.json()).error ?? ''), /admin refresh required/i);
});

test('week+all: an empty legacy postseason partition does not make a fresh regular view stale (finding 2)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token'; // non-admin: a stale view would be flagged rebuildRequired
  // A pre-split aggregate holding ONLY regular rows (normal before postseason), with
  // an OLD timestamp; a FRESH regular child supersedes it and postseason has no rows.
  await seedLegacyAggregate(
    [{ id: 'leg-reg', seasonType: 'regular' }],
    Date.now() - 10 * 60 * 60 * 1000
  );
  await seedChild('regular', ['fresh-reg'], Date.now());
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.meta.cache, 'hit');
  assert.notEqual(
    json.meta.stale,
    true,
    'the empty legacy postseason must not drag the fresh regular view stale'
  );
  assert.notEqual(json.meta.rebuildRequired, true);
  assert.deepEqual(
    json.items.map((i: { id: string }) => i.id),
    ['fresh-reg'],
    'the fresh regular child is served; the empty legacy postseason contributes nothing'
  );
});

test('week+all: an empty legacy regular partition does not make a fresh postseason view stale (finding 2 symmetric)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  process.env.ADMIN_API_TOKEN = 'admin-token';
  await seedLegacyAggregate(
    [{ id: 'leg-post', seasonType: 'postseason' }],
    Date.now() - 10 * 60 * 60 * 1000
  );
  await seedChild('postseason', ['fresh-post'], Date.now());
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.notEqual(json.meta.stale, true);
  assert.deepEqual(
    json.items.map((i: { id: string }) => i.id),
    ['fresh-post'],
    'the fresh postseason child is served; the empty legacy regular contributes nothing'
  );
});

test('week+all: a legacy aggregate with only regular rows composes to a regular-only view (finding 2)', async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  const legacyAt = Date.now() - 30 * 60 * 1000; // 30 min ago — still within TTL
  await seedLegacyAggregate([{ id: 'leg-reg', seasonType: 'regular' }], legacyAt);
  setMockFetch(async () => {
    throw new Error('composed read must not call upstream');
  });
  const res = await GET(weekAllCacheOnlyRequest());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.meta.cache, 'hit');
  assert.deepEqual(
    json.items.map((i: { id: string }) => i.id),
    ['leg-reg']
  );
  // The empty postseason extraction adds NO resolution, so freshness is the legacy
  // regular partition's own (fresh) timestamp — not a stale placeholder.
  assert.equal(new Date(json.meta.generatedAt).getTime(), legacyAt);
  assert.notEqual(json.meta.stale, true);
});
