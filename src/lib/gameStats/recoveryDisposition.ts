import { randomUUID } from 'node:crypto';

import type { CfbdSeasonType } from '../cfbd.ts';
import {
  getAppState,
  getAppStateEntries,
  withAppStateKeyTransaction,
} from '../server/appStateStore.ts';
import type { GameStatsRefreshDispositionReason } from './refreshPublication.ts';

/**
 * PLATFORM-086H3 — durable, fenced per-partition recovery claims (ACTIVE).
 *
 * "At most one provider request per cron run" alone cannot prevent duplicate
 * provider spending under OVERLAPPING executions, nor stop the same
 * unresolved partition from being reselected forever. This module owns ALL
 * recovery-metadata mutation (the activation guard enforces that ownership)
 * and makes it concurrency-safe with the SAME transaction-scoped per-key lock
 * primitive the evidence authority uses — applied to the recovery-metadata
 * key, never to evidence, and NEVER held across provider access:
 *
 *   transactionally read disposition
 *   → verify eligibility and absence of an active (unexpired) claim
 *   → increment the attempt count atomically
 *   → persist a fenced claim (unique attempt token + lease expiry)
 *   → COMMIT
 *   → caller performs the provider fetch OUTSIDE any transaction
 *   → conditional finalization: only the token that owns the active claim
 *     may update or clear the disposition (stale/duplicate completions no-op)
 *
 * Progress is judged ONLY from authoritative before/after state: a committed
 * COVERAGE fingerprint change, or a canonical SCHEDULE expectation
 * fingerprint change. Accepted-row counts, newer observation fences,
 * provider-response completion, and status publication are never progress —
 * a fence-only refresh with unchanged gaps escalates backoff normally.
 *
 * Lease expiry: an abandoned claim (holder died mid-flight) becomes
 * reclaimable only after `leaseExpiresAt`; reclamation issues a NEW token
 * (the old token can no longer finalize), preserves attempt/backoff history,
 * and every claim sets `nextEligibleAt` to at least its own lease expiry, so
 * expiry never enables unbounded immediate retries.
 *
 * This state is operational bookkeeping in its own scope
 * (`game-stats-recovery`) — never game-stat evidence, never merged into
 * partitions, never surfaced as provider facts. Persistence failures here are
 * NOT optional noise: a claim that cannot be persisted must prevent the
 * provider request (the transaction throws to the caller), and a
 * finalization failure propagates so the caller reports it visibly.
 */

const RECOVERY_SCOPE = 'game-stats-recovery';

/** How long a claim owns its partition before it may be reclaimed. */
export const RECOVERY_CLAIM_LEASE_MS = 10 * 60 * 1000;

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
  lastReason: GameStatsRefreshDispositionReason | 'claim-abandoned' | 'claimed';
  /**
   * Applied backoff tier index (into RECOVERY_BACKOFF_TIERS_MS). `-1` means
   * no unresolved-failure history yet.
   */
  backoffTier: number;
  /** ISO time the partition becomes selectable again; null → terminal. */
  nextEligibleAt: string | null;
  /**
   * Set when automatic recovery cannot help (the partition needs operator
   * action); planning skips it until authoritative state changes.
   */
  terminal?: 'manual-action';
  /** Last time an attempt produced meaningful coverage/schedule progress. */
  lastMeaningfulChangeAt: string | null;
  /** Active claim fence — null when no attempt is in flight. */
  attemptToken: string | null;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  /**
   * Committed-coverage fingerprint captured when the ACTIVE claim was
   * acquired (the authoritative BEFORE state), retained after finalization as
   * the latest known committed-coverage fingerprint.
   */
  coverageFingerprint: string | null;
  /** Canonical schedule-expectation fingerprint at the last claim. */
  scheduleFingerprint: string | null;
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

function hasActiveClaim(
  record: GameStatsRecoveryDispositionRecord | null | undefined,
  now: number
): boolean {
  if (!record?.attemptToken || !record.leaseExpiresAt) return false;
  const expires = Date.parse(record.leaseExpiresAt);
  return Number.isFinite(expires) && expires > now;
}

/** Whether a disposition permits selecting its partition at `now`. */
export function isRecoveryEligible(
  disposition: GameStatsRecoveryDispositionRecord | null | undefined,
  now: number
): boolean {
  if (!disposition) return true;
  if (disposition.terminal) return false;
  if (hasActiveClaim(disposition, now)) return false;
  if (disposition.nextEligibleAt === null) return false;
  const eligibleMs = Date.parse(disposition.nextEligibleAt);
  return !Number.isFinite(eligibleMs) || eligibleMs <= now;
}

