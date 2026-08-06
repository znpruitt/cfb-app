import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import { TEST_LEAGUE_SLUG, type League } from '../../../../../lib/league.ts';
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
// PLATFORM-086F2H1B — the automated half of lifecycle convergence.
//
// The cron drives the GUARDED preseason→season authority and reports four
// independent dispositions truthfully across the HTTP response, the runtime
// event, and the durable receipt.
//
// PLATFORM-086F2H1T2 then made the demo league MANUAL-ONLY: `test` is filtered
// out before the zero-target decision and before grouping, so it is not a
// target and not counted. The tests at the end of this file pin that.
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
 * Neutralize the upstream CFBD fetch. `onFirstFetch` runs ONCE inside the E1A
 * refresh — strictly after the route captured its registry snapshot and strictly
 * before any lifecycle write — which is exactly the window a competing actor
 * would land in.
 */
function stubFetch(onFirstFetch?: () => Promise<void>): void {
  let fired = false;
  globalThis.fetch = (async () => {
    if (onFirstFetch && !fired) {
      fired = true;
      await onFirstFetch();
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/**
 * A COMPLETE E1A refresh: the regular partition returns one past game and the
 * postseason partition is legitimately empty. This is the only way to get
 * `cached: true` — the default `stubFetch` returns `[]`, which the authority
 * reports as `no-op / empty-response`. The past date keeps the transition gate
 * open. `onFirstFetch` runs once, inside the refresh, after the route captured
 * its registry snapshot and before any lifecycle write.
 */
function stubFetchPopulated(onFirstFetch?: () => Promise<void>): void {
  let fired = false;
  globalThis.fetch = (async (input: URL | string) => {
    if (onFirstFetch && !fired) {
      fired = true;
      await onFirstFetch();
    }
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body =
      url.searchParams.get('seasonType') === 'postseason'
        ? '[]'
        : JSON.stringify([
            {
              id: '1-Texas-Rice',
              week: 1,
              home_team: 'Texas',
              away_team: 'Rice',
              start_date: '2023-08-26T00:00:00Z',
              completed: false,
            },
          ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
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
  targetLeagues?: number;
  transitionedLeagues?: number;
  alreadyInTargetSeasonLeagues?: number;
  removedLeagues?: number;
  refusedLeagues?: number;
};

type RunResult = {
  res: Response;
  body: { years: CronYear[]; invalidLifecycleTargets: number; error?: string };
  event: SeasonTransitionCronExecutionEvent;
  tags: string[];
  providerCalls: number;
  /** Every URL the route asked the provider for, in order. */
  providerUrls: string[];
};

async function runRoute(
  req: Request = cronRequest(),
  onRevalidateTag?: (tag: string) => void
): Promise<RunResult> {
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  let providerCalls = 0;
  const providerUrls: string[] = [];
  const wrapped = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    providerCalls += 1;
    const input = args[0];
    // `String(new Request(url))` is '[object Request]', which would make every
    // "the demo year was never fetched" assertion below pass regardless of the
    // year actually requested. Resolve the URL from every input shape.
    providerUrls.push(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String(input)
    );
    return wrapped(...args);
  }) as typeof fetch;
  // `pendingRevalidatedTags.push` is what `revalidateTag` calls, so a hooked
  // array gives tests a deterministic point BETWEEN a committed lifecycle write
  // and the next one — no polling, no race.
  class HookedTags extends Array<string> {
    override push(...items: string[]): number {
      for (const item of items) onRevalidateTag?.(item);
      return super.push(...items);
    }
  }
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: onRevalidateTag ? new HookedTags() : ([] as string[]),
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
      if (parsed?.event === 'season-transition-cron') {
        events.push(parsed as SeasonTransitionCronExecutionEvent);
      }
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
    providerCalls,
    providerUrls,
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubFetch();
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
test('the target year comes from status.year, never league.year or the calendar', async () => {
  // Top-level year deliberately disagrees with the authoritative status year.
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR }, 1999)]);
  await seedPastProbe();

  const { body } = await runRoute();

  assert.equal(body.years[0]!.year, YEAR);
  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'season', year: YEAR });
  assert.equal((await readLeague('alpha'))?.year, YEAR, 'the projection follows status.year');
});

// ---------------------------------------------------------------------------
// 15-24 — route truth across all three surfaces

async function assertSurfacesAgree(run: RunResult): Promise<void> {
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt, 'a receipt was written for the authenticated invocation');
  const target = receipt.value.target;
  assert.equal(target.kind, 'season-transition-years');
  if (target.kind !== 'season-transition-years') return;
  const receiptYears: ReadonlyArray<{
    year: number;
    targetLeagues: number;
    probed: boolean;
    transitionedLeagues: number;
    alreadyInTargetSeasonLeagues: number;
    removedLeagues: number;
    refusedLeagues: number;
  }> = target.years;

  for (const [i, entry] of run.event.years.entries()) {
    const bodyYear = run.body.years.find((y) => y.year === entry.year);
    const receiptYear = receiptYears[i]!;
    assert.equal(receiptYear.year, entry.year, 'receipt years align with event years');
    for (const key of [
      'targetLeagues',
      'transitionedLeagues',
      'alreadyInTargetSeasonLeagues',
      'removedLeagues',
      'refusedLeagues',
    ] as const) {
      assert.equal(receiptYear[key], entry[key], `receipt.${key} matches event`);
      if (bodyYear && bodyYear[key] !== undefined) {
        assert.equal(bodyYear[key], entry[key], `body.${key} matches event`);
      }
    }
  }
}

test('a clean transition agrees across response, event and receipt', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  const run = await runRoute();

  assert.equal(run.body.years[0]!.transitioned, true);
  assert.deepEqual(run.body.years[0]!.leagues, ['alpha']);
  assert.equal(run.event.years[0]!.transitionedLeagues, 1);
  assert.equal(run.event.years[0]!.refusedLeagues, 0);
  assert.equal(run.event.result, 'success');
  assert.equal(run.event.reason, 'season-transitioned');
  await assertSurfacesAgree(run);
});

