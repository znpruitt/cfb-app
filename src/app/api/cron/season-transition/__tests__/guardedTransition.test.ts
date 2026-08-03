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
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import type { SeasonTransitionCronExecutionEvent } from '../../../../../lib/lifecycleCronExecutionLog.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 — the daily season-transition cron drives the GUARDED
// preseason→season authority. Its registry snapshot is read once, before
// lengthy schedule work, so by write time a league may have been rolled over,
// moved to another preseason year, or transitioned by someone else. Those
// leagues are REFUSED, never overwritten; a refusal is never counted as a
// successful transition and never reported as cron success.
//
// The ordinary path (no concurrent actor) is unchanged and stays pinned here
// alongside route.test.ts / receipts.test.ts.
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret';
const YEAR = 2023;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function makeLeague(slug: string, status: League['status'], year = YEAR): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seedRegistry(leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

async function readLeague(slug: string): Promise<League | undefined> {
  return (await readRegistry()).find((l) => l.slug === slug);
}

/** A past first-game date satisfies the transition time gate (now >= first − 1d). */
async function seedPastProbe(): Promise<void> {
  await setAppState('schedule-probe', String(YEAR), {
    year: YEAR,
    baseCachedAt: '2023-01-01T00:00:00.000Z',
    firstGameDate: '2023-08-26T00:00:00.000Z',
  });
}

/**
 * Neutralize the upstream CFBD fetch (empty schedule → the seeded probe alone
 * drives the transition). `onFirstFetch` runs ONCE, inside the refresh — i.e.
 * strictly after the route captured its registry snapshot and strictly before
 * any lifecycle write — which is exactly the window a competing lifecycle actor
 * would land in.
 */
function stubFetchEmptySchedule(onFirstFetch?: () => Promise<void>): void {
  let fired = false;
  globalThis.fetch = (async () => {
    if (onFirstFetch && !fired) {
      fired = true;
      await onFirstFetch();
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-transition', { headers });
}

type CronYear = {
  year: number;
  transitioned: boolean;
  leagues: string[];
  refusedLeagues?: string[];
};

type RunResult = {
  res: Response;
  body: { years: CronYear[]; error?: string };
  event: SeasonTransitionCronExecutionEvent;
  tags: string[];
};

/** Run GET under the Next work store, capturing exactly one structured event. */
async function runRoute(req: Request = cronRequest()): Promise<RunResult> {
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  let res: Response;
  try {
    res = await workAsyncStorage.run(store as never, () => GET(req));
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  const events: SeasonTransitionCronExecutionEvent[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'season-transition-cron')
        events.push(parsed as SeasonTransitionCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }
  assert.equal(events.length, 1, 'exactly one season-transition-cron event');
  return {
    res,
    body: (await res.json()) as RunResult['body'],
    event: events[0]!,
    tags: store.pendingRevalidatedTags,
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubFetchEmptySchedule();
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

// ---------------------------------------------------------------------------
// The ordinary path is unchanged

test('the ordinary transition path is unchanged — confirmed flip, no refusal surface', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  const { res, body, event, tags } = await runRoute();

  assert.equal(res.status, 200);
  assert.equal(body.years.length, 1);
  const year = body.years[0]!;
  assert.equal(year.transitioned, true);
  assert.deepEqual(year.leagues, ['alpha']);
  assert.ok(
    !('refusedLeagues' in year),
    'the refusal field is absent on an unchanged ordinary run'
  );
  assert.ok(tags.includes('standings:alpha'), 'standings invalidated on the confirmed flip');

  const stored = await readLeague('alpha');
  assert.deepEqual(stored?.status, { state: 'season', year: YEAR });
  assert.equal(stored?.year, YEAR, 'league.year stays synchronized with status.year');

  assert.equal(event.result, 'success');
  assert.equal(event.reason, 'season-transitioned');
  assert.equal(event.years[0]!.transitionedLeagues, 1);
});

// ---------------------------------------------------------------------------
// A stale snapshot cannot overwrite newer lifecycle state

test('a stale snapshot cannot overwrite a league another actor rolled to offseason', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  // A competing lifecycle actor lands after the snapshot, before the write.
  stubFetchEmptySchedule(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'offseason' })]);
  });

  const { res, body, event, tags } = await runRoute();

  assert.equal(res.status, 200, 'a refusal is not an error');
  const year = body.years[0]!;
  assert.equal(year.transitioned, false, 'a refused transition is never reported as success');
  assert.deepEqual(year.leagues, [], 'refused leagues are never counted as transitioned');
  assert.deepEqual(year.refusedLeagues, ['alpha']);
  assert.ok(!tags.includes('standings:alpha'), 'no standings invalidation without a real flip');

  const stored = await readLeague('alpha');
  assert.deepEqual(stored?.status, { state: 'offseason' }, 'the newer state survived intact');

  assert.equal(event.years[0]!.transitionedLeagues, 0);
  assert.equal(event.years[0]!.reason, 'lifecycle-transition-refused');
  assert.equal(
    event.years[0]!.result,
    'partial',
    'a refusal is surfaced (System Health raises an issue only for failure/partial)'
  );
  assert.equal(event.result, 'partial', 'the aggregate is never success');
});

