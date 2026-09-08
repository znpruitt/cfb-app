import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import {
  UpstreamFetchError,
  type UpstreamErrorKind,
} from '../../../../../lib/api/fetchUpstream.ts';
import { UPSTREAM_FAULT_KINDS } from '../../../../../lib/api/upstreamFaultClass.ts';
import { type League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { __resetSeasonRankingsCacheForTests } from '../../../../../lib/server/rankings.ts';
import { __resetUpstreamPacingForTests } from '../../../../../lib/api/fetchUpstream.ts';
import {
  parseSchedulerExecutionReceipt,
  type SchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import { summarizeReceiptTarget } from '../../../../../components/admin/systemHealth/systemHealthPresentation.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';

// PLATFORM-126B — the rankings job's half of the incident-evidence contract, at
// ROUTE level.
//
// `AGENTS.md` → Scope and sizing: a second job shipped without route-level
// coverage is a scope violation, not merely a test gap. Named failure case is
// `PLATFORM-086F2H1B` v1. This suite exists so that case is not repeated: every
// assertion here reads the DURABLE receipt after a real route invocation.

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

const YEAR = 2031;
const SLOT_WEEKLY_MS = Date.parse('2031-10-05T22:00:00.000Z'); // Sunday 22:00
const FIRST_KICKOFF = '2031-08-30T18:00:00.000Z';

const SECRET_QUERY_KEY = 'SUPER-SECRET-KEY';
const SECRET_BODY_MARKER = 'tok_live_MARKER';

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

type PartitionPlan =
  | { kind: 'rows'; rows: unknown[] }
  | { kind: 'throw'; error: unknown }
  | { kind: 'status'; status: number; body: string };

type Plan = Partial<Record<'regular' | 'postseason', PartitionPlan>>;

function makeLeague(slug: string, year: number): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2005,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'season', year },
  } as League;
}

async function seedLeague(year: number): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [...existing, makeLeague(`league-${year}`, year)]);
}

async function seedSchedule(year: number, firstKickoff: string): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: 1,
    items: [
      {
        id: `${year}01`,
        week: 1,
        startDate: firstKickoff,
        homeTeam: 'Georgia',
        awayTeam: 'Michigan',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

function usablePayload(year: number): unknown[] {
  return [
    {
      season: year,
      seasonType: 'regular',
      week: 6,
      polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: 'Georgia', conference: null }] }],
    },
  ];
}

