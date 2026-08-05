import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import { TEST_LEAGUE_SLUG, type League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { yearScope } from '../../../../../lib/providerRefreshScope.ts';
import { acquireRankingsRefreshLease } from '../../../../../lib/rankings/refreshLease.ts';
import {
  claimRankingsPublicationWindow,
  normalizeRankingsPublicationWindowControl,
  RANKINGS_PUBLICATION_WINDOW_SCOPE,
  type RankingsPublicationWindowControl,
} from '../../../../../lib/rankings/publicationWindowControl.ts';
import { __resetSeasonRankingsCacheForTests } from '../../../../../lib/server/rankings.ts';
import { __resetUpstreamPacingForTests } from '../../../../../lib/api/fetchUpstream.ts';
import type { RankingsCronExecutionEvent } from '../../../../../lib/rankings/cronExecutionLog.ts';

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

// Deterministic heartbeat fixtures (weekdays asserted below): a Sunday 22:00 UTC
// slot puts an in-season year inside the weekly-ap-coaches window; 21:00 the
// same day is not a heartbeat slot. `node:test` mock timers (Date API only) pin
// the route-entry instant; every other timer stays real.
const YEAR = 2031;
const SLOT_WEEKLY_MS = Date.parse('2031-10-05T22:00:00.000Z'); // Sunday 22:00
const OFF_SLOT_MS = Date.parse('2031-10-05T21:00:00.000Z'); // Sunday 21:00
const WEEKLY_KEY = `${YEAR}:weekly-ap-coaches:2031-10-05`;
const FIRST_KICKOFF = '2031-08-30T18:00:00.000Z'; // Saturday, well before the slot

test('fixture weekdays are what these tests assume', () => {
  assert.equal(new Date(SLOT_WEEKLY_MS).getUTCDay(), 0, 'slot is a Sunday');
  assert.equal(new Date(SLOT_WEEKLY_MS).getUTCHours(), 22);
  assert.equal(new Date(FIRST_KICKOFF).getUTCDay(), 6, 'kickoff is a Saturday');
});

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2005, // deliberately wrong — targeting must never read league.year
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  } as League;
}

/** Append one league. Pass `TEST_LEAGUE_SLUG` to seed the DEMO league. */
async function seedLeague(
  year: number,
  state: 'season' | 'preseason' = 'season',
  slug = `league-${year}-${state}`
): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [...existing, makeLeague(slug, { state, year })]);
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

/** A usable CFBD rankings payload for `year` (season labels must match — E2A). */
function usablePayload(year: number, school = 'Georgia'): unknown[] {
  return [
    {
      season: year,
      seasonType: 'regular',
      week: 6,
      polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school, conference: null }] }],
    },
  ];
}

type PartitionStub = unknown[] | 'fail';
type InfoStub = { remainingCalls?: unknown; patronLevel?: unknown } | 'fail' | 'throw';

/**
 * PLATFORM-086F2H1T4 — every request URL this run observed, recorded BEFORE any
 * parsing and BEFORE any path branching.
 *
 * `fetchLog` below stays the precise behavioral counter, but it can only record
 * the two endpoints it recognizes, and only once `new URL()` has parsed. Both
 * consumers on this path swallow a stub throw (the quota probe's `catch` in the
 * route, and E2A's `fetch-failed` catch), so a counter that increments after
 * parsing/branching would report zero for a request that really was attempted.
 * Every "no provider request" assertion in this file rests on THIS log; the
 * positive control below proves it records all three `fetch` input shapes and
 * an unrecognized endpoint.
 */
const providerUrlLog: string[] = [];

const fetchLog: { info: number; rankings: string[]; sequence: string[] } = {
  info: 0,
  rankings: [],
  sequence: [],
};

