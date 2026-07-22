import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateFileCommitFailureForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateReadFailureForTests,
  __setAppStatePoolForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';
import { initializeWriterControl } from '../../../../scripts/init-game-stats-writer-control.ts';
import {
  describeTransitionOutcome,
  parseTransitionArgs,
} from '../../../../scripts/transition-game-stats-writer-control.ts';
import {
  isAllowedWriterControlTransition,
  transitionWriterControl,
  type WriterControlTransitionOutcome,
} from '../writerControlTransition.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_SCOPE,
  WRITER_CONTROL_STATES,
  type WriterControlState,
} from '../writerFence.ts';
import { seedWriterControlState } from './writerControlSeed.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

/** The raw stored control value, or the sentinel `'__ABSENT__'` when no row exists. */
async function controlRaw(): Promise<unknown> {
  const row = await getAppState<unknown>(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY);
  return row === null ? '__ABSENT__' : row.value;
}

const ALLOWED_EDGES: ReadonlyArray<readonly [WriterControlState, WriterControlState]> = [
  ['legacy', 'armed'],
  ['armed', 'legacy'],
  ['armed', 'active'],
  ['active', 'read-only-safe'],
  ['read-only-safe', 'active'],
];

function isAllowedEdge(from: WriterControlState, to: WriterControlState): boolean {
  return ALLOWED_EDGES.some(([f, t]) => f === from && t === to);
}

// === The closed transition graph ===

test('graph: isAllowedWriterControlTransition matches exactly the five permitted edges', () => {
  for (const from of WRITER_CONTROL_STATES) {
    for (const to of WRITER_CONTROL_STATES) {
      assert.equal(
        isAllowedWriterControlTransition(from, to),
        isAllowedEdge(from, to),
        `${from} → ${to}`
      );
    }
  }
});

for (const [from, to] of ALLOWED_EDGES) {
  test(`transition: '${from}' → '${to}' commits and persists the exact record shape`, async () => {
    await seedWriterControlState(from);
    const outcome = await transitionWriterControl({ expected: from, to, apply: true });
    assert.deepEqual(outcome, { kind: 'transitioned', from, to });
    // Exactly `{recordVersion, state}` — no extra field, stamp, or history.
    assert.deepEqual(await controlRaw(), { recordVersion: 1, state: to });
  });
}

test('transition: every non-permitted state pair (including same-state) refuses without mutation', async () => {
  for (const from of WRITER_CONTROL_STATES) {
    for (const to of WRITER_CONTROL_STATES) {
      if (isAllowedEdge(from, to)) continue;
      await seedWriterControlState(from);
      const outcome = await transitionWriterControl({ expected: from, to, apply: true });
      assert.deepEqual(
        outcome,
        { kind: 'refused', reason: 'forbidden-edge', from, to },
        `${from} → ${to}`
      );
      assert.deepEqual(await controlRaw(), { recordVersion: 1, state: from }, `${from} → ${to}`);
    }
  }
});

test('transition: every return to legacy after activation is forbidden by construction', async () => {
  for (const from of ['active', 'read-only-safe'] as const) {
    await seedWriterControlState(from);
    const outcome = await transitionWriterControl({ expected: from, to: 'legacy', apply: true });
    assert.deepEqual(outcome, { kind: 'refused', reason: 'forbidden-edge', from, to: 'legacy' });
    assert.deepEqual(await controlRaw(), { recordVersion: 1, state: from });
  }
});

// === Refusals on record state ===

test('transition: an absent control refuses with control-absent and writes nothing', async () => {
  const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
  assert.deepEqual(outcome, { kind: 'refused', reason: 'control-absent' });
  assert.equal(await controlRaw(), '__ABSENT__');
});

test('transition: a malformed control refuses with control-malformed and never repairs it', async () => {
  const malformedShapes: unknown[] = [
    null,
    'legacy',
    { recordVersion: 2, state: 'legacy' }, // unknown version
    { recordVersion: 1, state: 'unknown' }, // unsupported state
    { recordVersion: 1, state: 'legacy', extra: 1 }, // extra field
  ];
  for (const malformed of malformedShapes) {
    await setAppState(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY, malformed);
    const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
    assert.deepEqual(outcome, { kind: 'refused', reason: 'control-malformed' });
    assert.deepEqual(await controlRaw(), malformed, JSON.stringify(malformed));
  }
});

test('transition: an expected-state mismatch refuses with the ACTUAL state and writes nothing', async () => {
  await seedWriterControlState('active');
  const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
  assert.deepEqual(outcome, {
    kind: 'refused',
    reason: 'expected-state-mismatch',
    expected: 'legacy',
    actual: 'active',
  });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'active' });
});

