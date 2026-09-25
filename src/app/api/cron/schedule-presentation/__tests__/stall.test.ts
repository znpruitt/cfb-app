import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import test from 'node:test';

import { GET } from '../route';
import { CFBD_PEAK_LATENCY_TIMEOUT_MS } from '../../../../../lib/api/cfbdRequestPolicy.ts';
import { VENUE_CATALOG_TTL_MS } from '../../../../../lib/schedule/schedulePresentationRefresh.ts';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  PROVIDER_REFRESH_SETTINGS_KEY,
  PROVIDER_REFRESH_SETTINGS_SCOPE,
  type ProviderRefreshSettings,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { PROVIDER_DATASETS } from '../../../../../lib/providerDatasets.ts';
import { __resetSchedulePresentationMemoForTests } from '../../../../../lib/schedule/schedulePresentationJoin.ts';
import { __resetUpstreamPacingForTests } from '../../../../../lib/api/fetchUpstream.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';

/**
 * PLATFORM-757a ACCEPTANCE 3 — **the receipt is written while the provider hangs.**
 *
 * ## What this proves that nothing else does
 *
 * #757 is not "presentation can fail". It is that presentation's DURATION is
 * unbounded from its caller's point of view, so a caller can be KILLED at the
 * platform ceiling with its durable receipt still unwritten — and a killed run
 * is then indistinguishable from one that never happened. This job must have
 * the opposite property from its first commit, not acquire it later.
 *
 * ## Why the body, and not the headers
 *
 * A provider that merely delays its HEADERS is the easy case, and a test using
 * one passes whether or not the deadline covers body consumption. The real
 * question is whether the per-attempt bound spans the whole request. It does,
 * structurally: `fetchUpstream` passes the timeout signal to `fetch` (`:390`),
 * reads the body through `consumeClassified` INSIDE the timed `try`, and clears
 * the timeout in the `finally` only AFTER that read. The stub below answers with
 * headers and a first byte, then stalls the body forever unless its signal
 * aborts — which is exactly what a hung server looks like from here, and turns
 * that structural reasoning into evidence.
 *
 * `fetchUpstreamBodyDeadline.test.ts` (PLATFORM-662) already proves the
 * classification against a real socket. What is unproven until here is that the
 * JOB's receipt survives it.
 *
 * ## Why the clock is driven
 *
 * The production bound is 40s per attempt over 3 attempts, and
 * `scripts/run-tests.mjs` caps a test process at 30s, so the real ceiling cannot
 * be waited out. `setTimeout` is mocked and ticked: the AbortController, the
 * stream error, the fault classification and the receipt write are all the
 * REAL ones — only time is compressed. The 40s value itself is pinned by
 * assertion below rather than assumed.
 *
 * This file is separate from `route.test.ts` because it mocks timers, and a
 * suite that shares a process with tests relying on real ones is a flake
 * waiting to happen.
 */

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

/** Requests the stub received, and whether each one's body was ever aborted. */
let mediaAttempts: Array<{ aborted: boolean }> = [];

/**
 * A provider that completes its headers, emits a first byte, then stalls the
 * body until its signal aborts.
 *
 * The first byte matters: a stub that returned an empty stalling stream could be
 * satisfied by a deadline that only covered the HEADERS, because nothing would
 * distinguish "no body yet" from "no response yet". Emitting `[` puts the
 * request unambiguously into body consumption before it hangs.
 */
