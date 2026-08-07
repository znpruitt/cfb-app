import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET, POST } from '../route';
import type { League } from '../../../../../lib/league.ts';
import type {
  ManualRolloverPreviewResponse,
  ManualRolloverStatusResponse,
} from '../../../../../lib/manualRollover.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../../../../lib/server/teamDatabaseStore.ts';
import { saveSeasonArchive } from '../../../../../lib/seasonArchive.ts';
import { buildSeasonArchive } from '../../../../../lib/seasonRollover.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the admin rollover route is narrowed to explicit per-year
// operation behind the SAME strict eligibility authority as the automatic cron
// (`resolveNationalChampionshipRollover`), with shared target grouping
// (`groupRolloverTargets`): status.year-only targeting and mandatory gate
// re-evaluation on every POST.
//
// PLATFORM-086F2H3A — the route is now PREVIEW-ONLY. Execution moved entirely to
// `GET /api/cron/season-rollover`, so the archive-first two-stage execution and
// partial-failure reporting this file used to cover live in that route's suite.
// What remains here is status, preview, and the refusal of the retired verb.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

function makeLeague(
  slug: string,
  year: number,
  status?: League['status'],
  extra: Partial<League> = {}
): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
    ...extra,
  };
}

async function seedTeams(): Promise<void> {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2023-01-01T00:00:00.000Z',
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
}

// Seed a schedule cache containing a STRUCTURED CFP national-championship game
// plus an attached score for `year`. Mirrors the season-rollover cron fixture.
async function seedYearChampionship(
  year: number,
  champDate: string,
  options: { final?: boolean; structured?: boolean; scoreStatus?: string; withScore?: boolean } = {}
): Promise<void> {
  const final = options.final ?? true;
  const structured = options.structured ?? true;
  const withScore = options.withScore ?? true;
  await setAppState('schedule', `${year}-all-all`, {
    items: [
      {
        id: `${year}0101`,
        week: 15,
        startDate: champDate,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Alpha U',
        awayTeam: 'Beta U',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'final',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        ...(structured
          ? {
              playoffRound: 'national_championship',
              playoffCompetition: 'College Football Playoff',
              playoffRoundSource: 'cfbd-structured',
            }
          : {}),
      },
    ],
  });
  if (withScore) {
    await setAppState('scores', `${year}-all-postseason`, {
      at: Date.parse(champDate) + 24 * 60 * 60 * 1000,
      source: 'cfbd',
      cfbdFallbackReason: 'none',
      items: [
        {
          id: `${year}0101`,
          seasonType: 'postseason',
          startDate: champDate,
          week: 15,
          status: options.scoreStatus ?? (final ? 'final' : 'in progress'),
          home: { team: 'Alpha U', score: final ? 34 : 14 },
          away: { team: 'Beta U', score: final ? 21 : 10 },
          time: null,
        },
      ],
    });
  }
}

function getRequest(token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/admin/rollover', { headers });
}