test('an all-already redelivery is a no-op that raises no System Health issue', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'season', year: YEAR })]);
  });

  const run = await runRoute();

  assert.equal(run.res.status, 200);
  assert.deepEqual(run.body.years[0]!.leagues, [], 'this run transitioned nothing itself');
  assert.equal(run.body.years[0]!.transitioned, false, 'transitioned means an actual write');
  assert.equal(run.body.years[0]!.alreadyInTargetSeasonLeagues, 1);
  const entry = run.event.years[0]!;
  assert.equal(entry.result, 'no-op', 'never partial — System Health must stay quiet');
  assert.equal(entry.reason, 'already-in-target-season');
  assert.equal(entry.refusedLeagues, 0);
  await assertSurfacesAgree(run);
});

test('a target deleted mid-run is neutral and produces no false incident', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([]);
  });

  const run = await runRoute();

  assert.equal(run.res.status, 200);
  assert.equal(run.body.years[0]!.removedLeagues, 1);
  assert.equal(run.body.years[0]!.refusedLeagues, 0);
  const entry = run.event.years[0]!;
  assert.equal(entry.result, 'no-op', 'an intentional deletion is not an anomaly');
  assert.equal(entry.reason, 'transition-targets-removed');
  assert.deepEqual(await readRegistry(), [], 'the deleted league was not resurrected');
  await assertSurfacesAgree(run);
});

test('a genuinely stale target is refused, partial, and visible to System Health', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetch(async () => {
    // Rolled over by another actor since the snapshot.
    await seedRegistry([makeLeague('alpha', { state: 'offseason' })]);
  });

  const run = await runRoute();

  assert.equal(run.res.status, 200, 'a controlled refusal is not an HTTP error');
  assert.equal(run.body.years[0]!.refusedLeagues, 1);
  const entry = run.event.years[0]!;
  assert.equal(entry.result, 'partial', 'partial is what System Health surfaces');
  assert.equal(entry.reason, 'lifecycle-transition-refused');
  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'offseason' }, 'newer state kept');
  await assertSurfacesAgree(run);
});

test('every target refused is STILL partial, never a clean no-op', async () => {
  // The authenticated run performed its canonical/probe stage and then failed to
  // complete the lifecycle work it set out to do.
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([
      makeLeague('alpha', { state: 'offseason' }),
      makeLeague('bravo', { state: 'preseason', year: YEAR + 1 }, YEAR + 1),
    ]);
  });

  const run = await runRoute();

  assert.equal(run.event.years[0]!.refusedLeagues, 2);
  assert.equal(run.event.years[0]!.transitionedLeagues, 0);
  assert.equal(run.event.years[0]!.result, 'partial');
  assert.equal(run.event.result, 'partial');
});

test('a mixed year preserves all four dispositions independently', async () => {
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
    makeLeague('charlie', { state: 'preseason', year: YEAR }),
    makeLeague('delta', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([
      makeLeague('alpha', { state: 'preseason', year: YEAR }), // still transitions
      makeLeague('bravo', { state: 'season', year: YEAR }), // already there
      makeLeague('charlie', { state: 'offseason' }), // genuinely stale
      // delta deleted
    ]);
  });

  const run = await runRoute();

  const entry = run.event.years[0]!;
  assert.equal(entry.targetLeagues, 4);
  assert.equal(entry.transitionedLeagues, 1);
  assert.equal(entry.alreadyInTargetSeasonLeagues, 1);
  assert.equal(entry.removedLeagues, 1);
  assert.equal(entry.refusedLeagues, 1);
  assert.equal(
    entry.targetLeagues,
    entry.transitionedLeagues +
      entry.alreadyInTargetSeasonLeagues +
      entry.removedLeagues +
      entry.refusedLeagues,
    'the four dispositions account for every target'
  );
  assert.equal(entry.result, 'partial', 'a refusal dominates a mixed year');
  assert.deepEqual(run.body.years[0]!.leagues, ['alpha']);
  await assertSurfacesAgree(run);
});

test('a benign already/removed mixture with no transition is transition-not-required', async () => {
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'season', year: YEAR })]);
  });

  const run = await runRoute();

  const entry = run.event.years[0]!;
  assert.equal(entry.alreadyInTargetSeasonLeagues, 1);
  assert.equal(entry.removedLeagues, 1);
  assert.equal(entry.result, 'no-op');
  assert.equal(entry.reason, 'transition-not-required');
});

test('dispositions stay zero when the lifecycle gate is never reached', async () => {
  // No probe → the transition gate is not reached; the year reports its E1A
  // truth, and no lifecycle disposition is invented.
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);

  const run = await runRoute();

  const entry = run.event.years[0]!;
  assert.equal(entry.transitionedLeagues, 0);
  assert.equal(entry.alreadyInTargetSeasonLeagues, 0);
  assert.equal(entry.removedLeagues, 0);
  assert.equal(entry.refusedLeagues, 0);
  assert.notEqual(entry.reason, 'lifecycle-transition-refused');
  assert.ok(!('refusedLeagues' in run.body.years[0]!), 'absent on the HTTP body too');
});

// ---------------------------------------------------------------------------
// 25-27 — standings invalidation by outcome

test('a transitioned target invalidates its standings', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  const { tags } = await runRoute();

  assert.ok(tags.includes('standings:alpha'));
});

test('an already-in-target target ALSO invalidates, covering an overlapping snapshot', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'season', year: YEAR })]);
  });

  const { tags } = await runRoute();

  assert.ok(
    tags.includes('standings:alpha'),
    'the redelivery is the last chance to bust a cache an interrupted run left stale'
  );
});

test('removed and refused targets invalidate nothing', async () => {
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();
  stubFetch(async () => {
    await seedRegistry([makeLeague('alpha', { state: 'offseason' })]);
  });

  const { tags } = await runRoute();

  assert.ok(!tags.includes('standings:alpha'), 'a refused target mutated nothing');
  assert.ok(!tags.includes('standings:bravo'), 'a removed target mutated nothing');
});

// ---------------------------------------------------------------------------
// 37-38 — runtime envelope

