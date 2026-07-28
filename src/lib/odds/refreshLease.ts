/**
 * PLATFORM-086C1 — the durable, token-safe Odds refresh lease + control record.
 *
 * ONE durable record per exact season-scoped Odds target
 * (`odds-refresh-control/<seasonScopedKey>`) is the single point of
 * duplicate-spend protection every Odds refresh writer shares — the authorized
 * manual refresh today and the FUTURE PLATFORM-086C2 automatic cron. A nonexpired
 * lease refuses a second refresh BEFORE any provider/status work, so two refreshes
 * can never both spend provider credits on the same target.
 *
 * Concurrency contract:
 *   - Acquisition, release, and every backoff/completed-check mutation run inside
 *     `withAppStateKeyTransaction` rooted (and advisory-locked) on the control
 *     key, so overlapping acquirers serialize: at most one wins, the loser is
 *     told `refresh-in-progress`.
 *   - The lease token is a `crypto.randomUUID()` — unguessable and unique across
 *     processes, so two instances acquiring in the same instant cannot collide.
 *   - A lease lasts five minutes. A missing, malformed, or expired lease is
 *     reclaimable (a crashed holder never wedges the target).
 *   - Finalization is TOKEN-CHECKED: only the exact holder may clear or mutate its
 *     own lease. An older holder whose lease was already reclaimed by a newer
 *     refresh writes NOTHING — it can never clear or mutate the newer lease.
 *   - Store failures FAIL SAFE: acquisition maps every store error (including a
 *     commit whose durability is unknown) to `store-unavailable` with NO confirmed
 *     token, so no provider work proceeds; release is best-effort and never masks
 *     the caller's primary response/error (an unreleased lease simply expires).
 *
 * Backoff is DURABLE and AUTOMATIC-only: a billed provider/payload/commit failure
 * advances `automaticFailureCount` and sets `automaticNotBefore`; a success or
 * valid no-op resets both. Missing credentials, quota refusal, context failure,
 * and lease refusal are NOT billed failures — they neither advance nor reset. The
 * manual refresh IGNORES the backoff (it still requires the lease); the automatic
 * cadence (PLATFORM-086C2, dormant) consults `automaticNotBefore` before ever
 * acquiring. This module only PERSISTS the counters — the cadence gate reads them.
 */

import { randomUUID } from 'node:crypto';

import {
  AppStateKeyLockAcquireError,
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  getAppState,
  withAppStateKeyTransaction,
} from '../server/appStateStore.ts';
import type { OddsRefreshLeaseResolution } from './refreshResult.ts';

export const ODDS_REFRESH_CONTROL_SCOPE = 'odds-refresh-control';
/** A lease is valid for five minutes; after that any refresh may reclaim it. */
export const ODDS_LEASE_DURATION_MS = 5 * 60 * 1000;

export type OddsRefreshOwner = 'manual' | 'automatic';

export type OddsRefreshLease = {
  token: string;
  owner: OddsRefreshOwner;
  acquiredAt: string;
  expiresAt: string;
};

export type OddsRefreshControl = {
  lease: OddsRefreshLease | null;
  lastCompletedCheckAt: string | null;
  automaticFailureCount: number;
  automaticNotBefore: string | null;
};

/**
 * The durable automatic backoff schedule (hours), indexed by consecutive
 * failure count: 1h, 2h, 6h, 12h, then 24h for the 5th and beyond.
 */
