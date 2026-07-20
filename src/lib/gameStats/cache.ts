import type { CfbdSeasonType } from '../cfbd.ts';
import {
  getAppState,
  getAppStateEntries,
  listAppStateKeys,
  withAppStateKeyTransaction,
} from '../server/appStateStore.ts';
import {
  ACTIVATION_CONTROL_KEY,
  ACTIVATION_CONTROL_SCOPE,
  REVISIONED_EVIDENCE_WITNESS_KEY,
  classifyLegacyWrite,
  toControlRead,
  witnessSurvives,
  type ActivationState,
} from './activationControl.ts';
import type { WeeklyGameStats } from './types.ts';

const SCOPE = 'game-stats';
// Mirror of `revisionAuthority.GAME_STATS_REVISION_SCOPE` as a literal — the
// dormant revision authority may not be imported by this live cache module, but
// the fenced legacy writer must detect a surviving revision ledger for the
// partition it is about to overwrite.
const REVISION_LEDGER_SCOPE = 'game-stats-revision';

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
 * Typed outcome of the fenced legacy write. A refusal writes nothing and
 * preserves all durable state (PLATFORM-086H3B-ACTIVATION-DORMANCY-REMEDIATION).
 */
export type LegacyWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'fenced-non-legacy' | 'fenced-revision-history' | 'fenced-malformed';
      state: ActivationState;
    }
  | { ok: false; reason: 'store-unavailable' };

/** Thrown by `setCachedGameStats` when the activation fence refuses the write. */
export class GameStatsFenceError extends Error {
  readonly result: Exclude<LegacyWriteResult, { ok: true }>;
  constructor(result: Exclude<LegacyWriteResult, { ok: true }>) {
    super(
      `game-stats legacy write refused by activation fence: ${result.reason}` +
        ('state' in result ? ` (state=${result.state})` : '')
    );
    this.name = 'GameStatsFenceError';
    this.result = result;
  }
}

/**
 * Persist a legacy (pre-revision) weekly partition through the DURABLE activation
 * fence. The whole check-and-write runs in ONE transaction: it roots at the
 * evidence partition E(P), acquires the activation-control lock (forward order —
 * `game-stats` sorts below `game-stats-activation-control`), re-reads the
 * activation record + the durable global witness + this partition's revision
 * ledger under both locks, and writes ONLY when the fence resolves to `legacy`
 * with no surviving revision history. A transition that changed the state first
 * causes this write to observe the new state (read under the just-acquired lock)
 * and refuse; a write that validates the fence first commits before the
 * transition can acquire the lock.
 *
 * Behavior-equivalent to the pre-remediation blind write while the fence is
 * validly `legacy`: the stored partition bytes are identical (only extra reads
 * are added). Returns a typed result; `setCachedGameStats` throws on refusal.
 */
export async function writeLegacyGameStatsPartition(
  stats: WeeklyGameStats
): Promise<LegacyWriteResult> {
  const key = getGameStatsKey(stats.year, stats.week, stats.seasonType);
  try {
    return await withAppStateKeyTransaction<LegacyWriteResult>(SCOPE, key, async (txn) => {
      await txn.lockKey(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
      // PRESENCE-AWARE reads: a present-null / malformed control row is NEVER
      // treated as absence (PLATFORM-086H3B-ACTIVATION-STATE-CORRUPTION-REMEDIATION).
      const activation = toControlRead(
        await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY)
      );
      const survives = witnessSurvives(
        toControlRead(
          await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY)
        )
      );
      const existing = (await txn.read<WeeklyGameStats>())?.value ?? null;
      const ledgerRow = await txn.readKey<unknown>(REVISION_LEDGER_SCOPE, key);
      // Per-partition revision history: a surviving commit stamp (own-property) or
      // ANY present revision-ledger ROW — valid, or a revision-era marker (incl. a
      // present JSON-null value). Presence, not value, decides.
      const partitionHasRevisionHistory =
        (existing !== null && Object.prototype.hasOwnProperty.call(existing, 'commitStamp')) ||
        ledgerRow !== null;
      const gate = classifyLegacyWrite(activation, survives, partitionHasRevisionHistory);
      if (!gate.allow) return { ok: false, reason: gate.reason, state: gate.state };
      await txn.write(stats);
      return { ok: true };
    });
  } catch {
    return { ok: false, reason: 'store-unavailable' };
  }
}

/**
 * The production legacy game-stats cache writer — now routed through the durable
 * activation fence (no longer a blind partition overwrite). Preserves the prior
 * `Promise<void>` contract while the fence is validly `legacy`; throws
 * `GameStatsFenceError` when the fence refuses (armed/active/read-only-safe, a
 * malformed record, or surviving revision history), so a stale/misconfigured
 * deploy can never reintroduce blind legacy writing alongside revisioned
 * evidence. In production the fence is `legacy` (B arms/activates nothing), so
 * this behaves exactly as before.
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