test('the route declares an explicit 300s maxDuration on the default runtime', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/api/cron/season-transition/route.ts'),
    'utf8'
  );

  assert.match(source, /export const maxDuration = 300;/, 'explicit runtime envelope');
  assert.ok(!/export const runtime\s*=/.test(source), 'still the default Node.js runtime');
});

test('the cron cadence and scheduler ownership in vercel.json are unchanged', () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  assert.deepEqual(
    config.crons.find((c) => c.path === '/api/cron/season-transition'),
    { path: '/api/cron/season-transition', schedule: '0 0 * * *' }
  );
  assert.equal(config.crons.length, 2, 'no scheduler was added or removed');
});
// ---------------------------------------------------------------------------
// 28 — a post-commit invalidation failure never relabels the committed write

test('an invalidation throw preserves the committed transition and reports partial', async () => {
  // Running GET OUTSIDE the Next work store makes `revalidateTag` throw, which
  // is the real shape of a post-commit invalidation failure: the durable
  // lifecycle write has already landed.
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  let res: Response;
  try {
    res = await GET(cronRequest());
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }

  // The 500 itself is pre-existing behavior for a thrown operation.
  assert.equal(res.status, 500);

  // The durable lifecycle write COMMITTED and must not be rolled back or
  // relabelled as failed.
  const stored = await readLeague('alpha');
  assert.deepEqual(stored?.status, { state: 'season', year: YEAR }, 'the transition stands');
  assert.equal(stored?.year, YEAR, 'and its projection stands');

  const event = raw
    .map((line) => {
      try {
        return JSON.parse(line) as { event?: string };
      } catch {
        return null;
      }
    })
    .find((e) => e?.event === 'season-transition-cron') as
    | SeasonTransitionCronExecutionEvent
    | undefined;
  assert.ok(event, 'the event is still emitted from the finally block');
  const entry = event.years[0]!;
  assert.equal(entry.result, 'partial', 'never `failure` — the write succeeded');
  assert.equal(entry.reason, 'standings-invalidation-failed');
  assert.equal(entry.transitionedLeagues, 1, 'the confirmed count is preserved');

  // The 500 response must NOT stay silent about a transition that committed:
  // the three surfaces have to agree even on the post-commit failure path.
  const body = (await res.json()) as { years: CronYear[] };
  const bodyYear = body.years.find((y) => y.year === YEAR);
  assert.ok(bodyYear, 'the year is reported despite the throw');
  assert.equal(bodyYear.transitionedLeagues, entry.transitionedLeagues);
  assert.equal(bodyYear.targetLeagues, entry.targetLeagues);
  assert.equal(bodyYear.refusedLeagues, entry.refusedLeagues);
  assert.deepEqual(bodyYear.leagues, ['alpha']);
});

test('a refusal and an invalidation failure in one year both survive, and the reason names the fault', async () => {
  // The regression: the single `reason` field cannot carry two facts, so it
  // names the one with no other carrier. A refusal survives in `refusedLeagues`
  // (persisted in the receipt and rendered by System Health); the invalidation
  // fault has ONLY the reason, and mislabelling it points an operator at stale
  // lifecycle state when the exposure is committed standings serving stale cache.
  //
  // Registry order matters: the refused league must be processed BEFORE the one
  // whose commit triggers the throw, since the throw ends the year's loop.
  await seedRegistry([
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  // A competing actor moves bravo out of the target preseason after the route
  // captured its snapshot but before any lifecycle write — a genuine refusal.
  stubFetch(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) => (l.slug === 'bravo' ? { ...l, status: { state: 'offseason' } } : l))
    );
  });

  // Running GET OUTSIDE the Next work store makes `revalidateTag` throw, so
  // alpha's committed transition is followed by a real invalidation failure.
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  let res: Response;
  try {
    res = await GET(cronRequest());
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }

  assert.equal(res.status, 500);

  // The committed write stands; the refused league was not touched.
  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'season', year: YEAR });
  assert.deepEqual((await readLeague('bravo'))?.status, { state: 'offseason' });

  const event = raw
    .map((line) => {
      try {
        return JSON.parse(line) as { event?: string };
      } catch {
        return null;
      }
    })
    .find((e) => e?.event === 'season-transition-cron') as
    | SeasonTransitionCronExecutionEvent
    | undefined;
  assert.ok(event, 'the event is still emitted from the finally block');
  const entry = event.years[0]!;

  // Surface 1 — the runtime event.
  assert.equal(entry.result, 'partial');
  assert.equal(
    entry.reason,
    'standings-invalidation-failed',
    'the refusal must NOT displace the fault that caused the 500'
  );
  assert.equal(entry.transitionedLeagues, 1, 'the committed transition is counted');
  assert.equal(entry.refusedLeagues, 1, 'and the refusal is preserved alongside it');

  // Surface 2 — the HTTP response.
  const body = (await res.json()) as { years: CronYear[] };
  const bodyYear = body.years.find((y) => y.year === YEAR);
  assert.ok(bodyYear, 'the year is reported despite the throw');
  assert.equal(bodyYear.transitionedLeagues, 1);
  assert.equal(bodyYear.refusedLeagues, 1);
  assert.deepEqual(bodyYear.leagues, ['alpha']);

  // Surface 3 — the durable receipt an operator actually reads.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt, 'a receipt is written even on the post-commit failure path');
  assert.equal(receipt.value.result, 'partial');
  assert.equal(receipt.value.reason, 'standings-invalidation-failed');
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  const receiptYear = receipt.value.target.years[0]!;
  assert.equal(receiptYear.transitionedLeagues, 1);
  assert.equal(receiptYear.refusedLeagues, 1, 'the refusal is durable, not only in-memory');
});

