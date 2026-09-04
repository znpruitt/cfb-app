import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';

import { __resetAppStateForTests, __setAppStatePoolForTests } from '../appStateStore';
import {
  buildProviderUsageObservation,
  recordProviderUsageObservation,
  type ProviderUsageObservation,
} from '../providerUsageSeries';

/**
 * Codex review (P2): a COMMIT whose acknowledgement is lost leaves durability
 * UNKNOWN — `appStateStore` sets the threshold explicitly at `writeAttempted`,
 * because a submitted mutation may have executed server-side. The old code
 * collapsed that into `false`, so the receipt asserted the observation was lost
 * when it may well have committed.
 *
 * These need the POSTGRES path: the file store throws `writeAttempted: false`
 * (its atomic rename left the prior file intact), which is the certain case.
 */

type StoreState = { row: unknown | undefined; readThrows: boolean };

/**
 * The IN-TRANSACTION client. Its reads always succeed — `readThrows` models a
 * failure of the later pool-level reread, not of the transaction itself. An
 * earlier version failed both, so the callback threw a plain error before any
 * COMMIT was attempted and the test never reached the code it was written for.
 */
class FakeClient {
  async query(text: string): Promise<{ rows: unknown[] }> {
    const sql = String(text).trim().toLowerCase();
    if (sql.startsWith('commit')) throw new Error('COMMIT acknowledgement lost');
    if (sql.startsWith('select value')) return { rows: [] };
    return { rows: [{ present: true }] };
  }
  release(): void {}
}

class FakePool {
  constructor(private readonly state: StoreState) {}
  async connect(): Promise<FakeClient> {
    return new FakeClient();
  }
  // Keyed on the STATEMENT: only the reread's `select value` is affected. An
  // earlier version threw for every pool query, which broke `ensureDatabase`
  // before the transaction ever ran — so the error under test was never the one
  // raised, and the test could not reach the branch it was written for.
  async query(text?: string): Promise<{ rows: unknown[] }> {
    const sql = String(text ?? '')
      .trim()
      .toLowerCase();
    if (!sql.startsWith('select value')) return { rows: [{ present: true }] };
    if (this.state.readThrows) throw new Error('replica unreachable');
    return this.state.row === undefined
      ? { rows: [] }
      : { rows: [{ value: this.state.row, updated_at: new Date().toISOString() }] };
  }
  async end(): Promise<void> {}
}

const OBSERVATION: ProviderUsageObservation = {
  at: '2026-09-04T18:00:00.000Z',
  remaining: 4600,
  limit: 5000,
};

async function withLostCommit(state: StoreState): Promise<string> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fake-host/fake-db';
  __setAppStatePoolForTests(new FakePool(state) as unknown as Pool);
  try {
    return await recordProviderUsageObservation(OBSERVATION);
  } finally {
    __setAppStatePoolForTests(null);
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    __resetAppStateForTests();
  }
}

test('a lost COMMIT that DID land is reported as recorded, not as a loss', async () => {
  // The whole point: the reread settles the uncertainty into a fact.
  const outcome = await withLostCommit({
    row: { observations: [OBSERVATION] },
    readThrows: false,
  });
  assert.equal(outcome, 'recorded');
});

test('a lost COMMIT that did NOT land is reported as not-recorded', async () => {
  // Positive control for the test above: the reread must be capable of BOTH
  // answers, or "recorded" proves nothing.
  const outcome = await withLostCommit({ row: { observations: [] }, readThrows: false });
  assert.equal(outcome, 'not-recorded');
});

test('a lost COMMIT whose reread ALSO fails stays indeterminate', async () => {
  // The only genuinely unknown case, and the one the receipt must not dress up
  // as a definite loss.
  const outcome = await withLostCommit({ row: undefined, readThrows: true });
  assert.equal(outcome, 'indeterminate');
});

test('an incoherent reading is not stored as a count, so it cannot fake a period boundary', () => {
  // /code-review finding: the route computed this verdict and the writer ignored
  // it. A rise in `remaining` is the ONE signal marking a quota period, so a
  // reading above the account ceiling invented a boundary that never happened.
  const built = buildProviderUsageObservation(
    { patronLevel: 1, used: null, remaining: 999_999, limit: 5000 },
    new Date('2026-09-04T18:00:00.000Z')
  );

  assert.equal(built.remaining, null, 'remaining above the limit is not a usable count');
  assert.equal(built.limit, 5000, 'the limit is kept as the context it already was');

  // Positive control: a coherent pair on the same path is stored intact.
  const ok = buildProviderUsageObservation(
    { patronLevel: 1, used: 400, remaining: 4600, limit: 5000 },
    new Date('2026-09-04T18:00:00.000Z')
  );
  assert.equal(ok.remaining, 4600);
});
