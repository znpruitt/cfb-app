import type { CfbdSeasonType } from '../cfbd.ts';
import {
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  AppStateTxnLockOrderError,
  getAppState,
  getAppStateEntries,
  listAppStateKeys,
  withAppStateKeyTransaction,
} from '../server/appStateStore.ts';
import type { WeeklyGameStats } from './types.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_SCOPE,
  classifyLegacyWrite,
  toWriterControlRead,
  type WriterControlState,
} from './writerFence.ts';

const SCOPE = 'game-stats';

export function getGameStatsKey(year: number, week: number, seasonType: CfbdSeasonType): string {
  return `${year}:${week}:${seasonType}`;
}

export async function getCachedGameStats(
  year: number,
  week: number,
  seasonType: CfbdSeasonType = 'regular'
): Promise<WeeklyGameStats | null> {
  const key = getGameStatsKey(year, week, seasonType);
  const stored = await getAppState<WeeklyGameStats>(SCOPE, key);
  return stored?.value ?? null;
}

/**
 * Typed outcome of the fenced legacy write. No result is a successful persistence
 * except `ok: true`, but the failure kinds differ in what they claim about durability:
 * - `writer-control-*` and `store-unavailable` are KNOWN-UNCHANGED — the fence refused
 *   before staging, or the transaction provably persisted nothing, so the existing
 *   partition is preserved byte-for-byte.
 * - `store-indeterminate` is UNCERTAIN — mutation SQL was submitted but the COMMIT
 *   acknowledgement was lost (prerequisite A's `writeAttempted: true`), so the new
 *   partition MAY be durable. The write is never reported as successful, but callers
 *   and operators must NOT assume the prior partition is intact.
 */
export type LegacyWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'writer-control-absent' | 'writer-control-malformed';
    }
  | { ok: false; reason: 'writer-control-not-legacy'; state: WriterControlState }
  | { ok: false; reason: 'store-unavailable' }
  | { ok: false; reason: 'store-indeterminate' };

/**
 * Classify a thrown transaction error into a refusal reason. A finalize/cleanup
 * failure that SUBMITTED mutation SQL (`writeAttempted`) is `store-indeterminate` (the
 * commit may have persisted); every other failure — a lock-acquisition failure, a
 * callback failure, or a finalize that proves nothing was submitted — is
 * `store-unavailable` (known-unchanged).
 */
export function classifyWriteFailure(error: unknown): 'store-unavailable' | 'store-indeterminate' {
  if (
    (error instanceof AppStateTxnFinalizeError || error instanceof AppStateTxnCleanupError) &&
    error.writeAttempted
  ) {
    return 'store-indeterminate';
  }
  return 'store-unavailable';
}

/**
 * Whether a thrown transaction error indicates a PROGRAMMING bug rather than a store
 * condition. A violated canonical lock order (`AppStateTxnLockOrderError`) is only
 * reachable if the fence's fixed lock order is changed incorrectly — it must surface
 * loudly, never be masked as a transient `store-unavailable` that looks retryable.
 */
export function isFenceProgrammingError(error: unknown): boolean {
  return error instanceof AppStateTxnLockOrderError;
}

/** Thrown by `setCachedGameStats` when the writer-control fence refuses the write. */
export class GameStatsFenceError extends Error {
  readonly result: Exclude<LegacyWriteResult, { ok: true }>;
  constructor(result: Exclude<LegacyWriteResult, { ok: true }>) {
    super(
      `game-stats legacy write refused by writer-control fence: ${result.reason}` +
        ('state' in result ? ` (state=${result.state})` : '')
    );
    this.name = 'GameStatsFenceError';
    this.result = result;
  }
}