const BACKOFF_MS_BY_FAILURE: readonly number[] = [
  1 * 60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

export function backoffMsForFailureCount(count: number): number {
  if (count <= 0) return 0;
  const index = Math.min(count, BACKOFF_MS_BY_FAILURE.length) - 1;
  return BACKOFF_MS_BY_FAILURE[index]!;
}

export function emptyOddsRefreshControl(): OddsRefreshControl {
  return {
    lease: null,
    lastCompletedCheckAt: null,
    automaticFailureCount: 0,
    automaticNotBefore: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLease(value: unknown): OddsRefreshLease | null {
  if (!isPlainObject(value)) return null;
  const { token, owner, acquiredAt, expiresAt } = value;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (owner !== 'manual' && owner !== 'automatic') return null;
  if (typeof acquiredAt !== 'string' || typeof expiresAt !== 'string') return null;
  return { token, owner, acquiredAt, expiresAt };
}

/**
 * Normalize an unknown stored value into a control record. A malformed record —
 * or a malformed lease WITHIN an otherwise-usable record — degrades to a
 * reclaimable state (null lease) rather than wedging the target, exactly as an
 * absent record does.
 */
export function normalizeOddsRefreshControl(value: unknown): OddsRefreshControl {
  if (!isPlainObject(value)) return emptyOddsRefreshControl();
  const failureCount = value.automaticFailureCount;
  const notBefore = value.automaticNotBefore;
  const lastCompleted = value.lastCompletedCheckAt;
  return {
    lease: normalizeLease(value.lease),
    lastCompletedCheckAt: typeof lastCompleted === 'string' ? lastCompleted : null,
    automaticFailureCount:
      typeof failureCount === 'number' && Number.isFinite(failureCount) && failureCount >= 0
        ? Math.floor(failureCount)
        : 0,
    automaticNotBefore: typeof notBefore === 'string' ? notBefore : null,
  };
}

/** Whether the control record holds a lease that has NOT yet expired at `now`. */
export function isLeaseActive(control: OddsRefreshControl, now: number): boolean {
  if (!control.lease) return false;
  const expiresMs = Date.parse(control.lease.expiresAt);
  // An unparseable expiry cannot prove the lease is still valid — treat it as
  // reclaimable (fail toward reclaim, never toward a permanent wedge).
  if (!Number.isFinite(expiresMs)) return false;
  return now < expiresMs;
}

export type OddsLeaseAcquireResult =
  | { acquired: true; token: string; control: OddsRefreshControl }
  | { acquired: false; reason: 'refresh-in-progress'; control: OddsRefreshControl }
  | { acquired: false; reason: 'store-unavailable' };

/**
 * Acquire the refresh lease for one exact season-scoped target, or refuse.
 *
 * The reread, expiry check, and conditional write all run in ONE advisory-locked
 * transaction, so a nonexpired lease deterministically refuses a competing
 * acquirer. Never checks backoff — the manual caller ignores it and the automatic
 * cadence already gated it before calling. A store failure (including a commit of
 * unknown durability) yields `store-unavailable` with no confirmed token: the
 * caller must do no provider work, and any lease that may have become durable
 * simply expires and is reclaimed.
 */
export async function acquireOddsRefreshLease(params: {
  seasonScopedKey: string;
  owner: OddsRefreshOwner;
  now: number;
}): Promise<OddsLeaseAcquireResult> {
  const { seasonScopedKey, owner, now } = params;
  const token = randomUUID();
  try {
    return await withAppStateKeyTransaction<OddsLeaseAcquireResult>(
      ODDS_REFRESH_CONTROL_SCOPE,
      seasonScopedKey,
      async (txn) => {
        const control = normalizeOddsRefreshControl((await txn.read<unknown>())?.value);
        if (isLeaseActive(control, now)) {
          return { acquired: false, reason: 'refresh-in-progress', control };
        }
        const lease: OddsRefreshLease = {
          token,
          owner,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ODDS_LEASE_DURATION_MS).toISOString(),
        };
        const next: OddsRefreshControl = { ...control, lease };
        await txn.write(next);
        return { acquired: true, token, control: next };
      }
    );
  } catch (error) {
    // Every store failure — lock acquisition, a failed read/write with confirmed
    // rollback, or a finalize/cleanup whose durability is UNKNOWN — fails safe:
    // no confirmed token, so the caller performs no provider work. A lease that
    // may have become durable expires within five minutes.
    if (
      error instanceof AppStateKeyLockAcquireError ||
      error instanceof AppStateTxnFinalizeError ||
      error instanceof AppStateTxnCleanupError
    ) {
      return { acquired: false, reason: 'store-unavailable' };
    }
    throw error;
  }
}

function applyResolution(
  control: OddsRefreshControl,
  resolution: OddsRefreshLeaseResolution,
  now: number
): OddsRefreshControl {
  // Clearing OUR lease is common to every resolution.
  const base: OddsRefreshControl = { ...control, lease: null };
  switch (resolution) {
    case 'success':
    case 'no-op':
      // A completed check resets the automatic backoff and records the clock.
      return {
        ...base,
        lastCompletedCheckAt: new Date(now).toISOString(),
        automaticFailureCount: 0,
        automaticNotBefore: null,
      };
    case 'billed-failure': {
      // A billed provider/payload/commit failure advances the durable backoff.
      // It is NOT a completed check, so `lastCompletedCheckAt` is left untouched.
      const count = control.automaticFailureCount + 1;
      return {
        ...base,
        automaticFailureCount: count,
        automaticNotBefore: new Date(now + backoffMsForFailureCount(count)).toISOString(),
      };
    }
    case 'release-only':
      // Credentials missing, quota refusal, or context failure: clear the lease
      // only — neither a billed failure nor a completed check.
      return base;
  }
}

/**
 * Finalize the lease for one target. TOKEN-CHECKED: writes only when the durable
 * record still holds THIS token. An older holder whose lease was reclaimed by a
 * newer refresh finds a different (or absent) token and writes nothing, so it can
 * never clear or mutate the newer lease. Best-effort: a store failure is
 * swallowed (the caller's primary response/error must not be masked); the lease
 * expires within five minutes regardless.
 */
export async function releaseOddsRefreshLease(params: {
  seasonScopedKey: string;
  token: string;
  resolution: OddsRefreshLeaseResolution;
  now: number;
}): Promise<void> {
  const { seasonScopedKey, token, resolution, now } = params;
  try {
    await withAppStateKeyTransaction<void>(
      ODDS_REFRESH_CONTROL_SCOPE,
      seasonScopedKey,
      async (txn) => {
        const control = normalizeOddsRefreshControl((await txn.read<unknown>())?.value);
        // Only the exact current holder may finalize. If our lease is gone
        // (expired + reclaimed) or replaced by a newer token, do NOT touch the
        // record — a stale resolution must never clobber a newer holder's state.
        if (!control.lease || control.lease.token !== token) return;
        await txn.write(applyResolution(control, resolution, now));
      }
    );
  } catch {
    // Best-effort finalize — never mask the primary response/error.
  }
}

/**
 * Read the durable control record for a target WITHOUT taking the write lock.
 * Returns the normalized control, or `null` when the durable read itself failed
 * (never conflated with an absent record — the automatic cadence must not treat
 * an unreachable store as "no backoff"). The dormant PLATFORM-086C2 cadence
 * consumes this; nothing in C1 production calls it.
 */
export async function readOddsRefreshControl(
  seasonScopedKey: string
): Promise<OddsRefreshControl | null> {
  try {
    const record = await getAppState<unknown>(ODDS_REFRESH_CONTROL_SCOPE, seasonScopedKey);
    return normalizeOddsRefreshControl(record?.value);
  } catch {
    return null;
  }
}
