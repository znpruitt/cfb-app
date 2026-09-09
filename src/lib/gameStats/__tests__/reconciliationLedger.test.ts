import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECONCILIATION_LEDGER_MAX_ENTRIES,
  RECONCILIATION_LEDGER_SCOPE,
  appendReconciliationEntry,
  parseReconciliationLedger,
  readReconciliationLedger,
  reconciliationLedgerKey,
  summarizeReconciliationPasses,
  type ReconciliationLedgerEntry,
} from '../reconciliationLedger.ts';
import { reconciliationPassKey } from '../reconciliationTarget.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';

// PLATFORM-110B — the durable record of what correction reconciliation did. It
// bounds the work (a pass runs at most once, or three times if the provider
// never answers), it records changed games and failures truthfully, and it is
// what can retire the +7d pass on evidence.

const YEAR = 2025;

function entry(overrides: Partial<ReconciliationLedgerEntry> = {}): ReconciliationLedgerEntry {
  return {
    partitionKey: '2025:3:regular',
    pass: 'p1',
    dueAt: '2025-09-10T00:00:00.000Z',
    observedAt: '2025-09-10T01:00:00.000Z',
    reachedIngestion: true,
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

async function storedValue(): Promise<unknown> {
  const record = await getAppState<unknown>(
    RECONCILIATION_LEDGER_SCOPE,
    reconciliationLedgerKey(YEAR)
  );
  return record?.value ?? null;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

// === Reading distinguishes three unlike states ===

test('an absent ledger reads as absent — a legitimate, cacheable state', async () => {
  assert.deepEqual(await readReconciliationLedger(YEAR), { status: 'absent' });
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
    ['an entry with an unknown pass', { year: YEAR, entries: [entry({ pass: 'p3' as never })] }],
    [
      'an entry with an unknown outcome',
      { year: YEAR, entries: [entry({ outcome: 'ok' as never })] },
    ],
    [
      'an entry with a non-boolean reachedIngestion',
      { year: YEAR, entries: [{ ...entry(), reachedIngestion: 'yes' }] },
    ],
    ['an entry with a negative count', { year: YEAR, entries: [entry({ corrected: -1 })] }],
    ['an entry with a fractional count', { year: YEAR, entries: [{ ...entry(), refreshed: 1.5 }] }],
    ['an entry with a missing count', { year: YEAR, entries: [{ ...entry(), stale: undefined }] }],
    [
      'an entry with an empty partition key',
      { year: YEAR, entries: [entry({ partitionKey: '' })] },
    ],
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
    entries: [entry(), entry({ pass: 'nope' as never })],
  });
  assert.deepEqual(await readReconciliationLedger(YEAR), { status: 'malformed' });
});

test('a well-formed ledger round-trips every field', async () => {
  const written = entry({ corrected: 5, conflicts: 2, stale: 1, reason: 'written-mixed' });
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: [written],
  });
  const read = await readReconciliationLedger(YEAR);
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.status === 'ok' ? read.ledger.entries : null, [written]);
});

// === Summarizing ===

test('summarize counts attempts per pass and closes on any one that reached ingestion', () => {
  const summary = summarizeReconciliationPasses({
    year: YEAR,
    entries: [
      entry({ reachedIngestion: false, outcome: 'failure', reason: 'provider-fetch-failed' }),
      entry({ reachedIngestion: true }),
      entry({ pass: 'p2', reachedIngestion: false, outcome: 'failure', reason: 'x' }),
      entry({
        partitionKey: '2025:4:regular',
        reachedIngestion: false,
        outcome: 'failure',
        reason: 'x',
      }),
    ],
  });
  assert.deepEqual(summary.get(reconciliationPassKey('2025:3:regular', 'p1')), {
    attempts: 2,
    reachedIngestion: true,
  });
  assert.deepEqual(summary.get(reconciliationPassKey('2025:3:regular', 'p2')), {
    attempts: 1,
    reachedIngestion: false,
  });
  assert.deepEqual(summary.get(reconciliationPassKey('2025:4:regular', 'p1')), {
    attempts: 1,
    reachedIngestion: false,
  });
  assert.equal(summary.get(reconciliationPassKey('2025:9:regular', 'p1')), undefined);
});