function stubProvider(plan: Plan = {}): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.pathname === '/info') {
      return new Response(JSON.stringify({ remainingCalls: 4000, patronLevel: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/rankings') {
      const year = Number(url.searchParams.get('year'));
      const seasonType =
        url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
      const partition = plan[seasonType];
      if (partition?.kind === 'throw') throw partition.error;
      if (partition?.kind === 'status') {
        return new Response(partition.body, {
          status: partition.status,
          statusText: 'Service Unavailable',
        });
      }
      const rows =
        partition?.kind === 'rows'
          ? partition.rows
          : seasonType === 'regular'
            ? usablePayload(year)
            : [];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected provider request: ${url.pathname}`);
  }) as typeof fetch;
}

/** The same secret-bearing error shape the schedule suite uses — one vocabulary, two jobs. */
function upstreamThrow(kind: UpstreamErrorKind, status?: number): UpstreamFetchError {
  return new UpstreamFetchError({
    kind,
    message: `boom https://api.collegefootballdata.com/rankings?apiKey=${SECRET_QUERY_KEY}`,
    ...(status === undefined ? {} : { status, statusText: 'Service Unavailable' }),
    url: `https://api.collegefootballdata.com/rankings?apiKey=${SECRET_QUERY_KEY}`,
    responseBody: `{"error":"${SECRET_BODY_MARKER}"}`,
  });
}

function request(): Request {
  return new Request('http://localhost/api/cron/rankings', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

type RankingsYearsTarget = Extract<SchedulerExecutionReceipt['target'], { kind: 'rankings-years' }>;

async function storedTarget(): Promise<RankingsYearsTarget> {
  const res = await GET(request());
  assert.equal(res.status, 200, 'a controlled application failure is still HTTP 200');
  await deferrer.flush();
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored, 'a receipt was written');
  const target = stored.value.target as RankingsYearsTarget;
  assert.equal(target.kind, 'rankings-years');
  return target;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  __resetUpstreamPacingForTests();
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider();
  console.log = (() => {}) as typeof console.log;
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  console.log = ORIGINAL_CONSOLE_LOG;
  __setAppStateWriteFailureForTests(null);
});

test.after(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

// ── The headline, for the second multi-year job ──────────────────────────────

test('THE ITEM: a three-year run distinguishes the provider failure from its two siblings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  // Three years so a single-year fixture cannot pass this by accident. Only the
  // current season has a due publication window and a cached schedule; the two
  // older years have neither, so they take a DIFFERENT per-year path — which is
  // the point, because a run-level reason can only report one of the three.
  await seedLeague(2029);
  await seedLeague(2030);
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ postseason: { kind: 'throw', error: upstreamThrow('timeout') } });

  const target = await storedTarget();
  assert.equal(target.totalYears, 3);

  const byYear = new Map(target.years.map((entry) => [entry.year, entry]));
  const failed = byYear.get(YEAR)!;
  assert.equal(failed.result, 'failure', 'the provider-attempting year failed');
  assert.equal(failed.reason, 'provider-fetch-failed', 'and names its stable reason');
  assert.equal(failed.providerCallAttempted, true);
  assert.deepEqual(failed.attemptedSeasonTypes, ['regular', 'postseason']);
  assert.deepEqual(
    failed.failedPartitions,
    [{ seasonType: 'postseason', upstream: { kind: 'timeout', status: null } }],
    'the receipt names WHICH partition and what class of upstream fault'
  );

  // The two sibling years are separable from it, per year, in the same record.
  for (const year of [2029, 2030]) {
    const sibling = byYear.get(year)!;
    assert.notEqual(
      sibling.reason,
      'provider-fetch-failed',
      `${year} did not reach the provider and does not claim to`
    );
    assert.equal(sibling.providerCallAttempted, false);
    assert.deepEqual(sibling.attemptedSeasonTypes, []);
    assert.deepEqual(sibling.failedPartitions, []);
  }
});

// ── Every class survives to the store, from THIS job too ─────────────────────

for (const kind of UPSTREAM_FAULT_KINDS) {
  test(`the \`${kind}\` upstream class survives to the rankings durable record`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
    await seedLeague(YEAR);
    await seedSchedule(YEAR, FIRST_KICKOFF);
    const status = kind === 'http' ? 401 : undefined;
    stubProvider({ regular: { kind: 'throw', error: upstreamThrow(kind, status) } });

    const target = await storedTarget();
    const year = target.years[0]!;
    assert.equal(year.reason, 'provider-fetch-failed');
    assert.deepEqual(year.failedPartitions, [
      { seasonType: 'regular', upstream: { kind, status: status ?? null } },
    ]);
  });
}

test('the mixed pair — one partition usable, one refused — records exactly that', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ postseason: { kind: 'throw', error: upstreamThrow('http', 429) } });

  const target = await storedTarget();
  const year = target.years[0]!;
  assert.deepEqual(year.attemptedSeasonTypes, ['regular', 'postseason']);
  assert.deepEqual(
    year.failedPartitions,
    [{ seasonType: 'postseason', upstream: { kind: 'http', status: 429 } }],
    'only the refused partition is named, and only it carries a class'
  );
});

test('a schema-drift rejection names its partition with NO class — its transport was fine', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  // A nonempty payload whose every week is labelled with a DIFFERENT season, so
  // the cross-year guard drops them all and the partition normalizes to zero
  // usable weeks: fetched cleanly, rejected on content.
  stubProvider({
    regular: {
      kind: 'rows',
      rows: [
        {
          season: YEAR - 1,
          seasonType: 'regular',
          week: 6,
          polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: 'Georgia', conference: null }] }],
        },
      ],
    },
  });

  const target = await storedTarget();
  const year = target.years[0]!;
  assert.equal(year.reason, 'rankings-partition-schema-drift');
  assert.deepEqual(year.failedPartitions, [{ seasonType: 'regular', upstream: null }]);
});

// ── The gate ─────────────────────────────────────────────────────────────────

