import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AppStateKeyLockAcquireError,
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  AppStateTxnLockOrderError,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateFileCommitFailureForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';
import { initializeWriterControl } from '../../../../scripts/init-game-stats-writer-control.ts';
import {
  GameStatsFenceError,
  classifyWriteFailure,
  getCachedGameStats,
  isFenceProgrammingError,
  setCachedGameStats,
  writeLegacyGameStatsPartition,
} from '../cache.ts';
import type { WeeklyGameStats } from '../types.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_RECORD_VERSION,
  WRITER_CONTROL_SCOPE,
  classifyLegacyWrite,
  initialLegacyWriterControl,
  parseWriterControl,
  toWriterControlRead,
} from '../writerFence.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

const BASE = { year: 2024, week: 6, seasonType: 'regular' as const };
const T1 = '2024-10-07T00:00:00.000Z';
const T2 = '2024-10-08T00:00:00.000Z';

function partition(fetchedAt: string, id = 401_000_001): WeeklyGameStats {
  return { ...BASE, fetchedAt, games: [legacyRowFromWire(wireGame({ id }))] };
}

async function seedControl(value: unknown): Promise<void> {
  await setAppState(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY, value);
}
async function seedLegacy(): Promise<void> {
  await seedControl(initialLegacyWriterControl());
}
/** The raw stored control value, or the sentinel `'__ABSENT__'` when no row exists. */
async function controlRaw(): Promise<unknown> {
  const row = await getAppState<unknown>(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY);
  return row === null ? '__ABSENT__' : row.value;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// === Strict record parsing ===

test('writerFence: parseWriterControl accepts every valid state and reconstructs a fresh record', () => {
  for (const state of ['legacy', 'armed', 'active', 'read-only-safe'] as const) {
    const parsed = parseWriterControl({ recordVersion: WRITER_CONTROL_RECORD_VERSION, state });
    assert.deepEqual(parsed, { recordVersion: WRITER_CONTROL_RECORD_VERSION, state });
  }
});

test('writerFence: parseWriterControl rejects every malformed shape (no lenient coercion)', () => {
  const bad: unknown[] = [
    null,
    undefined,
    42,
    'legacy',
    true,
    [],
    [{ recordVersion: 1, state: 'legacy' }],
    {}, // missing fields
    { state: 'legacy' }, // missing version
    { recordVersion: 1 }, // missing state
    { recordVersion: 2, state: 'legacy' }, // unknown version
    { recordVersion: 1, state: 'unknown' }, // unsupported state
    { recordVersion: 1, state: 'legacy', extra: 1 }, // extra field
    { recordVersion: '1', state: 'legacy' }, // wrong version type
  ];
  for (const value of bad) assert.equal(parseWriterControl(value), null, JSON.stringify(value));
});

test('writerFence: classifyLegacyWrite is presence-aware — absent and malformed are NOT legacy', () => {
  assert.deepEqual(classifyLegacyWrite({ present: false }), {
    allow: false,
    reason: 'writer-control-absent',
  });
  assert.deepEqual(classifyLegacyWrite({ present: true, record: null }), {
    allow: false,
    reason: 'writer-control-malformed',
  });
  assert.deepEqual(classifyLegacyWrite({ present: true, record: initialLegacyWriterControl() }), {
    allow: true,
  });
  for (const state of ['armed', 'active', 'read-only-safe'] as const) {
    assert.deepEqual(classifyLegacyWrite({ present: true, record: { recordVersion: 1, state } }), {
      allow: false,
      reason: 'writer-control-not-legacy',
      state,
    });
  }
});

test('writerFence: toWriterControlRead distinguishes absent / present-null / valid', () => {
  assert.deepEqual(toWriterControlRead(null), { present: false });
  assert.deepEqual(toWriterControlRead({ value: null }), { present: true, record: null });
  assert.deepEqual(toWriterControlRead({ value: { recordVersion: 1, state: 'legacy' } }), {
    present: true,
    record: { recordVersion: 1, state: 'legacy' },
  });
});

// === Valid-legacy write behavior (parity) ===

test('fenced writer: a valid legacy control permits the write with byte-identical stored shape', async () => {
  await seedLegacy();
  const p = partition(T1);
  const result = await writeLegacyGameStatsPartition(p);
  assert.deepEqual(result, { ok: true });
  const stored = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
  assert.deepEqual(stored, p); // no revision / lineage / commit-stamp / activation metadata added
  assert.equal('commitStamp' in (stored as object), false);
});

test('fenced writer: first write to an empty partition commits under valid legacy', async () => {
  await seedLegacy();
  assert.equal(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), null);
  await setCachedGameStats(partition(T1));
  const stored = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
  assert.ok(stored);
  assert.equal(stored!.fetchedAt, T1);
});