function postRequest(body: unknown, token: string | null = ADMIN_TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return new Request('https://example.com/api/admin/rollover', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
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

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ADMIN_API_TOKEN === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
  else MUTABLE_ENV.ADMIN_API_TOKEN = ORIGINAL_ADMIN_API_TOKEN;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

// 1 — authentication precedes every registry/cache read: with the durable
// store poisoned to fail ALL reads, an unauthorized request still returns the
// unchanged 401 auth failure (it never reached the store).
test('unauthorized GET/POST fail auth before any registry or cache work', async () => {
  __setAppStateReadFailureForTests(new Error('store must not be read before auth'));
  try {
    const getRes = await GET(getRequest(null));
    assert.equal(getRes.status, 401);
    const getBody = (await getRes.json()) as { error?: string };
    assert.equal(getBody.error, 'admin-token-required');

    const postRes = await POST(postRequest({ year: 2023, confirmed: false }, 'wrong-token'));
    assert.equal(postRes.status, 401);
    const postBody = (await postRes.json()) as { error?: string };
    assert.equal(postBody.error, 'admin-token-invalid');
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

// 2 + 6 — per-year grouping by status.year, ascending, evaluated independently;
// the eligible year carries championship/rollover dates; leagues are sanitized.
test('GET groups active years independently by status.year, ascending', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    // Registered newest-year first to prove ascending output ordering.
    makeLeague('charlie', 2025, { state: 'season', year: 2025 }),
    makeLeague(
      'alpha',
      2023,
      { state: 'season', year: 2023 },
      { passwordHash: 'h', passwordSalt: 's' }
    ),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z'); // final, long past → eligible
  await seedYearChampionship(2025, '2025-01-06T00:00:00.000Z', { final: false }); // not final

  const res = await GET(getRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as ManualRolloverStatusResponse;
  assert.equal(typeof body.generatedAt, 'string');
  assert.deepEqual(
    body.years.map((y) => ({ year: y.year, eligibility: y.eligibility, reason: y.reason })),
    [
      { year: 2023, eligibility: 'eligible', reason: null },
      { year: 2025, eligibility: 'not-eligible', reason: 'not-final' },
    ]
  );
  const eligible = body.years[0]!;
  assert.equal(eligible.championshipDate, '2023-01-09T00:00:00.000Z');
  assert.equal(
    eligible.rolloverDate,
    new Date(Date.parse('2023-01-09T00:00:00.000Z') + 7 * 24 * 60 * 60 * 1000).toISOString()
  );
  assert.deepEqual(
    eligible.leagues.map((l) => l.slug),
    ['alpha']
  );
  const sanitized = eligible.leagues[0] as Record<string, unknown>;
  assert.ok(!('passwordHash' in sanitized), 'credential fields never cross the API boundary');
  assert.ok(!('passwordSalt' in sanitized));
});

// 3 — the top-level league.year (deliberately wrong) never changes the target.
test('a desynchronized top-level league.year never changes the target year', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2010, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const res = await GET(getRequest());
  const body = (await res.json()) as ManualRolloverStatusResponse;
  assert.deepEqual(
    body.years.map((y) => y.year),
    [2023],
    'grouped by status.year, not league.year'
  );

  // POSTing the bogus top-level year is refused — it is not an active group.
  const post = await POST(postRequest({ year: 2010, confirmed: false }));
  assert.equal(post.status, 409);
  const postBody = (await post.json()) as { error?: string };
  assert.equal(postBody.error, 'rollover-year-not-active');
});

// 4 — offseason, preseason, missing-status, and test leagues are never targets.
test('GET excludes offseason, preseason, missing-status, and test leagues', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('off', 2023, { state: 'offseason' }),
    makeLeague('pre', 2023, { state: 'preseason', year: 2024 }),
    makeLeague('legacy', 2023),
    makeLeague('test', 2023, { state: 'season', year: 2023 }),
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const res = await GET(getRequest());
  const body = (await res.json()) as ManualRolloverStatusResponse;
  assert.equal(body.years.length, 1);
  assert.deepEqual(
    body.years[0]!.leagues.map((l) => l.slug),
    ['alpha'],
    'only the non-test season league is a target'
  );
});

// 5 — no active season groups is a truthful empty response.
test('GET with no production league in season → 200 { years: [] }', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('off', 2023, { state: 'offseason' }),
    makeLeague('test', 2023, { state: 'season', year: 2023 }),
  ]);

  const res = await GET(getRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as ManualRolloverStatusResponse;
  assert.deepEqual(body.years, []);
});

// PLATFORM-086F2H3A — PRODUCTION-ONLY, proven positively. The panel's empty
// state ("No production leagues are waiting for rollover") is truthful only if
// the demo league can never reach it. `groupRolloverTargets` excludes the demo
// upstream, so no filtering was added for the UI — this pins that the exclusion
// really is what makes the panel production-only.
//
// The negative half is paired with a positive control on the SAME fixture: a
// production league in season DOES appear. Without it, an empty `years` array
// would be indistinguishable from a broken fixture.
test('F2H3A: an in-season DEMO league is absent from the status the panel renders', async () => {
  await seedTeams();
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  await setAppState('leagues', 'registry', [
    makeLeague('test', 2023, { state: 'season', year: 2023 }),
  ]);
  const demoOnly = await GET(getRequest());
  const demoBody = (await demoOnly.json()) as ManualRolloverStatusResponse;
  assert.equal(demoOnly.status, 200);
  assert.deepEqual(demoBody.years, [], 'the demo alone yields no rollover target');
  assert.ok(
    !JSON.stringify(demoBody).includes('"test"'),
    'the demo slug never rides out to the panel'
  );

  // POSITIVE CONTROL — same fixture plus a production league in season.
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2023, { state: 'season', year: 2023 }),
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  const withProd = await GET(getRequest());
  const prodBody = (await withProd.json()) as ManualRolloverStatusResponse;
  assert.deepEqual(
    prodBody.years.flatMap((y) => y.leagues.map((l) => l.slug)),
    ['alpha'],
    'production is rendered; the demo beside it still is not'
  );
});