function stubStallingBody(): void {
  globalThis.fetch = (async (input: URL | string | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes('/games/media')) throw new Error(`unexpected provider call: ${href}`);
    const attempt = { aborted: false };
    mediaAttempts.push(attempt);
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('['));
        const fail = (): void => {
          attempt.aborted = true;
          controller.error(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail);
        // Deliberately never closed and never enqueued again.
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function seed(extraYear?: number, venueAgeMs = 0): Promise<void> {
  await setAppState('leagues', 'registry', [
    {
      slug: 'a',
      displayName: 'League a',
      year: 2026,
      createdAt: '2022-01-01T00:00:00.000Z',
      status: { state: 'season', year: 2026 },
    } satisfies League,
    ...(extraYear === undefined
      ? []
      : [
          {
            slug: 'b',
            displayName: 'League b',
            year: extraYear,
            createdAt: '2022-01-01T00:00:00.000Z',
            status: { state: 'preseason', year: extraYear },
          } satisfies League,
        ]),
  ]);
  const datasets = {} as ProviderRefreshSettings['datasets'];
  for (const dataset of PROVIDER_DATASETS) datasets[dataset] = { enabled: true };
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, {
    globalPause: false,
    datasets,
  } satisfies ProviderRefreshSettings);
  await setAppState('schedule', '2026-all-all', {
    at: 1,
    items: [
      {
        id: '101',
        week: 1,
        startDate: '2026-09-05T23:00:00.000Z',
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Home',
        awayTeam: 'Away',
        homeId: null,
        awayId: null,
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  if (extraYear !== undefined) {
    await setAppState('schedule', `${extraYear}-all-all`, {
      at: 1,
      items: [
        {
          id: '202',
          week: 1,
          startDate: '2027-09-05T23:00:00.000Z',
          neutralSite: false,
          conferenceGame: false,
          homeTeam: 'Home',
          awayTeam: 'Away',
          homeId: null,
          awayId: null,
          homeConference: 'SEC',
          awayConference: 'SEC',
          status: 'scheduled',
          seasonType: 'regular',
        },
      ],
      partialFailure: false,
      failedSeasonTypes: [],
    });
  }
  // A FRESH venue catalog, so the venue part short-circuits on its TTL and this
  // test isolates the media stall. Without it the run would stall twice and the
  // assertion below could not say which site it measured.
  await setAppState('venue-catalog', 'current', {
    at: Date.now() - venueAgeMs,
    items: [
      {
        id: 3504,
        name: 'Kyle Field',
        city: 'College Station',
        state: 'TX',
        countryCode: 'US',
        timezone: null,
        capacity: null,
        grass: null,
        dome: null,
      },
    ],
  });
}

/**
 * Yield MACROTASKS, not just a microtask drain.
 *
 * The durable store's reads are real filesystem I/O, and an
 * `await Promise.resolve()` loop cannot advance an fs promise — it drains the
 * microtask queue and hands control straight back, so the run never reaches the
 * provider call. `setImmediate` is not among the mocked APIs, so it still turns
 * the loop.
 *
 * Twenty turns is a BUDGET, not a guarantee that the run has reached its next
 * `await`. Nothing here can make it one — the run's progress depends on how fast
 * the filesystem answers, which is load. {@link tickUntilSettled} is built to
 * absorb that rather than to out-guess it.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * The hang guard on {@link tickUntilSettled} — NOT a measurement of what a run
 * needs. The loop stops on the run itself, so a healthy run never approaches
 * this number, and it is sized well above observed demand rather than tuned
 * against it — about four times the worst index measured below.
 *
 * Measured 2026-09-24, instrumented over 200 runs at five-way contention: the
 * last timer fired at tick index 6-9 for ACCEPTANCE 3 and 6-13 for ACCEPTANCE 9.
 * `docs/campaigns/platform-872-tick-until-settled-closeout.md` has the full
 * distribution and the method.
 */
const MAX_STALL_TICKS = 60;

/**
 * Drive the mocked clock until `running` SETTLES, with a bounded cap.
 *
 * ## Why not a fixed count — #872
 *
 * These loops used to tick a fixed ten and twelve times, on the reasoning that
 * three attempts need five ticks — one per attempt deadline, two for the backoff
 * sleeps between them — so the remaining five were "deliberate headroom" and
 * "extra ticks are free".
 *
 * **The timer count was right and the headroom was not.** A tick only fires a
 * timer that has already been SCHEDULED. `settle` returns after a fixed number
 * of macrotask turns, not when the run reaches its next `await`, so a tick
 * issued while the run is still inside a durable read fires nothing and is
 * SPENT. The demand is five timers — measured, in all 700 instrumented
 * executions — but reaching the fifth costs SEVEN TO NINE ticks, because the
 * spent ones sit in between. The old allowance of ten was therefore about one
 * tick from the edge, not five, and the tail crosses it: ACCEPTANCE 9's own
 * allowance of twelve was exceeded once in 200 measured runs (index 13).
 *
 * That failed ~2.5% of runs (#872, measured over 120+ by the #866 lane), and it
 * failed in the worst available way: `running` stayed pending forever, so the
 * test died with "Promise resolution is still pending but the event loop has
 * already resolved" — a BROKEN-SUITE signature rather than an assertion naming a
 * broken job — and took every later test in the file down with it, under a TAP
 * summary still reading `# fail 0`.
 *
 * Ticking on the condition removes the class outright: a spent tick costs one
 * more iteration instead of one of a handful of lives. Proven by mutation rather
 * than asserted — shrinking `settle`'s budget to 5 turns kills the fixed-count
 * loops 5/5 and leaves this one green; see the closeout named above.
 *
 * ## What the cap is for
 *
 * A genuinely stuck job must still fail, and fail BY NAME. The cap ends the loop
 * and asserts, so the failure is attributable instead of a dead file. Pinned by
 * '#872: the tick cap fails by ASSERTION, naming what hung — it does not kill the file',
 * and the default's value and wiring by
 * '#872: the default cap is the one the loops run under, and it stays clear of measured demand'.
 */
async function tickUntilSettled(
  t: { mock: { timers: { tick: (ms: number) => void } } },
  running: Promise<unknown>,
  what: string,
  maxTicks = MAX_STALL_TICKS
): Promise<void> {
  // Observe settlement without consuming it — the caller still awaits `running`
  // for its value. The rejection arm is not error handling: it marks a rejected
  // run as settled, because the loop must stop either way, and it keeps this
  // observation from surfacing as an unhandled rejection before the caller
  // reaches its own `await`.
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  void running.then(mark, mark);

  let ticks = 0;
  for (; ticks < maxTicks; ticks += 1) {
    await settle();
    if (settled) return;
    t.mock.timers.tick(CFBD_PEAK_LATENCY_TIMEOUT_MS + 5_000);
  }
  await settle();
  assert.ok(
    settled,
    `${what} did not settle after ${ticks} ticks of ${CFBD_PEAK_LATENCY_TIMEOUT_MS + 5_000} ms — ` +
      'it is waiting on something the mocked clock does not drive'
  );
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSchedulePresentationMemoForTests();
  __resetUpstreamPacingForTests();
  mediaAttempts = [];
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  deferrer = installSchedulerReceiptDeferrer();
  console.log = () => {};
});

test.afterEach(() => {
  deferrer.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
  MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
});

test('the per-attempt bound is the 40s peak-latency timeout, not something looser', () => {
  // The compressed clock below proves the MECHANISM. This pins the VALUE, so a
  // change to the production ceiling cannot pass by silently while the mechanism
  // test keeps ticking whatever it is handed.
  assert.equal(CFBD_PEAK_LATENCY_TIMEOUT_MS, 40_000);
});

test('ACCEPTANCE 3: the receipt is written even when the provider stalls MID-BODY', async (t) => {
  await seed();
  stubStallingBody();
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const running = GET(
    new Request('https://turfwar.games/api/cron/schedule-presentation', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );

  // Advance past each attempt's deadline in turn, letting the promise chain
  // settle between ticks. Generous margins: the point is to outlast the bound,
  // not to measure it. The loop stops when the RUN does — see
  // `tickUntilSettled` for why a fixed count was #872.
  await tickUntilSettled(t, running, 'the stalled schedule-presentation run');

  const res = await running;
  t.mock.timers.reset();

  // The stall reached BODY consumption and the bound ended it there.
  assert.ok(mediaAttempts.length >= 1, 'the provider was actually called');
  assert.ok(
    mediaAttempts.every((a) => a.aborted),
    'every stalled attempt was aborted by the per-attempt deadline, during the body read'
  );

  const body = await res.json();
  assert.equal(res.status, 200, 'a hung provider is a controlled outcome, not a 5xx');
  assert.equal(body.years[0].media, 'provider-fetch-failed');
  assert.equal(body.years[0].venues, 'fresh-cache', 'the venue leg was not due');
  assert.equal(body.result, 'partial', 'a mixed year makes a mixed run');

  // THE POINT. The run completed and filed its receipt, so System Health can
  // tell this from a run that never happened.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('schedule-presentation');
  assert.ok(receipt, 'the receipt exists despite the hang — this is what #757 is about');
  assert.equal(receipt.value.job, 'schedule-presentation');
  // `partial`, not `failure`, and that is round 3 finding 2's correction: this
  // year's media failed while its venues no-opped on a fresh TTL, so the YEAR is
  // itself mixed. Counting a `partial` year purely as a failure made the run's
  // class depend on how many years happened to be active — one year read
  // "execution failed", two years read "partial" for the identical fault.
  assert.equal(receipt.value.result, 'partial');
  assert.equal(receipt.value.providerCallAttempted, true);
  assert.equal(receipt.value.target.kind, 'schedule-presentation');
});

test('ACCEPTANCE 9: a year that eats the clock stops the NEXT year from starting', async (t) => {
  // The budget's real behaviour, with elapsed time that is genuine rather than
  // an artefact of an oversized reservation. `Date` is mocked alongside
  // `setTimeout`, so ticking the stalled attempts advances the wall clock the
  // route reads — which is the only way to reach the branch inside the 30s
  // per-process cap.
  //
  // The venue catalog is fresh, so the leg is NOT owed and each year reserves
  // one media leg (121s). Year 2026 sorts first (no media entry at all) and its
  // media stalls through all three attempts, and the ticks that outlast those
  // attempts are what carry elapsed past the line.
  //
  // THE VERDICT DOES NOT DEPEND ON HOW MANY TICKS THAT TAKES, which is what
  // makes the condition-driven loop below safe here even though `Date` is mocked
  // and every tick advances the clock the route reads. 2027 reserves 121s
  // against a 250s budget (`JOB_BUDGET_MS`), so it is admitted only while
  // elapsed ≤ 129s — and three stalled attempts cannot complete in fewer than
  // three ticks of 45s, which is already 135s. Every ADDITIONAL tick moves
  // elapsed further past the line, never back toward it, so the floor is the
  // only bound that has to hold.
  await seed(2027);
  stubStallingBody();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

  const running = GET(
    new Request('https://turfwar.games/api/cron/schedule-presentation', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
  await tickUntilSettled(t, running, 'the budget-exhausted schedule-presentation run');
  const res = await running;
  t.mock.timers.reset();

  const body = await res.json();
  assert.equal(body.years.length, 1, 'only the first year ran');
  assert.equal(body.yearsSkippedForBudget, 1, 'the second year was not started');
  assert.equal(body.reason, 'budget-exhausted');

  // THE POINT, again: the run still filed its receipt.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('schedule-presentation');
  assert.ok(receipt, 'a budget-stopped run still files its receipt');
  assert.equal(
    receipt.value.target.kind === 'schedule-presentation' &&
      receipt.value.target.yearsSkippedForBudget,
    1,
    'and the skipped year reaches it'
  );
});

test('#872: the tick cap fails by ASSERTION, naming what hung — it does not kill the file', async (t) => {
  // The positive control for the loop the two tests above rely on. Without it,
  // "the cap asserts rather than dying" is an unwritten claim about the very
  // mechanism whose previous unwritten claim WAS #872 — and the failure it
  // guards against is the one that prints `# fail 0` while the file dies, so the
  // difference between the two outcomes is exactly what nobody can see by
  // reading a summary.
  //
  // A promise that never settles is the genuinely-stuck job. The cap is passed
  // explicitly so this costs three ticks rather than MAX_STALL_TICKS; that the
  // default is wired to the same parameter is visible at the call site.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const neverSettles = new Promise<never>(() => {});

  await assert.rejects(
    () => tickUntilSettled(t, neverSettles, 'the never-settling probe', 3),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.includes('the never-settling probe') &&
      error.message.includes('after 3 ticks'),
    'the cap expiry names the pending work and fails as an assertion'
  );

  t.mock.timers.reset();
});

test('ROUND 3 #1: a comfortably fresh catalog owes nothing, so a later year is judged on ONE leg', async (t) => {
  // Round 2 held a 242s reservation whenever it could not PROVE the catalog was
  // fresh, and cleared that belief only on a commit. A fresh catalog therefore
  // kept the full reservation all run, and years were skipped for budget with
  // minutes of headroom left.
  //
  // Re-reading the catalog per year removes the belief entirely: a fresh catalog
  // simply reads fresh, every time. This pins the consequence — 120s elapsed
  // plus one 121s leg fits the 250s budget, where 120 + 242 would not, so the
  // reservation is the only thing deciding whether year 2 runs.
  //
  // The mock clock is ANCHORED to real time. `mock.timers.enable` starts `Date`
  // at 0 by default, which makes every stored `at` look astronomically far in
  // the future — the catalog then reads infinitely fresh whatever the code does,
  // and this test passes against any reservation rule at all. That is exactly
  // what an earlier version did, and both mutations stayed green against it.
  const t0 = Date.now();
  await seed(2027); // a catalog written just now: the full 30-day TTL ahead of it
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  let mediaCalls = 0;
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes('/games/media')) throw new Error(`unexpected provider call: ${href}`);
    mediaCalls += 1;
    // Year 1 takes two minutes. 120 + 121 = 241 fits; 120 + 242 = 362 does not.
    if (mediaCalls === 1) t.mock.timers.tick(120_000);
    return new Response(JSON.stringify([{ id: 101, mediaType: 'tv', outlet: 'ESPN' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const body = await (
    await GET(
      new Request('https://turfwar.games/api/cron/schedule-presentation', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )
  ).json();
  t.mock.timers.reset();

  assert.equal(body.years[0].venues, 'fresh-cache', 'the catalog is nowhere near its TTL');
  assert.equal(body.years.length, 2, 'so the second year is judged against one leg, and runs');
  assert.equal(body.yearsSkippedForBudget, 0);
});

test('ROUND 3 #3: a catalog that expires mid-run is owed by the year that follows', async (t) => {
  // The complement of the test above, and the reason the obligation is re-read
  // rather than decided once: the same run can legitimately answer "not owed"
  // for one year and "owed" for the next.
  //
  // The catalog has 100s of TTL left when the run starts. Year 1 reads it fresh
  // and spends nothing on venues. Year 1 then takes two minutes, so by year 2
  // the catalog has genuinely expired — and year 2 must be judged on BOTH legs,
  // which 120s of elapsed time cannot afford. A run that carried year 1's
  // reading forward would admit year 2 on one leg and could overrun the ceiling.
  const t0 = Date.now();
  await seed(2027, VENUE_CATALOG_TTL_MS - 100_000);
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  let mediaCalls = 0;
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.includes('/games/media')) {
      mediaCalls += 1;
      if (mediaCalls === 1) t.mock.timers.tick(120_000);
      return new Response(JSON.stringify([{ id: 101, mediaType: 'tv', outlet: 'ESPN' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // The venue catalog has genuinely expired by now, so the leg really does
    // reach out — and fails, leaving the obligation exactly where it was.
    throw new Error('venue provider unavailable');
  }) as typeof fetch;

  const body = await (
    await GET(
      new Request('https://turfwar.games/api/cron/schedule-presentation', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )
  ).json();
  t.mock.timers.reset();

  // Year 1's own leg reads `fresh-cache`: the authority captures `now` once per
  // invocation, at the START of the year, when the catalog still had 100s left.
  // That reading is TRUE and also irrelevant to year 2, which begins two minutes
  // later against an expired catalog — which is exactly why the obligation is
  // re-read per year rather than carried forward from this outcome.
  assert.equal(body.years[0].venues, 'fresh-cache');
  assert.equal(body.years.length, 1, 'the second year is not admitted on a one-leg reservation');
  assert.equal(body.yearsSkippedForBudget, 1);
  assert.equal(body.reason, 'budget-exhausted');
});

/**
 * PLATFORM-861 — **the admission check must decide on an elapsed time measured
 * AFTER its durable read resolves.**
 *
 * ## Why these tests need a slow STORE read, and why that is hard here
 *
 * The defect is invisible with a healthy store: `venueRefreshDue()` returns in
 * milliseconds, so a value captured before it and a value captured after it are
 * the same number. A fixture whose venue read resolves immediately proves
 * nothing at all — it passes identically before and after the fix. The read has
 * to be made slow enough to cross the admission boundary.
 *
 * Nothing in `appStateStore` can inject latency into a read: its test seams
 * cover failure (`__setAppStateReadFailureForTests`), lock failure, commit
 * failure and pool substitution, but not timing. Adding one would widen this
 * slice into a module the whole app shares, so instead these tests reach the
 * only seam that already exists at the boundary — **the file-fallback store
 * calls `fs.readFile`, and `node:fs`'s `promises` object is mutable**, so a test
 * can wrap it and advance the mock clock for the duration of one read. No
 * production code carries a timing hook.
 *
 * ## Why the frame name and not a call count
 *
 * A two-year run makes 28 store reads and exactly ONE of them comes from
 * `venueRefreshDue` — measured, and it is the governed year's, because an
 * ungoverned year skips the read entirely. Keying on the read's INDEX would then
 * encode that count, and any unrelated change to the job's store traffic would
 * move the latency onto a different read and quietly stop testing the claim.
 * Keying on the calling frame asks the question the test actually cares about:
 * is THIS the read the admission check is waiting for.
 */
const VENUE_READ_FRAME = 'venueRefreshDue';
const STALENESS_READ_FRAME = 'mediaObservedAtMs';

/**
 * A bounded durable read's full cost under PLATFORM-625: FOUR composed 15s
 * bounds, not one.
 *
 * **This was 15_000 and called a "full cost" (PLATFORM-866).** One `getAppState`
 * on the database path runs `getPool().connect()` at `connectionTimeoutMillis`,
 * `openBoundedTransaction` at `APP_STATE_OPENER_TIMEOUT_MS`, the statement at
 * `statement_timeout`, and then `commit` — which carries the same bound, because
 * `APP_STATE_BOUNDED_BEGIN` sets it with `SET LOCAL` and LOCAL holds to the end
 * of the transaction. Each is 15s, they are sequential, so the read is ~60s.
 *
 * **A FLOOR, NOT A CEILING.** Three of the four legs are SERVER-side
 * `statement_timeout`s, and `appStateStore` says of its `keepAlive` that "this is
 * DETECTION, not a tight bound … it closes the 'hangs forever' case, NOT the
 * 'bounded at 15 s' case" — so if a timeout's error packet never lands the wait
 * is the OS probe/retry schedule. `queryBounded` also has a fifth round trip this
 * omits: a timed-out `commit` ends the transaction, reverting `SET LOCAL`, and the
 * catch's `rollback` then runs unbounded. This fixture therefore models the
 * cheapest degraded read, not the worst one.
 *
 * None of those four constants is exported, so this figure is restated rather
 * than imported and a change to any of them will not redden this file. That is
 * the same weakness the 15s version had, and naming it is the only honest
 * mitigation available from here.
 *
 * The value is load-bearing in the docblock by `JOB_BUDGET_MS` and in the
 * admission comment, where it is what turns the pre-fix under-count from margin
 * erosion into a `maxDuration` breach.
 */
const STORE_READ_WORST_CASE_MS = 60_000;

/** What `JOB_BUDGET_MS - (YEAR_WORST_CASE_MS + VENUE_LEG_WORST_CASE_MS)` comes to:
 * 250s - (121s + 121s). Neither constant is exported, so the boundary pair below
 * pins the arithmetic behaviourally instead — a year is admitted at exactly this
 * elapsed and skipped one millisecond past it. */
const BOTH_LEGS_ADMISSION_BOUNDARY_MS = 8_000;

// A STACK, not a single slot, so a test can install a second probe as a witness
// for a first one's absence assertion. Each patch wraps whatever `fs.readFile`
// already is, so every installed probe observes the same call, and they unwind in
// reverse on teardown.
const readClockRestores: Array<() => void> = [];

/**
 * Advance the mock clock for the duration of every durable read issued from
 * `frame`, and count them.
 *
 * `t.mock.timers.tick` is synchronous, so calling it before delegating to the
 * real `fs.readFile` puts the whole advance inside the awaited read — which is
 * precisely where production spends it.
 */
function installReadClock(
  t: { mock: { timers: { tick: (ms: number) => void } } },
  frame: string,
  advanceMs: number
): { reads: number } {
  const original = fs.readFile;
  const counter = { reads: 0 };
  fs.readFile = (async (...args: unknown[]) => {
    if ((new Error('frame probe').stack ?? '').includes(frame)) {
      counter.reads += 1;
      t.mock.timers.tick(advanceMs);
    }
    return (original as (...a: unknown[]) => Promise<unknown>)(...args);
  }) as unknown as typeof fs.readFile;
  readClockRestores.push(() => {
    fs.readFile = original;
  });
  return counter;
}

/** Media succeeds instantly; the venue leg fails, so an owed catalog STAYS owed
 * and the next year is still judged on both legs. */
function stubMediaOkVenuesDown(): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.includes('/games/media')) {
      return new Response(JSON.stringify([{ id: 101, mediaType: 'tv', outlet: 'ESPN' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('venue provider unavailable');
  }) as typeof fetch;
}

async function runCron(): Promise<{
  years: Array<{ year: number; venues: string }>;
  yearsSkippedForBudget: number;
  reason: string;
}> {
  return (await (
    await GET(
      new Request('https://turfwar.games/api/cron/schedule-presentation', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )
  ).json()) as {
    years: Array<{ year: number; venues: string }>;
    yearsSkippedForBudget: number;
    reason: string;
  };
}

test.afterEach(() => {
  while (readClockRestores.length > 0) readClockRestores.pop()?.();
});

test('PLATFORM-861: a slow venue read is charged to the admission check, not to the year after it', async (t) => {
  // THE DEFECT, AND THE ONE TEST THAT FAILS AGAINST PRE-FIX `main`.
  //
  // The catalog is exactly at its TTL, so the leg is owed for every year, and the
  // venue provider is down, so year 1 cannot settle the obligation — year 2 is
  // judged on both legs, a 242s reservation.
  //
  // `Date` is mocked and anchored to real time, and NOTHING advances it except
  // the venue read itself. So year 2 reaches its `elapsedMs` capture with elapsed
  // 0, and 0 + 242 = 242 <= 250 admits on the stale value. The read then costs
  // its PLATFORM-625 floor, ~60s, and 60 + 242 = 302 > 250 — so a check that
  // re-measures skips the year and a check that reuses the stale capture admits
  // it.
  //
  // Referred to by NAME, not by line number: these two sentences cited `:421`
  // until PLATFORM-866, and `:421` is a bare `//` line — the `route.ts` half of
  // that same remediation was applied and this half was not, so the comment
  // explaining the fix misdirected exactly where the fix said not to.
  //
  // WHY THE FIXTURE CROSSES THE BOUNDARY: the margin with both legs owed is 8s
  // (250 - 242), and a degraded store read is worth ~60s or more. The defect's whole
  // reachability argument is that one read outweighs the margin — and at 60s it
  // does so by enough to carry the year past the 300s ceiling, not merely past
  // the budget.
  const t0 = Date.now();
  await seed(2027, VENUE_CATALOG_TTL_MS);
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  stubMediaOkVenuesDown();
  const venueReads = installReadClock(t, VENUE_READ_FRAME, STORE_READ_WORST_CASE_MS);

  const body = await runCron();
  t.mock.timers.reset();

  assert.equal(venueReads.reads, 1, 'only the GOVERNED year reads the catalog — year 1 skips it');
  assert.equal(
    body.years.length,
    1,
    'the slow read is charged to the year it precedes, so 2027 is skipped'
  );
  assert.equal(body.yearsSkippedForBudget, 1);
  assert.equal(body.reason, 'budget-exhausted');
});

test('PLATFORM-861: a year IS admitted at exactly the both-legs boundary', async (t) => {
  // The lower half of the constants pin, and the reason the fix cannot starve a
  // later year: re-measuring makes the decision honest, not stricter. At exactly
  // 8s of elapsed, 8 + 242 = 250 is NOT greater than the budget, so the year
  // runs. Together with the test below this pins
  // `JOB_BUDGET_MS - (YEAR_WORST_CASE_MS + VENUE_LEG_WORST_CASE_MS)` at 8s and
  // the comparison as strict `>`, neither constant being exported.
  const t0 = Date.now();
  await seed(2027, VENUE_CATALOG_TTL_MS);
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  stubMediaOkVenuesDown();
  const venueReads = installReadClock(t, VENUE_READ_FRAME, BOTH_LEGS_ADMISSION_BOUNDARY_MS);

  const body = await runCron();
  t.mock.timers.reset();

  assert.equal(venueReads.reads, 1);
  assert.equal(body.years.length, 2, 'exactly 250s of promise is still a promise the job can keep');
  assert.equal(body.yearsSkippedForBudget, 0);
});

test('PLATFORM-861: one millisecond past the boundary and the year is skipped', async (t) => {
  // The upper half. 8.001s + 242s = 250.001s > 250s.
  const t0 = Date.now();
  await seed(2027, VENUE_CATALOG_TTL_MS);
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  stubMediaOkVenuesDown();
  const venueReads = installReadClock(t, VENUE_READ_FRAME, BOTH_LEGS_ADMISSION_BOUNDARY_MS + 1);

  const body = await runCron();
  t.mock.timers.reset();

  assert.equal(venueReads.reads, 1);
  assert.equal(body.years.length, 1, 'one millisecond over the budget is over the budget');
  assert.equal(body.yearsSkippedForBudget, 1);
});

test('PLATFORM-861: a year that cannot fit under ANY answer costs no durable read', async (t) => {
  // ACCEPTANCE 2 — the cheap pre-check keeps its value from BEFORE the read, and
  // that ordering is what the fix must not disturb. It was itself a review
  // finding (757a round 4, finding 2).
  //
  // The catalog is fresh here, so the answer would have been "not owed" and a
  // one-leg reservation. The point is that the job never finds out: year 1 burns
  // 130s, and 130 + 121 exceeds the budget under the CHEAPEST possible answer, so
  // spending a bounded read to discover which answer applies is wasted. Keyed on
  // the read's calling frame, so this asserts the absence of the read itself
  // rather than the absence of some side effect of it.
  //
  // ## THE ABSENCE ASSERTION NEEDS A WITNESS, AND HAD NONE (PLATFORM-866)
  //
  // `venueReads.reads === 0` is the only absence claim in this group, and the
  // counter only increments when a stack carries the frame name — so "the read
  // never happened" and "the probe cannot see reads" render identically. Measured:
  // blinding `VENUE_READ_FRAME` to a nonexistent frame reddened the three tests
  // above and left THIS ONE GREEN. The other probes carry implicit controls
  // (`reads === 1`, `reads >= 1`); an absence assertion cannot.
  //
  // So a second probe watches a frame this run MUST reach — `orderByStaleness`
  // reads media freshness for both years before the loop — with a zero advance so
  // it changes no timing. If the mechanism ever stops seeing reads (a pool path
  // when `DATABASE_URL` is set, an inlined helper, a lowered
  // `Error.stackTraceLimit`), the witness goes to zero and says so, instead of the
  // real assertion passing blind.
  //
  // The witness proves the MECHANISM sees reads. It does not prove that
  // `VENUE_READ_FRAME` still names a real function — blinding only that constant
  // leaves this test green, because zero is what it expects. The three tests above
  // pin that name (they assert `reads === 1`), so the GROUP covers it; the static
  // check below makes this test independently sound rather than relying on its
  // neighbours, since a reader deleting one of them would not know they had
  // removed this one's support.
  const t0 = Date.now();
  await seed(2027);
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  let mediaCalls = 0;
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes('/games/media')) throw new Error(`unexpected provider call: ${href}`);
    mediaCalls += 1;
    // 130s, so `130 + 121 = 251 > 250` fails the pre-check for year 2.
    if (mediaCalls === 1) t.mock.timers.tick(130_000);
    return new Response(JSON.stringify([{ id: 101, mediaType: 'tv', outlet: 'ESPN' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const routeSource = await fs.readFile(new URL('../route.ts', import.meta.url), 'utf8');
  assert.ok(
    routeSource.includes(`function ${VENUE_READ_FRAME}(`),
    `${VENUE_READ_FRAME} is not a function in route.ts, so a stack could never carry it`
  );
  // ORDER MATTERS, and it was wrong (PLATFORM-866). Each probe wraps whatever
  // `fs.readFile` already is, so the one installed LAST is outermost and captures
  // its stack one frame SHALLOWER than the one it wraps. The witness was installed
  // last, which made it a weaker observer than the probe whose blindness it exists
  // to rule out — and stack truncation, which its own comment names, is exactly a
  // cause that hides a deep frame while leaving a shallow one visible. Installed
  // FIRST, the witness sits innermost and is a true lower bound: if it can see its
  // frame from there, the venue probe can see one from shallower.
  const witnessReads = installReadClock(t, STALENESS_READ_FRAME, 0);
  const venueReads = installReadClock(t, VENUE_READ_FRAME, STORE_READ_WORST_CASE_MS);

  const body = await runCron();
  t.mock.timers.reset();

  assert.ok(
    witnessReads.reads >= 1,
    `the frame probe can see durable reads in this run (witness saw ${witnessReads.reads}), ` +
      'so the zero below means the read was ABSENT and not that the probe was blind'
  );
  assert.equal(
    venueReads.reads,
    0,
    'the durable read was never attempted for a year that cannot fit'
  );
  assert.equal(body.years.length, 1);
  assert.equal(body.yearsSkippedForBudget, 1);
});

test('PLATFORM-861: the FIRST year runs even past the budget, with a slow store and the venue leg owed', async (t) => {
  // ACCEPTANCE 3 — THE STARVATION GUARD, stated as strongly as the code allows.
  //
  // Round 1 shipped a reservation larger than the whole budget and starved every
  // year after the first; the reverted round-4 store term would have done it
  // again. The first year is the floor under both: it is UNGOVERNED, so no
  // elapsed time and no reservation can skip it.
  //
  // The clock is driven past the ENTIRE budget before the loop begins — 400s,
  // charged to the staleness read that orders the years — and the year must still
  // run. A weaker fixture (a few seconds of elapsed) would pass against a
  // governed first year too, and prove nothing.
  const t0 = Date.now();
  await seed(undefined, VENUE_CATALOG_TTL_MS);
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  stubMediaOkVenuesDown();
  const stalenessReads = installReadClock(t, STALENESS_READ_FRAME, 400_000);

  const body = await runCron();
  t.mock.timers.reset();

  assert.ok(stalenessReads.reads >= 1, 'the clock really was driven, before the loop');
  assert.equal(
    body.years.length,
    1,
    'the first year is ungoverned and runs whatever the clock says'
  );
  assert.equal(body.yearsSkippedForBudget, 0);
  assert.equal(
    body.years[0].venues,
    'provider-fetch-failed',
    'and it ran with the venue leg genuinely owed, not short-circuited on a fresh TTL'
  );
});

test('#872: the default cap is the one the loops run under, and it stays clear of measured demand', async (t) => {
  // ROUND 1 FINDING 2. Nothing observed `MAX_STALL_TICKS` or the
  // `maxTicks = MAX_STALL_TICKS` default: ACCEPTANCE 3 and 9 never reach the cap
  // on a healthy run, and the control above passes its own cap of 3. So the
  // constant was load-bearing for the recorded evidence and unpinned by the code.
  //
  // THE GAP IS NOT THEORETICAL, and the edit that walks through it is specific.
  // The docblock records a MEASURED distribution of 6-13, which reads as an
  // invitation to size the cap to the data — and a cap near the top of that
  // range reintroduces #872 as an intermittent named assertion, with the whole
  // suite green on the commit that caused it. The measurement is there to
  // justify the margin, not to set the value.
  //
  // Two assertions, because they fail to different edits. The first is the
  // SAFETY MARGIN, which a tuning edit breaks. The second is the WIRING — that
  // the omitted argument actually reaches the loop — which a signature change
  // breaks while leaving the constant untouched.
  assert.ok(
    MAX_STALL_TICKS >= 30,
    'the cap must stay clear of measured demand (worst last-fire index 13 over 200 runs); ' +
      `${MAX_STALL_TICKS} is close enough to reintroduce #872`
  );

  t.mock.timers.enable({ apis: ['setTimeout'] });
  await assert.rejects(
    () => tickUntilSettled(t, new Promise<never>(() => {}), 'the default-cap probe'),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.includes(`after ${MAX_STALL_TICKS} ticks`),
    'the omitted argument resolves to MAX_STALL_TICKS, and the message reports it'
  );
  t.mock.timers.reset();
});

test("every test name cited in route.ts or this file's comments resolves to a test in this file", async () => {
  // THE GUARD FOR THE DEFECT REVIEW FOUND ON THIS BRANCH. The first version of
  // the admission comment cited a test called 'PLATFORM-861: the admission
  // boundary is 8s of elapsed with both legs owed'. No such test was ever
  // written — the string existed only in the comment.
  //
  // A DANGLING CITATION IS WORSE THAN NO CITATION. The binding rule is that a
  // comment asserting runtime behaviour names the test asserting the same thing,
  // and its whole value is that a reader can go read that test. A name that
  // resolves to nothing spends the reader's trust and then strands them: they
  // cannot tell whether the test was deleted, renamed, or never existed, so they
  // cannot tell whether the comment's claim is covered or merely asserted.
  //
  // Checking the citation resolves is not the same as checking it is the RIGHT
  // test, and this test does not claim to do that. It closes the failure mode
  // that actually occurred, which is the name pointing at nothing.
  //
  // ## THE FIRST VERSION OF THIS GUARD WAS VACUOUS, AND HOW IS THE LESSON
  //
  // It searched the whole of this FILE's text for each cited name. The comment
  // directly above quotes the dangling name in order to explain it — so the
  // mutation that should have reddened this test found its own name in this
  // test's documentation and passed. **Quoting the mistake reproduced it**, the
  // same shape as `CLAUDE.md`'s rule about closing keywords in commit messages.
  //
  // The fix is to stop keying on the file's TEXT and key on the quantity the
  // check is actually about: the set of names that `test(...)` DECLARES. A
  // citation resolves when a test by that name exists, not when the string
  // appears somewhere in the file — prose, however careful, is not a test.
  const source = await fs.readFile(new URL('../route.ts', import.meta.url), 'utf8');
  const selfSource = await fs.readFile(new URL('./stall.test.ts', import.meta.url), 'utf8');
  // Comment continuations wrap across lines, so the leading `// ` of each line is
  // stripped before matching a quoted name that may span two or three of them.
  const flatten = (text: string): string => text.replace(/\n\s*\/\/ ?/g, ' ').replace(/\s+/g, ' ');
  const citedInRoute = [...flatten(source).matchAll(/'(PLATFORM-861:[^']+)'/g)].map((m) => m[1]);
  // #872 WIDENED THIS, BECAUSE ROUND 1 FOUND THE SAME DEFECT ONE FILE OVER AND
  // THIS GUARD COULD NOT SEE IT. The `tickUntilSettled` docblock cites the
  // controls that pin its cap, and its first version quoted a TRUNCATED form of
  // a real test's name — which resolves to nothing exactly as an invented name
  // does. The citation lived in this file's own comments rather than in
  // `route.ts`, so a guard reading only `route.ts` passed it.
  //
  // The declared-name set is already read from this file, so the fix is to widen
  // what is EXTRACTED, not what is checked against.
  const citedHere = [...flatten(selfSource).matchAll(/'(#872:[^']+)'/g)].map((m) => m[1]);
  const declared = new Set(
    [...selfSource.matchAll(/^test\(\s*'([^']+)'/gm)].map((match) => match[1])
  );

  assert.ok(
    citedInRoute.length >= 5,
    `expected route.ts to cite its tests, found ${citedInRoute.length}`
  );
  // The same positive control as `declared` below, for the added extraction: a
  // regex that stops matching would report "every citation resolves" having read
  // none of them.
  assert.ok(
    citedHere.length >= 2,
    `the #872 citation extraction found ${citedHere.length} names, so it is not reading this file's comments`
  );
  const cited = [...citedInRoute, ...citedHere];
  // A positive control on the extraction itself: if the `test(...)` pattern ever
  // stops matching, `declared` goes empty and every citation would "fail" for the
  // wrong reason — a check that cannot see is not a check that found nothing.
  assert.ok(
    declared.size >= 10,
    `the test-name extraction saw only ${declared.size} declarations, so it is not reading this file`
  );
  for (const name of cited) {
    assert.ok(
      declared.has(name),
      `a comment cites a test that does not exist in stall.test.ts: ${JSON.stringify(name)}`
    );
  }
});