test('transition: the expected-state check precedes edge validation (mismatch wins)', async () => {
  // The request names a FORBIDDEN edge, but the durable state also mismatches:
  // the operator hears about the mismatch first and rereads before acting.
  await seedWriterControlState('armed');
  const outcome = await transitionWriterControl({ expected: 'legacy', to: 'active', apply: true });
  assert.deepEqual(outcome, {
    kind: 'refused',
    reason: 'expected-state-mismatch',
    expected: 'legacy',
    actual: 'armed',
  });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'armed' });
});

// === Concurrency: same expected state, at most one transition ===

test('transition: two concurrent commands with the same expected state serialize; exactly one commits', async () => {
  await seedWriterControlState('legacy');
  const [a, b] = await Promise.all([
    transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true }),
    transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true }),
  ]);
  const kinds = [a.kind, b.kind].sort();
  assert.deepEqual(kinds, ['refused', 'transitioned']);
  const loser = (a.kind === 'refused' ? a : b) as Extract<
    WriterControlTransitionOutcome,
    { kind: 'refused' }
  >;
  // The loser reread the COMMITTED state inside its own transaction: a
  // truthful mismatch (armed), never a double transition or a false success.
  assert.deepEqual(loser, {
    kind: 'refused',
    reason: 'expected-state-mismatch',
    expected: 'legacy',
    actual: 'armed',
  });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'armed' });
});

// === Dry run ===

test('dry run: validates record, expected state, and edge without EVER writing', async () => {
  await seedWriterControlState('legacy');
  // Arm the write seam: any attempted write would throw and surface as
  // store-unavailable — a passing would-transition proves no write path ran.
  __setAppStateWriteFailureForTests(new Error('no writes expected'), WRITER_CONTROL_SCOPE);
  const ok = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: false });
  assert.deepEqual(ok, { kind: 'would-transition', from: 'legacy', to: 'armed' });

  const forbidden = await transitionWriterControl({
    expected: 'legacy',
    to: 'active',
    apply: false,
  });
  assert.deepEqual(forbidden, {
    kind: 'refused',
    reason: 'forbidden-edge',
    from: 'legacy',
    to: 'active',
  });
  const mismatch = await transitionWriterControl({ expected: 'armed', to: 'active', apply: false });
  assert.deepEqual(mismatch, {
    kind: 'refused',
    reason: 'expected-state-mismatch',
    expected: 'armed',
    actual: 'legacy',
  });
  __setAppStateWriteFailureForTests(null);
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'legacy' });
});

test('dry run: is not a reservation — a later apply repeats the atomic expected-state check', async () => {
  await seedWriterControlState('legacy');
  const dry = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: false });
  assert.equal(dry.kind, 'would-transition');
  // The state moves between the dry run and the apply (another operator won).
  await seedWriterControlState('armed');
  const late = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
  assert.deepEqual(late, {
    kind: 'refused',
    reason: 'expected-state-mismatch',
    expected: 'legacy',
    actual: 'armed',
  });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'armed' });
});

// === The initializer remains incapable of transitioning ===

test('initializer: still create-if-absent only — it cannot transition any state', async () => {
  for (const state of ['armed', 'active', 'read-only-safe'] as const) {
    await seedWriterControlState(state);
    const outcome = await initializeWriterControl({ apply: true });
    assert.deepEqual(outcome, { action: 'refused-not-legacy', state });
    assert.deepEqual(await controlRaw(), { recordVersion: 1, state });
  }
});

// === Store failures: truthful known-unchanged vs indeterminate ===

test('store: a lock-acquisition failure is store-unavailable with no durable transition', async () => {
  await seedWriterControlState('legacy');
  __setAppStateKeyLockFailureForTests(new Error('lock down'), WRITER_CONTROL_SCOPE);
  const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
  __setAppStateKeyLockFailureForTests(null);
  assert.deepEqual(outcome, { kind: 'store-unavailable' });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'legacy' });
});

test('store: a failed reread is store-unavailable with no durable transition', async () => {
  await seedWriterControlState('legacy');
  __setAppStateReadFailureForTests(new Error('read down'), WRITER_CONTROL_SCOPE);
  const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
  __setAppStateReadFailureForTests(null);
  assert.deepEqual(outcome, { kind: 'store-unavailable' });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'legacy' });
});

