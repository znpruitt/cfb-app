import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { yearScope } from '../../../../../lib/providerRefreshScope.ts';

// ---------------------------------------------------------------------------
// PLATFORM-071 — cron season-transition must invalidate standings for each
// league it flips preseason → season (preseason owner list → live standings).
// Previously it wrote status/year but left warm standings snapshots stale
// (documented gap).
//
// The success path drives the transition from a seeded schedule-probe with a
// past firstGameDate; the upstream CFBD fetch is stubbed (empty schedule) so the
// test is deterministic regardless of whether a real CFBD_API_KEY is present,
// and the seeded probe alone satisfies the transition time gate.
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret';
const YEAR = 2023;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

// Neutralize the upstream CFBD fetch so the test is deterministic (no real
// network, no quota use). Returning an empty schedule leaves the seeded
// past-firstGameDate probe as the sole driver of the transition. `beforeEach`
// sets CFBD_API_KEY so the route (which reads the key at call time) actually
// invokes this stub.
function stubFetchEmptySchedule(): void {
  globalThis.fetch = (async () =>
    new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

// Mock CFBD so `regular` and `postseason` partitions can be controlled
// independently by `?seasonType=`. Each arg is either a JSON body string or the
// literal 'throw' to simulate a fetch failure for that partition.
function stubFetchBySeasonType(regular: string | 'throw', postseason: string | 'throw'): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const seasonType = url.searchParams.get('seasonType');
    const body = seasonType === 'postseason' ? postseason : regular;
    if (body === 'throw') {
      return new Response('upstream unavailable', { status: 503 });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function game(
  week: number,
  home: string,
  away: string,
  startDate: string
): Record<string, unknown> {
  return {
    id: `${week}-${home}-${away}`,
    week,
    home_team: home,
    away_team: away,
    start_date: startDate,
    completed: false,
  };
}

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: YEAR,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seedPastProbe(): Promise<void> {
  // baseCachedAt set + firstGameDate in the past → the transition time gate
  // (now >= firstGame − 1 day) is satisfied.
  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: '2023-01-01T00:00:00.000Z',
    firstGameDate: '2023-08-26T00:00:00.000Z',
  });
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-transition', { headers });
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

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  // The route now reads CFBD_API_KEY at call time, so a set key lets the mocked
  // fetch actually run (partial/complete completeness tests depend on this).
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubFetchEmptySchedule();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

test('a completed transition invalidates standings for each transitioned league', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as { years: Array<{ transitioned: boolean; leagues: string[] }> };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.years[0]?.transitioned, true, 'alpha transitioned');
  assert.deepEqual(body.years[0]?.leagues, ['alpha']);
  assert.ok(tags.includes('standings:alpha'), 'transitioned league standings invalidated');

  // The transition actually happened (status is now season).
  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'season');
});

test('an all-empty schedule probe resolves the attempt as a no-op, not dangling in-progress (rereview finding #2)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // No probe seeded → shouldFetch is true; the stubbed fetch returns empty for
  // both partitions (valid absence — a future season not yet published).
  stubFetchEmptySchedule();

  const res = await GET(cronRequest());
  assert.equal(res.status, 200);

  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'no-op', 'all-empty probe resolves as a no-op');
  assert.notEqual(status.latestAttemptOutcome, 'in-progress', 'the attempt does not dangle');
  assert.equal(status.lastSuccessAt, null, 'a no-op does not advance last-success');
});

