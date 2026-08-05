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
  let tags: string[] = [];
  let outcome: { result?: T; error?: unknown; threw: boolean };
  try {
    outcome = { result: await workAsyncStorage.run(store as never, fn), threw: false };
  } catch (error) {
    outcome = { error, threw: true };
  } finally {
    // Read in `finally` so the tags are captured on EVERY exit path. The
    // rejecting path is the one that matters: a test proving a refused mutation
    // invalidated nothing observes a rejection, so a helper that reported only
    // on success would hand back an empty list and the assertion would be a
    // tautology — which is exactly how the first two versions of it failed.
    tags = [...store.pendingRevalidatedTags];
  }
  return { ...outcome, tags };
}
