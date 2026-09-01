// Test-only: Next's app-render async-storage modules expect the runtime's
// AsyncLocalStorage global. Bare node:test does not install it for route/helper
// suites, so shared tests import this module before importing Next internals.
import { AsyncLocalStorage } from 'node:async_hooks';

const globalWithAls = globalThis as typeof globalThis & {
  AsyncLocalStorage?: typeof AsyncLocalStorage;
};

globalWithAls.AsyncLocalStorage ??= AsyncLocalStorage;
