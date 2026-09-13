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

type BodyMode = 'ok' | 'slow-body' | 'socket-death' | 'malformed' | 'recover-on-2';

/** Requests served since the last reset — lets a test assert a RETRY happened. */
let servedCount = 0;
let server: Server;
let baseUrl = '';
let mode: BodyMode = 'ok';

test.before(async () => {
  server = createServer((_req, res) => {
    servedCount += 1;
    // Real provider usage headers: without them `usageHeadersTrustworthy` is false
    // on EVERY path, and an assertion about capture cannot discriminate.
    const usageHeaders = {
      'content-type': 'application/json',
      'x-requests-used': '17',
      'x-requests-remaining': '483',
      'x-requests-last': '1',
    };
    if (mode === 'recover-on-2') {
      // Attempt 1 never answers -> attempt deadline fires -> retried.
      if (servedCount === 1) return;
      res.writeHead(200, usageHeaders);
      return void res.end('[]');
    }
    res.writeHead(200, usageHeaders);
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

async function runRefresh(maxAttempts = 1): Promise<{
  status: string;
  reason: string;
  usageFromHeaders: boolean;
  usedRemaining: number | null;
}> {
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
      maxAttempts,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
      retryOnHttpStatuses: [],
    },
    emptyClassificationEvidence: { scheduleItems: [], resolver: null } as never,
    resolveCanonicalInputs: async () => ({ available: true, games: [], resolver: null as never }),
  });
  return {
    status: execution.result.status,
    reason: execution.result.reason,
    usageFromHeaders: execution.usageFromHeaders,
    usedRemaining: execution.usage?.remaining ?? null,
  };
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

test('#662 MULTI-ATTEMPT: a retried odds request delivers the RECOVERED attempt', async () => {
  // The HIGH this suite missed, now pinned here.
  //
  // The previous model computed the body budget from before the FIRST attempt,
  // but `timeoutMs` is per attempt and the retry loop is internal to
  // `fetchUpstreamResponse`. Once attempt 1 spent the budget, every later attempt
  // armed at `Math.max(0, negative)` -> fires on the next macrotask -> aborted a
  // complete, successful response during the usage write. Manual `/api/odds`
  // carries `maxAttempts: 3`, so retries could not recover from a header timeout:
  // two provider calls billed and the payload discarded.
  //
  // Invisible at `maxAttempts: 1`, which every test in this suite used. The fix
  // was to delete the second deadline and let the shared loop own both phases;
  // this test is what holds that, and it is the coverage the seam lacked.
  mode = 'recover-on-2';
  servedCount = 0;
  const result = await withCompressedTimeouts(async () => runRefresh(3));

  assert.notEqual(
    result.reason,
    'provider-fetch-failed',
    'the recovered attempt returned a complete body; it must not be reported as a fetch failure'
  );
  assert.ok(servedCount >= 2, 'attempt 1 must have timed out and been retried');
});

test('#662: usage is persisted from the headers even when the BODY fails', async () => {
  // The claim the whole third model rests on, tested rather than reasoned:
  // `captureOddsUsageSnapshot` takes Headers, so usage has no dependency on the
  // body and must still be recorded when the body dies mid-download.
  //
  // THE FIRST VERSION OF THIS TEST WAS VACUOUS and a mutation caught it: it
  // asserted `getLatestKnownOddsUsage() !== undefined`, which is true whether or
  // not THIS request recorded anything, and the server sent no usage headers at
  // all — so `usageHeadersTrustworthy` was false on every path and there was
  // nothing to discriminate. It stayed green with the header stash moved AFTER
  // the body read, which is the exact defect it exists to catch.
  mode = 'socket-death';
  const result = await runRefresh();

  assert.equal(result.reason, 'provider-fetch-failed', 'a dead transport is a fetch failure');
  assert.equal(
    result.usageFromHeaders,
    true,
    'the request was BILLED — its usage headers must be captured even though the body died'
  );
  assert.equal(result.usedRemaining, 483, "and the captured snapshot must be this response's");
});