// 7 — every gate refusal maps to its exact stable reason.
test('GET maps each gate refusal to its exact stable reason', async () => {
  await seedTeams();

  const cases: Array<{
    year: number;
    reason: string;
    seed: (year: number) => Promise<void>;
  }> = [
    { year: 2019, reason: 'no-season-schedule', seed: async () => {} },
    {
      year: 2020,
      reason: 'no-structured-championship',
      seed: (y) => seedYearChampionship(y, '2020-01-06T00:00:00.000Z', { structured: false }),
    },
    {
      year: 2021,
      reason: 'score-missing',
      seed: (y) => seedYearChampionship(y, '2021-01-06T00:00:00.000Z', { withScore: false }),
    },
    {
      year: 2022,
      reason: 'not-final',
      seed: (y) => seedYearChampionship(y, '2022-01-06T00:00:00.000Z', { final: false }),
    },
    {
      year: 2023,
      reason: 'disrupted',
      seed: (y) => seedYearChampionship(y, '2023-01-06T00:00:00.000Z', { scoreStatus: 'canceled' }),
    },
    {
      year: 2024,
      reason: 'waiting-period',
      seed: (y) =>
        seedYearChampionship(y, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()),
    },
  ];

  await setAppState(
    'leagues',
    'registry',
    cases.map((c) => makeLeague(`league-${c.year}`, c.year, { state: 'season', year: c.year }))
  );
  for (const c of cases) await c.seed(c.year);

  const res = await GET(getRequest());
  const body = (await res.json()) as ManualRolloverStatusResponse;
  assert.deepEqual(
    body.years.map((y) => ({ year: y.year, eligibility: y.eligibility, reason: y.reason })),
    cases.map((c) => ({ year: c.year, eligibility: 'not-eligible', reason: c.reason }))
  );
});

// 8 — a durable read failure is `unavailable`, never ordinary ineligibility;
// POST refuses with 503 and performs no preview/archive/status work.
test('durable eligibility read failure → GET unavailable, POST 503, no work', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');
  const registryBefore = await readRegistry();

  __setAppStateReadFailureForTests(new Error('schedule store outage'), 'schedule');
  try {
    const res = await GET(getRequest());
    const body = (await res.json()) as ManualRolloverStatusResponse;
    assert.deepEqual(
      body.years.map((y) => ({ eligibility: y.eligibility, reason: y.reason })),
      [{ eligibility: 'unavailable', reason: 'read-failed' }]
    );
    // Raw thrown-error text is never exposed.
    assert.ok(!JSON.stringify(body).includes('schedule store outage'));

    const post = await POST(postRequest({ year: 2023 }));
    assert.equal(post.status, 503);
    const postBody = (await post.json()) as { error?: string; reason?: string };
    assert.equal(postBody.error, 'rollover-eligibility-unavailable');
    assert.equal(postBody.reason, 'read-failed');
  } finally {
    __setAppStateReadFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), registryBefore, 'no status mutation');
  assert.equal(await getAppState('standings-archive:alpha', '2023'), null, 'no archive written');
});