test('fenced writer: lock order is partition-before-control (a valid legacy write does not violate ordering)', async () => {
  // The partition E(P) is the auto-locked primary; the writer-control key sorts
  // strictly above it, so `lockKey(writer-control)` is a forward acquisition. If the
  // order were inverted this write would fail with a lock-order error; success proves
  // the canonical order holds.
  await seedLegacy();
  const result = await writeLegacyGameStatsPartition(partition(T1));
  assert.deepEqual(result, { ok: true });
});

test('fenced writer: same-partition writes serialize into one atomic (non-torn) result', async () => {
  await seedLegacy();
  const [r1, r2] = await Promise.all([
    writeLegacyGameStatsPartition(partition(T1, 401_000_001)),
    writeLegacyGameStatsPartition(partition(T2, 401_000_002)),
  ]);
  assert.deepEqual(r1, { ok: true });
  assert.deepEqual(r2, { ok: true });
  const stored = await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
  // Exactly one of the two full partitions is stored — never an interleaved mix.
  const isP1 = stored?.fetchedAt === T1 && stored?.games[0]?.providerGameId === 401_000_001;
  const isP2 = stored?.fetchedAt === T2 && stored?.games[0]?.providerGameId === 401_000_002;
  assert.ok(isP1 !== isP2 && (isP1 || isP2), 'stored partition is exactly one coherent write');
});

test('fenced writer: an unrelated partition is untouched while a write holds the control lock', async () => {
  await seedLegacy();
  const other = {
    ...BASE,
    week: 7,
    fetchedAt: T1,
    games: [legacyRowFromWire(wireGame({ id: 9 }))],
  };
  await setCachedGameStats(other);
  await setCachedGameStats(partition(T2)); // week 6, holds the brief global control lock
  const storedOther = await getCachedGameStats(BASE.year, 7, BASE.seasonType);
  assert.deepEqual(storedOther, other); // week 7 preserved exactly
});

// === Refusals (no mutation on any) ===

/** The primary game-stats partition key for BASE. */
const PARTITION_KEY = `${BASE.year}:${BASE.week}:${BASE.seasonType}`;

test('fenced writer: absent control refuses and mutates nothing', async () => {
  // Prior-good partition exists (seeded blind), but NO control row.
  const prior = partition('2024-10-01T00:00:00.000Z');
  await setAppState('game-stats', PARTITION_KEY, prior);
  const result = await writeLegacyGameStatsPartition(partition(T2));
  assert.deepEqual(result, { ok: false, reason: 'writer-control-absent' });
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), prior);
  await assert.rejects(setCachedGameStats(partition(T2)), (e) => e instanceof GameStatsFenceError);
});

test('fenced writer: malformed control refuses and mutates nothing', async () => {
  const prior = partition('2024-10-01T00:00:00.000Z');
  await seedControl({ recordVersion: 1, state: 'legacy', extra: true }); // malformed (extra field)
  // Seed prior partition directly (blind) so a prior-good exists.
  await setAppState('game-stats', `${BASE.year}:${BASE.week}:${BASE.seasonType}`, prior);
  const result = await writeLegacyGameStatsPartition(partition(T2));
  assert.deepEqual(result, { ok: false, reason: 'writer-control-malformed' });
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), prior);
});

