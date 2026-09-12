import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test, { after, before } from 'node:test';

import { fetchUpstreamJson, UpstreamFetchError } from '../fetchUpstream.ts';

/**
 * PLATFORM-662 — the deadline must span BODY consumption, and the three ways a
 * body can fail must stay three distinct kinds.
 *
 * ## Why a real loopback server and not a mocked `fetch`
 *
 * The defect and its fix both live in how `undici` ends a body stream, and the
 * three failure modes are only distinguishable by what that stream actually
 * throws — measured, not assumed:
 *
 *   - bytes arrived, not JSON            -> `SyntaxError`          -> `parse`
 *   - socket destroyed mid-download      -> `TypeError: terminated`-> `network`
 *   - deadline aborted the body          -> `DOMException`/Abort   -> `timeout`
 *
 * A `Response` built over a hand-rolled `ReadableStream` can imitate the first
 * and third but NOT the second: `controller.error()` raises whatever object the
 * test passed, so a suite built on it would assert `network` against an error
 * shape production never produces, and would keep passing if the real one
 * stopped mapping. The server below destroys a real socket mid-body, so the
 * classifier is exercised on the bytes-and-sockets path the provider uses.
 *
 * Ports are ephemeral (`listen(0)`) and every response completes or dies within
 * ~30ms, well inside the runner's 30s per-process budget.
 */

type BodyMode =
  | 'ok' // complete, valid JSON
  | 'slow-body' // headers immediately, body finishes ~1s later
  | 'socket-death' // headers, partial body, socket destroyed
  | 'clean-truncation' // headers, partial body, stream closed cleanly
  | 'malformed'; // complete body that is not JSON

let server: Server;
let baseUrl = '';