// 9 — strict body validation.
test('POST validates body shape: malformed JSON, year, and confirmed → 400', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);

  // `{ year: 2023 }` is deliberately ABSENT: since F2H3A a bare year is the
  // valid preview body. `confirmed` is optional, and only a non-boolean value
  // is a shape error — `true` is a well-formed request for a retired
  // capability, so it answers 409, not 400 (covered separately below).
  const cases: unknown[] = [
    'not-json{',
    {},
    { confirmed: false },
    { year: '2023' },
    { year: 2023.5 },
    { year: 1200 },
    { year: 2023, confirmed: 'yes' },
  ];
  for (const body of cases) {
    const res = await POST(postRequest(body));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    const parsed = (await res.json()) as { error?: string };
    assert.equal(parsed.error, 'rollover-invalid-request');
  }
});

// 10 — a year without a current non-test season group is refused.
test('POST for an inactive year → 409 rollover-year-not-active', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('off', 2022, { state: 'offseason' }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  for (const year of [2022, 2024]) {
    const res = await POST(postRequest({ year }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'rollover-year-not-active');
  }
});

// 11 — an ineligible year refuses preview with the exact stable reason, and
// mutates nothing. The gate still guards preview after F2H3A: an operator must
// not inspect a "final" archive for a season that is not final.
test('an ineligible year refuses preview → 409 rollover-not-eligible, no mutation', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-06T00:00:00.000Z', { final: false });
  const registryBefore = await readRegistry();

  const { tags } = await runCapturingTags(async () => {
    const res = await POST(postRequest({ year: 2023 }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string; reason?: string };
    assert.equal(body.error, 'rollover-not-eligible');
    assert.equal(body.reason, 'not-final');
  });

  assert.deepEqual(await readRegistry(), registryBefore);
  assert.equal(await getAppState('standings-archive:alpha', '2023'), null);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// 12 — preview builds only the requested lifecycle-year group and writes
// nothing.
//
// THE OBSERVER MUST BE PROVEN. Before F2H3A the `standings-archive:<slug>`
// observer below was kept honest by the confirmed-execution test, which was the
// only thing in this file that ever wrote an archive. Retiring execution deleted
// it, so a bare `=== null` assertion here would pass even against a misspelled
// scope key — exactly the blind-observer defect R4 shipped and caught
// (`archive:<slug>` vs `standings-archive:<slug>`).
//
// The control is now built in: an archive is written through the REAL writer
// (`saveSeasonArchive`, so the scope key is derived by production code and not
// by this test), asserted visible, and then asserted BYTE-IDENTICAL after the
// preview. That also strengthens the claim from "no archive was created" to "no
// archive was created OR modified" — the stronger property, since preview reads
// an existing archive to build its diff.
test('preview touches only the requested year group and performs no durable write', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('bravo', 2024, { state: 'season', year: 2024 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');
  await seedYearChampionship(2024, '2024-01-08T00:00:00.000Z');

  // POSITIVE CONTROL — write a real archive and prove this observer sees it.
  await runCapturingTags(async () => {
    await saveSeasonArchive(await buildSeasonArchive('alpha', 2023));
  });
  const archiveBefore = await getAppState('standings-archive:alpha', '2023');
  assert.notEqual(archiveBefore, null, 'the observer can see an archive that exists');

  const registryBefore = await readRegistry();

  const res = await POST(postRequest({ year: 2023 }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as ManualRolloverPreviewResponse;
  assert.equal(body.preview.year, 2023);
  assert.deepEqual(
    body.preview.leagues.map((l) => l.leagueSlug),
    ['alpha'],
    'only the requested year group is previewed'
  );
  assert.equal(
    body.preview.leagues[0]!.hasExistingArchive,
    true,
    'the preview READ the seeded archive — the write path below is the only one under test'
  );

  assert.deepEqual(await readRegistry(), registryBefore, 'no durable mutation');
  assert.deepEqual(
    await getAppState('standings-archive:alpha', '2023'),
    archiveBefore,
    'the existing archive is byte-identical — preview neither rewrote nor refreshed it'
  );
  assert.equal(
    await getAppState('standings-archive:bravo', '2024'),
    null,
    'and no archive was created for the untouched sibling year'
  );
});

// 13 — the gate is re-evaluated on EVERY preview. An earlier successful preview
// is never a cached authorization: a degraded gate refuses the next one.
test('a previous successful preview does not survive the gate degrading', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const first = await POST(postRequest({ year: 2023 }));
  assert.equal(first.status, 200, 'the gate was open');

  __setAppStateReadFailureForTests(new Error('outage after preview'), 'schedule');
  try {
    const res = await POST(postRequest({ year: 2023 }));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'rollover-eligibility-unavailable');
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3A — manual rollover EXECUTION is retired. This route is
// preview-only; `GET /api/cron/season-rollover` is the sole executor.
// ---------------------------------------------------------------------------

// REGRESSION TEST — the retired verb is refused with its own stable code, and
// refused BEFORE any registry, championship, or archive work.
//
// The realistic caller is a browser still holding the pre-deploy bundle. Under
// a contract that merely IGNORED `confirmed`, that client would receive a
// PREVIEW body, decode it as an execute result, read `success` as `undefined`,
// and tell the operator a rollover was attempted and failed — when none was
// attempted. No write, but a false statement, which is the class this campaign
// exists to remove.
test('POST { confirmed: true } → 409 rollover-execution-retired, before any work', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');
  const registryBefore = await readRegistry();

  // Poison EVERY durable read: a request that reached the registry, the
  // championship gate, or the archive builder would fail differently. Passing
  // with the store dead is what proves the refusal precedes all of it.
  __setAppStateReadFailureForTests(new Error('store must not be touched'));
  let res: Response;
  try {
    const captured = await runCapturingTags(() =>
      POST(postRequest({ year: 2023, confirmed: true }))
    );
    res = captured.result;
    assert.deepEqual(
      captured.tags.filter((t) => t.startsWith('standings:')),
      [],
      'no invalidation'
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }

  assert.equal(
    res.status,
    409,
    'stored state does not prevent this — the server no longer offers it'
  );
  const body = (await res.json()) as { error?: string; detail?: string };
  assert.equal(body.error, 'rollover-execution-retired');
  assert.match(body.detail ?? '', /cron/, 'the operator is told who does execute');

  assert.deepEqual(await readRegistry(), registryBefore, 'no lifecycle write');
  assert.equal(await getAppState('standings-archive:alpha', '2023'), null, 'no archive');
});

// POSITIVE CONTROL for the test above — with the store healthy and the SAME
// fixture, an ordinary preview still returns 200. Without this, the 409 could
// be produced by any unrelated refusal on this fixture and the test would still
// pass.
test('F2H3A positive control: the same fixture previews normally without confirmed', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const res = await POST(postRequest({ year: 2023 }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as ManualRolloverPreviewResponse;
  assert.equal(body.preview.year, 2023);
});

// CONTRACT PIN — `confirmed: false` stays ACCEPTED. Only `true` is retired, so
// a client that still sends the old preview body is not broken by the change.
test('F2H3A contract pin: confirmed:false is still a valid preview request', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const res = await POST(postRequest({ year: 2023, confirmed: false }));
  assert.equal(res.status, 200, 'the retired value is `true`, not the field');
});

// before any championship/cache resolution.
test('R4 regression: a malformed registry refuses both verbs with a sanitized 409', async () => {
  await setAppState('leagues', 'registry', { alpha: 1, secret: 'HASH-CANARY' });
  await seedTeams();

  const getRes = await GET(getRequest());
  const getBody = (await getRes.json()) as { error?: string; detail?: string };
  assert.equal(getRes.status, 409, 'stored state prevents the operation');
  assert.equal(getBody.error, 'rollover-registry-malformed');
  assert.ok(!JSON.stringify(getBody).includes('HASH-CANARY'), 'the corrupt value never leaks');

  const { result: postRes, tags } = await runCapturingTags(() => POST(postRequest({ year: 2023 })));
  const postBody = (await postRes.json()) as { error?: string };
  assert.equal(postRes.status, 409);
  assert.equal(postBody.error, 'rollover-registry-malformed');
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    [],
    'no work ran'
  );
});

// REGRESSION TEST — GET reports valid groups AND the refusal count. A valid
// group stays fully usable when an unrelated unusable record coexists: the
// count reports the problem without withholding work an operator can do.
test('R4 regression: GET reports valid groups plus the refusal count', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('bad', 2024, { state: 'season', year: '2024' } as unknown as League['status']),
  ]);
  await seedTeams();
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const res = await GET(getRequest());
  const body = (await res.json()) as ManualRolloverStatusResponse;

  assert.equal(res.status, 200);
  assert.deepEqual(
    body.years.map((y) => y.year),
    [2023],
    'the valid group is still offered'
  );
  assert.equal(body.invalidLifecycleTargets, 1);
  assert.ok(!JSON.stringify(body).includes('2024'), 'the unusable value never rides out');
});

// REGRESSION TEST — a POST for a VALID group still previews with refusals
// present, and the absent-group case names the integrity condition instead of
// the (false) `rollover-year-not-active`.
test('R4 regression: POST previews a valid group and names the integrity refusal otherwise', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('bad', 2024, { state: 'season', year: '2024' } as unknown as League['status']),
  ]);
  await seedTeams();
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  // The requested year IS a valid group — preview proceeds normally.
  const { result: okRes } = await runCapturingTags(() => POST(postRequest({ year: 2023 })));
  const okBody = (await okRes.json()) as ManualRolloverPreviewResponse;
  assert.equal(okRes.status, 200);
  assert.equal(okBody.preview.year, 2023, 'a valid group previews normally');
  assert.equal(okBody.invalidLifecycleTargets, 1, 'and still reports the refusal');

  // The requested year has no group AND refusals exist → the stable integrity code.
  const badRes = await POST(postRequest({ year: 2024 }));
  const badBody = (await badRes.json()) as { error?: string; invalidLifecycleTargets?: number };
  assert.equal(badRes.status, 409);
  assert.equal(badBody.error, 'rollover-unusable-lifecycle-year');
  assert.equal(badBody.invalidLifecycleTargets, 1);
});