test('a refusal keeps the year partial when a later lifecycle write throws', async () => {
  // The exact reachable path, all three conditions real:
  //   1. The canonical refresh is a VALID no-op — the stubbed provider returns
  //      `[]`, which the authority reports as `no-op / empty-response`. That is
  //      the one outcome leaving BOTH `cached` false and `transitionBlocked`
  //      false, so the lifecycle gate opens with no canonical work recorded.
  //   2. An earlier target is refused (a competing actor moved it out of the
  //      target preseason after the snapshot).
  //   3. A later target's guarded write throws on a degraded registry.
  // Without the refusal in the classification this lands on `failure`, erasing
  // the fact that the authenticated run reached its lifecycle stage and
  // declined a stale target — which AGENTS.md requires to stay `partial`.
  const { __setAppStateWriteFailureForTests } = await import(
    '../../../../../lib/server/appStateStore.ts'
  );
  await seedRegistry([
    makeLeague('bravo', { state: 'preseason', year: YEAR }),
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  stubFetch(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) => (l.slug === 'bravo' ? { ...l, status: { state: 'offseason' } } : l))
    );
    // Poison the store only AFTER the competing mutation lands. bravo's refusal
    // never reaches `txn.write`, so only alpha's guarded write faults.
    __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  });

  let run: RunResult;
  try {
    run = await runRoute();
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(run.res.status, 500, 'the write fault still surfaces as a 500');

  const entry = run.event.years[0]!;
  assert.equal(entry.cached, false, 'the no-op refresh recorded no canonical work');
  assert.equal(entry.transitionedLeagues, 0, 'and nothing committed');
  assert.equal(
    entry.result,
    'partial',
    'a year with any refusal is ALWAYS partial — never `failure`'
  );
  assert.equal(entry.reason, 'lifecycle-write-failed', 'the reason names the throw');
  assert.equal(entry.refusedLeagues, 1, 'the refusal is preserved through the fault');

  // The response agrees.
  const bodyYear = run.body.years.find((y) => y.year === YEAR);
  assert.ok(bodyYear, 'the year is reported despite the throw');
  assert.equal(bodyYear.refusedLeagues, 1);
  assert.equal(bodyYear.transitionedLeagues, 0);
  assert.deepEqual(bodyYear.leagues, [], 'no league is claimed as transitioned');

  // And so does the durable receipt System Health reads.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt);
  assert.equal(receipt.value.result, 'partial');
  assert.equal(receipt.value.reason, 'lifecycle-write-failed');
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.equal(receipt.value.target.years[0]!.refusedLeagues, 1);
});

test('a healed projection keeps the year partial when a later lifecycle write throws', async () => {
  // The heal is a COMMITTED registry write. Before `healedProjections` entered
  // the classification, this landed on `failure` — the run disowning data it
  // had durably changed — even though the same route calls a heal `success`
  // when nothing throws.
  //
  // Same reachable gate as the refusal case: the stubbed provider returns `[]`,
  // which the authority reports as `no-op / empty-response`, leaving `cached`
  // false and `transitionBlocked` false so the gate opens with no canonical work.
  const { __setAppStateWriteFailureForTests } = await import(
    '../../../../../lib/server/appStateStore.ts'
  );
  await seedRegistry([
    // bravo is targeted first and is already in the target season with a STALE
    // top-level year, so its guarded write heals the projection.
    { ...makeLeague('bravo', { state: 'preseason', year: YEAR }), year: 2019 },
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  stubFetch(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) =>
        l.slug === 'bravo' ? { ...l, status: { state: 'season', year: YEAR } } : l
      )
    );
  });

  // Poison the store the instant bravo's heal is durable: the route invalidates
  // standings immediately after a committed heal, and that bust runs BEFORE
  // alpha's guarded write. Deterministic and synchronous.
  let armed = false;
  let run: RunResult;
  try {
    run = await runRoute(cronRequest(), (tag) => {
      if (!armed && tag.includes('bravo')) {
        armed = true;
        __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
      }
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(armed, true, 'the heal committed before the outage was armed');
  assert.equal(run.res.status, 500, "alpha's write fault still surfaces as a 500");

  // The registry proves the heal COMMITTED and must not be disowned.
  const bravo = await readLeague('bravo');
  assert.deepEqual(bravo?.status, { state: 'season', year: YEAR });
  assert.equal(bravo?.year, YEAR, 'the stale projection was durably repaired');

  const entry = run.event.years[0]!;
  assert.equal(entry.cached, false, 'the no-op refresh recorded no canonical work');
  assert.equal(entry.transitionedLeagues, 0, 'and nothing transitioned');
  assert.equal(entry.refusedLeagues, 0, 'and nothing was refused — only the heal happened');
  assert.equal(entry.result, 'partial', 'a committed repair must never be disowned as `failure`');
  assert.equal(entry.reason, 'lifecycle-write-failed');
  assert.equal(entry.alreadyInTargetSeasonLeagues, 1, 'the completed disposition is preserved');

  const bodyYear = run.body.years.find((y) => y.year === YEAR);
  assert.ok(bodyYear);
  assert.equal(bodyYear.alreadyInTargetSeasonLeagues, 1);

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt);
  assert.equal(receipt.value.result, 'partial');
  assert.equal(receipt.value.reason, 'lifecycle-write-failed');
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.equal(receipt.value.target.years[0]!.alreadyInTargetSeasonLeagues, 1);
});

test('a no-write idempotent target that then fails its cache bust is a failure, not a partial', async () => {
  // `partial` has to mean something. This year's only target was an UNTOUCHED
  // `already-in-target-season` match — no transition, no heal, no refusal, and
  // a `no-op / empty-response` refresh, so `cached` is false too. The bust is
  // invalidating a cache no run in this invocation dirtied. Reporting `partial`
  // would assert progress that did not happen.
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  // A competing actor completes the transition WITH a synced projection, so the
  // route's own guarded call heals nothing.
  stubFetch(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) =>
        l.slug === 'alpha' ? { ...l, year: YEAR, status: { state: 'season', year: YEAR } } : l
      )
    );
  });

  // Outside the Next work store, so the post-disposition `revalidateTag` throws.
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  let res: Response;
  try {
    res = await GET(cronRequest());
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }

  assert.equal(res.status, 500);

  const event = raw
    .map((line) => {
      try {
        return JSON.parse(line) as { event?: string };
      } catch {
        return null;
      }
    })
    .find((e) => e?.event === 'season-transition-cron') as
    | SeasonTransitionCronExecutionEvent
    | undefined;
  assert.ok(event);
  const entry = event.years[0]!;

  assert.equal(entry.cached, false, 'no canonical work was recorded');
  assert.equal(entry.transitionedLeagues, 0);
  assert.equal(entry.refusedLeagues, 0);
  assert.equal(entry.alreadyInTargetSeasonLeagues, 1, 'the untouched match is still counted');
  assert.equal(entry.result, 'failure', 'nothing was written, so nothing is `partial` about it');
  assert.equal(entry.reason, 'standings-invalidation-failed', 'the reason still names the fault');

  // The registry is untouched by this run — the competing actor wrote it.
  const stored = await readLeague('alpha');
  assert.deepEqual(stored?.status, { state: 'season', year: YEAR });
  assert.equal(stored?.year, YEAR);
});

