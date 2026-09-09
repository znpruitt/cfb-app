import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECONCILIATION_LEDGER_MAX_ENTRIES,
  RECONCILIATION_LEDGER_SCOPE,
  parseReconciliationLedger,
  readReconciliationLedger,
  reconciliationLedgerKey,
  reserveReconciliationAttempt,
  settleReconciliationAttempt,
  summarizeReconciliationPasses,
  type ReconciliationLedgerEntry,
  type ReconciliationSettlementInput,
} from '../reconciliationLedger.ts';
import { RECONCILIATION_MAX_ATTEMPTS, reconciliationPassKey } from '../reconciliationTarget.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';

// PLATFORM-110B — the durable record of what correction reconciliation did.
// Reserve BEFORE the provider request, settle after: that ordering is what makes
// "a store that cannot record cannot spend" true, and it is what enforces the
// attempt cap inside the transaction.

const YEAR = 2025;
const PARTITION = '2025:3:regular';

function entry(overrides: Partial<ReconciliationLedgerEntry> = {}): ReconciliationLedgerEntry {
  return {
    attemptId: 'attempt-1',
    partitionKey: PARTITION,
    pass: 'p1',
    dueAt: '2025-09-10T00:00:00.000Z',
    reservedAt: '2025-09-10T00:59:00.000Z',
    observedAt: '2025-09-10T01:00:00.000Z',
    reachedVerdict: true,
    outcome: 'success',
    reason: 'written-clean',
    corrected: 0,
    refreshed: 12,
    inserted: 0,
    conflicts: 0,
    stale: 0,
    notObserved: 1,
    ...overrides,
  };
}

function settlement(
  overrides: Partial<ReconciliationSettlementInput> = {}
): ReconciliationSettlementInput {
  return {
    reachedVerdict: true,
    outcome: 'success',
    reason: 'written-clean',
    observedAt: '2025-09-10T01:00:00.000Z',
    corrected: 3,
    refreshed: 200,
    inserted: 0,
    conflicts: 0,
    stale: 0,
    notObserved: 4,
    ...overrides,
  };
}

async function reserve(attemptId: string, pass: 'p1' | 'p2' = 'p1') {
  return await reserveReconciliationAttempt({
    year: YEAR,
    partitionKey: PARTITION,
    pass,
    dueAt: '2025-09-10T00:00:00.000Z',
    attemptId,
    reservedAt: new Date().toISOString(),
  });
}

async function storedValue(): Promise<unknown> {
  const record = await getAppState<unknown>(
    RECONCILIATION_LEDGER_SCOPE,
    reconciliationLedgerKey(YEAR)
  );
  return record?.value ?? null;
}

async function entries(): Promise<ReconciliationLedgerEntry[]> {
  const read = await readReconciliationLedger(YEAR);
  return read.status === 'ok' ? read.ledger.entries : [];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

// === Reading distinguishes four unlike states ===

test('an absent ROW reads as absent — a legitimate, cacheable state', async () => {
  assert.deepEqual(await readReconciliationLedger(YEAR), { status: 'absent' });
});

test('a stored JSON null reads as MALFORMED, not absent', async () => {
  // A `jsonb` column can hold JSON `null`. Reading that as "no ledger" would
  // reopen every pass of the season, so absence is the missing ROW only.
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), null);
  assert.deepEqual(await readReconciliationLedger(YEAR), { status: 'malformed' });
});

test('a store failure reads as read-failed, never as absent', async () => {
  __setAppStateReadFailureForTests(new Error('store down'), RECONCILIATION_LEDGER_SCOPE);
  assert.deepEqual(await readReconciliationLedger(YEAR), { status: 'read-failed' });
});

test('every malformed shape reads as malformed, so nothing reads as "no pass has run"', async () => {
  const malformed: Array<[string, unknown]> = [
    ['not an object', 'ledger'],
    ['an array', []],
    ['no entries array', { year: YEAR }],
    ['entries not an array', { year: YEAR, entries: {} }],
    ['a different year', { year: 2024, entries: [] }],
    ['a year as a string', { year: String(YEAR), entries: [] }],
    ['an entry that is not an object', { year: YEAR, entries: ['x'] }],
    ['an entry with no attemptId', { year: YEAR, entries: [{ ...entry(), attemptId: '' }] }],
    ['an entry with an unknown pass', { year: YEAR, entries: [entry({ pass: 'p3' as never })] }],
    [
      'an entry with an unknown outcome',
      { year: YEAR, entries: [entry({ outcome: 'ok' as never })] },
    ],
    [
      'an entry with a non-boolean reachedVerdict',
      { year: YEAR, entries: [{ ...entry(), reachedVerdict: 'yes' }] },
    ],
    [
      'an entry with a non-string, non-null observedAt',
      { year: YEAR, entries: [{ ...entry(), observedAt: 17 }] },
    ],
    ['an entry with a negative count', { year: YEAR, entries: [entry({ corrected: -1 })] }],
    ['an entry with a fractional count', { year: YEAR, entries: [{ ...entry(), refreshed: 1.5 }] }],
    ['an entry with a missing count', { year: YEAR, entries: [{ ...entry(), stale: undefined }] }],
  ];

  for (const [label, value] of malformed) {
    assert.equal(parseReconciliationLedger(value, YEAR), null, `${label} must not parse`);
    await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), value);
    assert.deepEqual(
      await readReconciliationLedger(YEAR),
      { status: 'malformed' },
      `${label} must read as malformed`
    );
  }
});

