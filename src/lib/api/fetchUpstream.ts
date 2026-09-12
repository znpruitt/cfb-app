export type UpstreamErrorKind = 'timeout' | 'aborted' | 'network' | 'http' | 'parse';

export interface UpstreamError {
  kind: UpstreamErrorKind;
  message: string;
  status?: number;
  statusText?: string;
  url: string;
  responseBody?: string;
}

export class UpstreamFetchError extends Error {
  readonly details: UpstreamError;

  constructor(details: UpstreamError) {
    super(details.message);
    this.name = 'UpstreamFetchError';
    this.details = details;
  }
}

/**
 * Case-insensitive query-parameter names that carry a credential and must NEVER
 * appear in a diagnostic/error/log representation of an upstream URL (e.g. The
 * Odds API sends its key as `?apiKey=...`). PLATFORM-086C2 security prerequisite.
 */
const CREDENTIAL_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'apikey',
  'key',
  'token',
  'access_token',
  'authorization',
]);

/**
 * Redact credential query parameters from an upstream URL for SAFE diagnostic
 * use — errors, logs, and returned error details. The REAL request URL is never
 * passed through this: only its diagnostic representation is. Origin/path and
 * non-credential parameters are preserved; a value that cannot be parsed as an
 * absolute URL is reduced to everything before its query string (or a fixed
 * placeholder) rather than risk leaking a credential-bearing string verbatim.
 */
export function sanitizeUpstreamUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    let mutated = false;
    for (const name of [...url.searchParams.keys()]) {
      if (CREDENTIAL_QUERY_PARAMS.has(name.toLowerCase())) {
        url.searchParams.set(name, 'REDACTED');
        mutated = true;
      }
    }
    // Avoid re-encoding when nothing was redacted (keeps the URL byte-identical
    // for the common no-credential case, e.g. CFBD `?year=&week=`).
    return mutated ? url.toString() : rawUrl;
  } catch {
    const queryIndex = rawUrl.indexOf('?');
    return queryIndex >= 0 ? `${rawUrl.slice(0, queryIndex)}?REDACTED` : rawUrl;
  }
}

export type UpstreamRetryPolicy = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryOnHttpStatuses?: readonly number[];
};

export type UpstreamPacingPolicy = {
  key: string;
  minIntervalMs: number;
};

export interface FetchUpstreamJsonOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: UpstreamRetryPolicy;
  pacing?: UpstreamPacingPolicy;
}

export interface FetchUpstreamResponseOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: UpstreamRetryPolicy;
  pacing?: UpstreamPacingPolicy;
  throwOnHttpError?: boolean;
}

const IS_UPSTREAM_DEBUG =
  process.env.NEXT_PUBLIC_DEBUG === '1' ||
  process.env.DEBUG_CFBD === '1' ||
  process.env.DEBUG_UPSTREAM === '1';

const DEFAULT_RETRY_HTTP_STATUSES = [408, 425, 429, 500, 502, 503, 504];
const paceNextAllowedAtByKey = new Map<string, number>();
const paceTailByKey = new Map<string, Promise<void>>();

type UpstreamPacingClock = {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function toHeaderObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};

  const out: Record<string, string> = {};
  const source = new Headers(headers);
  for (const [key, value] of source.entries()) {
    out[key] = key.toLowerCase() === 'authorization' ? 'Bearer ***' : value;
  }
  return out;
}

function combineSignals(timeoutSignal: AbortSignal, requestSignal?: AbortSignal): AbortSignal {
  if (!requestSignal) {
    return timeoutSignal;
  }

  if (requestSignal.aborted) {
    return requestSignal;
  }

  const controller = new AbortController();

  const onAbort = () => {
    controller.abort();
    timeoutSignal.removeEventListener('abort', onAbort);
    requestSignal.removeEventListener('abort', onAbort);
  };

  timeoutSignal.addEventListener('abort', onAbort);
  requestSignal.addEventListener('abort', onAbort);

  return controller.signal;
}

function toMessage(status: number, statusText?: string): string {
  return statusText
    ? `Upstream request failed with status ${status} (${statusText})`
    : `Upstream request failed with status ${status}`;
}

function resolveRetryPolicy(policy?: UpstreamRetryPolicy): Required<UpstreamRetryPolicy> {
  return {
    maxAttempts: Math.max(1, policy?.maxAttempts ?? 1),
    baseDelayMs: Math.max(0, policy?.baseDelayMs ?? 250),
    maxDelayMs: Math.max(0, policy?.maxDelayMs ?? 2_000),
    jitterRatio: Math.min(Math.max(policy?.jitterRatio ?? 0.2, 0), 1),
    retryOnHttpStatuses: policy?.retryOnHttpStatuses ?? DEFAULT_RETRY_HTTP_STATUSES,
  };
}

