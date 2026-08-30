/**
 * Compress wall-clock timers while preserving production timeout ratios.
 * Production milliseconds are divided by 50, leaving a 300ms real-time margin
 * on the 25s success case and a 200ms margin on the 50s timeout case.
 */
const TIME_COMPRESSION_FACTOR = 50;

function compressedDelayMs(productionDelayMs: number): number {
  return productionDelayMs / TIME_COMPRESSION_FACTOR;
}

export async function withCompressedTimeouts<T>(
  action: (nativeSetTimeout: typeof globalThis.setTimeout) => Promise<T>
): Promise<T> {
  const nativeSetTimeout = globalThis.setTimeout;
  const compressedSetTimeout = ((
    handler: Parameters<typeof globalThis.setTimeout>[0],
    delay?: number,
    ...args: unknown[]
  ) => {
    const compressedDelay = typeof delay === 'number' ? compressedDelayMs(delay) : delay;
    return Reflect.apply(nativeSetTimeout, globalThis, [handler, compressedDelay, ...args]);
  }) as typeof globalThis.setTimeout;

  globalThis.setTimeout = compressedSetTimeout;
  try {
    return await action(nativeSetTimeout);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
}

/** Resolve a JSON response after a real test delay, rejecting when fetch aborts. */
export function delayedJsonResponse(args: {
  payload: unknown;
  delayMs: number;
  init?: RequestInit;
  nativeSetTimeout: typeof globalThis.setTimeout;
}): Promise<Response> {
  const { payload, delayMs, init, nativeSetTimeout } = args;

  return new Promise<Response>((resolve, reject) => {
    const signal = init?.signal;
    let settled = false;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== null) globalThis.clearTimeout(timeoutHandle);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutHandle = nativeSetTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }, delayMs);
  });
}

/**
 * Stub CFBD with an unbilled `/info` probe and one delayed payload for every
 * billed endpoint. Tests inspect every non-info URL after the route returns, so
 * an unexpected extra provider request cannot disappear into route-level
 * transport error handling.
 */
export function installDelayedCfbdProvider(args: {
  payload: unknown;
  providerDelayMs: number;
  nativeSetTimeout: typeof globalThis.setTimeout;
}) {
  const billedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    if (url.pathname === '/info') {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4_000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    billedUrls.push(url.toString());
    return delayedJsonResponse({
      payload: args.payload,
      delayMs: compressedDelayMs(args.providerDelayMs),
      init,
      nativeSetTimeout: args.nativeSetTimeout,
    });
  }) as typeof fetch;

  return {
    billedUrls: () => [...billedUrls],
    billedPaths: () => billedUrls.map((url) => new URL(url).pathname),
  };
}