test('ONE malformed entry condemns the whole record rather than being dropped', async () => {
  // Silently discarding an entry would REOPEN a pass that had already run — the
  // exact double-spend the record exists to prevent.
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: [entry(), entry({ attemptId: 'a2', pass: 'nope' as never })],
  });
  assert.deepEqual(await readReconciliationLedger(YEAR), { status: 'malformed' });
});

test('a reserved-but-unsettled entry round-trips with observedAt null', async () => {
  const pending = entry({ observedAt: null, reachedVerdict: false, reason: 'attempt-not-settled' });
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: [pending],
  });
  const read = await readReconciliationLedger(YEAR);
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.status === 'ok' ? read.ledger.entries : null, [pending]);
});

// === Summarizing ===

test('summarize counts reserved attempts and closes only on a merge VERDICT', () => {
  const summary = summarizeReconciliationPasses({
    year: YEAR,
    entries: [
      entry({ attemptId: 'a1', reachedVerdict: false, outcome: 'failure', reason: 'unavailable' }),
      entry({ attemptId: 'a2', reachedVerdict: true }),
      entry({
        attemptId: 'a3',
        pass: 'p2',
        reachedVerdict: false,
        outcome: 'failure',
        reason: 'x',
      }),
      entry({
        attemptId: 'a4',
        partitionKey: '2025:4:regular',
        reachedVerdict: false,
        outcome: 'failure',
        reason: 'x',
      }),
    ],
  });
  assert.deepEqual(summary.get(reconciliationPassKey(PARTITION, 'p1')), {
    attempts: 2,
    reachedVerdict: true,
  });
  assert.deepEqual(summary.get(reconciliationPassKey(PARTITION, 'p2')), {
    attempts: 1,
    reachedVerdict: false,
  });
  assert.equal(summary.get(reconciliationPassKey('2025:9:regular', 'p1')), undefined);
});

// === Reserving ===

test('the first reservation creates the season row with an unsettled placeholder', async () => {
  assert.deepEqual(await reserve('a1'), { status: 'reserved', attemptId: 'a1' });
  const stored = await entries();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.reachedVerdict, false, 'a reservation closes nothing');
  assert.equal(stored[0]!.observedAt, null, 'no observation has happened yet');
  assert.equal(
    stored[0]!.reason,
    'attempt-not-settled',
    'a run that dies mid-flight leaves exactly this, and it is the truth'
  );
});

test('a reservation on a CLOSED pass is refused, so the caller cannot spend', async () => {
  await reserve('a1');
  await settleReconciliationAttempt(YEAR, 'a1', settlement({ reachedVerdict: true }));
  const before = await storedValue();

  assert.deepEqual(await reserve('a2'), { status: 'already-closed' });
  assert.deepEqual(await storedValue(), before, 'nothing was written');
});

test('the attempt cap is enforced INSIDE the transaction and then refuses', async () => {
  for (let i = 0; i < RECONCILIATION_MAX_ATTEMPTS; i += 1) {
    assert.equal((await reserve(`a${i}`)).status, 'reserved', `attempt ${i + 1} reserves`);
    await settleReconciliationAttempt(
      YEAR,
      `a${i}`,
      settlement({ reachedVerdict: false, outcome: 'failure', reason: 'provider-fetch-failed' })
    );
  }
  assert.deepEqual(await reserve('one-too-many'), { status: 'attempt-cap-reached' });
  assert.equal((await entries()).length, RECONCILIATION_MAX_ATTEMPTS);
});

test('a full season row REFUSES the reservation — it never starts a refetch loop', async () => {
  // The defect this closes: appending after the fetch meant a full row recorded
  // nothing, left the pass due, and billed one call on every run forever.
  const full = Array.from({ length: RECONCILIATION_LEDGER_MAX_ENTRIES }, (_, i) =>
    // Deliberately DISJOINT from the partition under test, so the refusal is the
    // ceiling and not a closed pass — the checks are ordered closed, cap, full.
    entry({ attemptId: `f${i}`, partitionKey: `2025:${i}:postseason`, reachedVerdict: true })
  );
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: full,
  });
  assert.deepEqual(await reserve('a1'), { status: 'ledger-full' });
  assert.equal((await entries()).length, RECONCILIATION_LEDGER_MAX_ENTRIES);
});