function isRetryableError(
  error: UpstreamFetchError,
  retryOnHttpStatuses: readonly number[]
): boolean {
  if (error.details.kind === 'timeout' || error.details.kind === 'network') return true;
  if (error.details.kind === 'http' && typeof error.details.status === 'number') {
    return retryOnHttpStatuses.includes(error.details.status);
  }
  return false;
}

function computeBackoffMs(
  attempt: number,
  policy: Required<UpstreamRetryPolicy>
): { waitMs: number; baseMs: number } {
  const multiplier = 2 ** Math.max(0, attempt - 1);
  const baseMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * multiplier);
  const jitterSpan = Math.round(baseMs * policy.jitterRatio);
  const jitter = jitterSpan > 0 ? Math.floor(Math.random() * (jitterSpan * 2 + 1)) - jitterSpan : 0;
  return { waitMs: Math.max(0, baseMs + jitter), baseMs };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  await new Promise<void>((resolve, reject) => {
    const handle = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(handle);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    signal?.addEventListener('abort', onAbort);
  });
}

const systemPacingClock: UpstreamPacingClock = {
  now: () => Date.now(),
  sleep,
};

function isUpstreamPacingDisabledForTestProcess(): boolean {
  // Fail closed: the explicit opt-out is honored only inside a Node test child.
  // `NODE_TEST_CONTEXT=child-v8` is supplied by `node --test` itself on the
  // pinned runtime; the shared runner supplies only UPSTREAM_PACING_DISABLED.
  // If either signal is absent or changes, production pacing remains enabled.
  return (
    process.env.UPSTREAM_PACING_DISABLED === '1' && process.env.NODE_TEST_CONTEXT === 'child-v8'
  );
}

async function applyPacing(
  policy: UpstreamPacingPolicy | undefined,
  signal?: AbortSignal,
  clock: UpstreamPacingClock = systemPacingClock
): Promise<void> {
  if (!policy || policy.minIntervalMs <= 0 || isUpstreamPacingDisabledForTestProcess()) return;

  const previous = paceTailByKey.get(policy.key) ?? Promise.resolve();

  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const nextAllowedAt = paceNextAllowedAtByKey.get(policy.key) ?? 0;
      const waitMs = Math.max(0, nextAllowedAt - clock.now());
      if (waitMs > 0) {
        await clock.sleep(waitMs, signal);
      }

      paceNextAllowedAtByKey.set(policy.key, clock.now() + policy.minIntervalMs);
    });

  // Keep the raw tail so the next reservation's catch is what releases the
  // chain after a rejected pacing wait. Callers still observe their own error.
  paceTailByKey.set(policy.key, run);

  await run;
}

function toUpstreamFetchError(params: {
  error: unknown;
  url: string;
  timeoutController: AbortController;
  requestSignal?: AbortSignal;
  timeoutMs: number;
}): UpstreamFetchError {
  const { error, url, timeoutController, requestSignal, timeoutMs } = params;
  if (error instanceof UpstreamFetchError) {
    return error;
  }

  if (timeoutController.signal.aborted) {
    return new UpstreamFetchError({
      kind: 'timeout',
      message: `Upstream request timed out after ${timeoutMs}ms`,
      url,
    });
  }

  if (requestSignal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new UpstreamFetchError({
      kind: 'aborted',
      message: 'Upstream request was aborted',
      url,
    });
  }

  // A FIXED message — never the raw `error.message`, which (in some environments)
  // can embed the requested URL and therefore a credential query parameter
  // (PLATFORM-086C2 security remediation). The `url` here is already sanitized.
  return new UpstreamFetchError({
    kind: 'network',
    message: 'Upstream network error',
    url,
  });
}

/** What a body consumer needs to classify its own failure (PLATFORM-662). */
type UpstreamAttemptContext = {
  url: string;
  timeoutController: AbortController;
  requestSignal?: AbortSignal;
  timeoutMs: number;
};