test('the order of a closing entry does not matter — closed is closed', () => {
  const closedFirst = summarizeReconciliationPasses({
    year: YEAR,
    entries: [
      entry({ reachedIngestion: true }),
      entry({ reachedIngestion: false, outcome: 'failure', reason: 'x' }),
    ],
  });
  assert.equal(
    closedFirst.get(reconciliationPassKey('2025:3:regular', 'p1'))?.reachedIngestion,
    true
  );
});

// === Appending ===

test('the first append creates the season row', async () => {
  assert.deepEqual(await appendReconciliationEntry(YEAR, entry()), { status: 'appended' });
  const read = await readReconciliationLedger(YEAR);
  assert.equal(read.status === 'ok' ? read.ledger.entries.length : -1, 1);
});

test('a second attempt on a CLOSED pass writes nothing', async () => {
  await appendReconciliationEntry(YEAR, entry({ reachedIngestion: true }));
  const before = await storedValue();

  assert.deepEqual(await appendReconciliationEntry(YEAR, entry({ corrected: 99 })), {
    status: 'already-closed',
  });
  assert.deepEqual(await storedValue(), before, 'the stored row is byte-identical');
});

test('a second attempt on an OPEN pass IS recorded — both spent a call', async () => {
  const failed = entry({
    reachedIngestion: false,
    outcome: 'failure',
    reason: 'provider-fetch-failed',
  });
  assert.deepEqual(await appendReconciliationEntry(YEAR, failed), { status: 'appended' });
  assert.deepEqual(await appendReconciliationEntry(YEAR, failed), { status: 'appended' });

  const read = await readReconciliationLedger(YEAR);
  assert.equal(read.status, 'ok');
  const summary = summarizeReconciliationPasses(
    read.status === 'ok' ? read.ledger : { year: YEAR, entries: [] }
  );
  assert.deepEqual(summary.get(reconciliationPassKey('2025:3:regular', 'p1')), {
    attempts: 2,
    reachedIngestion: false,
  });
});

test('a malformed stored value is REFUSED, never overwritten', async () => {
  const corrupt = { year: YEAR, entries: 'not an array' };
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), corrupt);

  assert.deepEqual(await appendReconciliationEntry(YEAR, entry()), { status: 'malformed' });
  assert.deepEqual(
    await storedValue(),
    corrupt,
    'overwriting would erase every pass that had already run and reopen them all'
  );

  // Positive control: the same append against a WELL-FORMED row does write, so
  // the refusal above is the malformed value and not a broken writer.
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: [],
  });
  assert.deepEqual(await appendReconciliationEntry(YEAR, entry()), { status: 'appended' });
});

test('the season row has a hard ceiling, and reaching it writes nothing', async () => {
  const full = Array.from({ length: RECONCILIATION_LEDGER_MAX_ENTRIES }, (_, i) =>
    entry({
      partitionKey: `2025:${i}:regular`,
      reachedIngestion: false,
      outcome: 'failure',
      reason: 'x',
    })
  );
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: full,
  });
  assert.deepEqual(
    await appendReconciliationEntry(YEAR, entry({ partitionKey: '2025:999:regular' })),
    {
      status: 'ledger-full',
    }
  );
  const read = await readReconciliationLedger(YEAR);
  assert.equal(
    read.status === 'ok' ? read.ledger.entries.length : -1,
    RECONCILIATION_LEDGER_MAX_ENTRIES
  );
});

test('a store write failure is reported, never thrown at the caller', async () => {
  __setAppStateWriteFailureForTests(new Error('write refused'), RECONCILIATION_LEDGER_SCOPE);
  assert.deepEqual(await appendReconciliationEntry(YEAR, entry()), { status: 'write-failed' });
});

test('a read failure INSIDE the append transaction reports write-failed and writes nothing', async () => {
  // A store fault at the transaction's read is indistinguishable to the caller
  // from one at its write: either way the attempt was not recorded, so the pass
  // stays due and a later run repeats one call.
  await appendReconciliationEntry(
    YEAR,
    entry({ partitionKey: '2025:1:regular', reachedIngestion: true })
  );
  const before = await storedValue();

  __setAppStateReadFailureForTests(new Error('store down'), RECONCILIATION_LEDGER_SCOPE);
  assert.deepEqual(await appendReconciliationEntry(YEAR, entry()), { status: 'write-failed' });

  __setAppStateReadFailureForTests(null);
  assert.deepEqual(await storedValue(), before, 'nothing was written');
});
