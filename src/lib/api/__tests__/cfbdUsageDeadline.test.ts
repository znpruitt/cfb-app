import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach, beforeEach } from 'node:test';

import { CFBD_USAGE_PROBE_TIMEOUT_MS } from '../cfbdRequestPolicy.ts';
import {
  __fetchCfbdUsageWithTimeoutForTests,
  fetchCfbdUsage,
  type CfbdUsage,
} from '../cfbdUsage.ts';
import { UpstreamFetchError } from '../fetchUpstream.ts';

/**
 * PLATFORM-755 — the `/info` quota probe must be BOUNDED, and the two behaviours
 * its own file documents must survive being moved onto the shared helper.
 *
 * ## Why `fetch` is stubbed here and not driven by a loopback server
 *
 * The probe's URL is hardcoded to `https://api.collegefootballdata.com/info`, so
 * a loopback server can only be reached by redirecting the hostname through a
 * custom `undici` dispatcher and a self-signed certificate — machinery the suite
 * would have to generate at run time. The reproduction that justified this item
 * DID use exactly that (a real TLS server which completed the handshake, took
 * the request and never answered: **301.3s** before `undici`'s stock 300s
 * `headersTimeout` ended it, 301.1s on the default dispatcher), and that
 * measurement is recorded on the function's docblock.
 *
 * What is left for a suite to pin is narrower and is what these tests assert:
 * that `fetchCfbdUsage` is WIRED INTO the deadline at all. A stub that never
 * settles until its `signal` aborts is precisely what a hung server looks like
 * from the caller's side. **This goes red against `main`** — MEASURED, by
 * reverting this file's body to the raw unbounded `fetch` and running the suite:
 * `0 pass, 14 cancelled`, exit 1. Note the mechanism, because it is not the one
 * you would guess: with no signal the stub's promise never settles, the event
 * loop drains with it still pending, and `node:test` cancels the whole file
 * (`'Promise resolution is still pending but the event loop has already
 * resolved'`) rather than waiting out the runner's 30s process cap.
 *
 * Socket-level body/transport classification is NOT re-proven here — that is
 * `fetchUpstreamBodyDeadline.test.ts` (PLATFORM-662), against a real server.
 *
 * ## Coverage note on the 40s value
 *
 * `scripts/run-tests.mjs` caps a test process at 30s, so the production ceiling
 * cannot be waited out. The deadline MECHANISM is proven below at 250ms through
 * the `__…ForTests` seam, the value is pinned by assertion, and the delegation
 * between them is pinned at source — see the last test.
 */

const REAL_FETCH = globalThis.fetch;
const KEY = 'test-cfbd-key-must-never-appear-in-an-error';

type FetchInit = RequestInit & { next?: { revalidate?: number } };

/** Every init the probe handed to `fetch`, in order. */
let seenInits: FetchInit[] = [];

beforeEach(() => {
  seenInits = [];
  process.env.CFBD_API_KEY = KEY;
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.CFBD_API_KEY;
});

/** A server that accepts the request and never answers, until aborted. */
function stubHungFetch(): void {
  globalThis.fetch = ((_input: unknown, init?: FetchInit) => {
    seenInits.push(init ?? {});
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      );
    });
  }) as typeof fetch;
}

/** A server that answers 200 with `raw` as its literal body. */
function stubBody(raw: string): void {
  globalThis.fetch = ((_input: unknown, init?: FetchInit) => {
    seenInits.push(init ?? {});
    return Promise.resolve(
      new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } })
    );
  }) as typeof fetch;
}

const ALL_UNAVAILABLE: CfbdUsage = {
  patronLevel: null,
  used: null,
  remaining: null,
  limit: null,
};

// ---------------------------------------------------------------------------
// 1. The deadline. RED against `main`, which hangs here.
// ---------------------------------------------------------------------------

test('a server that never answers fails at the deadline instead of hanging', async () => {
  stubHungFetch();

  const startedAt = Date.now();
  const error = await __fetchCfbdUsageWithTimeoutForTests({ fresh: true }, 250).then(
    () => null,
    (e: unknown) => e
  );
  const elapsedMs = Date.now() - startedAt;

  assert.ok(
    error instanceof UpstreamFetchError,
    `expected UpstreamFetchError, got ${String(error)}`
  );
  assert.equal(error.details.kind, 'timeout');
  // The deadline actually ended it — not some other rejection that happened to
  // arrive. `undici`'s own backstop is 300s, so anything under a second here can
  // only be our timer.
  assert.ok(elapsedMs < 5_000, `expected the deadline to end it promptly, waited ${elapsedMs}ms`);
  // The message carries the deadline it was given, which is what makes the
  // production delegation differ from this call by the constant and nothing else.
  assert.match(error.message, /timed out after 250ms/);
});

test('the hung-server stub can succeed — the deadline test is not vacuous', async () => {
  // Positive control for the test above: the same probe, the same seam, a server
  // that DOES answer. If this could not pass, a green deadline test would prove
  // only that the stub is broken.
  stubBody(JSON.stringify({ patronLevel: 1, remainingCalls: 4_321 }));

  const usage = await __fetchCfbdUsageWithTimeoutForTests({ fresh: true }, 250);
  assert.equal(usage.remaining, 4_321);
  assert.equal(usage.patronLevel, 1);
});

test('a timed-out probe leaks neither the API key nor a Bearer token', async () => {
  stubHungFetch();

  const error = await __fetchCfbdUsageWithTimeoutForTests({ fresh: true }, 100).then(
    () => null,
    (e: unknown) => e
  );

  assert.ok(error instanceof UpstreamFetchError);
  const serialized = `${error.message} ${error.details.url} ${JSON.stringify(error.details)}`;
  assert.ok(!serialized.includes(KEY), 'the API key must never reach an error');
  assert.ok(!serialized.includes('Bearer'), 'no Authorization material may reach an error');
});