test('a throw BEFORE the lifecycle gate keeps its existing response shape', async () => {
  // A probe-write failure produces no dispositions, so the pre-existing
  // behavior (the year is absent from the 500 body) is deliberately unchanged.
  const { __setAppStateWriteFailureForTests } = await import(
    '../../../../../lib/server/appStateStore.ts'
  );
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body =
      url.searchParams.get('seasonType') === 'postseason'
        ? '[]'
        : JSON.stringify([
            {
              id: 'g1',
              week: 1,
              home_team: 'Texas',
              away_team: 'Rice',
              start_date: '2099-09-01T00:00:00Z',
              completed: false,
            },
          ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  __setAppStateWriteFailureForTests(new Error('probe write boom'), 'schedule-probe');
  let run: RunResult;
  try {
    run = await runRoute();
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.equal(run.res.status, 500, 'the same 500 as before');
  assert.equal(run.event.years[0]!.reason, 'probe-write-failed');
  assert.deepEqual(run.body.years, [], 'no dispositions, so no year entry is invented');
});

// ---------------------------------------------------------------------------
// 23 — schedule truth and lifecycle truth stay separate

test('a partial schedule refresh is not conflated with a lifecycle refusal', async () => {
  // A failed postseason partition makes E1A report failure; the transition gate
  // is then blocked, so NO lifecycle disposition may be invented.
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.searchParams.get('seasonType') === 'postseason') {
      return new Response('upstream unavailable', { status: 503 });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { body, event } = await runRoute();

  const entry = event.years[0]!;
  assert.equal(entry.refusedLeagues, 0, 'a schedule failure is not a lifecycle refusal');
  assert.equal(entry.transitionedLeagues, 0);
  assert.notEqual(entry.reason, 'lifecycle-transition-refused');
  assert.ok(
    !('refusedLeagues' in body.years[0]!),
    'no lifecycle counters when the gate is blocked'
  );
  assert.deepEqual(
    (await readLeague('alpha'))?.status,
    { state: 'preseason', year: YEAR },
    'the league never flips off an unconfirmed schedule'
  );
});
// ---------------------------------------------------------------------------
// The dispositions must reach an operator, not stop at the receipt boundary.

test('the System Health receipt summary distinguishes stale from benign targets', async () => {
  const { summarizeReceiptTarget } = await import(
    '../../../../../components/admin/systemHealth/systemHealthPresentation.ts'
  );

  const mixed = summarizeReceiptTarget({
    kind: 'season-transition-years',
    totalYears: 1,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [
      {
        year: 2026,
        targetLeagues: 4,
        probed: true,
        transitionedLeagues: 1,
        alreadyInTargetSeasonLeagues: 1,
        removedLeagues: 1,
        refusedLeagues: 1,
      },
    ],
  });
  assert.match(mixed, /1\/4 leagues/);
  assert.match(mixed, /1 stale/, 'the anomalous disposition is named');
  assert.match(mixed, /1 already/);
  assert.match(mixed, /1 removed/);

  // A clean run — and a legacy receipt, whose counters normalize to zero —
  // keeps the previous compact form.
  const clean = summarizeReceiptTarget({
    kind: 'season-transition-years',
    totalYears: 1,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [
      {
        year: 2026,
        targetLeagues: 2,
        probed: true,
        transitionedLeagues: 2,
        alreadyInTargetSeasonLeagues: 0,
        removedLeagues: 0,
        refusedLeagues: 0,
      },
    ],
  });
  assert.equal(clean, '1 year(s): 2026 (2/2 leagues)');

  // PLATFORM-086F2H1R1 — the refusal count must reach the operator, and only
  // when it is non-zero. Without these two cases, deleting the whole `unusable`
  // suffix leaves the suite green (AGENTS.md: "if deleting the new guard leaves
  // the suite green, the guard is not in the PR's acceptance contract").
  const refused = summarizeReceiptTarget({
    kind: 'season-transition-years',
    totalYears: 1,
    truncated: false,
    invalidLifecycleTargets: 2,
    years: [
      {
        year: 2026,
        targetLeagues: 2,
        probed: true,
        transitionedLeagues: 2,
        alreadyInTargetSeasonLeagues: 0,
        removedLeagues: 0,
        refusedLeagues: 0,
      },
    ],
  });
  assert.equal(refused, '1 year(s): 2026 (2/2 leagues) · 2 unusable lifecycle target(s)');

  // The all-refused receipt has NO years, so the year list must not leave a
  // dangling separator behind.
  const allRefused = summarizeReceiptTarget({
    kind: 'season-transition-years',
    totalYears: 0,
    truncated: false,
    invalidLifecycleTargets: 1,
    years: [],
  });
  assert.equal(allRefused, '0 year(s) · 1 unusable lifecycle target(s)');
});

// ---------------------------------------------------------------------------
// `no-op` means NOTHING committed — canonical work counts, not just lifecycle.

test('a committed canonical refresh keeps an all-already year out of no-op', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  // A competing delivery transitions alpha WITH a synced projection, so the
  // route heals nothing: `cached` is the only recorded work.
  stubFetchPopulated(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) =>
        l.slug === 'alpha' ? { ...l, year: YEAR, status: { state: 'season', year: YEAR } } : l
      )
    );
  });

  const { event } = await runRoute();
  const entry = event.years[0]!;

  assert.equal(entry.cached, true, 'E1A durably committed a schedule this run');
  assert.equal(entry.alreadyInTargetSeasonLeagues, 1);
  assert.equal(entry.transitionedLeagues, 0);
  assert.equal(
    entry.result,
    'success',
    'a billed, committed run is never reported as having done nothing'
  );
  assert.equal(entry.reason, 'already-in-target-season', 'the LIFECYCLE reason is preserved');
  assert.equal(
    entry.scheduleRefreshReason !== null,
    true,
    'the E1A detail travels on its own field'
  );
});

