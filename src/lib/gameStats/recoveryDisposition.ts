import type { CfbdSeasonType } from '../cfbd.ts';
import { getAppState, getAppStateEntries, setAppState } from '../server/appStateStore.ts';
import type { GameStatsRefreshDispositionReason } from './refreshPublication.ts';

/**
 * PLATFORM-086H3 — durable per-partition recovery disposition (ACTIVE).
 *
 * "At most one provider request per cron run" alone cannot prevent the SAME
 * unresolved partition from being selected on every run forever, starving
 * older candidates and spending quota on a partition that cannot currently
 * improve. This module persists a small, typed disposition per weekly
 * partition so recovery is bounded ACROSS runs:
 *
 *   - every resolved attempt records its reason, attempt count, backoff
 *     tier, and next-eligible time;
 *   - unresolved outcomes (provider unavailable, invalid payload, schema
 *     drift, unexpected empty, unmatched/mismatched/unresolved observations,
 *     no-persistable, merge conflict, durable unavailable/indeterminate,
 *     stale/unchanged-insufficient, post-commit reread failure) escalate a
 *     deterministic backoff tier;
 *   - meaningful progress (accepted durable evidence) resets the tier, and a
 *     satisfied partition CLEARS its disposition;
 *   - recovery planning selects the newest ELIGIBLE candidate, so a
 *     backed-off newer partition rotates selection to older eligible ones.
 *
 * This state is operational bookkeeping, deliberately stored in its own
 * scope (`game-stats-recovery`) — it is never game-stat evidence, never
 * merged into partitions, and never surfaced as provider facts. Writes go
 * through the ordinary app-state setter because this scope is NOT a
 * game-stats partition; the activation guard keeps the `game-stats` evidence
 * scope writable only by the durable merge authority.
 */

const RECOVERY_SCOPE = 'game-stats-recovery';

/**
 * Deterministic backoff tiers (ms). The weekly cron cadence means most tiers
 * only matter for manually triggered or catch-up runs — the invariant is that
 * an immediately repeated run NEVER refetches the same unresolved partition.
 */
export const RECOVERY_BACKOFF_TIERS_MS: readonly number[] = [
  30 * 60 * 1000, // 30m
  2 * 60 * 60 * 1000, // 2h
  8 * 60 * 60 * 1000, // 8h
  24 * 60 * 60 * 1000, // 24h
  3 * 24 * 60 * 60 * 1000, // 3d
  7 * 24 * 60 * 60 * 1000, // 7d (cap)
];

export type GameStatsRecoveryDispositionRecord = {
  /** `${year}:${week}:${seasonType}` — the durable partition this describes. */
  partitionKey: string;
  attemptCount: number;
  lastAttemptAt: string;
  lastReason: GameStatsRefreshDispositionReason;
  /** Index into RECOVERY_BACKOFF_TIERS_MS (clamped). */
  backoffTier: number;
  /** ISO time the partition becomes selectable again; null → terminal. */
  nextEligibleAt: string | null;
  /**
   * Set when automatic recovery cannot help (the partition needs operator
   * action or a schedule change); planning skips it until state changes.
   */
  terminal?: 'manual-action';
  /** Last time the attempt produced meaningful durable progress (or satisfied). */
  lastMeaningfulChangeAt: string | null;
};

export function gameStatsRecoveryKey(
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): string {
  return `${year}:${week}:${seasonType}`;
}

export async function readGameStatsRecoveryDispositions(
  year: number
): Promise<Map<string, GameStatsRecoveryDispositionRecord>> {
  const entries = await getAppStateEntries<GameStatsRecoveryDispositionRecord | null>(
    RECOVERY_SCOPE,
    `${year}:`
  );
  const byKey = new Map<string, GameStatsRecoveryDispositionRecord>();
  for (const entry of entries) {
    // A cleared (satisfied) disposition is stored as null — unconstrained.
    if (entry.value) byKey.set(entry.key, entry.value);
  }
  return byKey;
}

export async function readGameStatsRecoveryDisposition(
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): Promise<GameStatsRecoveryDispositionRecord | null> {
  const record = await getAppState<GameStatsRecoveryDispositionRecord>(
    RECOVERY_SCOPE,
    gameStatsRecoveryKey(year, week, seasonType)
  );
  return record?.value ?? null;
}

/** Whether a disposition permits selecting its partition at `now`. */
export function isRecoveryEligible(
  disposition: GameStatsRecoveryDispositionRecord | null | undefined,
  now: number
): boolean {
  if (!disposition) return true;
  if (disposition.terminal) return false;
  if (disposition.nextEligibleAt === null) return false;
  const eligibleMs = Date.parse(disposition.nextEligibleAt);
  return !Number.isFinite(eligibleMs) || eligibleMs <= now;
}

/**
 * Record one resolved refresh attempt for a partition.
 *
 *   - `satisfied` → the disposition is CLEARED (an empty record marks the
 *     partition unconstrained; a later gap starts fresh);
 *   - meaningful progress (`meaningfulChange`) → tier resets to 0 (base
 *     backoff still applies so an immediately repeated run stays bounded);
 *   - anything else → tier escalates one step (capped).
 */
export async function recordGameStatsRecoveryAttempt(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  reason: GameStatsRefreshDispositionReason;
  meaningfulChange: boolean;
  now: number;
}): Promise<GameStatsRecoveryDispositionRecord | null> {
  const { year, week, seasonType, reason, meaningfulChange, now } = params;
  const key = gameStatsRecoveryKey(year, week, seasonType);

  if (reason === 'satisfied') {
    // Durable evidence is sufficient: clear the constraint entirely.
    await setAppState(RECOVERY_SCOPE, key, null);
    return null;
  }

  const prior = await readGameStatsRecoveryDisposition(year, week, seasonType);
  const priorTier = prior && !prior.terminal ? prior.backoffTier : -1;
  const tier = meaningfulChange ? 0 : Math.min(priorTier + 1, RECOVERY_BACKOFF_TIERS_MS.length - 1);
  const record: GameStatsRecoveryDispositionRecord = {
    partitionKey: key,
    attemptCount: (prior?.attemptCount ?? 0) + 1,
    lastAttemptAt: new Date(now).toISOString(),
    lastReason: reason,
    backoffTier: tier,
    nextEligibleAt: new Date(now + RECOVERY_BACKOFF_TIERS_MS[tier]!).toISOString(),
    lastMeaningfulChangeAt: meaningfulChange
      ? new Date(now).toISOString()
      : (prior?.lastMeaningfulChangeAt ?? null),
  };
  await setAppState(RECOVERY_SCOPE, key, record);
  return record;
}