// === Claim acquisition ===

export type GameStatsRecoveryClaim = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  partitionKey: string;
  attemptToken: string;
  leaseExpiresAt: string;
  attemptCount: number;
  /** Authoritative BEFORE state for progress judgement at finalization. */
  priorCoverageFingerprint: string;
  /** Whether the canonical schedule expectation changed since the last claim. */
  scheduleChanged: boolean;
};

export type GameStatsRecoveryClaimRefusal = {
  claimed: false;
  reason: 'active-claim' | 'backing-off' | 'terminal';
};

export type GameStatsRecoveryClaimResult =
  | { claimed: true; claim: GameStatsRecoveryClaim }
  | GameStatsRecoveryClaimRefusal;

/**
 * Atomically claim one partition for a recovery/refresh attempt. Runs the
 * read→verify→increment→persist sequence inside the per-key transaction lock
 * so overlapping executions cannot both claim the same partition and attempt
 * counts can never lose updates. The transaction never spans provider access
 * — the caller fetches only AFTER the committed claim is returned.
 *
 * `override` (authorized manual refresh — documented operator semantics):
 * skips the backoff/terminal eligibility gates AND takes over an active
 * lease with a NEW token, which fences out the previous claimant's
 * finalization (the stale token can no longer write). Attempt counting and
 * conditional finalization apply identically.
 *
 * A persistence failure here throws — the caller must not contact the
 * provider without a durably committed claim.
 */
export async function claimGameStatsRecoveryPartition(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  now: number;
  coverageFingerprint: string;
  scheduleFingerprint: string;
  override?: boolean;
  leaseMs?: number;
}): Promise<GameStatsRecoveryClaimResult> {
  const { year, week, seasonType, now } = params;
  const leaseMs = params.leaseMs ?? RECOVERY_CLAIM_LEASE_MS;
  const key = gameStatsRecoveryKey(year, week, seasonType);

  return withAppStateKeyTransaction<GameStatsRecoveryClaimResult>(
    RECOVERY_SCOPE,
    key,
    async (txn) => {
      const prior = (await txn.read<GameStatsRecoveryDispositionRecord | null>())?.value ?? null;

      if (!params.override) {
        if (prior?.terminal) return { claimed: false, reason: 'terminal' };
        if (hasActiveClaim(prior, now)) return { claimed: false, reason: 'active-claim' };
        if (prior && prior.nextEligibleAt !== null) {
          const eligibleMs = Date.parse(prior.nextEligibleAt);
          if (Number.isFinite(eligibleMs) && eligibleMs > now) {
            return { claimed: false, reason: 'backing-off' };
          }
        }
        if (prior && prior.nextEligibleAt === null && !prior.terminal && prior.attemptToken) {
          // Defensive: a stuck record without an eligible time behaves as
          // claimed until its lease expires (handled by hasActiveClaim above)
          // or an operator override intervenes.
          return { claimed: false, reason: 'active-claim' };
        }
      }

      const attemptToken = randomUUID();
      const leaseAcquiredAt = new Date(now).toISOString();
      const leaseExpiresAt = new Date(now + leaseMs).toISOString();
      const abandoned =
        prior !== null && prior.attemptToken !== null && !hasActiveClaim(prior, now);
      const scheduleChanged =
        prior?.scheduleFingerprint != null &&
        prior.scheduleFingerprint !== params.scheduleFingerprint;

      const record: GameStatsRecoveryDispositionRecord = {
        partitionKey: key,
        attemptCount: (prior?.attemptCount ?? 0) + 1,
        lastAttemptAt: leaseAcquiredAt,
        lastReason: abandoned ? 'claim-abandoned' : 'claimed',
        backoffTier: prior?.backoffTier ?? -1,
        // Bounded even if this claimant dies: the partition is not selectable
        // again before the lease expires; finalization overwrites this.
        nextEligibleAt: leaseExpiresAt,
        terminal: undefined,
        lastMeaningfulChangeAt: prior?.lastMeaningfulChangeAt ?? null,
        attemptToken,
        leaseAcquiredAt,
        leaseExpiresAt,
        coverageFingerprint: params.coverageFingerprint,
        scheduleFingerprint: params.scheduleFingerprint,
      };
      await txn.write(record);

      return {
        claimed: true,
        claim: {
          year,
          week,
          seasonType,
          partitionKey: key,
          attemptToken,
          leaseExpiresAt,
          attemptCount: record.attemptCount,
          priorCoverageFingerprint: params.coverageFingerprint,
          scheduleChanged,
        },
      };
    }
  );
}

