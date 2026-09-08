import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the E1A authority's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

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
import { resetScheduleRouteCacheForTests } from '../../../schedule/cache.ts';
import { __resetSchedulePresentationMemoForTests } from '../../../../../lib/schedule/schedulePresentationJoin.ts';
import {
  buildSchedulerExecutionReceipt,
  parseSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
  type SchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import { summarizeReceiptTarget } from '../../../../../components/admin/systemHealth/systemHealthPresentation.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';

// PLATFORM-126B — the weekly schedule job's half of the incident-evidence
// contract, at ROUTE level.
//
// The acceptance test this suite exists to answer is the September 1, 2026
// failure: after runtime logs expire and a later manual refresh succeeds, does
// the durable receipt ALONE say which year failed, why, which partition, and
// what class of upstream fault caused it? Every assertion below reads the stored
// record, never the route response and never the runtime event.

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

/** A past latest-regular kickoff makes each year lifecycle-critical, so the operator gate never skips it. */
const CRITICAL_KICKOFF = '2020-11-28T20:00:00.000Z';

/** The credential- and payload-bearing values that must never reach the store. */
const SECRET_QUERY_KEY = 'SUPER-SECRET-KEY';
const SECRET_BODY_MARKER = 'tok_live_MARKER';

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

type PartitionPlan =
  | { kind: 'rows' }
  | { kind: 'throw'; error: unknown }
  | { kind: 'status'; status: number; body: string };

/** Per-year, per-partition provider behaviour. A missing entry serves rows. */
type Plan = Record<number, Partial<Record<'regular' | 'postseason', PartitionPlan>>>;

function makeLeague(slug: string, year: number): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'season', year },
  };
}

async function seedSeasonLeague(year: number): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [...existing, makeLeague(`league-${year}`, year)]);
}