test('store: a proven-nothing-durable commit failure is store-unavailable (known-unchanged)', async () => {
  await seedWriterControlState('legacy');
  __setAppStateFileCommitFailureForTests(new Error('commit down'));
  const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
  __setAppStateFileCommitFailureForTests(null);
  // The file-fallback atomic rename proves NOTHING staged became durable
  // (`writeAttempted: false`) — truthfully known-unchanged, not indeterminate.
  assert.deepEqual(outcome, { kind: 'store-unavailable' });
  assert.deepEqual(await controlRaw(), { recordVersion: 1, state: 'legacy' });
});

/**
 * Minimal fake pg client/pool: serves a valid `legacy` control record, accepts
 * the transition write, then LOSES the COMMIT acknowledgement — the only path
 * to `store-indeterminate` (mutation SQL submitted, durability unknown).
 */
class LostCommitClient {
  async query(text: string): Promise<{ rows: unknown[] }> {
    const sql = text.toLowerCase().trim();
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('select value')) {
      return {
        rows: [
          { value: { recordVersion: 1, state: 'legacy' }, updated_at: '2024-01-01T00:00:00.000Z' },
        ],
      };
    }
    if (sql === 'commit') throw new Error('commit acknowledgement lost');
    // begin / pg_advisory_xact_lock / insert (write submitted) / rollback / ddl.
    return { rows: [] };
  }
  release(): void {}
}

class LostCommitPool {
  async query(text: string): Promise<{ rows: unknown[] }> {
    return text.toLowerCase().includes('to_regclass')
      ? { rows: [{ present: true }] }
      : { rows: [] };
  }
  async connect(): Promise<LostCommitClient> {
    return new LostCommitClient();
  }
  async end(): Promise<void> {}
}

test('store: a lost commit AFTER the mutation was submitted is store-indeterminate', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  __setAppStatePoolForTests(new LostCommitPool() as unknown as Pool);
  try {
    const outcome = await transitionWriterControl({ expected: 'legacy', to: 'armed', apply: true });
    // EITHER state may be durable — never reported as success or as unchanged.
    assert.deepEqual(outcome, { kind: 'store-indeterminate' });
  } finally {
    __setAppStatePoolForTests(null);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    __resetAppStateForTests();
  }
});

// === Operator CLI: argument parsing and outcome mapping ===

test('cli: parseTransitionArgs requires explicit valid --from/--to and rejects anything else', () => {
  assert.deepEqual(parseTransitionArgs(['--from', 'legacy', '--to', 'armed']), {
    from: 'legacy',
    to: 'armed',
    apply: false,
  });
  assert.deepEqual(parseTransitionArgs(['--from', 'armed', '--to', 'active', '--apply']), {
    from: 'armed',
    to: 'active',
    apply: true,
  });
  for (const argv of [
    [], // nothing
    ['--from', 'legacy'], // missing --to
    ['--to', 'armed'], // missing --from
    ['--from', 'legacy', '--to'], // dangling value
    ['--from', '--to', 'armed'], // flag as value
    ['--from', 'legacy', '--to', 'bogus'], // invalid state
    ['--from', 'Legacy', '--to', 'armed'], // case-sensitive states
    ['--from', 'legacy', '--to', 'armed', '--force'], // unknown flag
  ]) {
    const parsed = parseTransitionArgs(argv);
    assert.ok('error' in parsed, JSON.stringify(argv));
  }
});

test('cli: outcome mapping uses stable exit codes and the indeterminate line instructs a reread', () => {
  assert.equal(
    describeTransitionOutcome({ kind: 'transitioned', from: 'legacy', to: 'armed' }, true).code,
    0
  );
  assert.equal(
    describeTransitionOutcome({ kind: 'would-transition', from: 'legacy', to: 'armed' }, false)
      .code,
    0
  );
  for (const refusal of [
    { kind: 'refused', reason: 'control-absent' },
    { kind: 'refused', reason: 'control-malformed' },
    {
      kind: 'refused',
      reason: 'expected-state-mismatch',
      expected: 'legacy',
      actual: 'armed',
    },
    { kind: 'refused', reason: 'forbidden-edge', from: 'active', to: 'legacy' },
  ] as const) {
    assert.equal(describeTransitionOutcome(refusal, true).code, 2, refusal.reason);
  }
  assert.equal(describeTransitionOutcome({ kind: 'store-unavailable' }, true).code, 3);
  const indeterminate = describeTransitionOutcome({ kind: 'store-indeterminate' }, true);
  assert.equal(indeterminate.code, 4);
  // The operator is told to REREAD, and explicitly told not to retry/repair.
  assert.match(indeterminate.line, /REREAD/);
  assert.match(indeterminate.line, /do NOT retry/);
  assert.match(indeterminate.line, /EITHER state may/);
});