test('SECRET SCAN: a real HTTP failure carrying a URL and a response body persists neither', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({
    regular: {
      kind: 'status',
      status: 503,
      body: `{"error":"quota exceeded for ${SECRET_BODY_MARKER}"}`,
    },
  });

  const target = await storedTarget();
  // Scan the WHOLE stored receipt, not only its target.
  const stored = await readSchedulerReceipt('rankings');
  const serialized = JSON.stringify(stored);
  assert.ok(!serialized.includes(SECRET_BODY_MARKER), 'no response body');
  assert.ok(!serialized.includes('collegefootballdata'), 'no provider URL');
  assert.ok(!serialized.includes('test-cfbd-token'), 'no credential');
  assert.ok(!serialized.includes('Service Unavailable'), 'no status text');
  assert.deepEqual(target.years[0]!.failedPartitions, [
    { seasonType: 'regular', upstream: { kind: 'http', status: 503 } },
  ]);
});

// ── A reader on the old shape ────────────────────────────────────────────────

test('a rankings receipt stored in the PRE-widening shape still parses and renders unchanged', async () => {
  const legacyStored = {
    version: 1,
    job: 'rankings',
    source: 'qstash',
    invocationId: '99999999-9999-4999-8999-999999999999',
    startedAt: '2026-09-01T22:00:00.000Z',
    completedAt: '2026-09-01T22:00:37.000Z',
    durationMs: 36917,
    result: 'failure',
    reason: 'year-results',
    providerCallAttempted: true,
    target: {
      kind: 'rankings-years',
      totalYears: 1,
      truncated: false,
      invalidLifecycleTargets: 0,
      years: [{ year: 2026, publicationWindow: 'weekly-ap-coaches' }],
    },
  };

  const parsed = parseSchedulerExecutionReceipt(
    legacyStored,
    'rankings',
    Date.parse('2026-09-07T17:00:00.000Z')
  );
  assert.ok(parsed, 'the old shape parses rather than degrading the row to `invalid`');
  const year = (parsed.target as RankingsYearsTarget).years[0]!;
  assert.equal(year.publicationWindow, 'weekly-ap-coaches');
  assert.equal(year.result, null);
  assert.equal(year.reason, null);
  assert.equal(year.rowsCommitted, null, 'null, never 0 — 0 is a real observation');
  assert.deepEqual(year.failedPartitions, []);
  assert.equal(
    summarizeReceiptTarget(parsed.target),
    '1 year(s): 2026 (weekly-ap-coaches)',
    'a legacy receipt is byte-identical on the System Health surface'
  );
});

// ── The response body is a separate contract from the receipt ───────────────

test('the response body per-year keys are byte-preserved — the retained class is receipt-only', async (t) => {
  // Regression test. `years: exec.years` was returned verbatim, so widening the
  // shared year-entry type silently added `failedPartitions` to the QStash
  // response — contradicting this slice's own invariant in
  // `/api/schedule/route.ts` and unpinned by anything, which is exactly why it
  // shipped. Nothing pinned the RESPONSE body; the log-event keys were pinned
  // and passed. Verified failing against the pre-fix route.
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ postseason: { kind: 'throw', error: upstreamThrow('timeout') } });

  const res = await GET(request());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { years: Array<Record<string, unknown>> };
  assert.equal(body.years.length, 1);
  assert.deepEqual(
    Object.keys(body.years[0]!).sort(),
    [
      'attemptedSeasonTypes',
      'dataChanged',
      'lifecycle',
      'providerCallAttempted',
      'publicationKey',
      'publicationWindow',
      'quotaChecked',
      'quotaRemaining',
      'reason',
      'result',
      'rowsCommitted',
      'rowsReceived',
      'year',
    ],
    'exactly the pre-126B key set — no failedPartitions'
  );
  assert.ok(
    !JSON.stringify(body).includes('failedPartitions'),
    'the retained class does not reach the delivery response'
  );

  // POSITIVE CONTROL — the same run DID record it durably, so the absence above
  // is the projector working, not the evidence going missing.
  await deferrer.flush();
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored);
  assert.deepEqual((stored.value.target as RankingsYearsTarget).years[0]!.failedPartitions, [
    { seasonType: 'postseason', upstream: { kind: 'timeout', status: null } },
  ]);
});
