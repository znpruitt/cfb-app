import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { beginProviderRefreshAttempt } from '../../server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../providerRefreshScope.ts';
import { withCompressedTimeouts } from '../../../test/compressedTimeout.ts';
import { executeOddsRefresh } from '../oddsRefreshExecutor.ts';
import { defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';

// ---------------------------------------------------------------------------
// PLATFORM-662 — the odds executor's SECOND unprotected body read.
//
// `oddsRefreshExecutor` calls `fetchUpstreamResponse` directly and reads the
// body itself, 84 lines and a DURABLE USAGE WRITE later. That write is
// deliberate — "the request spent credits regardless" — which is exactly why
// this body read cannot be handed to the shared retry loop: doing so would put
// a durable write inside a retried callback. It keeps the read and takes the
// deadline with it, sharing the classifier.
//
// Before this item, EVERY way that body could fail — a stalled download, a dead
// socket, genuine schema garbage — returned `odds-invalid-payload`, a claim
// about the shape of a payload the code had never finished receiving.
//
// The real fetch is forwarded to a loopback server so the abort signal is
// actually wired to the body stream: a hand-built `Response` would ignore the
// abort and the deadline could not be observed at all.
// ---------------------------------------------------------------------------

const NATIVE_SET_TIMEOUT = globalThis.setTimeout;
const ORIGINAL_FETCH = globalThis.fetch;
const YEAR = 2026;
const KEY = defaultOddsCacheKey(YEAR);
const SCOPE = oddsTargetScope(YEAR, 'canonical', KEY);

type BodyMode = 'ok' | 'slow-body' | 'socket-death' | 'malformed' | 'slow-headers';
let server: Server;
let baseUrl = '';
let mode: BodyMode = 'ok';

test.before(async () => {
  server = createServer((_req, res) => {
    if (mode === 'slow-headers') {
      // Headers deliberately late so the body phase's REMAINING budget is
      // measurably smaller than the full one.
      NATIVE_SET_TIMEOUT(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
      }, 60);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (mode === 'ok') return void res.end('[]');
    if (mode === 'malformed') return void res.end('not json at all');
    res.write('[');
    // Native timers: the test body runs under compressed timers, and the SERVER
    // must keep real-time behaviour or the delay would shrink with the deadline.
    if (mode === 'slow-body') NATIVE_SET_TIMEOUT(() => res.end(']'), 3_000);
    else NATIVE_SET_TIMEOUT(() => res.socket?.destroy(), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(() => {
  server.close();
});

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  // Forward to the loopback server, PRESERVING `init` — that is what carries the
  // combined abort signal through to the real body stream.
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    ORIGINAL_FETCH(baseUrl, init)) as typeof fetch;
});

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

async function runRefresh(): Promise<{ status: string; reason: string }> {
  const attempt = await beginProviderRefreshAttempt('odds', SCOPE, {
    startedAt: new Date().toISOString(),
  });
  const execution = await executeOddsRefresh({
    mode: 'automatic',
    season: YEAR,
    seasonScopedKey: KEY,
    isCanonical: true,
    scope: SCOPE,
    attempt,
    apiKey: 'test-key',
    query: { bookmakers: ['draftkings'], markets: ['spreads'], regions: ['us'] },
    observationAt: new Date().toISOString(),
    now: new Date().toISOString(),
    retry: {
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
      retryOnHttpStatuses: [],
    },
    emptyClassificationEvidence: { scheduleItems: [], resolver: null } as never,
    resolveCanonicalInputs: async () => ({ available: true, games: [], resolver: null as never }),
  });
  return { status: execution.result.status, reason: execution.result.reason };
}

test('#662: a body that outlives the deadline is `provider-fetch-failed`, not a payload rejection', async () => {
  mode = 'slow-body';
  // The 12s executor deadline compresses to 240ms; the server holds the body for
  // a real 3s. Against `main` this RESOLVES (the body completes, unbounded) and
  // the empty array reads as a benign no-op — the defect, at the odds surface.
  const result = await withCompressedTimeouts(async () => runRefresh());

  assert.equal(result.status, 'failure');
  assert.equal(
    result.reason,
    'provider-fetch-failed',
    'a body that never finished tells us NOTHING about the payload shape'
  );
});

test('#662: a body whose socket dies mid-download is `provider-fetch-failed`', async () => {
  mode = 'socket-death';
  const result = await runRefresh();

  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'provider-fetch-failed');
});

test('#662 CONTROL: a complete body that is not JSON is STILL `odds-invalid-payload`', async () => {
  mode = 'malformed';
  const result = await runRefresh();

  assert.equal(result.status, 'failure');
  assert.equal(
    result.reason,
    'odds-invalid-payload',
    'bytes that ARRIVED and were not JSON remain a payload rejection'
  );
});

test('#662 CONTROL: a complete, valid body is unaffected by the deadline', async () => {
  mode = 'ok';
  const result = await withCompressedTimeouts(async () => runRefresh());

  // An empty array is not a fetch failure — whatever the executor decides to do
  // with an empty slate, it must not be one of the two body-failure reasons.
  assert.notEqual(result.reason, 'provider-fetch-failed');
  assert.notEqual(result.reason, 'odds-invalid-payload');
});

test('#662: the odds body deadline is armed at the HEADERS on the REMAINING budget', async () => {
  // Review remediation, pinned deterministically rather than by racing a clock.
  //
  // Two regressions must be caught: arming the body deadline only where the body
  // is READ (leaving the durable usage write in an unbounded window), and
  // granting the body a FRESH full budget (making the lane's real ceiling
  // `timeoutMs` twice over, plus the write).
  //
  // Both show up in the DELAY the executor arms with. The request timer is armed
  // at exactly ODDS_UPSTREAM_TIMEOUT_MS; a correct body deadline is armed at that
  // budget MINUS however long the headers took, so it is strictly smaller. A
  // fresh-budget regression arms two timers of exactly 12000 and no smaller one.
  // The timer never has to fire, so there is nothing to flake.
  mode = 'slow-headers';
  const nativeSetTimeout = globalThis.setTimeout;
  const armedDelays: number[] = [];
  globalThis.setTimeout = ((handler: never, delay?: number, ...args: never[]) => {
    if (typeof delay === 'number') armedDelays.push(delay);
    return nativeSetTimeout(handler, delay as number, ...args);
  }) as typeof globalThis.setTimeout;

  try {
    await runRefresh();
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }

  const FULL_BUDGET_MS = 12_000;
  assert.ok(
    armedDelays.includes(FULL_BUDGET_MS),
    `the request timer should arm at the full budget; saw ${JSON.stringify(armedDelays)}`
  );
  const bodyDeadlines = armedDelays.filter((d) => d < FULL_BUDGET_MS && d > FULL_BUDGET_MS - 1_000);
  assert.ok(
    bodyDeadlines.length >= 1,
    'the body deadline must be armed on the REMAINING budget (strictly less than the full one), ' +
      `which also proves it was armed at the headers rather than at the read; saw ${JSON.stringify(armedDelays)}`
  );
});