test('an empty cron probe OVER a populated prior-good schedule is rejected, not a silent no-op (6th-review finding #2)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Prior-good POPULATED schedule already cached for this year.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [
      {
        id: 'prior',
        week: 1,
        startDate: '2023-08-26T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Past firstGameDate → the transition gate WOULD fire if the probe were trusted.
  await seedPastProbe();
  // CFBD unexpectedly returns empty for BOTH partitions over the populated prior.
  stubFetchEmptySchedule();

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ transitioned: boolean; partialFailure?: boolean }>;
  };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.years[0]?.partialFailure, true, 'empty-over-populated is a partial failure');
  assert.equal(body.years[0]?.transitioned, false, 'the league must not flip off an empty probe');

  // Prior-good durable schedule retained (never overwritten with the empty probe).
  const stored = await getAppState<{ items: Array<{ id: string }> }>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good schedule retained');

  // The league stays preseason — no transition off the empty probe.
  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'preseason');

  // Status recorded as a FAILURE (same classification the schedule route uses),
  // not a clean no-op that would hide the empty replacement.
  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'schedule-empty-replacement-rejected');

  // No standings invalidation from the rejected empty probe.
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('a prior-cache read failure while classifying an empty probe resolves the attempt as failed, without transitioning (final-truthfulness finding #2)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Prior-good POPULATED schedule to prove retention.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [
      {
        id: 'prior',
        week: 1,
        startDate: '2023-08-26T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  await seedPastProbe();
  stubFetchEmptySchedule();

  // The prior durable SCHEDULE read used to classify the empty probe fails. Scoped
  // to 'schedule' so 'provider-refresh-status' / 'leagues' / 'schedule-probe'
  // reads still succeed (the attempt CAN be recorded; the probe still loads).
  __setAppStateReadFailureForTests(new Error('durable read boom'), 'schedule');

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  __setAppStateReadFailureForTests(null);

  const body = (await res.json()) as { error?: string };
  assert.equal(res.status, 500, JSON.stringify(body));
  assert.ok(body.error, 'the cron returns its established safe failure response');

  // The shared authority fails FAST (canonical-context-unavailable) when the prior
  // durable schedule cannot be read — BEFORE the lease or any provider-refresh
  // attempt. So no attempt is begun (none can dangle) and no false success is
  // recorded; the cron surfaces the store outage as a 500.
  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, null, 'fail-fast begins no attempt');
  assert.equal(status.lastSuccessAt, null, 'no false success recorded');

  // Prior-good durable schedule retained (nothing written on the read-failure path).
  const stored = await getAppState<{ items: Array<{ id: string }> }>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good schedule retained');

  // The league does NOT transition off an unverifiable probe.
  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'preseason');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('a schedule persistence failure resolves the attempt as failed, not dangling (rereview finding #2)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Regular returns a real game (postseason empty) so the commit path runs.
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2023-08-26T00:00:00.000Z')]),
    '[]'
  );

  // Fail only the durable 'schedule' write, so the best-effort status write (a
  // different scope) still persists the resolved failure.
  __setAppStateWriteFailureForTests(new Error('durable write unavailable'), 'schedule');
  let res: Response;
  try {
    res = await GET(cronRequest());
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(res.status, 500, 'a persistence failure surfaces as a 500');

  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed', 'the open attempt is resolved as failed');
  assert.equal(status.lastError?.code, 'schedule-durable-commit-failed');
});

test('an unauthorized request invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest('wrong-secret')));
  assert.equal(res.status, 401);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('no preseason leagues → invalidates nothing', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', { state: 'season', year: YEAR })]);

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  assert.equal(res.status, 200);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-085B — a transition schedule refresh must not commit partial or
// uncertain provider results as a complete fresh schedule.
// ---------------------------------------------------------------------------

test('a partial transition fetch (postseason fails) does not commit partial schedule as complete', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // No prior probe/schedule. Regular succeeds; postseason request fails.
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2099-09-01T00:00:00Z')]),
    'throw'
  );

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{
      probed: boolean;
      cached: boolean;
      transitioned: boolean;
      partialFailure?: boolean;
      failedSeasonTypes?: string[];
    }>;
  };
  assert.equal(res.status, 200, JSON.stringify(body));

  const yr = body.years[0]!;
  assert.equal(yr.probed, true);
  assert.equal(yr.cached, false, 'partial data not committed');
  assert.equal(yr.partialFailure, true);
  assert.deepEqual(yr.failedSeasonTypes, ['postseason']);
  assert.equal(yr.transitioned, false);

  // Neither the durable schedule nor the probe were written from partial data.
  assert.equal(await getAppState('schedule', `${YEAR}-all-all`), null);
  assert.equal(await getAppState('schedule-probe', String(YEAR)), null);

  // No standings invalidation from an incomplete refresh.
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

test('a partial transition fetch retains prior-good durable schedule', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Prior-good COMPLETE schedule already cached.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: 1,
    items: [
      {
        id: 'prior',
        week: 1,
        startDate: '2099-09-01T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  // Probe with firstGameDate=null → shouldFetch=true but the transition gate
  // (needs a firstGameDate) does not fire, isolating the retain-on-partial path.
  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: '2023-01-01T00:00:00.000Z',
    firstGameDate: null,
  });

  // Regular succeeds with a DIFFERENT game; postseason fails → incomplete.
  stubFetchBySeasonType(
    JSON.stringify([game(2, 'Ohio State', 'Michigan', '2099-10-01T00:00:00Z')]),
    'throw'
  );

  const { result: res } = await runCapturingTags(() => GET(cronRequest()));
  assert.equal(res.status, 200);

  // Prior-good schedule is intact — NOT overwritten with the partial regular-only fetch.
  const stored = await getAppState<{ items: Array<{ id: string }> }>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.length, 1);
  assert.equal(stored?.value?.items?.[0]?.id, 'prior', 'prior-good schedule retained');
});