before(async () => {
  server = createServer((req, res) => {
    const mode = (new URL(req.url ?? '/', 'http://localhost').searchParams.get('mode') ??
      'ok') as BodyMode;
    res.writeHead(200, { 'content-type': 'application/json' });

    if (mode === 'ok') return void res.end('{"ok":true}');
    if (mode === 'malformed') return void res.end('this is definitely not json');

    // Every remaining mode sends headers and a PARTIAL body, then diverges —
    // which is the shape the whole item is about: the headers already arrived,
    // so the old timer had already been cleared.
    res.write('{"ok":');
    if (mode === 'slow-body') setTimeout(() => res.end('true}'), 1_000);
    else if (mode === 'socket-death') setTimeout(() => res.socket?.destroy(), 20);
    else setTimeout(() => res.end(), 20); // clean-truncation
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server must bind an ephemeral port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

/** Run one request, reporting the kind and how many provider calls it billed. */
async function attempt(
  mode: BodyMode,
  options: { timeoutMs: number; maxAttempts?: number }
): Promise<{ kind: string | null; attempts: number; elapsedMs: number; value?: unknown }> {
  const nativeFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    attempts += 1;
    return nativeFetch(input, init);
  }) as typeof fetch;

  const startedAt = Date.now();
  try {
    const value = await fetchUpstreamJson<unknown>(`${baseUrl}/?mode=${mode}`, {
      timeoutMs: options.timeoutMs,
      retry: { maxAttempts: options.maxAttempts ?? 1, baseDelayMs: 1, jitterRatio: 0 },
    });
    return { kind: null, attempts, elapsedMs: Date.now() - startedAt, value };
  } catch (error) {
    assert.ok(error instanceof UpstreamFetchError, `expected UpstreamFetchError, got ${error}`);
    return { kind: error.details.kind, attempts, elapsedMs: Date.now() - startedAt };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

test('#662 REGRESSION: a body slower than timeoutMs aborts instead of downloading forever', async () => {
  // Against `main` this RESOLVES with {"ok":true} after ~1000ms, because the
  // per-attempt timer was cleared when the headers arrived. That is the defect:
  // the assertion below fails on `kind` (null, not 'timeout'), not on timing.
  const result = await attempt('slow-body', { timeoutMs: 50 });

  assert.equal(result.kind, 'timeout', 'a body that outlives the deadline must abort as `timeout`');
  assert.equal(result.value, undefined, 'the slow body must NOT be delivered');
  assert.ok(
    result.elapsedMs < 500,
    `must abort near the 50ms deadline, not ride the ~1000ms body (took ${result.elapsedMs}ms)`
  );
});

test('#662: a body whose transport dies mid-download is `network`, not `parse`', async () => {
  const result = await attempt('socket-death', { timeoutMs: 5_000 });
  assert.equal(result.kind, 'network');
});

test('#662: a complete body that is not JSON is STILL `parse`', async () => {
  // The signal this item exists to preserve. A fix that reclassifies everything
  // as `timeout` passes the two tests above and destroys this one.
  const result = await attempt('malformed', { timeoutMs: 5_000 });
  assert.equal(result.kind, 'parse');
});

test('#662: a truncated body whose stream closes cleanly is `parse` (the provider sent that)', async () => {
  // The discriminant is whether the TRANSPORT reported a failure, not whether
  // the JSON happens to be short. A clean close means these really are all the
  // bytes the provider sent, so the payload — not the network — is the fault.
  const result = await attempt('clean-truncation', { timeoutMs: 5_000 });
  assert.equal(result.kind, 'parse');
});

test('#662: a complete, valid body still resolves (the deadline does not fire on success)', async () => {
  const result = await attempt('ok', { timeoutMs: 5_000 });
  assert.equal(result.kind, null);
  assert.deepEqual(result.value, { ok: true });
});

test('#662 RULING: a `parse` body failure is NOT retried, while `timeout` and `network` are', async () => {
  // The item deliberately adds NO retry branch for body failures: once the kind
  // is honest, `isRetryableError` already decides correctly. This is the test
  // that proves the decision was taken rather than falling out of where the
  // `await` landed — and it is what would catch a future "fix" that classifies
  // a schema problem as transport and starts spending provider quota to
  // re-request an unparseable payload.
  const parse = await attempt('malformed', { timeoutMs: 5_000, maxAttempts: 3 });
  assert.equal(parse.kind, 'parse');
  assert.equal(parse.attempts, 1, 'malformed JSON must bill exactly ONE provider call');

  const timeout = await attempt('slow-body', { timeoutMs: 50, maxAttempts: 3 });
  assert.equal(timeout.kind, 'timeout');
  assert.equal(timeout.attempts, 3, 'a body timeout must consume the retry budget');

  const network = await attempt('socket-death', { timeoutMs: 5_000, maxAttempts: 3 });
  assert.equal(network.kind, 'network');
  assert.equal(network.attempts, 3, 'a mid-download transport death must consume the retry budget');
});

test('#662: a body-failure message never embeds the unsanitized URL', async () => {
  // A JSON parse error's own message quotes the offending body, and a transport
  // error can embed the requested URL — either would carry a credential query
  // parameter into a log or a durable record. Every body path must use the
  // FIXED message and the sanitized URL (PLATFORM-086C2).
  const marker = 'ODDS-KEY-SECRET-MARKER';
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    nativeFetch(`${baseUrl}/?mode=malformed`, init)) as typeof fetch;

  try {
    await fetchUpstreamJson(`${baseUrl}/?mode=malformed&apiKey=${marker}`, {
      timeoutMs: 5_000,
      retry: { maxAttempts: 1 },
    });
    assert.fail('expected a parse failure');
  } catch (error) {
    assert.ok(error instanceof UpstreamFetchError);
    assert.equal(error.details.kind, 'parse');
    assert.ok(!error.details.url.includes(marker), 'url must be sanitized');
    assert.ok(!error.details.message.includes(marker), 'message must not embed the URL');
    assert.match(error.details.url, /apiKey=REDACTED/);
    // The fixed message — never the parser's own, which quotes the body.
    assert.equal(error.details.message, 'Upstream response was not valid JSON');
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('#662: the headers-only path leaves no armed timer behind', async () => {
  // `fetchUpstreamResponse` still clears its timer when it returns the headers —
  // its contract is unchanged. A leak here would keep the process alive past the
  // test, so the assertion is that nothing is pending once the read completes.
  const { fetchUpstreamResponse } = await import('../fetchUpstream.ts');
  const res = await fetchUpstreamResponse(`${baseUrl}/?mode=ok`, {
    timeoutMs: 5_000,
    retry: { maxAttempts: 1 },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  // If the attempt timer were still armed, an unref'd handle would remain; the
  // runner's 30s process timeout is the backstop, this is the direct check.
  const pending = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles;
  if (typeof pending === 'function') {
    const timers = pending
      .call(process)
      .filter((h) => h?.constructor?.name === 'Timeout') as unknown[];
    assert.equal(timers.length, 0, 'no attempt timer may outlive the response');
  }
});