test('a malformed stored value is REFUSED, never overwritten', async () => {
  const corrupt = { year: YEAR, entries: 'not an array' };
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), corrupt);

  assert.deepEqual(await reserve('a1'), { status: 'malformed' });
  assert.deepEqual(
    await storedValue(),
    corrupt,
    'overwriting would erase every pass that had already run and reopen them all'
  );

  // Positive control: the same reservation against a WELL-FORMED row does write,
  // so the refusal above is the malformed value and not a broken writer.
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: [],
  });
  assert.deepEqual(await reserve('a1'), { status: 'reserved', attemptId: 'a1' });
});

test('a store write failure refuses the reservation rather than throwing', async () => {
  __setAppStateWriteFailureForTests(new Error('write refused'), RECONCILIATION_LEDGER_SCOPE);
  assert.deepEqual(await reserve('a1'), { status: 'write-failed' });
});

test('a read failure inside the reservation transaction refuses and writes nothing', async () => {
  await reserve('a0');
  await settleReconciliationAttempt(
    YEAR,
    'a0',
    settlement({ reachedVerdict: false, outcome: 'failure', reason: 'x' })
  );
  const before = await storedValue();

  __setAppStateReadFailureForTests(new Error('store down'), RECONCILIATION_LEDGER_SCOPE);
  assert.deepEqual(await reserve('a1'), { status: 'write-failed' });

  __setAppStateReadFailureForTests(null);
  assert.deepEqual(await storedValue(), before, 'nothing was written');
});

test('CONCURRENT reservations serialize: the cap holds without any await between them', async () => {
  // The sequential test below proves the cap's arithmetic; hoisting the check
  // OUT of the transaction would survive it. This one fires the reservations
  // together, with no await in between, so each would read the same snapshot if
  // the check were not inside the transaction — and one extra attempt would slip
  // past the bound.
  const results = await Promise.all(
    Array.from({ length: RECONCILIATION_MAX_ATTEMPTS + 2 }, (_, i) => reserve(`c${i}`))
  );
  const reserved = results.filter((r) => r.status === 'reserved');
  const refused = results.filter((r) => r.status === 'attempt-cap-reached');
  assert.equal(
    reserved.length,
    RECONCILIATION_MAX_ATTEMPTS,
    `exactly ${RECONCILIATION_MAX_ATTEMPTS} concurrent reservations may win`
  );
  assert.equal(refused.length, 2, 'and the rest are refused by the cap, not admitted');
  assert.equal((await entries()).length, RECONCILIATION_MAX_ATTEMPTS, 'the row agrees');
});

test('two runs that both reserve both appear — the ledger cannot under-report spend', async () => {
  assert.equal((await reserve('a1')).status, 'reserved');
  assert.equal((await reserve('a2')).status, 'reserved');
  const summary = summarizeReconciliationPasses({ year: YEAR, entries: await entries() });
  assert.deepEqual(summary.get(reconciliationPassKey(PARTITION, 'p1')), {
    attempts: 2,
    reachedVerdict: false,
  });
});

// === Settling ===

test('settling replaces the reserved entry in place, never appending a second', async () => {
  await reserve('a1');
  assert.deepEqual(await settleReconciliationAttempt(YEAR, 'a1', settlement({ corrected: 5 })), {
    status: 'settled',
  });
  const stored = await entries();
  assert.equal(stored.length, 1, 'one attempt, one entry');
  assert.equal(stored[0]!.attemptId, 'a1');
  assert.equal(stored[0]!.corrected, 5);
  assert.equal(stored[0]!.reachedVerdict, true);
  assert.equal(stored[0]!.observedAt, '2025-09-10T01:00:00.000Z');
  assert.equal(stored[0]!.reservedAt.length > 0, true, 'the reservation instant is preserved');
});

test('settling an unknown attempt reports not-found and INVENTS no entry', async () => {
  await reserve('a1');
  assert.deepEqual(await settleReconciliationAttempt(YEAR, 'ghost', settlement()), {
    status: 'not-found',
  });
  assert.equal((await entries()).length, 1, 'the ledger can never over-count spend');
});

test('a failed settlement leaves the reservation standing, so the attempt still counts', async () => {
  await reserve('a1');
  __setAppStateWriteFailureForTests(new Error('write refused'), RECONCILIATION_LEDGER_SCOPE);
  assert.deepEqual(await settleReconciliationAttempt(YEAR, 'a1', settlement()), {
    status: 'write-failed',
  });

  __setAppStateWriteFailureForTests(null);
  const stored = await entries();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.reachedVerdict, false, 'the pass stays open');
  assert.equal(stored[0]!.reason, 'attempt-not-settled', 'and the attempt is still counted');
});

test('settling against a malformed row is refused rather than overwriting it', async () => {
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: 'not an array',
  });
  assert.deepEqual(await settleReconciliationAttempt(YEAR, 'a1', settlement()), {
    status: 'malformed',
  });
});