test('a nonempty payload that normalizes to zero rows is treated as uncertainty (schema drift)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Regular returns a NONEMPTY payload whose rows all fail to map (missing
  // home_team) → schema drift; postseason returns a valid EMPTY payload.
  stubFetchBySeasonType(JSON.stringify([{ week: 1, away_team: 'Rice' }]), JSON.stringify([]));

  const { result: res } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ cached: boolean; partialFailure?: boolean; failedSeasonTypes?: string[] }>;
  };
  assert.equal(res.status, 200);
  assert.equal(body.years[0]?.cached, false);
  assert.equal(body.years[0]?.partialFailure, true);
  assert.deepEqual(body.years[0]?.failedSeasonTypes, ['regular']);
  assert.equal(await getAppState('schedule', `${YEAR}-all-all`), null);
});

test('a complete transition fetch commits durable schedule and probe', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Both partitions succeed: regular has a future game; postseason is legitimately
  // empty (valid absence before bowl season).
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2099-09-01T00:00:00Z')]),
    JSON.stringify([])
  );

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ cached: boolean; partialFailure?: boolean; transitioned: boolean }>;
  };
  assert.equal(res.status, 200);
  assert.equal(body.years[0]?.cached, true, 'complete schedule committed');
  assert.notEqual(body.years[0]?.partialFailure, true);

  // Durable schedule + probe written from the complete fetch.
  const stored = await getAppState<{ items: unknown[] }>('schedule', `${YEAR}-all-all`);
  assert.equal(stored?.value?.items?.length, 1);
  const probe = await getAppState<{ firstGameDate: string | null }>('schedule-probe', String(YEAR));
  assert.equal(probe?.value?.firstGameDate, '2099-09-01T00:00:00.000Z');

  // A fresh schedule COMMIT now invalidates canonical standings for the year via
  // the shared authority (PLATFORM-086E1A closes the old gap where a transition
  // schedule write left standings stale). Future first game → no transition flip.
  assert.equal(body.years[0]?.transitioned, false);
  assert.ok(
    tags.includes('standings:alpha:2023'),
    'fresh schedule commit invalidates year standings'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086E1A — the cron drives the shared full-season authority: exactly one
// regular/postseason fetch pair and one year-scoped attempt, and it never flips a
// league off a failed refresh even when the transition time gate is satisfied.
// ---------------------------------------------------------------------------

test('season-transition drives one shared attempt and one regular/postseason fetch pair', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // No probe → shouldFetch true. Count exactly which season types are requested.
  const seenSeasonTypes: string[] = [];
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    seenSeasonTypes.push(url.searchParams.get('seasonType') ?? '');
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  await GET(cronRequest());

  assert.deepEqual(
    [...seenSeasonTypes].sort(),
    ['postseason', 'regular'],
    'exactly one fetch per required partition'
  );
  // A single year-scoped attempt was recorded (a valid-empty no-op here).
  const status = await getProviderRefreshStatus('schedule', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'no-op', 'one year-scoped attempt, resolved once');
});

test('season-transition does not flip a league off a failed refresh even past the first-game gate', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  // Past firstGameDate → the transition time gate WOULD fire if the probe were
  // trusted. But the refresh fails (postseason partition fails), so the league must
  // NOT flip off unconfirmed data.
  await seedPastProbe();
  stubFetchBySeasonType(
    JSON.stringify([game(1, 'Texas', 'Rice', '2023-08-26T00:00:00.000Z')]),
    'throw'
  );

  const { result: res, tags } = await runCapturingTags(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ partialFailure?: boolean; transitioned: boolean; failedSeasonTypes?: string[] }>;
  };
  assert.equal(res.status, 200);
  assert.equal(body.years[0]?.partialFailure, true);
  assert.deepEqual(body.years[0]?.failedSeasonTypes, ['postseason']);
  assert.equal(body.years[0]?.transitioned, false, 'no flip off a failed refresh');

  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'preseason');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086E1B1 — pin the season-transition `shouldFetch` policy the weekly
