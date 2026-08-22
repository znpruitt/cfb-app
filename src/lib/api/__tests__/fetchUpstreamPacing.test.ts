import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __applyUpstreamPacingForTests,
  __isUpstreamPacingDisabledForTests,
  __resetUpstreamPacingForTests,
  type UpstreamPacingPolicy,
} from '../fetchUpstream.ts';

type PendingSleep = {
  ms: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

function createControlledClock() {
  let nowMs = 0;
  const pending: PendingSleep[] = [];
  const durations: number[] = [];

  return {
    clock: {
      now: () => nowMs,
      sleep: (ms: number) => {
        durations.push(ms);
        return new Promise<void>((resolve, reject) => {
          pending.push({ ms, resolve, reject });
        });
      },
    },
    durations,
    pendingCount: () => pending.length,
    resolveNext: () => {
      const next = pending.shift();
      assert.ok(next, 'expected a pending pacing sleep to resolve');
      nowMs += next.ms;
      next.resolve();
    },
    rejectNext: () => {
      const next = pending.shift();
      assert.ok(next, 'expected a pending pacing sleep to reject');
      next.reject(new Error('injected pacing sleep rejection'));
    },
  };
}

async function waitFor(predicate: () => boolean, message: string, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

async function drainMicrotasks(attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await Promise.resolve();
  }
}

async function withPacingEnvironment(
  options: { disabled: boolean; nodeTestProcess: boolean },
  run: () => Promise<void>
): Promise<void> {
  const priorDisabled = process.env.UPSTREAM_PACING_DISABLED;
  const priorContext = process.env.NODE_TEST_CONTEXT;

  if (options.disabled) process.env.UPSTREAM_PACING_DISABLED = '1';
  else delete process.env.UPSTREAM_PACING_DISABLED;

  if (options.nodeTestProcess) process.env.NODE_TEST_CONTEXT = 'child-v8';
  else delete process.env.NODE_TEST_CONTEXT;

  __resetUpstreamPacingForTests();
  try {
    await run();
  } finally {
    __resetUpstreamPacingForTests();
    if (priorDisabled === undefined) delete process.env.UPSTREAM_PACING_DISABLED;
    else process.env.UPSTREAM_PACING_DISABLED = priorDisabled;
    if (priorContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = priorContext;
  }
}

const POLICY: UpstreamPacingPolicy = { key: 'cfbd-test', minIntervalMs: 150 };

test('the shared runner satisfies the real fail-closed pacing guard', () => {
  assert.equal(
    __isUpstreamPacingDisabledForTests(),
    true,
    'shared test runner did not activate the guarded upstream pacing disable'
  );
});

test('same-key pacing spaces reservations and serializes the tail chain', async () => {
  await withPacingEnvironment({ disabled: false, nodeTestProcess: true }, async () => {
    const controlled = createControlledClock();
    await __applyUpstreamPacingForTests(POLICY, controlled.clock);

    const second = __applyUpstreamPacingForTests(POLICY, controlled.clock);
    await waitFor(() => controlled.pendingCount() === 1, 'second same-key call did not wait');

    const third = __applyUpstreamPacingForTests(POLICY, controlled.clock);
    await drainMicrotasks();
    assert.equal(
      controlled.pendingCount(),
      1,
      'third same-key call must remain behind the unresolved second call'
    );

    controlled.resolveNext();
    await second;
    await waitFor(
      () => controlled.pendingCount() === 1,
      'third same-key call did not wait in turn'
    );
    controlled.resolveNext();
    await third;

    assert.deepEqual(controlled.durations, [150, 150]);
  });
});

test('different pacing keys do not block one another', async () => {
  await withPacingEnvironment({ disabled: false, nodeTestProcess: true }, async () => {
    const controlled = createControlledClock();
    await __applyUpstreamPacingForTests(POLICY, controlled.clock);

    const blockedSameKey = __applyUpstreamPacingForTests(POLICY, controlled.clock);
    await waitFor(() => controlled.pendingCount() === 1, 'same-key call did not enter pacing wait');

    await __applyUpstreamPacingForTests(
      { key: 'odds-test', minIntervalMs: POLICY.minIntervalMs },
      controlled.clock
    );
    assert.equal(controlled.pendingCount(), 1, 'different key should resolve without another wait');

    controlled.resolveNext();
    await blockedSameKey;
  });
});

test('a rejected pacing call does not wedge the next same-key call', async () => {
  await withPacingEnvironment({ disabled: false, nodeTestProcess: true }, async () => {
    const controlled = createControlledClock();
    await __applyUpstreamPacingForTests(POLICY, controlled.clock);

    const rejected = __applyUpstreamPacingForTests(POLICY, controlled.clock);
    await waitFor(() => controlled.pendingCount() === 1, 'rejected call did not enter pacing wait');
    const afterRejection = __applyUpstreamPacingForTests(POLICY, controlled.clock);

    controlled.rejectNext();
    await assert.rejects(rejected, /injected pacing sleep rejection/);
    await waitFor(
      () => controlled.pendingCount() === 1,
      'tail catch did not release the call after a rejected predecessor'
    );
    controlled.resolveNext();
    await afterRejection;
  });
});

test('the explicit disable skips pacing inside a Node test child', async () => {
  await withPacingEnvironment({ disabled: true, nodeTestProcess: true }, async () => {
    const controlled = createControlledClock();
    await __applyUpstreamPacingForTests(POLICY, controlled.clock);
    await __applyUpstreamPacingForTests(POLICY, controlled.clock);
    assert.deepEqual(controlled.durations, []);
  });
});

test('the explicit disable fails closed without the Node test-process guard', async () => {
  await withPacingEnvironment({ disabled: true, nodeTestProcess: false }, async () => {
    const controlled = createControlledClock();
    await __applyUpstreamPacingForTests(POLICY, controlled.clock);

    const second = __applyUpstreamPacingForTests(POLICY, controlled.clock);
    await waitFor(
      () => controlled.pendingCount() === 1,
      'disable flag bypassed pacing outside a proven Node test child'
    );
    controlled.resolveNext();
    await second;
    assert.deepEqual(controlled.durations, [150]);
  });
});