/**
 * Classify a failure raised while CONSUMING a response body (PLATFORM-662).
 *
 * The discriminant is measured, not assumed: a body whose bytes arrived and did
 * not parse throws `SyntaxError` (both "not JSON at all" and a short body whose
 * stream closed cleanly — "Unexpected end of JSON input"). A body whose
 * TRANSPORT died mid-download throws something else entirely — `TypeError:
 * terminated` (cause `SocketError`) from a destroyed socket, a `DOMException`
 * named `AbortError` when a deadline fires. So `SyntaxError` is the only case
 * that is genuinely a payload problem, and everything else is handed to
 * {@link toUpstreamFetchError}, which resolves it against the live signals:
 * our own deadline → `timeout`, a caller's signal → `aborted`, otherwise
 * `network`.
 *
 * This is what keeps `parse` meaningful. Before this item every body failure —
 * abort, socket reset, truncation, genuine schema garbage — was reported as
 * `parse` with the message "Upstream response was not valid JSON", so a consumer
 * could not tell a dead network from a changed provider schema.
 */
function toBodyFailureError(
  params: UpstreamAttemptContext & { error: unknown }
): UpstreamFetchError {
  if (params.error instanceof UpstreamFetchError) return params.error;
  if (params.error instanceof SyntaxError) {
    return new UpstreamFetchError({
      kind: 'parse',
      // A FIXED message — never the raw `error.message`. A JSON parse error
      // embeds a fragment of the response body verbatim, which on a credentialed
      // provider is exactly the kind of content that must not reach a log or a
      // durable record (PLATFORM-086C2). The `url` here is already sanitized.
      message: 'Upstream response was not valid JSON',
      url: params.url,
    });
  }
  return toUpstreamFetchError(params);
}

/**
 * Read a JSON body under a deadline the caller arms itself, classifying failures
 * exactly as the shared attempt loop does (PLATFORM-662).
 *
 * For callers that must observe the RESPONSE between the headers arriving and
 * the body being read — `oddsRefreshExecutor` persists a usage snapshot there,
 * deliberately, because the request spent credits whether or not the body ever
 * parses. Such a caller cannot hand body consumption to the retry loop without
 * moving that durable write inside a retried callback, so it keeps the read and
 * takes the deadline with it. The CLASSIFIER is shared; only the arming site
 * differs.
 *
 * `abortController` must be the controller whose signal was passed to the
 * request as `signal` — aborting it is what errors the body stream. A timer that
 * merely rejects a race would leave the download running.
 */