test('a stale snapshot cannot overwrite a league already advanced to a different preseason year', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchEmptySchedule(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR + 1 }, YEAR + 1)]);
  });

  const { body, event } = await runRoute();

  assert.equal(body.years[0]!.transitioned, false);
  assert.deepEqual(body.years[0]!.refusedLeagues, ['alpha']);
  const stored = await readLeague('alpha');
  assert.deepEqual(stored?.status, { state: 'preseason', year: YEAR + 1 });
  assert.equal(event.result, 'partial');
  assert.equal(event.reason, 'lifecycle-transition-refused');
});

test('a stale snapshot cannot re-transition a league another actor already moved to season', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchEmptySchedule(async () => {
    await seedRegistry([
      // Already transitioned AND then advanced — the refusal protects the later state.
      makeLeague('alpha', { state: 'season', year: YEAR }),
    ]);
  });

  const { body, event } = await runRoute();

  assert.deepEqual(body.years[0]!.leagues, []);
  assert.deepEqual(body.years[0]!.refusedLeagues, ['alpha']);
  const stored = await readLeague('alpha');
  assert.deepEqual(stored?.status, { state: 'season', year: YEAR });
  assert.equal(event.years[0]!.transitionedLeagues, 0);
});

test('a mixed year reports the confirmed transition and the refusal truthfully', async () => {
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubFetchEmptySchedule(async () => {
    await seedRegistry([
      makeLeague('alpha', { state: 'offseason' }),
      makeLeague('bravo', { state: 'preseason', year: YEAR }),
    ]);
  });

  const { body, event, tags } = await runRoute();

  const year = body.years[0]!;
  assert.deepEqual(year.leagues, ['bravo'], 'only the confirmed transition is counted');
  assert.deepEqual(year.refusedLeagues, ['alpha']);
  assert.equal(year.transitioned, true, 'a real transition still happened this run');
  assert.ok(tags.includes('standings:bravo'));
  assert.ok(!tags.includes('standings:alpha'));

  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'offseason' });
  assert.deepEqual((await readLeague('bravo'))?.status, { state: 'season', year: YEAR });

  assert.equal(event.years[0]!.transitionedLeagues, 1);
  assert.equal(event.years[0]!.targetLeagues, 2);
  assert.equal(event.years[0]!.result, 'partial', 'never success while a target was refused');
  assert.equal(event.years[0]!.reason, 'lifecycle-transition-refused');
});

test('a refused transition is recorded in the durable receipt, never as success', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchEmptySchedule(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'offseason' })]);
  });

  await runRoute();
  await deferrer.flush();

  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt, 'a receipt was written for the authenticated invocation');
  assert.equal(receipt.value.result, 'partial');
  assert.equal(receipt.value.reason, 'lifecycle-transition-refused');
});

test('a refusal after a POPULATED schedule commit is never reported as a no-op run', async () => {
  // Coverage gap raised at F2H1 review: every other refusal test stubs an empty
  // schedule, so `cached` is always false. Here the E1A refresh genuinely
  // succeeds with rows — a billed provider call plus a durable canonical commit
  // — and THEN every league is refused. Reporting `no-op` would assert that
  // nothing was left to do on a run that actually performed provider I/O.
  const games = JSON.stringify([
    {
      id: '1-Alpha U-Beta U',
      week: 1,
      home_team: 'Alpha U',
      away_team: 'Beta U',
      start_date: '2023-08-26T00:00:00.000Z',
      completed: false,
    },
  ]);
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  let fired = false;
  globalThis.fetch = (async (input: URL | string) => {
    if (!fired) {
      fired = true;
      await seedRegistry([makeLeague('alpha', { state: 'offseason' })]);
    }
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = url.searchParams.get('seasonType') === 'postseason' ? '[]' : games;
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { res, body, event } = await runRoute();

  assert.equal(res.status, 200);
  assert.deepEqual(body.years[0]!.leagues, []);
  assert.deepEqual(body.years[0]!.refusedLeagues, ['alpha']);

  const entry = event.years[0]!;
  assert.equal(entry.cached, true, 'a populated schedule was durably committed this run');
  assert.equal(entry.providerCallAttempted, true, 'the run made a provider call');
  assert.notEqual(entry.result, 'no-op', 'a run that committed canonical work is not a no-op');
  assert.equal(entry.result, 'partial');
  assert.equal(entry.reason, 'lifecycle-transition-refused');
  assert.ok(entry.scheduleRefreshReason, 'the exact E1A reason is still preserved on the entry');
});

test('a league that vanished from the registry mid-run is refused, not recreated', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchEmptySchedule(async () => {
    await seedRegistry([]);
  });

  const { res, body } = await runRoute();

  assert.equal(res.status, 200);
  assert.deepEqual(body.years[0]!.leagues, []);
  assert.deepEqual(body.years[0]!.refusedLeagues, ['alpha']);
  assert.deepEqual(await readRegistry(), [], 'the deleted league was not resurrected');
});
