import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET, POST } from '../route';
import type { League } from '../../../../../lib/league.ts';
import type {
  ManualRolloverExecuteResponse,
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

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the manual rollover route is narrowed to explicit per-year
// operation behind the SAME strict eligibility authority as the automatic cron
// (`resolveNationalChampionshipRollover`), with shared target grouping
// (`groupRolloverTargets`): status.year-only targeting, mandatory gate
// re-evaluation on every POST, archive-first two-stage execution, truthful
// partial-failure reporting, and no force/emergency bypass.
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

    for (const confirmed of [false, true]) {
      const post = await POST(postRequest({ year: 2023, confirmed }));
      assert.equal(post.status, 503);
      const postBody = (await post.json()) as { error?: string; reason?: string };
      assert.equal(postBody.error, 'rollover-eligibility-unavailable');
      assert.equal(postBody.reason, 'read-failed');
    }
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

  const cases: unknown[] = [
    'not-json{',
    {},
    { confirmed: true },
    { year: '2023', confirmed: true },
    { year: 2023.5, confirmed: true },
    { year: 1200, confirmed: true },
    { year: 2023 },
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
    const res = await POST(postRequest({ year, confirmed: true }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'rollover-year-not-active');
  }
});

// 11 — an ineligible year refuses BOTH preview and execution with the exact
// stable reason, and mutates nothing.
test('ineligible preview and execution → 409 rollover-not-eligible, no mutation', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-06T00:00:00.000Z', { final: false });
  const registryBefore = await readRegistry();

  const { tags } = await runCapturingTags(async () => {
    for (const confirmed of [false, true]) {
      const res = await POST(postRequest({ year: 2023, confirmed }));
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error?: string; reason?: string };
      assert.equal(body.error, 'rollover-not-eligible');
      assert.equal(body.reason, 'not-final');
    }
  });

  assert.deepEqual(await readRegistry(), registryBefore);
  assert.equal(await getAppState('standings-archive:alpha', '2023'), null);
  assert.deepEqual(
    tags.filter((t) => t.startsWith('standings:')),
    []
  );
});

// 12 — preview builds only the requested lifecycle-year group and writes nothing.
test('preview touches only the requested year group and performs no durable write', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('bravo', 2024, { state: 'season', year: 2024 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');
  await seedYearChampionship(2024, '2024-01-08T00:00:00.000Z');
  const registryBefore = await readRegistry();

  const res = await POST(postRequest({ year: 2023, confirmed: false }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as ManualRolloverPreviewResponse;
  assert.equal(body.preview.year, 2023);
  assert.equal(body.preview.championshipDate, '2023-01-09T00:00:00.000Z');
  assert.deepEqual(
    body.preview.leagues.map((l) => l.leagueSlug),
    ['alpha'],
    'only the requested year group is previewed'
  );

  assert.deepEqual(await readRegistry(), registryBefore, 'no durable mutation');
  assert.equal(await getAppState('standings-archive:alpha', '2023'), null);
  assert.equal(await getAppState('standings-archive:bravo', '2024'), null);
});

// 13 — confirmation re-evaluates the gate; an earlier eligible preview never
// authorizes execution once the gate becomes unavailable.
test('a stale eligible preview cannot authorize execution after the gate degrades', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  const preview = await POST(postRequest({ year: 2023, confirmed: false }));
  assert.equal(preview.status, 200, 'preview was eligible');
  const registryBefore = await readRegistry();

  __setAppStateReadFailureForTests(new Error('outage after preview'), 'schedule');
  try {
    const res = await POST(postRequest({ year: 2023, confirmed: true }));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'rollover-eligibility-unavailable');
  } finally {
    __setAppStateReadFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), registryBefore, 'no mutation off the stale preview');
  assert.equal(await getAppState('standings-archive:alpha', '2023'), null);
});