// === Conditional (token-fenced) finalization ===

export type GameStatsRecoveryFinalization =
  | 'finalized'
  | 'cleared'
  /** The token no longer owns the active claim — a newer claim superseded it. */
  | 'stale-token';

/**
 * Finalize one claimed attempt. Only the token that still owns the active
 * claim may write: a late completion from an expired-and-replaced claimant, a
 * duplicate completion, or a stale failure racing a newer claim resolves as
 * `stale-token` and changes NOTHING (late failures cannot overwrite newer
 * success, late successes cannot clear newer failures, and stale completions
 * cannot reduce a newer backoff tier).
 *
 * Backoff policy (authoritative-progress only):
 *   - `satisfied` → the disposition is CLEARED;
 *   - committed-coverage fingerprint changed, or the canonical schedule
 *     expectation changed since the last claim → tier resets to 0;
 *   - otherwise → tier escalates one step (capped) — including fence-only
 *     refreshes and provider calls that changed no usable coverage.
 *
 * A persistence failure propagates to the caller (operationally visible) —
 * finalization is the mechanism enforcing bounded retries, never optional.
 */
export async function finalizeGameStatsRecoveryClaim(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  attemptToken: string;
  reason: GameStatsRefreshDispositionReason;
  now: number;
  /** Post-attempt committed-coverage fingerprint (null when unverifiable). */
  postCoverageFingerprint: string | null;
  priorCoverageFingerprint: string | null;
  scheduleChanged: boolean;
}): Promise<GameStatsRecoveryFinalization> {
  const { year, week, seasonType, now } = params;
  const key = gameStatsRecoveryKey(year, week, seasonType);

  return withAppStateKeyTransaction<GameStatsRecoveryFinalization>(
    RECOVERY_SCOPE,
    key,
    async (txn) => {
      const record = (await txn.read<GameStatsRecoveryDispositionRecord | null>())?.value ?? null;
      if (!record || record.attemptToken !== params.attemptToken) return 'stale-token';

      if (params.reason === 'satisfied') {
        await txn.write(null);
        return 'cleared';
      }

      const coverageImproved =
        params.postCoverageFingerprint !== null &&
        params.priorCoverageFingerprint !== null &&
        params.postCoverageFingerprint !== params.priorCoverageFingerprint;
      const progress = coverageImproved || params.scheduleChanged;
      const tier = progress
        ? 0
        : Math.min(record.backoffTier + 1, RECOVERY_BACKOFF_TIERS_MS.length - 1);

      await txn.write({
        ...record,
        lastReason: params.reason,
        backoffTier: tier,
        nextEligibleAt: new Date(now + RECOVERY_BACKOFF_TIERS_MS[tier]!).toISOString(),
        lastMeaningfulChangeAt: progress
          ? new Date(now).toISOString()
          : record.lastMeaningfulChangeAt,
        attemptToken: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        coverageFingerprint: params.postCoverageFingerprint ?? record.coverageFingerprint,
      } satisfies GameStatsRecoveryDispositionRecord);
      return 'finalized';
    }
  );
}

// === Safe retirement of stale dispositions ===

export type GameStatsRecoveryRetirement = 'cleared' | 'terminal' | 'skipped-active-claim' | 'noop';

/**
 * Conditionally retire a disposition from AUTHORITATIVE planner state:
 * a partition whose committed coverage is satisfied clears its stale
 * disposition; a blocked/manual-only partition transitions to the terminal
 * manual-action state instead of retaining an obsolete retry lease. Never
 * touches a record with an active (unexpired) claim.
 */
export async function retireGameStatsRecoveryDisposition(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  now: number;
  state: 'satisfied' | 'manual-action';
}): Promise<GameStatsRecoveryRetirement> {
  const { year, week, seasonType, now } = params;
  const key = gameStatsRecoveryKey(year, week, seasonType);

  return withAppStateKeyTransaction<GameStatsRecoveryRetirement>(
    RECOVERY_SCOPE,
    key,
    async (txn) => {
      const record = (await txn.read<GameStatsRecoveryDispositionRecord | null>())?.value ?? null;
      if (!record) return 'noop';
      if (hasActiveClaim(record, now)) return 'skipped-active-claim';

      if (params.state === 'satisfied') {
        await txn.write(null);
        return 'cleared';
      }
      if (record.terminal === 'manual-action') return 'noop';
      await txn.write({
        ...record,
        terminal: 'manual-action',
        attemptToken: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        nextEligibleAt: null,
      } satisfies GameStatsRecoveryDispositionRecord);
      return 'terminal';
    }
  );
}