for (const state of ['armed', 'active', 'read-only-safe'] as const) {
  test(`fenced writer: '${state}' control refuses and mutates nothing`, async () => {
    const prior = partition('2024-10-01T00:00:00.000Z');
    await seedControl({ recordVersion: 1, state });
    await setAppState('game-stats', `${BASE.year}:${BASE.week}:${BASE.seasonType}`, prior);
    const result = await writeLegacyGameStatsPartition(partition(T2));
    assert.deepEqual(result, { ok: false, reason: 'writer-control-not-legacy', state });
    assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), prior);
    await assert.rejects(
      setCachedGameStats(partition(T2)),
      (e) => e instanceof GameStatsFenceError
    );
  });
}

// === Failure paths never report success ===

test('fenced writer: a lock-acquisition failure is store-unavailable, not success', async () => {
  await seedLegacy();
  const prior = partition('2024-10-01T00:00:00.000Z');
  await setCachedGameStats(prior);
  __setAppStateKeyLockFailureForTests(new Error('lock down'), null);
  const result = await writeLegacyGameStatsPartition(partition(T2));
  __setAppStateKeyLockFailureForTests(null, null);
  assert.deepEqual(result, { ok: false, reason: 'store-unavailable' });
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), prior);
});

test('fenced writer: a callback (read) failure rolls back to store-unavailable with no mutation', async () => {
  await seedLegacy();
  const prior = partition('2024-10-01T00:00:00.000Z');
  await setCachedGameStats(prior);
  __setAppStateReadFailureForTests(new Error('read down'));
  const result = await writeLegacyGameStatsPartition(partition(T2));
  __setAppStateReadFailureForTests(null);
  assert.deepEqual(result, { ok: false, reason: 'store-unavailable' });
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), prior);
});

test('fenced writer: a proven-nothing-durable commit failure is store-unavailable', async () => {
  await seedLegacy();
  const prior = partition('2024-10-01T00:00:00.000Z');
  await setCachedGameStats(prior);
  __setAppStateFileCommitFailureForTests(new Error('commit down'));
  const result = await writeLegacyGameStatsPartition(partition(T2));
  __setAppStateFileCommitFailureForTests(null);
  // The file-fallback atomic rename proves NOTHING staged became durable
  // (`writeAttempted: false`), so this is known-unchanged — prior partition intact.
  assert.deepEqual(result, { ok: false, reason: 'store-unavailable' });
  assert.deepEqual(await getCachedGameStats(BASE.year, BASE.week, BASE.seasonType), prior);
});

test('cache: classifyWriteFailure separates indeterminate commits from known-unchanged failures', () => {
  // A finalize/cleanup failure that SUBMITTED mutation SQL is indeterminate (the
  // commit may be durable) — never claim byte preservation for it.
  assert.equal(
    classifyWriteFailure(new AppStateTxnFinalizeError(new Error('lost ack'), true, false)),
    'store-indeterminate'
  );
  assert.equal(
    classifyWriteFailure(new AppStateTxnCleanupError(new Error('c'), new Error('r'), true, false)),
    'store-indeterminate'
  );
  // A finalize proving nothing was submitted, a lock-acquisition failure, and any
  // other error are known-unchanged.
  assert.equal(
    classifyWriteFailure(new AppStateTxnFinalizeError(new Error('none'), false, false)),
    'store-unavailable'
  );
  assert.equal(
    classifyWriteFailure(new AppStateKeyLockAcquireError(new Error('lock'))),
    'store-unavailable'
  );
  assert.equal(classifyWriteFailure(new Error('generic')), 'store-unavailable');
});