// 14 + 15 + 18(positive) + 19(positive) — a confirmed eligible rollover
// archives and transitions exactly the requested group; a sibling year is
// untouched; suppression clears only after archive + status success; standings
// invalidate for each rolled-over league.
test('confirmed eligible rollover rolls only the requested group; sibling year untouched', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('bravo', 2023, { state: 'season', year: 2023 }),
    makeLeague('charlie', 2024, { state: 'season', year: 2024 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');
  await seedYearChampionship(2024, '2024-01-08T00:00:00.000Z', { final: false });
  await setAppState('insights-suppression:alpha:2023', 'insight-1', { insightId: 'insight-1' });

  const { result: res, tags } = await runCapturingTags(() =>
    POST(postRequest({ year: 2023, confirmed: true }))
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as ManualRolloverExecuteResponse;
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.year, 2023);
  assert.deepEqual(body.archivedLeagues, ['alpha', 'bravo']);
  assert.deepEqual(body.rolledOverLeagues, ['alpha', 'bravo']);
  assert.deepEqual(body.errors, []);

  const bySlug = Object.fromEntries((await readRegistry()).map((l) => [l.slug, l]));
  assert.equal(bySlug.alpha!.status?.state, 'offseason');
  assert.equal(bySlug.bravo!.status?.state, 'offseason');
  assert.equal(bySlug.alpha!.year, 2023, 'offseason retains the archived season year');
  assert.equal(bySlug.charlie!.status?.state, 'season', 'sibling year untouched');
  assert.notEqual(await getAppState('standings-archive:alpha', '2023'), null);
  assert.notEqual(await getAppState('standings-archive:bravo', '2023'), null);
  assert.equal(await getAppState('standings-archive:charlie', '2024'), null);

  assert.ok(tags.includes('standings:alpha'));
  assert.ok(tags.includes('standings:bravo'));
  assert.ok(!tags.includes('standings:charlie'));

  assert.equal(
    await getAppState('insights-suppression:alpha:2023', 'insight-1'),
    null,
    'suppression cleared after archive + status success'
  );
});

// 16 — ANY archive failure prevents EVERY status transition for the group.
test('an archive failure prevents all status transitions for the requested group', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
    makeLeague('bravo', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');

  // Fail ONLY alpha's archive save; bravo's archive save succeeds.
  __setAppStateWriteFailureForTests(new Error('archive store outage'), 'standings-archive:alpha');
  let body: ManualRolloverExecuteResponse;
  try {
    const { result: res, tags } = await runCapturingTags(() =>
      POST(postRequest({ year: 2023, confirmed: true }))
    );
    assert.equal(res.status, 200);
    body = (await res.json()) as ManualRolloverExecuteResponse;
    assert.deepEqual(
      tags.filter((t) => t.startsWith('standings:')),
      [],
      'no standings invalidation without a status transition'
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(body.success, false);
  assert.deepEqual(body.archivedLeagues, ['bravo'], 'truthful: bravo did archive');
  assert.deepEqual(body.rolledOverLeagues, [], 'NO league transitioned');
  assert.deepEqual(
    body.errors.map((e) => ({ leagueSlug: e.leagueSlug, stage: e.stage })),
    [{ leagueSlug: 'alpha', stage: 'archive' }]
  );
  assert.match(body.message ?? '', /No status transitions were made/);

  const bySlug = Object.fromEntries((await readRegistry()).map((l) => [l.slug, l.status?.state]));
  assert.equal(bySlug.alpha, 'season');
  assert.equal(bySlug.bravo, 'season', 'sibling in group not transitioned either');
});

// 17 + 18(ordering) + 19(negative) — a status-write failure is reported
// truthfully; suppression stays untouched; nothing is invalidated.
test('a status-write failure is reported truthfully, never as full success', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);
  await seedYearChampionship(2023, '2023-01-09T00:00:00.000Z');
  await setAppState('insights-suppression:alpha:2023', 'insight-1', { insightId: 'insight-1' });

  // Archives write to `standings-archive:*`; ONLY the registry write fails.
  __setAppStateWriteFailureForTests(new Error('registry outage'), 'leagues');
  let body: ManualRolloverExecuteResponse;
  try {
    const { result: res, tags } = await runCapturingTags(() =>
      POST(postRequest({ year: 2023, confirmed: true }))
    );
    assert.equal(res.status, 200);
    body = (await res.json()) as ManualRolloverExecuteResponse;
    assert.deepEqual(
      tags.filter((t) => t.startsWith('standings:')),
      [],
      'standings invalidate only for successful status transitions'
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(body.success, false, 'never fabricates all-success');
  assert.deepEqual(body.archivedLeagues, ['alpha']);
  assert.deepEqual(body.rolledOverLeagues, []);
  assert.deepEqual(
    body.errors.map((e) => ({ leagueSlug: e.leagueSlug, stage: e.stage })),
    [{ leagueSlug: 'alpha', stage: 'status' }]
  );

  assert.equal((await readRegistry())[0]!.status?.state, 'season', 'status unchanged');
  assert.notEqual(
    await getAppState('insights-suppression:alpha:2023', 'insight-1'),
    null,
    'suppression clearing happens only after a successful status transition'
  );
});