export async function readUpstreamJsonWithDeadline<T>(params: {
  response: Response;
  url: string;
  timeoutMs: number;
  abortController: AbortController;
  requestSignal?: AbortSignal;
}): Promise<T> {
  const { response, url, timeoutMs, abortController, requestSignal } = params;
  const safeUrl = sanitizeUpstreamUrl(url);
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw toBodyFailureError({
      error,
      url: safeUrl,
      timeoutController: abortController,
      requestSignal,
      timeoutMs,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * The shared attempt loop. `consume` runs INSIDE the try, the retry loop and the
 * per-attempt deadline, so whatever it does to the response is covered by the
 * same timeout and the same retry decision as the request that produced it.
 */
async function runUpstreamAttempts<T>(
  url: string,
  options: FetchUpstreamResponseOptions,
  consume: (res: Response, ctx: UpstreamAttemptContext) => Promise<T>
): Promise<T> {
  const {
    timeoutMs = 10_000,
    signal: requestSignal,
    retry,
    pacing,
    throwOnHttpError = true,
    ...init
  } = options;
  const retryPolicy = resolveRetryPolicy(retry);
  // The credential-safe URL used in EVERY diagnostic (logs, errors, returned
  // details). The real `url` is used only for `fetch` below.
  const safeUrl = sanitizeUpstreamUrl(url);

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
    const attemptContext: UpstreamAttemptContext = {
      url: safeUrl,
      timeoutController,
      requestSignal,
      timeoutMs,
    };

    try {
      const signal = combineSignals(timeoutController.signal, requestSignal);
      await applyPacing(pacing, signal);

      if (IS_UPSTREAM_DEBUG) {
        console.log('upstream request', {
          url: safeUrl,
          method: init.method ?? 'GET',
          headers: toHeaderObject(init.headers),
          timeoutMs,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          pacing: pacing ?? null,
        });
      }

      const res = await fetch(url, { ...init, signal });

      if (IS_UPSTREAM_DEBUG) {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of res.headers.entries()) {
          responseHeaders[key] = value;
        }
        console.log('upstream response', {
          url: safeUrl,
          status: res.status,
          statusText: res.statusText,
          headers: responseHeaders,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
        });
      }

      if (!res.ok) {
        const retryableHttp = retryPolicy.retryOnHttpStatuses.includes(res.status);
        if (attempt < retryPolicy.maxAttempts && retryableHttp) {
          const { waitMs, baseMs } = computeBackoffMs(attempt, retryPolicy);
          if (IS_UPSTREAM_DEBUG) {
            console.log('upstream retry scheduled', {
              url: safeUrl,
              attempt,
              nextAttempt: attempt + 1,
              reason: `http_${res.status}`,
              backoffBaseMs: baseMs,
              backoffWaitMs: waitMs,
            });
          }
          await sleep(waitMs, requestSignal);
          continue;
        }

        if (!throwOnHttpError) {
          return await consume(res, attemptContext);
        }

        const responseBody = await res.text().catch(() => '');
        throw new UpstreamFetchError({
          kind: 'http',
          message: toMessage(res.status, res.statusText),
          status: res.status,
          statusText: res.statusText,
          url: safeUrl,
          responseBody,
        });
      }

      return await consume(res, attemptContext);
    } catch (error) {
      const normalized = toUpstreamFetchError({
        error,
        url: safeUrl,
        timeoutController,
        requestSignal,
        timeoutMs,
      });

      if (
        attempt < retryPolicy.maxAttempts &&
        isRetryableError(normalized, retryPolicy.retryOnHttpStatuses)
      ) {
        const { waitMs, baseMs } = computeBackoffMs(attempt, retryPolicy);
        if (IS_UPSTREAM_DEBUG) {
          console.log('upstream retry scheduled', {
            url: safeUrl,
            attempt,
            nextAttempt: attempt + 1,
            reason: normalized.details.kind,
            status: normalized.details.status ?? null,
            backoffBaseMs: baseMs,
            backoffWaitMs: waitMs,
          });
        }
        await sleep(waitMs, requestSignal);
        continue;
      }

      throw normalized;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new UpstreamFetchError({
    kind: 'network',
    message: 'Upstream retry loop exhausted unexpectedly',
    url: safeUrl,
  });
}

/**
 * Headers-only fetch. CONTRACT UNCHANGED by PLATFORM-662: the per-attempt
 * deadline still ends when this returns, because the caller — not this function
 * — decides when and whether to read the body. A caller that does read one must
 * bound it: {@link readUpstreamJsonWithDeadline}, or `fetchUpstreamJson`, which
 * reads inside the loop.
 */
export async function fetchUpstreamResponse(
  url: string,
  options: FetchUpstreamResponseOptions = {}
): Promise<Response> {
  return runUpstreamAttempts(url, options, async (res) => res);
}

/**
 * Fetch and parse a JSON body under ONE deadline spanning both phases.
 *
 * PLATFORM-662: the body is consumed inside the attempt loop, so a body that
 * outlives `timeoutMs` aborts instead of downloading forever, and its failure
 * reaches the SAME retry decision as a header-phase failure. No retry rule is
 * written here on purpose — `isRetryableError` already returns the right answer
 * once the kind is honest: a body abort is `timeout` and a mid-download
 * transport death is `network`, both retryable; malformed JSON is `parse`, which
 * is NOT retried, because re-requesting a schema problem spends provider quota
 * to fail identically. If a body failure ever needs a retry branch of its own,
 * the classification above it is wrong.
 *
 * `throwOnHttpError` is forced: a non-OK response must raise `http` with its
 * status, never be handed to the JSON parser as though it were a payload.
 */
export async function fetchUpstreamJson<T>(
  url: string,
  options: FetchUpstreamJsonOptions = {}
): Promise<T> {
  return runUpstreamAttempts<T>(url, { ...options, throwOnHttpError: true }, async (res, ctx) => {
    try {
      return (await res.json()) as T;
    } catch (error) {
      throw toBodyFailureError({ ...ctx, error });
    }
  });
}

/**
 * Test-only: clear the shared per-key pacing state. Suites that pin `Date.now`
 * with mocked timers (PLATFORM-086E2B publication-slot tests) would otherwise
 * leave a `nextAllowedAt` in another test's future when the mocked clock jumps
 * backward between tests, turning the 150 ms pacing wait into an effectively
 * unbounded sleep. Never called in production paths.
 */
export function __resetUpstreamPacingForTests(): void {
  paceNextAllowedAtByKey.clear();
  paceTailByKey.clear();
}

/** Test-only observation of the real process guard used by the shared runner. */
export function __isUpstreamPacingDisabledForTests(): boolean {
  return isUpstreamPacingDisabledForTestProcess();
}

/** Test-only injected-clock seam for deterministic pacing coverage. */
export function __applyUpstreamPacingForTests(
  policy: UpstreamPacingPolicy | undefined,
  clock: UpstreamPacingClock,
  signal?: AbortSignal
): Promise<void> {
  return applyPacing(policy, signal, clock);
}