test('cache: a lock-order programming error is surfaced loudly, not masked as a store failure', () => {
  // The fence re-throws `AppStateTxnLockOrderError` (a canonical-order regression)
  // instead of collapsing it into a retryable-looking `store-unavailable`.
  assert.equal(
    isFenceProgrammingError(new AppStateTxnLockOrderError('["a","b"]', '["c","d"]')),
    true
  );
  assert.equal(
    isFenceProgrammingError(new AppStateTxnFinalizeError(new Error('x'), true, false)),
    false
  );
  assert.equal(isFenceProgrammingError(new AppStateKeyLockAcquireError(new Error('x'))), false);
  assert.equal(isFenceProgrammingError(new Error('generic')), false);
});

// === Initializer (create-if-absent only) ===

test('initializer: dry-run against an absent row would-create and writes nothing', async () => {
  const outcome = await initializeWriterControl({ apply: false });
  assert.deepEqual(outcome, { action: 'would-create' });
  assert.equal(await controlRaw(), '__ABSENT__');
});

test('initializer: apply against an absent row creates the initial legacy record', async () => {
  const outcome = await initializeWriterControl({ apply: true });
  assert.deepEqual(outcome, { action: 'created' });
  assert.deepEqual(await controlRaw(), initialLegacyWriterControl());
});

test('initializer: apply is an idempotent no-op when a valid legacy record already exists', async () => {
  await seedLegacy();
  const outcome = await initializeWriterControl({ apply: true });
  assert.deepEqual(outcome, { action: 'noop-valid-legacy' });
  assert.deepEqual(await controlRaw(), initialLegacyWriterControl());
});

test('initializer: refuses a malformed record and never edits it', async () => {
  const malformed = { recordVersion: 9, state: 'legacy' };
  await seedControl(malformed);
  const outcome = await initializeWriterControl({ apply: true });
  assert.deepEqual(outcome, { action: 'refused-malformed' });
  assert.deepEqual(await controlRaw(), malformed);
});

test('initializer: refuses a non-legacy record and never transitions it', async () => {
  const armed = { recordVersion: 1, state: 'armed' };
  await seedControl(armed);
  const outcome = await initializeWriterControl({ apply: true });
  assert.deepEqual(outcome, { action: 'refused-not-legacy', state: 'armed' });
  assert.deepEqual(await controlRaw(), armed);
});

test('initializer: concurrent applies are atomic — exactly one creates, the other is a truthful no-op', async () => {
  // Both run the read-and-create inside one transaction rooted on the control key, so
  // they serialize: the first creates `legacy`, the second rereads and no-ops. A
  // second unconditional write can never overwrite the first-established record.
  const [a, b] = await Promise.all([
    initializeWriterControl({ apply: true }),
    initializeWriterControl({ apply: true }),
  ]);
  assert.deepEqual([a.action, b.action].sort(), ['created', 'noop-valid-legacy']);
  assert.deepEqual(await controlRaw(), initialLegacyWriterControl());
});

// === Boundaries: live-path ownership + H1/H2 dormancy (source-level) ===

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('boundary: the live game-stats route and cron still write via the legacy setter', () => {
  for (const rel of ['src/app/api/game-stats/route.ts', 'src/app/api/cron/game-stats/route.ts']) {
    const src = read(rel);
    assert.match(src, /setCachedGameStats/, `${rel} uses setCachedGameStats`);
    assert.doesNotMatch(src, /writerFence/, `${rel} does not reach the fence directly`);
  }
});

test('boundary: the fence + fenced writer import no dormant H1/H2 module', () => {
  for (const rel of ['src/lib/gameStats/writerFence.ts', 'src/lib/gameStats/cache.ts']) {
    const src = read(rel);
    assert.doesNotMatch(src, /from '\.\/contract\.ts'|from '\.\/durableMerge\.ts'/, rel);
    assert.doesNotMatch(
      src,
      /revisionAuthority|revisionRepair|activationControl|mergeGameStatsPartition/,
      rel
    );
    // The control record is deliberately NOT the dormant row `schemaVersion`.
    assert.doesNotMatch(
      src,
      /\bschemaVersion\b/,
      `${rel} must not reference the dormant schemaVersion`
    );
  }
});