test('a committed canonical refresh keeps an all-removed year out of no-op', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchPopulated(async () => {
    await setAppState('leagues', 'registry', []);
  });

  const { event } = await runRoute();
  const entry = event.years[0]!;

  assert.equal(entry.cached, true);
  assert.equal(entry.removedLeagues, 1);
  assert.equal(entry.result, 'success');
  assert.equal(entry.reason, 'transition-targets-removed', 'the LIFECYCLE reason is preserved');
});

test('with no canonical work and an untouched target, the year IS a no-op', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  // `[]` from the provider is `no-op / empty-response`: nothing committed.
  stubFetch(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) =>
        l.slug === 'alpha' ? { ...l, year: YEAR, status: { state: 'season', year: YEAR } } : l
      )
    );
  });

  const { event } = await runRoute();
  const entry = event.years[0]!;

  assert.equal(entry.cached, false);
  assert.equal(entry.alreadyInTargetSeasonLeagues, 1);
  assert.equal(entry.result, 'no-op', 'nothing was committed anywhere — that is a real no-op');
  assert.equal(entry.reason, 'already-in-target-season');
});

test('with no canonical work and every target removed, the year IS a no-op', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetch(async () => {
    await setAppState('leagues', 'registry', []);
  });

  const { event } = await runRoute();
  const entry = event.years[0]!;

  assert.equal(entry.cached, false);
  assert.equal(entry.removedLeagues, 1);
  assert.equal(entry.result, 'no-op');
  assert.equal(entry.reason, 'transition-targets-removed');
});

test('the invalidation-failure path uses the SAME recorded-work definition', async () => {
  // Committed canonical work makes the failed bust `partial`, matching the
  // `success` the identical non-throwing run now gets. Before canonical work
  // counted in the classification block, the throwing run was `partial` while
  // the clean run was `no-op` — the clean run looking like strictly less work.
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchPopulated(async () => {
    const registry = await readRegistry();
    await setAppState(
      'leagues',
      'registry',
      registry.map((l) =>
        l.slug === 'alpha' ? { ...l, year: YEAR, status: { state: 'season', year: YEAR } } : l
      )
    );
  });

  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  let res: Response;
  try {
    // Outside the Next work store, so the post-disposition bust throws.
    res = await GET(cronRequest());
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  assert.equal(res.status, 500);

  const event = raw
    .map((line) => {
      try {
        return JSON.parse(line) as { event?: string };
      } catch {
        return null;
      }
    })
    .find((e) => e?.event === 'season-transition-cron') as
    | SeasonTransitionCronExecutionEvent
    | undefined;
  assert.ok(event);
  const entry = event.years[0]!;

  assert.equal(entry.cached, true);
  assert.equal(entry.result, 'partial', 'committed canonical work is recorded work here too');
  assert.equal(entry.reason, 'standings-invalidation-failed');
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T2 — the demo league is MANUAL-ONLY for automatic transition.
//
// Labels below follow AGENTS.md → Verification. The provider-call observer is
// itself proven before any "zero calls" claim rests on it.
// ---------------------------------------------------------------------------

// POSITIVE CONTROL for the provider observer. Every "made no provider call"
// assertion below is worthless unless this passes: it proves the same harness
// DOES record calls, and records the year, for a production target.
test('the provider observer detects calls, and their year, for a production target', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();

  const { providerCalls, providerUrls } = await runRoute();

  assert.ok(providerCalls > 0, 'the observer records provider calls when they happen');
  assert.ok(
    providerUrls.some((u) => u.includes(String(YEAR))),
    `the observer records the requested year; saw ${JSON.stringify(providerUrls)}`
  );
});

// REGRESSION TEST — verified failing with the exclusion removed.
test('a demo-only preseason registry is skipped with no provider work', async () => {
  const demo = makeLeague('test', { state: 'preseason', year: YEAR });
  await seedRegistry([demo]);
  await seedPastProbe();
  const before = await readRegistry();

  const { res, body, event, providerCalls, providerUrls, tags } = await runRoute();

  assert.equal(res.status, 200);
  assert.deepEqual(body.years, [], 'no year is reported');
  assert.deepEqual(tags, [], 'no standings invalidation for a demo-only registry');
  assert.equal(event.result, 'skipped');
  assert.equal(
    event.reason,
    'no-automatic-preseason-leagues',
    'a preseason league EXISTS — saying `no-preseason-leagues` would be false'
  );
  assert.deepEqual(event.years, [], 'no year entries');
  assert.equal(providerCalls, 0, 'no billed provider call for a demo-only year');
  assert.deepEqual(providerUrls, []);
  assert.deepEqual(await readRegistry(), before, 'the demo record is byte-equivalent');

  // The durable receipt agrees with the event.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt);
  assert.equal(receipt.value.result, 'skipped');
  assert.equal(receipt.value.reason, 'no-automatic-preseason-leagues');
  assert.equal(receipt.value.providerCallAttempted, false);
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.equal(receipt.value.target.totalYears, 0, 'zero years on the receipt target');
  assert.deepEqual(receipt.value.target.years, []);
});

// CONTRACT PIN — the literal-empty case keeps its existing reason.
test('a registry with no preseason league at all keeps no-preseason-leagues', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'season', year: YEAR })]);

  const { event, providerCalls } = await runRoute();

  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-preseason-leagues');
  assert.equal(providerCalls, 0);
});