// ---------------------------------------------------------------------------
// 2. Surviving behaviour A: the `fresh` / cached split.
// ---------------------------------------------------------------------------

test('fresh: true bypasses the framework cache and sets no revalidate window', async () => {
  stubBody(JSON.stringify({ patronLevel: 1, remainingCalls: 10 }));

  await fetchCfbdUsage({ fresh: true });

  assert.equal(seenInits.length, 1);
  assert.equal(seenInits[0].cache, 'no-store');
  assert.equal(
    seenInits[0].next,
    undefined,
    'a quota gate must not carry a revalidate window — a cached remaining-count lets a burst of refreshes reuse one pre-spend snapshot'
  );
});

test('the cached (display) probe carries a 600s revalidate window and no no-store', async () => {
  stubBody(JSON.stringify({ patronLevel: 1, remainingCalls: 10 }));

  await fetchCfbdUsage();

  assert.equal(seenInits.length, 1);
  assert.deepEqual(seenInits[0].next, { revalidate: 600 });
  assert.equal(seenInits[0].cache, undefined, 'the display probe must stay cacheable');
});

// ---------------------------------------------------------------------------
// 3. Surviving behaviour B: a 200 with a non-object body is UNAVAILABLE, not a throw.
// ---------------------------------------------------------------------------

// MEASURED, so the block below is not read as stronger than it is: removing the
// guard entirely fails ONLY the `null` case, with
// `TypeError: Cannot read properties of null (reading 'patronLevel')`. The other
// four still resolve to all-unavailable unguarded, because `resolveCfbdUsage`
// reads two properties and property access on `[]`, a string, a number or a
// boolean yields `undefined` rather than throwing. `null` is what pins the
// guard; the rest pin the CONTRACT, and would fire if `resolveCfbdUsage` ever
// started rejecting non-objects instead of reporting them unavailable.
for (const raw of ['null', '[]', '"a string"', '42', 'true']) {
  test(`a 200 whose body is ${raw} resolves to all-unavailable rather than throwing`, async () => {
    stubBody(raw);

    const usage = await fetchCfbdUsage({ fresh: true });

    assert.deepEqual(usage, ALL_UNAVAILABLE);
  });
}

test('a 200 with an object body is still read normally', async () => {
  // Positive control for the block above: the guard must not swallow real
  // payloads on its way to refusing malformed ones.
  stubBody(JSON.stringify({ patronLevel: 1, remainingCalls: 4_900 }));

  const usage = await fetchCfbdUsage({ fresh: true });

  assert.equal(usage.remaining, 4_900);
  assert.equal(usage.limit, 5_000);
  assert.equal(usage.used, 100);
});

test('a 200 whose body is not JSON at all still THROWS — unavailable stays distinct', async () => {
  // The documented behaviour is about a PARSED non-object, not an unparseable
  // body. A body that cannot be parsed is a read failure and must keep throwing,
  // or "we looked and got nothing" would become indistinguishable from
  // "we could not look".
  stubBody('this is definitely not json');

  const error = await fetchCfbdUsage({ fresh: true }).then(
    () => null,
    (e: unknown) => e
  );

  assert.ok(
    error instanceof UpstreamFetchError,
    `expected UpstreamFetchError, got ${String(error)}`
  );
  assert.equal(error.details.kind, 'parse');
});

// ---------------------------------------------------------------------------
// 4. The value, and the delegation the seam cannot reach.
// ---------------------------------------------------------------------------

test('the probe ceiling is its own 40s value, not the payload ceiling by reference', () => {
  assert.equal(CFBD_USAGE_PROBE_TIMEOUT_MS, 40_000);

  // Their equality is deliberately NOT asserted. The two constants hold the same
  // number today for different reasons, and pinning that here would rebuild in
  // the suite exactly the coupling that was just removed from the source: a
  // payload-driven edit to the `/games` ceiling would turn this test red and
  // invite someone to "fix" it by moving the probe's ceiling too. The reviewers
  // split on this point; this follows the one that keeps them independent.
  //
  // What IS worth pinning is that the probe's value cannot move by reference.
  const src = readFileSync(new URL('../cfbdRequestPolicy.ts', import.meta.url), 'utf8');
  assert.match(src, /export const CFBD_USAGE_PROBE_TIMEOUT_MS = 40_000;/);
  assert.doesNotMatch(
    src,
    /export const CFBD_USAGE_PROBE_TIMEOUT_MS = CFBD_PEAK_LATENCY_TIMEOUT_MS;/,
    'the probe ceiling must not be an alias of the payload ceiling'
  );
});

test('fetchCfbdUsage delegates with CFBD_USAGE_PROBE_TIMEOUT_MS, not a literal', () => {
  // A SOURCE assertion, and labelled as one. The runner caps a process at 30s so
  // the 40s deadline cannot be observed by waiting; this is what closes the gap
  // between the seam (proven at 250ms above) and the production entry point.
  // Precedent: `manageRankingsSchedule.test.ts` pins a route's shape the same way.
  const src = readFileSync(new URL('../cfbdUsage.ts', import.meta.url), 'utf8');
  const delegation =
    /export async function fetchCfbdUsage\([^)]*\)[^{]*\{\s*return probeCfbdUsage\(options, CFBD_USAGE_PROBE_TIMEOUT_MS\);\s*\}/;
  assert.match(src, delegation, 'fetchCfbdUsage must pass the shared constant through unchanged');
});