// route's preseason handoff mirrors: the DAILY transition cron fetches when the
// probe is unarmed (`!baseCachedAt`), the first game is unknown
// (`!firstGameDate`), or `now >= firstGameDate − 7d` — and does NOT fetch in
// cache-armed early preseason (that window is E1B's ordinary weekly maintenance).
// ---------------------------------------------------------------------------

test('shouldFetch pins: unarmed probe, unknown first game, and final-week all fetch; early preseason does not', async () => {
  const cases: Array<{
    name: string;
    probe: { baseCachedAt: string | null; firstGameDate: string | null } | null;
    probed: boolean;
  }> = [
    { name: 'no probe record', probe: null, probed: true },
    {
      name: 'missing baseCachedAt',
      probe: { baseCachedAt: null, firstGameDate: '2099-08-28T16:00:00.000Z' },
      probed: true,
    },
    {
      name: 'missing firstGameDate',
      probe: { baseCachedAt: '2023-01-01T00:00:00.000Z', firstGameDate: null },
      probed: true,
    },
    {
      name: 'inside the final seven days',
      probe: {
        baseCachedAt: '2023-01-01T00:00:00.000Z',
        // 3 days from the real clock → now >= firstGame − 7d.
        firstGameDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      probed: true,
    },
    {
      name: 'cache-armed early preseason (E1B-owned window)',
      probe: {
        baseCachedAt: '2023-01-01T00:00:00.000Z',
        firstGameDate: '2099-08-28T16:00:00.000Z', // far future → > 7 days away
      },
      probed: false,
    },
  ];

  for (const { name, probe, probed } of cases) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('leagues', 'registry', [
      makeLeague('alpha', { state: 'preseason', year: YEAR }),
    ]);
    if (probe) {
      await setAppState('schedule-probe', String(YEAR), { year: YEAR, ...probe });
    }
    stubFetchEmptySchedule();

    const res = await GET(cronRequest());
    const body = (await res.json()) as { years: Array<{ probed: boolean }> };
    assert.equal(res.status, 200, name);
    assert.equal(body.years[0]?.probed, probed, `shouldFetch pin: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086E1C2 — automatic presentation wiring (trigger: 'season-transition').
// A qualifying populated E1A success invokes the REAL E1C1 authority once per
// year AFTER probe/lifecycle/standings work; every other path invokes nothing;
// presentation faults never block or roll back lifecycle truth.
// ---------------------------------------------------------------------------

const presentationLog: string[] = [];

/** Numeric-id game row so committed items yield canonical provider game ids. */
function numericGame(year: number, startDate: string): Record<string, unknown> {
  return {
    id: year * 10 + 1,
    week: 1,
    home_team: 'Texas',
    away_team: 'Rice',
    start_date: startDate,
    home_conference: 'Big 12',
    away_conference: 'American',
  };
}

/**
 * Presentation-aware CFBD stub: `/games` per season type, `/games/media` and
 * `/venues` tracked in `presentationLog` (default empty payloads).
 */
function stubProviderWithPresentation(params: {
  regular: string | 'throw';
  postseason: string | 'throw';
  media?: string | 'throw';
}): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/games/media') {
      presentationLog.push(`media:${url.searchParams.get('year')}`);
      const body = params.media ?? '[]';
      if (body === 'throw') throw new Error('stub: media network down');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/venues') {
      presentationLog.push('venues');
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const seasonType = url.searchParams.get('seasonType');
    const body = seasonType === 'postseason' ? params.postseason : params.regular;
    if (body === 'throw') return new Response('upstream unavailable', { status: 503 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/** Capture the authority's `schedule-presentation-refresh` console events. */
async function runCapturingPresentation<T>(fn: () => Promise<T>): Promise<{
  result: T;
  tags: string[];
  pEvents: Array<{ trigger: string; year: number; media: { reason: string } }>;
}> {
  const originalLog = console.log;
  const pEvents: Array<{ trigger: string; year: number; media: { reason: string } }> = [];
  console.log = ((...args: unknown[]) => {
    const line = args.map((a) => String(a)).join(' ');
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'schedule-presentation-refresh') {
        pEvents.push(parsed as (typeof pEvents)[number]);
      }
    } catch {
      // Non-JSON console output — ignored.
    }
  }) as typeof console.log;
  try {
    const { result, tags } = await runCapturingTags(fn);
    return { result, tags, pEvents };
  } finally {
    console.log = originalLog;
  }
}

// 17 + 18 + 27 — a qualifying populated success invokes presentation once with
// trigger 'season-transition', after the probe update and lifecycle flip.
test('a qualifying transition success invokes presentation once after lifecycle work', async () => {
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  // Populated refresh whose first game is in the past → probe re-derived, the
  // transition gate fires, and the year qualifies for presentation.
  stubProviderWithPresentation({
    regular: JSON.stringify([numericGame(YEAR, '2023-08-26T00:00:00.000Z')]),
    postseason: '[]',
    media: JSON.stringify([{ id: YEAR * 10 + 1, mediaType: 'tv', outlet: 'ESPN' }]),
  });

  const { result: res, tags, pEvents } = await runCapturingPresentation(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ cached: boolean; transitioned: boolean; leagues: string[] }>;
  };
  assert.equal(res.status, 200);
  assert.equal(body.years[0]?.cached, true);
  assert.equal(body.years[0]?.transitioned, true, 'the lifecycle flip happened');
  assert.ok(tags.includes('standings:alpha'), 'standings invalidated');

  assert.deepEqual(presentationLog, [`media:${YEAR}`, 'venues'], 'one presentation pass');
  assert.equal(pEvents.length, 1, 'exactly one presentation event');
  assert.equal(pEvents[0]!.trigger, 'season-transition');
  assert.equal(pEvents[0]!.year, YEAR);
  assert.equal(pEvents[0]!.media.reason, 'written-clean');

  // The probe reflects the committed schedule (updated BEFORE presentation).
  const probe = await getAppState<{ firstGameDate: string | null }>('schedule-probe', String(YEAR));
  assert.equal(probe?.value?.firstGameDate, '2023-08-26T00:00:00.000Z');
});

// 19 + 26 — presentation failure never blocks the transition, year sync,
// standings invalidation, or the CronResult contract.
test('a presentation failure does not block a due transition or change the response', async () => {
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubProviderWithPresentation({
    regular: JSON.stringify([numericGame(YEAR, '2023-08-26T00:00:00.000Z')]),
    postseason: '[]',
    media: 'throw',
  });

  const { result: res, tags, pEvents } = await runCapturingPresentation(() => GET(cronRequest()));
  const body = (await res.json()) as {
    years: Array<{ transitioned: boolean; partialFailure?: boolean }>;
    error?: string;
  };
  assert.equal(res.status, 200, 'HTTP status unchanged');
  assert.equal(body.years[0]?.transitioned, true, 'the flip still happened');
  assert.equal(body.years[0]?.partialFailure, undefined, 'no fabricated partialFailure');
  assert.equal(body.error, undefined, 'no fabricated error');
  assert.ok(tags.includes('standings:alpha'), 'standings invalidation intact');
  assert.equal(pEvents[0]!.media.reason, 'provider-fetch-failed');

  const leagues = await getAppState<League[]>('leagues', 'registry');
  assert.equal(leagues?.value?.[0]?.status?.state, 'season', 'league year/state synced');
});

// 20 — multiple leagues sharing one year → presentation once for that year.
test('multiple leagues sharing a year invoke presentation once', async () => {
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeLeague('beta', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubProviderWithPresentation({
    regular: JSON.stringify([numericGame(YEAR, '2023-08-26T00:00:00.000Z')]),
    postseason: '[]',
  });
  const { pEvents } = await runCapturingPresentation(() => GET(cronRequest()));
  assert.deepEqual(
    presentationLog.filter((entry) => entry.startsWith('media:')),
    [`media:${YEAR}`],
    'one media call for the shared year'
  );
  assert.equal(pEvents.length, 1);
});

// 21 — distinct successful years invoke presentation once per year.
test('distinct successful years invoke presentation once each', async () => {
  presentationLog.length = 0;
  const otherYear = YEAR + 1;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    { ...makeLeague('gamma', { state: 'preseason', year: otherYear }), year: otherYear },
  ]);
  // No probes → both years fetch (discovery). Future first games → no flips,
  // but both years still qualify for presentation.
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/games/media') {
      presentationLog.push(`media:${url.searchParams.get('year')}`);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/venues') {
      presentationLog.push('venues');
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const year = Number(url.searchParams.get('year'));
    const seasonType = url.searchParams.get('seasonType');
    const body =
      seasonType === 'postseason'
        ? '[]'
        : JSON.stringify([numericGame(year, `${year + 1}-08-26T00:00:00.000Z`)]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { pEvents } = await runCapturingPresentation(() => GET(cronRequest()));
  assert.deepEqual(
    presentationLog.filter((entry) => entry.startsWith('media:')).sort(),
    [`media:${YEAR}`, `media:${otherYear}`],
    'one media call per successful year'
  );
  assert.equal(pEvents.length, 2);
  assert.ok(pEvents.every((event) => event.trigger === 'season-transition'));
});

// 22/23/24/25 — every non-qualifying path performs NO presentation work.
test('non-qualifying season-transition paths never invoke presentation', async () => {
  // (22) shouldFetch false — armed probe, first game far in the future.
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: '2023-01-01T00:00:00.000Z',
    firstGameDate: '2099-08-26T00:00:00.000Z',
  });
  stubProviderWithPresentation({ regular: 'throw', postseason: 'throw' });
  let captured = await runCapturingPresentation(() => GET(cronRequest()));
  assert.equal((captured.result as Response).status, 200);
  assert.equal(presentationLog.length, 0, 'shouldFetch=false spends nothing');
  assert.equal(captured.pEvents.length, 0);

  // (23) no preseason leagues.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [makeLeague('done', { state: 'season', year: YEAR })]);
  captured = await runCapturingPresentation(() => GET(cronRequest()));
  assert.equal(presentationLog.length, 0);
  assert.equal(captured.pEvents.length, 0);

  // (24) authentication failure.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  captured = await runCapturingPresentation(() => GET(cronRequest('wrong-secret')));
  assert.equal((captured.result as Response).status, 401);
  assert.equal(presentationLog.length, 0);

  // (25a) E1A failure (postseason partition down).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  stubProviderWithPresentation({
    regular: JSON.stringify([numericGame(YEAR, '2023-08-26T00:00:00.000Z')]),
    postseason: 'throw',
  });
  captured = await runCapturingPresentation(() => GET(cronRequest()));
  assert.equal(presentationLog.length, 0, 'an E1A failure never triggers presentation');

  // (25b) a valid empty-response no-op (both partitions genuinely empty).
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  stubProviderWithPresentation({ regular: '[]', postseason: '[]' });
  captured = await runCapturingPresentation(() => GET(cronRequest()));
  assert.equal(presentationLog.length, 0, 'an empty-response no-op never triggers presentation');

  // (25c) stale observation — durable schedule observed in the future.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now() + 1_000_000_000,
    items: [
      {
        id: String(YEAR * 10 + 1),
        week: 1,
        startDate: '2023-08-26T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        homeConference: 'Big 12',
        awayConference: 'American',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  stubProviderWithPresentation({
    regular: JSON.stringify([numericGame(YEAR, '2023-08-26T00:00:00.000Z')]),
    postseason: '[]',
  });
  captured = await runCapturingPresentation(() => GET(cronRequest()));
  assert.equal(presentationLog.length, 0, 'a stale observation never triggers presentation');

  // (25d) E1A lease contention.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  presentationLog.length = 0;
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  const { acquireScheduleRefreshLease } = await import(
    '../../../../../lib/schedule/scheduleRefreshLease.ts'
  );
  const lease = await acquireScheduleRefreshLease({ year: YEAR, now: Date.now() });
  assert.ok(lease.acquired);
  stubProviderWithPresentation({
    regular: JSON.stringify([numericGame(YEAR, '2023-08-26T00:00:00.000Z')]),
    postseason: '[]',
  });
  captured = await runCapturingPresentation(() => GET(cronRequest()));
  assert.equal(presentationLog.length, 0, 'lease contention never triggers presentation');
});
