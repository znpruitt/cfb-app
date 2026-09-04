import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';

import { __resetAppStateForTests, __setAppStatePoolForTests } from '../appStateStore';
import { recordedFromWriteOutcome } from '../../providerUsage/cronExecutionLog';
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

test('an uncertain COMMIT is reported as INDETERMINATE, never as a loss', async () => {
  // Codex P2. A COMMIT failing after the mutation was submitted leaves durability
  // unknown; `appStateStore` sets the threshold at `writeAttempted` precisely
  // because a submitted mutation may have executed server-side. The outcome is
  // reported, not guessed.
  const outcome = await withLostCommit({ row: { observations: [] }, readThrows: false });
  assert.equal(outcome, 'indeterminate');
});

test('the outcome does NOT depend on rereading the row', async () => {
  // Positive control AND a regression guard. An earlier version resolved the
  // uncertainty by rereading and asking whether an observation with this `at`
  // existed — but this module deliberately permits two observations to share a
  // timestamp, so the reread could find an EARLIER row and confirm a commit that
  // never happened. Whatever the store contains, the answer is the same.
  const withRow = await withLostCommit({
    row: { observations: [OBSERVATION] },
    readThrows: false,
  });
  const withoutRow = await withLostCommit({ row: undefined, readThrows: false });

  assert.equal(withRow, 'indeterminate', 'a colliding row cannot manufacture a confirmation');
  assert.equal(withoutRow, 'indeterminate');
});

test('an UNKNOWN patron tier still yields a usable reading', () => {
  // REGRESSION. `cfbdCanonicalLimitForTier` falls back to Tier 0 (1,000) for any
  // tier outside its table, so a coherence check comparing `remaining` against
  // `limit` turned a true 4,600 into "impossible" and discarded it — filing
  // `partial` every six hours forever, the exact failure the round before had
  // fixed. Nothing derives from `limit` now.
  const built = buildProviderUsageObservation(
    { patronLevel: 7, used: null, remaining: 4600, limit: 1000 },
    new Date('2026-09-04T18:00:00.000Z')
  );

  assert.equal(built.remaining, 4600, 'the provider-reported count survives an unknown tier');
  assert.equal(built.limit, 1000, 'the fallback limit is recorded as context and used for nothing');
});

test('an untrustworthy count is still refused', () => {
  // Positive control for the test above: dropping the limit comparison must not
  // also drop the one check that remains.
  const fractional = buildProviderUsageObservation(
    { patronLevel: 1, used: null, remaining: 1500.5, limit: 5000 },
    new Date('2026-09-04T18:00:00.000Z')
  );
  assert.equal(fractional.remaining, null, 'a fractional count is not a count');
});

test('the receipt maps indeterminate to NULL, never to a definite loss', () => {
  // The link both reviewers flagged, and the one a mutation showed no test
  // reached: the write path returned a tri-state and the receipt flattened it.
  assert.equal(recordedFromWriteOutcome('recorded'), true);
  assert.equal(recordedFromWriteOutcome('not-recorded'), false);
  assert.equal(recordedFromWriteOutcome('indeterminate'), null);
  // `null` and `false` must stay distinguishable — `??` and truthiness both
  // collapse them, which is how the flattening happened in the first place.
  assert.notEqual(recordedFromWriteOutcome('indeterminate'), false);
});
