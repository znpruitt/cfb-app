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

async function applyPacing(
  policy: UpstreamPacingPolicy | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (!policy || policy.minIntervalMs <= 0) return;

  const previous = paceTailByKey.get(policy.key) ?? Promise.resolve();

  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const nextAllowedAt = paceNextAllowedAtByKey.get(policy.key) ?? 0;
      const waitMs = Math.max(0, nextAllowedAt - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs, signal);
      }

      paceNextAllowedAtByKey.set(policy.key, Date.now() + policy.minIntervalMs);
    });

  const settled = run.then(
    () => undefined,
    () => undefined
  );
  paceTailByKey.set(policy.key, settled);

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

export async function fetchUpstreamResponse(
  url: string,
  options: FetchUpstreamResponseOptions = {}
): Promise<Response> {
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
          return res;
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

      return res;
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

export async function fetchUpstreamJson<T>(
  url: string,
  options: FetchUpstreamJsonOptions = {}
): Promise<T> {
  const response = await fetchUpstreamResponse(url, options);

  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamFetchError({
      kind: 'parse',
      message: 'Upstream response was not valid JSON',
      url: sanitizeUpstreamUrl(url),
    });
  }
}
