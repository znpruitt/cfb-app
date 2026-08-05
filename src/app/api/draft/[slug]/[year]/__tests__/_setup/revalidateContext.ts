// Test-only helper: run a route handler inside a minimal Next work-async-storage
// store so calls to `revalidateTag` (via `invalidateStandings`) succeed instead of
// throwing "Invariant: static generation store missing". Production supplies this
// store automatically; the bare node:test runner does not.
//
// `./installAsyncLocalStorage` MUST be imported before the Next storage module so
// the required global `AsyncLocalStorage` is installed first.
import './installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

/**
 * Execute `fn` within a stub work-async-storage store. `revalidateTag` only reads
 * `route`/`incrementalCache` and appends to `pendingRevalidatedTags`, so a minimal
 * shape is sufficient for tests that exercise mutation routes end to end.
 */
export function runWithRevalidateContext<T>(fn: () => Promise<T>): Promise<T> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  return workAsyncStorage.run(store as never, fn);
}

/**
 * As above, but ALSO returns the tags revalidated during `fn` — INCLUDING when
 * `fn` throws.
 *
 * The throwing path is the entire point. A test proving that a REFUSED mutation
 * invalidated nothing observes a rejecting call, so a helper that returns only
 * on the resolving path hands back the empty array the caller created and the
 * assertion becomes a tautology. Tags are therefore read on both paths, and the
 * error is RETURNED rather than propagated so a caller can assert on the
 * rejection and the tags together.
 */
export async function runCapturingRevalidatedTags<T>(
  fn: () => Promise<T>
): Promise<{ result?: T; error?: unknown; threw: boolean; tags: string[] }> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  try {
    const result = await workAsyncStorage.run(store as never, fn);
    return { result, threw: false, tags: store.pendingRevalidatedTags };
  } catch (error) {
    return { error, threw: true, tags: store.pendingRevalidatedTags };
  }
}
