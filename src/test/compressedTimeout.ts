/**
 * Compress wall-clock timers while preserving production timeout ratios.
 * Delayed test providers receive the original timer so a 25ms response behaves
 * like a 25s response against a production timeout compressed by 1,000x.
 */
export async function withCompressedTimeouts<T>(
  action: (nativeSetTimeout: typeof globalThis.setTimeout) => Promise<T>
): Promise<T> {
  const nativeSetTimeout = globalThis.setTimeout;
  const compressedSetTimeout = ((
    handler: Parameters<typeof globalThis.setTimeout>[0],
    delay?: number,
    ...args: unknown[]
  ) => {
    const compressedDelay = typeof delay === 'number' ? delay / 1_000 : delay;
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

    // Close the small race between the initial check and listener installation.
    if (signal?.aborted) onAbort();
  });
}