// REGRESSION TEST — verified failing with the exclusion removed.
test('a mixed same-year registry counts and transitions only the production league', async () => {
  await seedRegistry([
    makeLeague('test', { state: 'preseason', year: YEAR }),
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  const { body, event } = await runRoute();

  const entry = event.years[0]!;
  assert.equal(entry.year, YEAR);
  assert.equal(entry.targetLeagues, 1, 'the demo league is not a target');
  assert.equal(entry.transitionedLeagues, 1);
  assert.equal(entry.alreadyInTargetSeasonLeagues, 0);
  assert.equal(entry.removedLeagues, 0);
  assert.equal(entry.refusedLeagues, 0);

  const bodyYear = body.years.find((y) => y.year === YEAR);
  assert.deepEqual(bodyYear?.leagues, ['alpha'], 'only the production league transitioned');

  // POSITIVE CONTROL for the state observer: the production league DID move,
  // so "the demo league did not" is a real observation rather than a no-op run.
  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'season', year: YEAR });
  assert.deepEqual(
    (await readLeague('test'))?.status,
    { state: 'preseason', year: YEAR },
    'the demo league is untouched even though its year transitioned'
  );
});

// REGRESSION TEST — verified failing when the exclusion is applied AFTER
// grouping, which still spends a billed call on the demo-only year.
test('a demo-only year is absent from every surface and from provider requests', async () => {
  const demoYear = YEAR + 1;
  await seedRegistry([
    makeLeague('test', { state: 'preseason', year: demoYear }, demoYear),
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
  ]);
  await seedPastProbe();

  const { body, event, providerUrls } = await runRoute();

  assert.deepEqual(
    event.years.map((y) => y.year),
    [YEAR],
    'the demo-only year never reaches the runtime event'
  );
  assert.deepEqual(
    body.years.map((y) => y.year),
    [YEAR]
  );

  assert.ok(providerUrls.length > 0, 'the production year WAS fetched (observer live)');
  assert.ok(
    !providerUrls.some((u) => u.includes(String(demoYear))),
    `no provider request may name the demo-only year; saw ${JSON.stringify(providerUrls)}`
  );

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt);
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.deepEqual(
    receipt.value.target.years.map((y) => y.year),
    [YEAR]
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1R1 — registry-container truth and structural lifecycle-year
// validity, applied BEFORE any probe, provider, lifecycle, or invalidation work.
//
// `status.year` reaches the grouping line straight from durable JSON with no
// per-record validation, so an unusable year previously became a Map key,
// survived the zero-target gate, drove a probe read and a billed E1A refresh,
// and — when `undefined` — produced a per-year entry whose `year` key
// `JSON.stringify` drops, failing receipt validation and discarding the WHOLE
// job's latest receipt from System Health.
// ---------------------------------------------------------------------------

/** A preseason league whose stored `status.year` is deliberately unusable. */
function makeUnusableLeague(slug: string, year: unknown): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: YEAR,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state: 'preseason', year },
  } as unknown as League;
}

// REGRESSION TEST — a malformed container is no longer reported as an empty one.
test('R1 regression: a malformed registry refuses with registry-malformed, not a zero-target reason', async () => {
  await setAppState('leagues', 'registry', { alpha: { state: 'preseason' } });
  await seedPastProbe();

  const run = await runRoute();

  assert.equal(run.res.status, 500);
  assert.equal(run.event.reason, 'registry-malformed');
  assert.equal(run.event.result, 'failure');
  assert.deepEqual(run.event.years, []);
  assert.deepEqual(run.body.years, []);
  assert.equal(run.providerCalls, 0, 'no provider work on a corrupt container');
  assert.deepEqual(run.providerUrls, []);

  // The receipt is still written and still parses — a corrupt registry must not
  // also cost the operator visibility into the job.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt, 'an authenticated invocation still records a receipt');
  assert.equal(receipt.value.reason, 'registry-malformed');
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.equal(receipt.value.target.totalYears, 0);
  assert.equal(receipt.value.target.invalidLifecycleTargets, 0);
});

// CONTRACT PIN — an ABSENT registry keeps its pre-R1 behavior exactly.
test('R1 contract pin: an absent registry still reports no-preseason-leagues', async () => {
  const run = await runRoute();

  assert.equal(run.res.status, 200);
  assert.equal(run.event.result, 'skipped');
  assert.equal(run.event.reason, 'no-preseason-leagues');
  assert.equal(run.event.invalidLifecycleTargets, 0);
  assert.equal(run.body.invalidLifecycleTargets, 0);
  assert.equal(run.providerCalls, 0);
});

// REGRESSION TEST — every unusable-year shape is refused, and none of them
// reaches a probe, the provider, or a year entry.
test('R1 regression: unusable-only production targets refuse without any work', async () => {
  for (const [label, year] of [
    ['missing', undefined],
    ['string', '2023'],
    ['fractional', 2023.5],
    ['unsafe integer', 2 ** 53],
    ['pre-football', 1800],
    ['null', null],
  ] as const) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    deferrer.restore();
    deferrer = installSchedulerReceiptDeferrer();
    await seedRegistry([makeUnusableLeague('alpha', year)]);
    await seedPastProbe();

    const run = await runRoute();

    assert.equal(run.res.status, 200, `${label}: a data-integrity refusal is not a store outage`);
    assert.equal(run.event.result, 'failure', label);
    assert.equal(run.event.reason, 'unusable-lifecycle-year', label);
    assert.equal(run.event.invalidLifecycleTargets, 1, label);
    assert.equal(run.body.invalidLifecycleTargets, 1, label);
    assert.deepEqual(run.event.years, [], `${label}: no year entry`);
    assert.deepEqual(run.body.years, [], label);
    assert.equal(run.providerCalls, 0, `${label}: no billed provider work`);
    assert.deepEqual(run.tags, [], `${label}: no standings invalidation`);
  }
});