async function seedSchedule(year: number): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: 1,
    items: [
      {
        id: `${year}-1`,
        week: 14,
        startDate: CRITICAL_KICKOFF,
        homeTeam: 'Ohio State',
        awayTeam: 'Michigan',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

/** Seed a lifecycle-critical year the cron will pick up. */
async function seedYear(year: number): Promise<void> {
  await seedSeasonLeague(year);
  await seedSchedule(year);
}

function gameBody(year: number): string {
  return JSON.stringify([
    {
      id: year * 10 + 1,
      week: 1,
      home_team: 'Texas',
      away_team: 'Rice',
      start_date: `${year}-09-01T00:00:00Z`,
      home_conference: 'Big 12',
      away_conference: 'American',
    },
  ]);
}

function stubProvider(plan: Plan): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.pathname === '/games/media') return new Response('[]', { status: 200 });
    if (url.pathname === '/venues') return new Response('[]', { status: 200 });
    const year = Number(url.searchParams.get('year'));
    const seasonType = (url.searchParams.get('seasonType') ?? 'regular') as
      | 'regular'
      | 'postseason';
    const partition = plan[year]?.[seasonType] ?? { kind: 'rows' };
    if (partition.kind === 'throw') throw partition.error;
    if (partition.kind === 'status') {
      return new Response(partition.body, {
        status: partition.status,
        statusText: 'Service Unavailable',
      });
    }
    // Postseason serves a valid absence; regular serves usable rows.
    const body = seasonType === 'postseason' ? '[]' : gameBody(year);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/**
 * A real `UpstreamFetchError` of the given kind, carrying the credential and the
 * response body the gate forbids persisting. `fetchUpstreamJson` passes an
 * already-normalized error through unchanged, so this drives the production
 * classifier on the production path.
 */
function upstreamThrow(kind: UpstreamErrorKind, status?: number): UpstreamFetchError {
  return new UpstreamFetchError({
    kind,
    message: `boom https://api.collegefootballdata.com/games?apiKey=${SECRET_QUERY_KEY}`,
    ...(status === undefined ? {} : { status, statusText: 'Service Unavailable' }),
    url: `https://api.collegefootballdata.com/games?apiKey=${SECRET_QUERY_KEY}`,
    responseBody: `{"error":"${SECRET_BODY_MARKER}"}`,
  });
}

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/schedule-refresh', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

async function runRoute(): Promise<Response> {
  console.log = (() => {}) as typeof console.log;
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  try {
    return await workAsyncStorage.run(store as never, () => GET(cronRequest()));
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
}

type ScheduleYearsTarget = Extract<SchedulerExecutionReceipt['target'], { kind: 'schedule-years' }>;

/** Run the cron and return the DURABLE receipt's target — the only evidence that outlives the run. */
async function storedTarget(): Promise<ScheduleYearsTarget> {
  const res = await runRoute();
  assert.equal(res.status, 200, 'a controlled application failure is still HTTP 200');
  await deferrer.flush();
  const stored = await readSchedulerReceipt('schedule-refresh');
  assert.ok(stored, 'a receipt was written');
  const target = stored.value.target as ScheduleYearsTarget;
  assert.equal(target.kind, 'schedule-years');
  return target;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  __resetSchedulePresentationMemoForTests();
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider({});
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateWriteFailureForTests(null);
  globalThis.fetch = ORIGINAL_FETCH;
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
});

// ── The headline ─────────────────────────────────────────────────────────────

test('THE ITEM: a three-year run with ONE failing year names that year, its reason, its partition and its class', async () => {
  // Three years so a single-year fixture cannot pass this by accident — a
  // run-level result is indistinguishable from a per-year one when a run spans
  // exactly one year, which is why the September 1 receipt looked adequate.
  await seedYear(2029);
  await seedYear(2030);
  await seedYear(2031);
  stubProvider({ 2030: { postseason: { kind: 'throw', error: upstreamThrow('timeout') } } });

  const target = await storedTarget();
  assert.equal(target.totalYears, 3);
  assert.deepEqual(
    target.years.map((entry) => entry.year),
    [2029, 2030, 2031]
  );

  const failed = target.years.filter((entry) => entry.result === 'failure');
  assert.equal(failed.length, 1, 'exactly one year failed');
  const only = failed[0]!;
  assert.equal(only.year, 2030, 'the receipt names WHICH year failed');
  assert.equal(only.reason, 'partition-fetch-failed', 'and its stable reason');
  assert.equal(only.providerCallAttempted, true);
  assert.deepEqual(only.attemptedSeasonTypes, ['regular', 'postseason']);
  assert.deepEqual(
    only.failedPartitions,
    [{ seasonType: 'postseason', upstream: { kind: 'timeout', status: null } }],
    'and which partition, and what class of upstream fault'
  );
  assert.equal(only.rowsCommitted, 0, 'nothing was committed for the failed year');
  assert.equal(only.dataChanged, false);

  // The two healthy years are recorded as healthy, individually.
  for (const entry of target.years.filter((y) => y.year !== 2030)) {
    assert.equal(entry.result, 'success', `${entry.year} succeeded`);
    assert.equal(entry.reason, 'written-clean');
    assert.deepEqual(entry.failedPartitions, [], `${entry.year} has no failed partition`);
  }
});

test('the System Health target summary shows the failing year and hides the healthy ones', async () => {
  await seedYear(2030);
  await seedYear(2031);
  stubProvider({ 2031: { regular: { kind: 'throw', error: upstreamThrow('http', 503) } } });

  const target = await storedTarget();
  assert.equal(
    summarizeReceiptTarget(target),
    '2 year(s): 2030 (postseason-boundary), 2031 (postseason-boundary) [failure / partition-fetch-failed · regular http 503]',
    'the failing year names its evidence; the healthy year renders exactly as before'
  );
});

// ── Every class survives to the store ────────────────────────────────────────

for (const kind of UPSTREAM_FAULT_KINDS) {
  test(`the \`${kind}\` upstream class survives to the durable record`, async () => {
    // A test that only exercises `timeout` proves one branch of five.
    await seedYear(2031);
    const status = kind === 'http' ? 401 : undefined;
    stubProvider({ 2031: { regular: { kind: 'throw', error: upstreamThrow(kind, status) } } });

    const target = await storedTarget();
    assert.deepEqual(target.years[0]!.failedPartitions, [
      { seasonType: 'regular', upstream: { kind, status: status ?? null } },
    ]);
    assert.equal(target.years[0]!.reason, 'partition-fetch-failed');
  });
}

test('the mixed pair — one partition committed, one timed out — records exactly that', async () => {
  // This is the case a PER-YEAR class could not express without a lossy
  // tie-break, and is why the class is recorded per failed partition
  // (owner ruling, 2026-09-07).
  await seedYear(2031);
  stubProvider({ 2031: { postseason: { kind: 'throw', error: upstreamThrow('timeout') } } });

  const target = await storedTarget();
  const year = target.years[0]!;
  assert.deepEqual(
    year.attemptedSeasonTypes,
    ['regular', 'postseason'],
    'both partitions were requested'
  );
  assert.deepEqual(
    year.failedPartitions,
    [{ seasonType: 'postseason', upstream: { kind: 'timeout', status: null } }],
    'only the postseason partition is named, and only it carries a class'
  );
  assert.equal(
    year.rowsReceived,
    1,
    'the regular partition’s usable rows are still counted, per the E1A contract'
  );
});

test('a payload rejection names its partition with NO class — its transport was fine', async () => {
  await seedYear(2031);
  stubProvider({ 2031: { regular: { kind: 'status', status: 200, body: '{"not":"an array"}' } } });

  const target = await storedTarget();
  const year = target.years[0]!;
  assert.equal(year.reason, 'partition-invalid-payload');
  assert.deepEqual(
    year.failedPartitions,
    [{ seasonType: 'regular', upstream: null }],
    'null is the absence of a transport fault, not lost evidence'
  );
});

// ── The gate: no secret reaches the store ────────────────────────────────────

test('SECRET SCAN: a real HTTP failure carrying a URL and a response body persists neither', async () => {
  await seedYear(2031);
  // The most realistic secret-bearing case: the helper builds the error itself
  // and captures the FULL response body at `fetchUpstream.ts:355`.
  stubProvider({
    2031: {
      regular: {
        kind: 'status',
        status: 503,
        body: `{"error":"quota exceeded for ${SECRET_BODY_MARKER}"}`,
      },
    },
  });

  const target = await storedTarget();
  // Scan the WHOLE stored receipt, not only its target — a leak anywhere in the
  // durable row is the same exfiltration path.
  const stored = await readSchedulerReceipt('schedule-refresh');
  const serialized = JSON.stringify(stored);
  assert.ok(!serialized.includes(SECRET_BODY_MARKER), 'no response body');
  assert.ok(!serialized.includes('collegefootballdata'), 'no provider URL');
  assert.ok(!serialized.includes('test-cfbd-token'), 'no credential');
  assert.ok(!serialized.includes('Service Unavailable'), 'no status text');
  // The evidence that IS retained.
  assert.deepEqual(target.years[0]!.failedPartitions, [
    { seasonType: 'regular', upstream: { kind: 'http', status: 503 } },
  ]);
});

test('POSITIVE CONTROL: the same scan SEES the body and the URL when the classifier is bypassed', async () => {
  // Without this, the scan above proves only that the instrument is blind. The
  // response body and URL genuinely reached the app on that path — this is what
  // the durable record would have looked like had the class been built by
  // spreading `UpstreamError` instead of picking two fields from it.
  const leaked = {
    kind: 'schedule-years',
    years: [
      {
        year: 2031,
        failedPartitions: [
          {
            seasonType: 'regular',
            upstream: {
              kind: 'http',
              status: 503,
              url: `https://api.collegefootballdata.com/games?apiKey=${SECRET_QUERY_KEY}`,
              responseBody: `{"error":"quota exceeded for ${SECRET_BODY_MARKER}"}`,
              statusText: 'Service Unavailable',
            },
          },
        ],
      },
    ],
  };
  const serialized = JSON.stringify(leaked);
  assert.ok(serialized.includes(SECRET_BODY_MARKER), 'the scan can see a response body');
  assert.ok(serialized.includes('collegefootballdata'), 'the scan can see a URL');
  assert.ok(serialized.includes(SECRET_QUERY_KEY), 'the scan can see a credential');
  assert.ok(serialized.includes('Service Unavailable'), 'the scan can see status text');
});

// ── A reader on the old shape ────────────────────────────────────────────────

test('a receipt stored in the PRE-widening shape still parses, and normalizes to null not zero', async () => {
  // A durable contract outlives one deploy: instances of both builds write to
  // this one row during a rollout, and the reader must not reject the older one.
  const legacyStored = {
    version: 1,
    job: 'schedule-refresh',
    source: 'qstash',
    invocationId: 'd563a545-3204-4cd2-8530-55de43149c46',
    startedAt: '2026-09-01T12:00:01.664Z',
    completedAt: '2026-09-01T12:00:38.788Z',
    durationMs: 37124,
    result: 'failure',
    reason: 'year-results',
    providerCallAttempted: true,
    target: {
      kind: 'schedule-years',
      totalYears: 1,
      truncated: false,
      invalidLifecycleTargets: 0,
      // The EXACT September 1, 2026 target, byte for byte.
      years: [{ year: 2026, operation: 'ordinary-maintenance' }],
    },
  };

  const parsed = parseSchedulerExecutionReceipt(
    legacyStored,
    'schedule-refresh',
    Date.parse('2026-09-07T17:00:00.000Z')
  );
  assert.ok(parsed, 'the old shape parses rather than degrading the row to `invalid`');
  const year = (parsed.target as ScheduleYearsTarget).years[0]!;
  assert.equal(year.year, 2026);
  assert.equal(year.operation, 'ordinary-maintenance');
  for (const field of [
    'result',
    'reason',
    'providerCallAttempted',
    'rowsReceived',
    'rowsCommitted',
    'dataChanged',
  ] as const) {
    assert.equal(year[field], null, `${field} normalizes to null, never to 0/false`);
  }
  assert.deepEqual(year.attemptedSeasonTypes, []);
  assert.deepEqual(year.failedPartitions, []);
  // And it renders exactly the string it rendered before this slice.
  assert.equal(
    summarizeReceiptTarget(parsed.target),
    '1 year(s): 2026 (ordinary-maintenance)',
    'a legacy receipt is byte-identical on the System Health surface'
  );
});

test('a widened receipt written by a NEW build survives a round trip through the store', async () => {
  await seedYear(2031);
  stubProvider({ 2031: { regular: { kind: 'throw', error: upstreamThrow('parse') } } });
  const written = await storedTarget();

  const receipt = buildSchedulerExecutionReceipt({
    job: 'schedule-refresh',
    invocationId: '11111111-1111-4111-8111-111111111111',
    startedAtMs: Date.now(),
    completedAtMs: Date.now() + 10,
    result: 'failure',
    reason: 'year-results',
    providerCallAttempted: true,
    target: written,
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const reread = await readSchedulerReceipt('schedule-refresh');
  assert.ok(reread);
  assert.deepEqual(reread.value.target, written, 'no field is lost or reshaped by the round trip');
});

// ── Pre-provider exits never fabricate attempted partitions ─────────────────

test('a MISSING CFBD key records no attempted partitions — the receipt cannot claim a call it never made', async () => {
  // Regression test. Before the review fix the authority filled
  // `attemptedSeasonTypes` at function entry, so this exit wrote
  // `providerCallAttempted: false` beside `attemptedSeasonTypes:
  // ['regular','postseason']` — a self-contradicting durable row, in the record
  // this item exists to make trustworthy. Verified failing against the pre-fix
  // authority (the assertion below read `['regular','postseason']`).
  await seedYear(2031);
  delete MUTABLE_ENV.CFBD_API_KEY;

  const target = await storedTarget();
  const year = target.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.reason, 'cfbd-api-key-missing');
  assert.equal(year.providerCallAttempted, false, 'no provider request was made');
  assert.deepEqual(year.attemptedSeasonTypes, [], 'and none is claimed');
  assert.deepEqual(year.failedPartitions, [], 'nothing failed at the partition level');
  // POSITIVE CONTROL for the observer: the same harness DOES record both
  // partitions on a run that genuinely reached the provider (the mixed-pair and
  // class tests above), so an empty list here is the code's answer, not the
  // harness failing to look.
});

// ── The response body is a separate contract from the receipt ───────────────

test('the response body per-year keys are byte-preserved — the retained class is receipt-only', async () => {
  // Item 147. The SIBLING job's body leaked `failedPartitions` because only its
  // log-event keys were pinned and nothing pinned the body; that fix added a
  // projector and a pin for rankings and left this one — the job the whole item
  // was written about — unpinned. `responseYearEntry` is correct today; this
  // makes the two jobs symmetric so a future widening plus a `...entry` spread
  // cannot reproduce the same defect unobserved.
  await seedYear(2031);
  stubProvider({ 2031: { regular: { kind: 'throw', error: upstreamThrow('timeout') } } });

  const res = await runRoute();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { years: Array<Record<string, unknown>> };
  assert.equal(body.years.length, 1);
  assert.deepEqual(
    Object.keys(body.years[0]!).sort(),
    [
      'dataChanged',
      'operation',
      'providerCallAttempted',
      'reason',
      'result',
      'rowsCommitted',
      'rowsReceived',
      'year',
    ],
    'exactly the pre-126B key set — no attemptedSeasonTypes, no failedPartitions'
  );
  assert.ok(
    !JSON.stringify(body).includes('failedPartitions'),
    'the retained class does not reach the delivery response'
  );

  // POSITIVE CONTROL — the same run DID record it durably, so the absence above
  // is the projector working, not the evidence going missing.
  await deferrer.flush();
  const stored = await readSchedulerReceipt('schedule-refresh');
  assert.ok(stored);
  assert.deepEqual((stored.value.target as ScheduleYearsTarget).years[0]!.failedPartitions, [
    { seasonType: 'regular', upstream: { kind: 'timeout', status: null } },
  ]);
});
