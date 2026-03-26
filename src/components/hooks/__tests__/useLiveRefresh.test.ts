import assert from 'node:assert/strict';
import test from 'node:test';

import { nextBootstrapGuardState } from '../useLiveRefresh';

test('initial loaded state can bootstrap and arms guard', () => {
  const next = nextBootstrapGuardState({
    current: false,
    scheduleLoaded: true,
    didBootstrapThisPass: true,
  });

  assert.equal(next, true);
});

test('unloaded schedule resets bootstrap guard', () => {
  const next = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: false,
  });

  assert.equal(next, false);
});

test('later reload can bootstrap again after unload reset', () => {
  const afterUnload = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: false,
  });
  const afterReloadBootstrap = nextBootstrapGuardState({
    current: afterUnload,
    scheduleLoaded: true,
    didBootstrapThisPass: true,
  });

  assert.equal(afterUnload, false);
  assert.equal(afterReloadBootstrap, true);
});

test('continuous loaded state without bootstrap keeps guard stable', () => {
  const next = nextBootstrapGuardState({
    current: true,
    scheduleLoaded: true,
    didBootstrapThisPass: false,
  });

  assert.equal(next, true);
});
