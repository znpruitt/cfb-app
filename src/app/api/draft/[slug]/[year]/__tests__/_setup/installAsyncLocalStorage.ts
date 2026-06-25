// Test-only: Next's app-render async-storage modules assert that a global
// `AsyncLocalStorage` exists (it is normally polyfilled by the Next runtime).
// Under the bare node:test runner there is no such global, so installing it here
// lets route handlers that call `revalidateTag` (via `invalidateStandings`) run.
//
// This module performs ONLY the global install and intentionally imports nothing
// from Next, so that importing it first guarantees the global is in place before
// any Next storage module is evaluated.
import { AsyncLocalStorage } from 'node:async_hooks';

const globalWithAls = globalThis as typeof globalThis & {
  AsyncLocalStorage?: typeof AsyncLocalStorage;
};
globalWithAls.AsyncLocalStorage ??= AsyncLocalStorage;