// REGRESSION TEST — the whole-receipt consequence. Before R1 an `undefined`
// year produced an entry whose `year` key `JSON.stringify` dropped, so
// `parseSchedulerExecutionReceipt` rejected the ENTIRE record and the job
// vanished from System Health.
test('R1 regression: an unusable target no longer poisons the stored receipt', async () => {
  await seedRegistry([makeUnusableLeague('alpha', undefined)]);
  await seedPastProbe();

  await runRoute();
  await deferrer.flush();

  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt, 'the receipt still parses — the job stays visible');
  assert.equal(receipt.value.reason, 'unusable-lifecycle-year');
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.deepEqual(receipt.value.target.years, [], 'the unusable year is not stored');
  assert.equal(receipt.value.target.invalidLifecycleTargets, 1);
  assert.ok(
    !JSON.stringify(receipt.value).includes('alpha'),
    'a refused candidate never contributes a slug'
  );
});

// REGRESSION TEST — a mixed run does the valid work AND reports the refusal, on
// all three surfaces, without the refusal erasing the executed year.
test('R1 regression: a mixed run executes the valid year and reports the refusal everywhere', async () => {
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeUnusableLeague('broken', 2023.5),
  ]);
  await seedPastProbe();
  stubFetchPopulated();

  const run = await runRoute();

  // The valid year still executed — POSITIVE CONTROL for the zero-work
  // assertions above: this fixture proves the same path DOES reach the provider.
  assert.ok(run.providerCalls > 0, 'the valid year still reached the provider');
  assert.equal(run.event.years.length, 1);
  assert.equal(run.event.years[0]!.year, YEAR);
  assert.equal(run.event.years[0]!.targetLeagues, 1, 'the refused candidate is not counted here');
  assert.equal((await readLeague('alpha'))!.status!.state, 'season', 'alpha transitioned');
  assert.equal((await readLeague('broken'))!.status!.state, 'preseason', 'broken was untouched');

  // A run that accomplished something alongside a refusal is `partial`. The
  // REASON still names the executed year: the refusal rides on
  // `invalidLifecycleTargets`, and the receipt's year entries carry no reason
  // field, so overwriting it would erase the only durable record of what the
  // valid year did.
  assert.equal(run.event.result, 'partial');
  assert.equal(run.event.reason, 'season-transitioned');

  assert.equal(run.event.invalidLifecycleTargets, 1);
  assert.equal(run.body.invalidLifecycleTargets, 1);

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt);
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.equal(receipt.value.target.invalidLifecycleTargets, 1, 'all three surfaces agree');
  assert.deepEqual(
    receipt.value.target.years.map((y) => y.year),
    [YEAR]
  );
});

// REGRESSION TEST — ordering. Validity is applied AFTER the demo exclusion, so a
// malformed DEMO record can never flip this run's zero-target reason and
// silently undo F2H1T2.
test('R1 regression: a demo-only registry with an unusable year keeps the F2H1T2 reason', async () => {
  await seedRegistry([makeUnusableLeague(TEST_LEAGUE_SLUG, 2023.5)]);
  await seedPastProbe();

  const run = await runRoute();

  assert.equal(run.res.status, 200);
  assert.equal(run.event.result, 'skipped');
  assert.equal(run.event.reason, 'no-automatic-preseason-leagues');
  assert.equal(run.event.invalidLifecycleTargets, 0, 'a demo record is never an invalid TARGET');
  assert.equal(run.body.invalidLifecycleTargets, 0);
  assert.equal(run.providerCalls, 0);
});

// CONTRACT PIN — an ordinary clean run is untouched by R1.
test('R1 contract pin: a wholly valid run still reports zero refusals', async () => {
  await seedRegistry([makeLeague('alpha', { state: 'preseason', year: YEAR })]);
  await seedPastProbe();
  stubFetchPopulated();

  const run = await runRoute();

  assert.ok(run.providerCalls > 0);
  assert.equal(run.event.invalidLifecycleTargets, 0);
  assert.equal(run.body.invalidLifecycleTargets, 0);
  assert.equal(run.event.result, 'success');
  assert.equal((await readLeague('alpha'))!.status!.state, 'season');
});

// REGRESSION TEST — the per-year CATCH path must aggregate through the same
// authority as the normal path. A throw arriving after a refusal was already
// detected must not erase the refusal: `invalidLifecycleTargets` is assigned
// ahead of the per-year loop for exactly that reason, and it must still reach
// the event and the receipt. The reason meanwhile names the fault that actually
// occurred — the refusal has its own carrier and does not rewrite it.
test('R1 regression: a mid-run throw does not erase an already-detected refusal', async () => {
  const { __setAppStateWriteFailureForTests } = await import(
    '../../../../../lib/server/appStateStore.ts'
  );
  await seedRegistry([
    makeLeague('alpha', { state: 'preseason', year: YEAR }),
    makeUnusableLeague('broken', 2023.5),
  ]);
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body =
      url.searchParams.get('seasonType') === 'postseason'
        ? '[]'
        : JSON.stringify([
            {
              id: 'g1',
              week: 1,
              home_team: 'Texas',
              away_team: 'Rice',
              start_date: '2099-09-01T00:00:00Z',
              completed: false,
            },
          ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  __setAppStateWriteFailureForTests(new Error('probe write boom'), 'schedule-probe');
  let run: RunResult;
  try {
    run = await runRoute();
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  // POSITIVE CONTROL: the throw really happened on the valid year's path.
  assert.equal(run.res.status, 500);
  assert.equal(run.event.years.length, 1);
  assert.equal(run.event.years[0]!.reason, 'probe-write-failed');

  // The refusal detected BEFORE the throw survives it, on every surface — the
  // count is assigned ahead of the per-year loop precisely so a throw cannot
  // lose it. The reason still names the fault that actually occurred.
  assert.equal(run.event.invalidLifecycleTargets, 1, 'the refusal is not erased by the throw');
  assert.equal(run.event.reason, 'probe-write-failed', 'the real fault is still named');

  await deferrer.flush();
  const receipt = await readSchedulerReceipt('season-transition');
  assert.ok(receipt);
  assert.equal(receipt.value.reason, 'probe-write-failed');
  assert.equal(receipt.value.target.kind, 'season-transition-years');
  if (receipt.value.target.kind !== 'season-transition-years') return;
  assert.equal(receipt.value.target.invalidLifecycleTargets, 1);
});
