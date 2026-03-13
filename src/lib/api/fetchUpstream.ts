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

export interface FetchUpstreamJsonOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const IS_UPSTREAM_DEBUG =
  process.env.NEXT_PUBLIC_DEBUG === '1' ||
  process.env.DEBUG_CFBD === '1' ||
  process.env.DEBUG_UPSTREAM === '1';

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

export async function fetchUpstreamJson<T>(
  url: string,
  options: FetchUpstreamJsonOptions = {}
): Promise<T> {
  const { timeoutMs = 10_000, signal: requestSignal, ...init } = options;

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const signal = combineSignals(timeoutController.signal, requestSignal);
    if (IS_UPSTREAM_DEBUG) {
      console.log('upstream request', {
        url,
        method: init.method ?? 'GET',
        headers: toHeaderObject(init.headers),
        timeoutMs,
      });
    }

    const res = await fetch(url, { ...init, signal });

    if (IS_UPSTREAM_DEBUG) {
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of res.headers.entries()) {
        responseHeaders[key] = value;
      }
      console.log('upstream response', {
        url,
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      });
    }

    if (!res.ok) {
      const responseBody = await res.text().catch(() => '');
      throw new UpstreamFetchError({
        kind: 'http',
        message: toMessage(res.status, res.statusText),
        status: res.status,
        statusText: res.statusText,
        url,
        responseBody,
      });
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new UpstreamFetchError({
        kind: 'parse',
        message: 'Upstream response was not valid JSON',
        url,
      });
    }
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      throw error;
    }

    if (timeoutController.signal.aborted) {
      throw new UpstreamFetchError({
        kind: 'timeout',
        message: `Upstream request timed out after ${timeoutMs}ms`,
        url,
      });
    }

    if (requestSignal?.aborted) {
      throw new UpstreamFetchError({
        kind: 'aborted',
        message: 'Upstream request was aborted',
        url,
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown network error';
    throw new UpstreamFetchError({
      kind: 'network',
      message,
      url,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