/** Stub CFBD: `/info` (quota probe) and per-year `/rankings` partitions. */
function stubProvider(opts: {
  info?: InfoStub;
  rankings?: Record<number, { regular: PartitionStub; postseason: PartitionStub }>;
  onRankingsRequest?: () => void;
}): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    // Resolve the href from every input shape, then record — before parsing,
    // before branching. `Request` does NOT override `toString()`, so
    // `String(request)` is the literal "[object Request]" and `new URL()` on it
    // throws; `.url` is the only correct resolution for that shape.
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    providerUrlLog.push(href);
    const url = new URL(href);
    if (url.pathname === '/info') {
      fetchLog.info += 1;
      fetchLog.sequence.push('info');
      const info = opts.info ?? { remainingCalls: 4000, patronLevel: 1 };
      if (info === 'throw') throw new Error('info transport down');
      if (info === 'fail') return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/rankings') {
      const year = Number(url.searchParams.get('year'));
      const seasonType =
        url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
      fetchLog.rankings.push(`${year}:${seasonType}`);
      fetchLog.sequence.push(String(year));
      opts.onRankingsRequest?.();
      const partitions = opts.rankings?.[year];
      const body = partitions ? partitions[seasonType] : [];
      // 400 is outside the E2A retry policy → one failed attempt, no retries.
      if (body === 'fail') return new Response('bad request', { status: 400 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected provider request: ${url.pathname}`);
  }) as typeof fetch;
}

const eventLines: RankingsCronExecutionEvent[] = [];

function captureEvents(): void {
  eventLines.length = 0;
  console.log = ((...args: unknown[]) => {
    const line = typeof args[0] === 'string' ? args[0] : '';
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed.event === 'rankings-cron') {
        eventLines.push(parsed as RankingsCronExecutionEvent);
      }
    } catch {
      // Non-JSON output — ignore.
    }
  }) as typeof console.log;
}

function request(auth: string | null = `Bearer ${CRON_SECRET}`): Request {
  return new Request(
    'http://localhost/api/cron/rankings',
    auth ? { headers: { authorization: auth } } : undefined
  );
}

async function windowControl(key: string): Promise<RankingsPublicationWindowControl> {
  return normalizeRankingsPublicationWindowControl(
    key,
    (await getAppState<unknown>(RANKINGS_PUBLICATION_WINDOW_SCOPE, key))?.value
  );
}

type CronBody = {
  result: string;
  reason: string;
  years: Array<Record<string, unknown>>;
};

test.beforeEach(async () => {
  providerUrlLog.length = 0;
  fetchLog.info = 0;
  fetchLog.rankings = [];
  fetchLog.sequence = [];
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  // The mocked Date jumps backward between tests; stale pacing state would turn
  // the 150 ms CFBD pacing wait into an unbounded sleep.
  __resetUpstreamPacingForTests();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider({});
  captureEvents();
});

test.afterEach(() => {
  console.log = ORIGINAL_CONSOLE_LOG;
});

test.after(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T4 — observer positive control
//
// Runs FIRST: every zero-provider-call assertion in this file (and the demo
// exclusion tests below) is only meaningful if the observer would have caught a
// request. Proven here for all three `fetch` input shapes AND for an endpoint
// the stub does not recognize.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: the observer records every input shape before parsing', async () => {
  const target = 'https://api.collegefootballdata.com/info?probe=1';
  await globalThis.fetch(target);
  await globalThis.fetch(new URL(target));
  await globalThis.fetch(new Request(target));
  // `Request` is the shape a parse-then-record observer silently loses, because
  // `String(request)` is "[object Request]" and `new URL()` rejects that. This
  // deepEqual is the proof that matters: all three shapes reach the log.
  assert.deepEqual(providerUrlLog, [target, target, target], 'all three shapes record the href');
});

test('POSITIVE CONTROL: the observer records an endpoint the stub rejects', async () => {
  const unknown = 'https://api.collegefootballdata.com/teams?probe=1';
  // The stub throws for unrecognized endpoints, and BOTH callers on this path
  // swallow that throw — so a record-after-branch observer would report zero
  // requests for a request that really was made.
  await assert.rejects(() => globalThis.fetch(unknown));
  assert.deepEqual(providerUrlLog, [unknown]);
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0, 'the specialized counters saw nothing');
});

// ---------------------------------------------------------------------------
// 1/2 — authentication before everything
// ---------------------------------------------------------------------------

test('a missing CRON_SECRET is 401 with one failure event and zero downstream work', async () => {
  delete MUTABLE_ENV.CRON_SECRET;
  await seedLeague(YEAR);

  const res = await GET(request());
  assert.equal(res.status, 401);

  assert.equal(fetchLog.info, 0);
  assert.deepEqual(fetchLog.rankings, []);
  assert.equal(eventLines.length, 1, 'exactly one event');
  assert.equal(eventLines[0]?.result, 'failure');
  assert.equal(eventLines[0]?.reason, 'cron-secret-not-configured');
  assert.deepEqual(eventLines[0]?.years, []);
  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, null, 'no fabricated provider attempt');
});

test('invalid cron authorization is 401 with one failure event and no secret leak', async () => {
  await seedLeague(YEAR);
  const res = await GET(request('Bearer wrong-secret'));
  assert.equal(res.status, 401);
  const text = JSON.stringify(await res.json());
  assert.ok(!text.includes(CRON_SECRET), 'secret never echoed');

  assert.equal(eventLines.length, 1);
  assert.equal(eventLines[0]?.reason, 'cron-authorization-invalid');
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  assert.ok(!JSON.stringify(eventLines[0]).includes(CRON_SECRET));
});

// ---------------------------------------------------------------------------
// 2/3 — automation gate and settings/registry failures
// ---------------------------------------------------------------------------

test('the global pause skips the entire run before any context/claim/quota work', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  await setGlobalPause(true);

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200);
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'automation-paused-or-disabled');
  assert.deepEqual(body.years, []);
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  assert.equal((await windowControl(WEEKLY_KEY)).claim, null, 'no window claim');
});

test('the Rankings toggle Off skips the entire run', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  await setDatasetAutoRefreshEnabled('rankings', false);

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'automation-paused-or-disabled');
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
});

test('a settings-store failure is a controlled generic failure with no downstream work', async () => {
  await seedLeague(YEAR);
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  try {
    const res = await GET(request());
    const body = (await res.json()) as CronBody;
    assert.equal(res.status, 200);
    assert.equal(body.result, 'failure');
    assert.equal(body.reason, 'settings-unavailable');
    assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('a registry read failure is registry-unavailable with no downstream work', async () => {
  __setAppStateReadFailureForTests(new Error('registry down'), 'leagues');
  try {
    const res = await GET(request());
    const body = (await res.json()) as CronBody;
    assert.equal(res.status, 200);
    assert.equal(body.result, 'failure');
    assert.equal(body.reason, 'registry-unavailable');
    assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('no eligible lifecycle years is a provider-free no-ranking-target skip', async () => {
  await setAppState('leagues', 'registry', [makeLeague('off', { state: 'offseason' })]);
  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-ranking-target');
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  assert.deepEqual(providerUrlLog, []);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T4 — the demo league is manual-only for automatic rankings
// publication. Ownership resolves from PRODUCTION leagues only.
// ---------------------------------------------------------------------------

// CONTRACT PIN — an inactive demo record is not an excluded CANDIDATE, so the
// genuinely-empty reason keeps its exact meaning.
test('T4 contract pin: an offseason demo league keeps the no-ranking-target reason', async () => {
  await setAppState('leagues', 'registry', [makeLeague(TEST_LEAGUE_SLUG, { state: 'offseason' })]);
  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-ranking-target');
  assert.deepEqual(providerUrlLog, []);
});

// REGRESSION TEST — the fixture is the happy path's: a DUE weekly window with a
// funded quota and a usable payload, so without the exclusion this run reaches
// `/info` and both rankings partitions.
test('T4 regression: a gates-open demo-only registry with a DUE window spends nothing', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR, 'season', TEST_LEAGUE_SLUG);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({
    info: { remainingCalls: 4000, patronLevel: 1 },
    rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } },
  });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200);
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-automatic-ranking-target');
  assert.deepEqual(body.years, [], 'no per-year entry for a demo-only year');

  // No provider request of any endpoint or input shape (observer proven above).
  assert.deepEqual(providerUrlLog, []);
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);

  // No publication-window control, no rankings commit, no provider-status attempt.
  assert.equal(await getAppState(RANKINGS_PUBLICATION_WINDOW_SCOPE, WEEKLY_KEY), null);
  assert.equal(await getAppState('rankings', String(YEAR)), null);
  assert.equal(
    (await getProviderRefreshStatus('rankings', yearScope(YEAR))).latestAttemptOutcome,
    null
  );

  // The single event mirrors the response exactly.
  assert.equal(eventLines.length, 1);
  assert.equal(eventLines[0]?.result, 'skipped');
  assert.equal(eventLines[0]?.reason, 'no-automatic-ranking-target');
  assert.deepEqual(eventLines[0]?.years, []);
});

// CONTRACT PIN — the automation gate stays AHEAD of target selection. The
// registry read is poisoned: if selection ran first this would be
// `failure / registry-unavailable`, raising a scheduler-execution issue for a
// job the operator deliberately paused. It also pins that a paused demo-only
// run keeps reporting the pause, not the new reason.
test('T4 contract pin: a paused run never reaches target selection', async () => {
  await seedLeague(YEAR, 'season', TEST_LEAGUE_SLUG);
  await setGlobalPause(true);
  __setAppStateReadFailureForTests(new Error('registry down'), 'leagues');
  try {
    const res = await GET(request());
    const body = (await res.json()) as CronBody;
    assert.equal(res.status, 200);
    assert.equal(body.result, 'skipped');
    assert.equal(body.reason, 'automation-paused-or-disabled');
    assert.deepEqual(body.years, []);
    assert.deepEqual(providerUrlLog, []);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

// REGRESSION TEST — a SHARED year keeps production maintenance, and the demo no
// longer determines its reported lifecycle. Doubles as a production POSITIVE
// CONTROL: the same observer records the real `/info` + partition traffic.
test('T4 regression: a shared year runs on the production league and its lifecycle', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR, 'season', TEST_LEAGUE_SLUG); // would outrank...
  await seedLeague(YEAR, 'preseason'); // ...this production league
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } } });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'success');
  assert.equal(body.years.length, 1);
  assert.equal(body.years[0]?.year, YEAR);
  // Reporting truth only: `lifecycle` is inert in the publication classifier, so
  // the window kind, publication key, quota gate, and provider requests asserted
  // below are identical in both directions.
  assert.equal(body.years[0]?.lifecycle, 'preseason');
  assert.equal(body.years[0]?.publicationWindow, 'weekly-ap-coaches');
  assert.equal(body.years[0]?.publicationKey, WEEKLY_KEY);
  assert.equal(eventLines[0]?.years[0]?.lifecycle, 'preseason');

  assert.equal(fetchLog.info, 1);
  assert.deepEqual(fetchLog.rankings.sort(), [`${YEAR}:postseason`, `${YEAR}:regular`]);
  assert.equal(providerUrlLog.length, 3, 'the observer saw exactly the probe plus both partitions');
});

// REGRESSION TEST — a demo-only year alongside a distinct production year is
// absent from every surface. Its schedule is seeded so its own weekly window
// WOULD be due without the exclusion.
test('T4 regression: a demo-only year never appears while a production year executes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  const DEMO_YEAR = 2033;
  const DEMO_KEY = `${DEMO_YEAR}:weekly-ap-coaches:2031-10-05`;
  await seedLeague(DEMO_YEAR, 'preseason', TEST_LEAGUE_SLUG);
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  await seedSchedule(DEMO_YEAR, '2031-11-15T18:00:00.000Z');
  stubProvider({
    rankings: {
      [YEAR]: { regular: usablePayload(YEAR), postseason: [] },
      [DEMO_YEAR]: { regular: usablePayload(DEMO_YEAR, 'Michigan'), postseason: [] },
    },
  });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'success');
  assert.deepEqual(
    body.years.map((y) => y.year),
    [YEAR],
    'only the production year is a target'
  );
  assert.deepEqual(
    eventLines[0]?.years.map((y) => y.year),
    [YEAR]
  );

  // One probe, one partition pair — the demo year never reached the quota gate.
  assert.equal(fetchLog.info, 1);
  assert.deepEqual(fetchLog.rankings.sort(), [`${YEAR}:postseason`, `${YEAR}:regular`]);
  assert.ok(
    !providerUrlLog.some((url) => url.includes(`year=${DEMO_YEAR}`)),
    'no request names the demo year'
  );

  // No durable trace of the demo year; the production year committed.
  assert.equal(await getAppState(RANKINGS_PUBLICATION_WINDOW_SCOPE, DEMO_KEY), null);
  assert.equal(await getAppState('rankings', String(DEMO_YEAR)), null);
  assert.equal(
    (await getProviderRefreshStatus('rankings', yearScope(DEMO_YEAR))).latestAttemptOutcome,
    null
  );
  assert.ok(await getAppState('rankings', String(YEAR)), 'the production year committed');
});

// ---------------------------------------------------------------------------
// 6 — heartbeat/window skips are provider-free
// ---------------------------------------------------------------------------

test('a non-heartbeat instant skips every year with no claim and no quota work', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: OFF_SLOT_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'not-a-heartbeat-slot');
  assert.equal(body.years.length, 1);
  assert.equal(body.years[0]?.result, 'skipped');
  assert.equal(body.years[0]?.publicationWindow, null);
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  assert.equal(
    await getAppState(RANKINGS_PUBLICATION_WINDOW_SCOPE, WEEKLY_KEY),
    null,
    'no window control written'
  );
  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, null);
});

test('a heartbeat slot with no due window skips provider-free (absent schedule → nulls)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR); // no schedule seeded → null kickoff → weekly not due

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-window-due');
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
});

// 5 (context) — malformed cached state refuses provider work for the year.
test('unavailable context is a year failure with no claim or provider work', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await setAppState('schedule', `${YEAR}-all-all`, { at: 1, items: 'corrupt' });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable');
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
});

// ---------------------------------------------------------------------------
// 10 — the due-window happy path
// ---------------------------------------------------------------------------

test('a due weekly window claims, probes quota fresh, refreshes via E2A, and completes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({
    info: { remainingCalls: 4000, patronLevel: 1 },
    rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } },
  });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success');
  assert.equal(body.reason, 'written-clean');
  assert.equal(body.years.length, 1);
  const year = body.years[0]!;
  assert.equal(year.year, YEAR);
  assert.equal(year.lifecycle, 'season');
  assert.equal(year.publicationWindow, 'weekly-ap-coaches');
  assert.equal(year.publicationKey, WEEKLY_KEY);
  assert.equal(year.result, 'success');
  assert.equal(year.reason, 'written-clean');
  assert.equal(year.quotaChecked, true);
  assert.equal(year.quotaRemaining, 4000);
  assert.deepEqual(year.attemptedSeasonTypes, ['regular', 'postseason']);
  assert.equal(year.providerCallAttempted, true);
  assert.equal(year.rowsReceived, 1);
  assert.equal(year.rowsCommitted, 1);
  assert.equal(year.dataChanged, true);

  assert.equal(fetchLog.info, 1, 'exactly one fresh /info probe');
  assert.deepEqual(fetchLog.rankings.sort(), [`${YEAR}:postseason`, `${YEAR}:regular`]);

  // The window is durably completed; the rankings snapshot committed.
  const control = await windowControl(WEEKLY_KEY);
  assert.ok(control.completedAt, 'window completed');
  assert.equal(control.claim, null);
  assert.ok(await getAppState('rankings', String(YEAR)), 'rankings committed durably');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'succeeded');

  // The single event mirrors the response.
  assert.equal(eventLines.length, 1);
  assert.equal(eventLines[0]?.result, 'success');
  assert.equal(eventLines[0]?.years.length, 1);
});

// 8 — a repeated delivery for a completed key spends nothing.
test('a repeated delivery of a completed window performs no /info and no rankings request', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({
    rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } },
  });

  const first = await GET(request());
  assert.equal(((await first.json()) as CronBody).result, 'success');
  const spentInfo = fetchLog.info;
  const spentRankings = fetchLog.rankings.length;

  // The SAME slot redelivered (at-least-once delivery).
  t.mock.timers.tick(30_000);
  const second = await GET(request());
  const body = (await second.json()) as CronBody;
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'publication-window-complete');
  assert.equal(body.years[0]?.publicationKey, WEEKLY_KEY);
  assert.equal(fetchLog.info, spentInfo, 'zero additional /info probes');
  assert.equal(fetchLog.rankings.length, spentRankings, 'zero additional rankings requests');
});

// 11 — a clean pre-poll no-op completes the window without fabricated rows.
test('an empty-response no-op completes the window with zero committed rows', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ rankings: { [YEAR]: { regular: [], postseason: [] } } });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'no-op');
  assert.equal(body.reason, 'empty-response');
  assert.equal(body.years[0]?.rowsCommitted, 0);
  assert.equal(body.years[0]?.dataChanged, false);
  assert.ok((await windowControl(WEEKLY_KEY)).completedAt, 'no-op still completes the window');

  // A redelivery is a provider-free completed-window skip.
  t.mock.timers.tick(30_000);
  const spent = fetchLog.info + fetchLog.rankings.length;
  const second = await GET(request());
  assert.equal(((await second.json()) as CronBody).reason, 'publication-window-complete');
  assert.equal(fetchLog.info + fetchLog.rankings.length, spent);
});

// ---------------------------------------------------------------------------
// 9 — the quota gate
// ---------------------------------------------------------------------------

test('trustworthy remaining 1007 permits the refresh; 1006 refuses below-reserve', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);

  // 1006 → refused; the claim is released so the window stays retryable.
  stubProvider({
    info: { remainingCalls: 1006, patronLevel: 1 },
    rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } },
  });
  const refused = await GET(request());
  const refusedBody = (await refused.json()) as CronBody;
  assert.equal(refusedBody.result, 'failure');
  assert.equal(refusedBody.reason, 'quota-below-reserve');
  assert.equal(refusedBody.years[0]?.quotaChecked, true);
  assert.equal(refusedBody.years[0]?.quotaRemaining, 1006);
  assert.equal(refusedBody.years[0]?.providerCallAttempted, false);
  assert.deepEqual(fetchLog.rankings, [], 'no rankings request on refusal');
  const afterRefusal = await windowControl(WEEKLY_KEY);
  assert.equal(afterRefusal.completedAt, null);
  assert.equal(afterRefusal.claim, null, 'claim released for a later retry');

  // 1007 → permitted (the released window is claimable again).
  t.mock.timers.tick(30_000);
  stubProvider({
    info: { remainingCalls: 1007, patronLevel: 1 },
    rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } },
  });
  const permitted = await GET(request());
  const permittedBody = (await permitted.json()) as CronBody;
  assert.equal(permittedBody.result, 'success');
  assert.equal(permittedBody.years[0]?.quotaRemaining, 1007);
  assert.equal(fetchLog.rankings.length, 2);
});

test('a thrown /info probe fails closed as quota-usage-unavailable without invoking E2A', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ info: 'throw' });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'quota-usage-unavailable');
  assert.equal(body.years[0]?.quotaChecked, true);
  assert.equal(body.years[0]?.quotaRemaining, null);
  assert.deepEqual(fetchLog.rankings, []);
  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, null, 'no fabricated rankings attempt');
});

test('a failed /info HTTP response fails closed as quota-usage-unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ info: 'fail' });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.reason, 'quota-usage-unavailable');
  assert.deepEqual(fetchLog.rankings, []);
});

test('malformed usage fails closed as quota-usage-untrustworthy', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  // remaining > canonical tier limit (patronLevel 1 → 5,000) is inconsistent.
  stubProvider({ info: { remainingCalls: 6000, patronLevel: 1 } });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.reason, 'quota-usage-untrustworthy');
  assert.deepEqual(fetchLog.rankings, []);
});

// ---------------------------------------------------------------------------
// 12 — E2A contention and failure release the window
// ---------------------------------------------------------------------------

test('E2A refresh contention releases the window claim and reports in-progress', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } } });

  // Another writer already holds the E2A per-year refresh lease.
  const held = await acquireRankingsRefreshLease({ year: YEAR, now: Date.now() });
  assert.equal(held.acquired, true);

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'in-progress');
  assert.equal(body.reason, 'refresh-in-progress');
  assert.equal(body.years[0]?.providerCallAttempted, false);
  assert.deepEqual(fetchLog.rankings, [], 'the losing refresh made no provider request');

  const control = await windowControl(WEEKLY_KEY);
  assert.equal(control.completedAt, null, 'contention never completes the window');
  assert.equal(control.claim, null, 'the window claim was released');
});

test('an E2A failure retains its exact reason and releases the window for retry', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({
    rankings: { [YEAR]: { regular: 'fail', postseason: usablePayload(YEAR) } },
  });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'provider-fetch-failed', 'the exact E2A reason rides through');
  assert.equal(body.years[0]?.providerCallAttempted, true);
  assert.equal(body.years[0]?.rowsReceived, 1, 'the fulfilled sibling rows still count');
  assert.equal(body.years[0]?.rowsCommitted, 0);

  const control = await windowControl(WEEKLY_KEY);
  assert.equal(control.completedAt, null);
  assert.equal(control.claim, null, 'released — the window is retryable next delivery');
});

// 7 (route) — an active foreign window claim defers with no quota work.
test('an active window claim from another delivery defers provider-free', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  const foreign = await claimRankingsPublicationWindow({
    publicationKey: WEEKLY_KEY,
    now: Date.now(),
  });
  assert.equal(foreign.kind, 'claimed');

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'in-progress');
  assert.equal(body.reason, 'publication-window-in-progress');
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0, 'no quota or provider work');
});

// 7 (route) — a control-store failure fails closed before quota work.
test('a window-control store failure fails closed as publication-control-unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  __setAppStateWriteFailureForTests(
    new Error('control store down'),
    RANKINGS_PUBLICATION_WINDOW_SCOPE
  );
  try {
    const res = await GET(request());
    const body = (await res.json()) as CronBody;
    assert.equal(body.result, 'failure');
    assert.equal(body.reason, 'publication-control-unavailable');
    assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});

// ---------------------------------------------------------------------------
// 13 — unconfirmed completion after successful provider work
// ---------------------------------------------------------------------------

test('a completion-store failure after a successful refresh is a truthful partial', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  // The claim succeeds (before the failure is armed); the completion write —
  // armed once the rankings fetch starts — fails scoped to the window scope, so
  // the E2A commit (scope `rankings`) is unaffected.
  stubProvider({
    rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } },
    onRankingsRequest: () =>
      __setAppStateWriteFailureForTests(
        new Error('completion store down'),
        RANKINGS_PUBLICATION_WINDOW_SCOPE
      ),
  });

  try {
    const res = await GET(request());
    const body = (await res.json()) as CronBody;
    assert.equal(body.result, 'partial');
    assert.equal(body.reason, 'publication-completion-unconfirmed');
    const year = body.years[0]!;
    assert.equal(year.result, 'partial');
    assert.equal(year.reason, 'publication-completion-unconfirmed');
    // The E2A outcome fields are preserved, not replaced or retried.
    assert.equal(year.providerCallAttempted, true);
    assert.equal(year.rowsCommitted, 1);
    assert.equal(fetchLog.rankings.length, 2, 'no blind retry of provider work');
    assert.ok(await getAppState('rankings', String(YEAR)), 'the refresh commit stands');
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  // The window was NOT completed; the claim reconciles by expiry.
  const control = await windowControl(WEEKLY_KEY);
  assert.equal(control.completedAt, null);
});

// ---------------------------------------------------------------------------
// 14 — multi-year ordering and per-year fresh quota
// ---------------------------------------------------------------------------

test('multiple due years execute ascending with a fresh probe and one refresh each', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  const YEAR2 = 2032;
  await seedLeague(YEAR2, 'preseason'); // seeded out of order — must execute ascending
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  // A 2032 first kickoff 41 days after the slot keeps Sunday 22:00 inside the
  // 45-day weekly lead for the preseason year too.
  await seedSchedule(YEAR2, '2031-11-15T18:00:00.000Z');
  stubProvider({
    rankings: {
      [YEAR]: { regular: usablePayload(YEAR), postseason: [] },
      [YEAR2]: { regular: usablePayload(YEAR2, 'Michigan'), postseason: [] },
    },
  });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'success');
  assert.deepEqual(
    body.years.map((y) => y.year),
    [YEAR, YEAR2],
    'ascending year order'
  );
  assert.deepEqual(
    body.years.map((y) => y.lifecycle),
    ['season', 'preseason']
  );
  assert.equal(fetchLog.info, 2, 'one FRESH quota probe per due year');
  assert.equal(fetchLog.rankings.length, 4, 'one two-partition refresh per year');
  // The reserve is re-evaluated BEFORE every due year's spend: each year's
  // probe precedes its own partition pair, and the second probe follows the
  // first year's spend (review P3 #4 — exact interleaving, not just counts).
  assert.deepEqual(
    fetchLog.sequence,
    ['info', '2031', '2031', 'info', '2032', '2032'],
    'probe → spend → probe → spend ordering'
  );
  assert.ok((await windowControl(WEEKLY_KEY)).completedAt);
  assert.ok((await windowControl(`${YEAR2}:weekly-ap-coaches:2031-10-05`)).completedAt);
});

// 14 — a skipped sibling never degrades an executed year's aggregate.
test('a no-window sibling is excluded from partial aggregation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  const YEAR2 = 2032;
  await seedLeague(YEAR);
  await seedLeague(YEAR2, 'preseason'); // no schedule → null kickoff → no window
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } } });

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(body.result, 'success', 'the sibling skip does not degrade the aggregate');
  assert.equal(body.reason, 'year-results');
  assert.equal(body.years.length, 2);
  assert.equal(body.years[0]?.result, 'success');
  assert.equal(body.years[1]?.result, 'skipped');
  assert.equal(body.years[1]?.reason, 'no-window-due');
});

// ---------------------------------------------------------------------------
// 15/16/17 — event integrity
// ---------------------------------------------------------------------------

test('exactly one event with the exact allowlisted keys and no credential canaries', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } } });

  await GET(request());
  assert.equal(eventLines.length, 1);
  const event = eventLines[0]!;
  assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'event', 'reason', 'result', 'years']);
  assert.equal(event.event, 'rankings-cron');
  assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0);
  assert.deepEqual(Object.keys(event.years[0]!).sort(), [
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
  ]);
  const serialized = JSON.stringify(event);
  for (const canary of [CRON_SECRET, 'test-cfbd-token', 'Bearer ', 'Georgia', 'authorization']) {
    assert.ok(!serialized.includes(canary), `event must not contain ${canary}`);
  }
});

test('an unexpected exception propagates while emitting one failure event', async () => {
  // A malformed Request (no headers) throws inside the handler — outside every
  // controlled branch — and must still emit the pessimistic failure event.
  await assert.rejects(() => GET({} as unknown as Request));
  assert.equal(eventLines.length, 1);
  assert.equal(eventLines[0]?.result, 'failure');
  assert.equal(eventLines[0]?.reason, 'unexpected-error');
});

test('a throwing logger changes neither the response nor durable outcomes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ rankings: { [YEAR]: { regular: usablePayload(YEAR), postseason: [] } } });
  console.log = (() => {
    throw new Error('logger down');
  }) as typeof console.log;

  const res = await GET(request());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success');
  assert.ok((await windowControl(WEEKLY_KEY)).completedAt, 'window completion unaffected');
});
