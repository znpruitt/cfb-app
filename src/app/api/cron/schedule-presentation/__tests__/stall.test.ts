import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import { CFBD_PEAK_LATENCY_TIMEOUT_MS } from '../../../../../lib/api/cfbdRequestPolicy.ts';
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

async function seed(extraYear?: number): Promise<void> {
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
    at: Date.now(),
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
  // not to measure it.
  //
  // The settle step yields a MACROTASK (`setImmediate`), not just a microtask
  // drain. The durable store's reads are real filesystem I/O, and an
  // `await Promise.resolve()` loop cannot advance an fs promise — it drains the
  // microtask queue and hands control straight back, so the run never reaches
  // the provider call and the whole file dies with "Promise resolution is still
  // pending but the event loop has already resolved". `setImmediate` is not
  // among the mocked APIs, so it still turns the loop.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  // Three attempts need at least five ticks — one per attempt deadline and one
  // per backoff sleep — plus the shared CFBD pacing waits between them. Ten is
  // deliberate headroom: too few ticks leaves the run pending and the whole
  // FILE dies with "Promise resolution is still pending but the event loop has
  // already resolved" rather than failing an assertion, so a marginal count
  // would read as a broken suite instead of a broken job. Extra ticks are free.
  for (let i = 0; i < 10; i += 1) {
    await settle();
    t.mock.timers.tick(CFBD_PEAK_LATENCY_TIMEOUT_MS + 5_000);
  }
  await settle();

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

  // THE POINT. The run completed and filed its receipt, so System Health can
  // tell this from a run that never happened.
  await deferrer.flush();
  const receipt = await readSchedulerReceipt('schedule-presentation');
  assert.ok(receipt, 'the receipt exists despite the hang — this is what #757 is about');
  assert.equal(receipt.value.job, 'schedule-presentation');
  assert.equal(receipt.value.result, 'failure');
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
  // media stalls through all three attempts, burning ~123s. 2027 then needs
  // 123 + 121 = 244s... which still fits under 250s, so the tick count below
  // deliberately carries it past the line.
  await seed(2027);
  stubStallingBody();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

  const running = GET(
    new Request('https://turfwar.games/api/cron/schedule-presentation', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  for (let i = 0; i < 12; i += 1) {
    await settle();
    t.mock.timers.tick(CFBD_PEAK_LATENCY_TIMEOUT_MS + 5_000);
  }
  await settle();
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