// CONTRACT PIN — with NO refusals, an absent group keeps the pre-R4 code.
// Without this, the new branch could swallow the ordinary not-active case.
test('R4 contract pin: an absent group with no refusals still reports rollover-year-not-active', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedTeams();
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const res = await POST(postRequest({ year: 2099 }));
  const body = (await res.json()) as { error?: string; invalidLifecycleTargets?: number };
  assert.equal(res.status, 409);
  assert.equal(body.error, 'rollover-year-not-active');
  assert.equal(body.invalidLifecycleTargets, 0);
});

// REGRESSION TEST — the manual surface's sink durability is REAL, not merely
// asserted in a comment. A corrupt record throwing mid-loop previously escaped
// the handler and produced a framework 500 with no body, discarding the count
// the loop had already published.
test('R4 regression: a refusal counted before a mid-loop throw survives on the manual surface', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: '2024' } as unknown as League['status']),
    null as unknown as League,
  ]);
  await seedTeams();

  const res = await GET(getRequest());
  const body = (await res.json()) as { error?: string; invalidLifecycleTargets?: number };

  // POSITIVE CONTROL — the throw really happened and really was caught here.
  assert.equal(res.status, 500, 'the corrupt record threw into the registry catch');
  assert.equal(body.error, 'rollover-registry-unavailable');
  assert.equal(body.invalidLifecycleTargets, 1, 'the refusal already counted is not discarded');
});
