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
 * As above, but ALSO returns the tags revalidated during `fn`. Tests that must
 * prove a mutation path invalidated NOTHING need the captured list, not just a
 * successful run — asserting an empty array the test itself created proves
 * nothing.
 */
export async function runCapturingRevalidatedTags<T>(
  fn: () => Promise<T>
): Promise<{ result: T; tags: string[] }> {
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  const result = await workAsyncStorage.run(store as never, fn);
  return { result, tags: store.pendingRevalidatedTags };
}