/**
 * Persist one legacy weekly partition through the durable writer-control fence. The
 * whole check-and-write is ONE transaction: it roots EXCLUSIVE on the partition key
 * E(P), takes the writer-control key G EXCLUSIVE (`lockKey` — canonical forward
 * order, `game-stats` sorts below `game-stats-writer-control`), re-reads the
 * writer-control record UNDER both locks, and writes the partition ONLY when that
 * record is exactly a valid `legacy`. An absent, malformed, `armed`, `active`, or
 * `read-only-safe` record refuses and writes nothing.
 *
 * Same-partition legacy writes therefore serialize across PostgreSQL-backed
 * instances (the primary key's `pg_advisory_xact_lock`), and a future rollout that
 * flips the control record to a non-`legacy` state stops this writer without a code
 * change. Provider fetch / retry / normalization / classification all happen BEFORE
 * this call — the transaction holds no provider or schedule work.
 *
 * While the record is validly `legacy` (its production state until E), the stored
 * partition bytes are IDENTICAL to the prior blind write — no revision, lineage,
 * commit-stamp, or activation metadata is added; only the extra fence read is.
 */
export async function writeLegacyGameStatsPartition(
  stats: WeeklyGameStats
): Promise<LegacyWriteResult> {
  const key = getGameStatsKey(stats.year, stats.week, stats.seasonType);
  try {
    return await withAppStateKeyTransaction<LegacyWriteResult>(SCOPE, key, async (txn) => {
      // Partition E(P) is the auto-locked primary; take writer-control G EXCLUSIVE
      // (sorts strictly above the partition identity, so lock order is satisfied).
      await txn.lockKey(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY);
      // PRESENCE-AWARE read: an absent row (null) and a present-malformed value are
      // distinct, and NEITHER is treated as `legacy`.
      const gate = classifyLegacyWrite(
        toWriterControlRead(await txn.readKey<unknown>(WRITER_CONTROL_SCOPE, WRITER_CONTROL_KEY))
      );
      if (!gate.allow) {
        return gate.reason === 'writer-control-not-legacy'
          ? { ok: false, reason: gate.reason, state: gate.state }
          : { ok: false, reason: gate.reason };
      }
      await txn.write(stats);
      return { ok: true };
    });
  } catch (error) {
    // A lock-order violation is a PROGRAMMING error (the canonical order is fixed and
    // statically correct) — re-throw it loudly instead of masking it as a transient
    // store failure. Every genuine store failure is classified and never reported as
    // success: a lock-acquisition / callback / provably-nothing-submitted failure is
    // `store-unavailable` (prior partition intact); a lost-COMMIT acknowledgement after
    // mutation SQL was submitted is `store-indeterminate` (the new partition MAY be
    // durable). The caller records a refresh failure and retries on the next poll.
    if (isFenceProgrammingError(error)) throw error;
    return { ok: false, reason: classifyWriteFailure(error) };
  }
}

/**
 * The production legacy game-stats cache writer — now routed through the durable
 * writer-control fence (no longer a blind partition overwrite). Preserves the prior
 * `Promise<void>` contract and the exact stored weekly envelope shape while the fence
 * is validly `legacy`; throws `GameStatsFenceError` when the fence refuses (absent /
 * malformed / non-`legacy` control, or a store failure — `store-unavailable` or
 * `store-indeterminate`), so a rollout that has armed the control — or a store
 * failure — can never be mistaken for a successful write. In production the control is
 * `legacy` (nothing arms it before E), so this behaves exactly as before.
 */
export async function setCachedGameStats(stats: WeeklyGameStats): Promise<void> {
  const result = await writeLegacyGameStatsPartition(stats);
  if (!result.ok) throw new GameStatsFenceError(result);
}

export async function listCachedGameStatsWeeks(year: number): Promise<string[]> {
  const allKeys = await listAppStateKeys(SCOPE);
  const prefix = `${year}:`;
  return allKeys.filter((k) => k.startsWith(prefix));
}

/**
 * Every cached weekly game-stats RECORD for a year (not just its keys), in one
 * durable read. Provider-data diagnostics use this to judge coverage by actual
 * game content instead of key existence (PLATFORM-086A 4th-review finding #3).
 */
export async function listCachedGameStats(year: number): Promise<WeeklyGameStats[]> {
  const entries = await getAppStateEntries<WeeklyGameStats>(SCOPE, `${year}:`);
  return entries.map((entry) => entry.value);
}
