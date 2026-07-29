/**
 * PLATFORM-086E1A — the durable, token-safe full-season schedule refresh lease.
 *
 * ONE durable record per season (`schedule-refresh-control/<year>`) is the single
 * point of duplicate-work protection every full-season schedule writer shares: the
 * authorized full-year `/api/schedule` refresh, the season-transition cron, and
 * the historical schedule repair (and, later, the PLATFORM-086E1B weekly caller).
 * A nonexpired lease refuses a second refresh BEFORE any provider or status work,
 * so two full-season refreshes can never both fetch/commit the same year.
 *
 * Concurrency contract (mirrors the Odds refresh lease, PLATFORM-086C1):
 *   - Acquisition and release run inside `withAppStateKeyTransaction` rooted on the
 *     control key, so overlapping acquirers serialize: at most one wins; the loser
 *     is told `refresh-in-progress` and does no provider work.
 *   - The lease token is a `crypto.randomUUID()` — unguessable and unique across
 *     processes, so two instances acquiring in the same instant cannot collide.
 *   - A lease lasts five minutes. A missing, malformed, or expired lease is
 *     reclaimable (a crashed holder never wedges the year).
 *   - Release is TOKEN-CHECKED: only the exact holder may clear its own lease. An
 *     older holder whose lease was already reclaimed by a newer refresh writes
 *     NOTHING.
 *   - Store failures FAIL SAFE: acquisition maps every store error (including a
 *     commit of unknown durability) to `store-unavailable` with NO confirmed token,
 *     so no provider work proceeds; release is best-effort and never masks the
 *     caller's primary response/error (an unreleased lease simply expires).
 *
 * Unlike the Odds lease there is NO durable backoff (§3): schedule refresh cadence
 * is driven entirely by the caller (the weekly E1B scheduler, the lifecycle cron,
 * or an operator), so the control record holds only the lease.
 */

import { randomUUID } from 'node:crypto';

import { withAppStateKeyTransaction } from '../server/appStateStore.ts';

export const SCHEDULE_REFRESH_CONTROL_SCOPE = 'schedule-refresh-control';
/** A lease is valid for five minutes; after that any refresh may reclaim it. */
export const SCHEDULE_LEASE_DURATION_MS = 5 * 60 * 1000;

export type ScheduleRefreshLease = {
  token: string;
  acquiredAt: string;
  expiresAt: string;
};

export type ScheduleRefreshControl = {
  lease: ScheduleRefreshLease | null;
};

export function emptyScheduleRefreshControl(): ScheduleRefreshControl {
  return { lease: null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLease(value: unknown): ScheduleRefreshLease | null {
  if (!isPlainObject(value)) return null;
  const { token, acquiredAt, expiresAt } = value;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof acquiredAt !== 'string' || typeof expiresAt !== 'string') return null;
  return { token, acquiredAt, expiresAt };
}

/**
 * Normalize an unknown stored value into a control record. A malformed record — or
 * a malformed lease within it — degrades to a reclaimable state (null lease)
 * rather than wedging the year, exactly as an absent record does.
 */
export function normalizeScheduleRefreshControl(value: unknown): ScheduleRefreshControl {
  if (!isPlainObject(value)) return emptyScheduleRefreshControl();
  return { lease: normalizeLease(value.lease) };
}

/** Whether the control record holds a lease that has NOT yet expired at `now`. */
export function isScheduleLeaseActive(control: ScheduleRefreshControl, now: number): boolean {
  if (!control.lease) return false;
  const expiresMs = Date.parse(control.lease.expiresAt);
  // An unparseable expiry cannot prove the lease is still valid — treat it as
  // reclaimable (fail toward reclaim, never toward a permanent wedge).
  if (!Number.isFinite(expiresMs)) return false;
  return now < expiresMs;
}

export type ScheduleLeaseAcquireResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: 'refresh-in-progress' }
  | { acquired: false; reason: 'store-unavailable' };

/**
 * Acquire the refresh lease for one season, or refuse. The reread, expiry check,
 * and conditional write all run in ONE advisory-locked transaction, so a
 * nonexpired lease deterministically refuses a competing acquirer. A store failure
 * (including a commit of unknown durability) yields `store-unavailable` with no
 * confirmed token: the caller must do no provider work, and any lease that may
 * have become durable simply expires and is reclaimed.
 */
export async function acquireScheduleRefreshLease(params: {
  year: number;
  now: number;
}): Promise<ScheduleLeaseAcquireResult> {
  const { year, now } = params;
  const token = randomUUID();
  try {
    return await withAppStateKeyTransaction<ScheduleLeaseAcquireResult>(
      SCHEDULE_REFRESH_CONTROL_SCOPE,
      String(year),
      async (txn) => {
        const control = normalizeScheduleRefreshControl((await txn.read<unknown>())?.value);
        if (isScheduleLeaseActive(control, now)) {
          return { acquired: false, reason: 'refresh-in-progress' };
        }
        const lease: ScheduleRefreshLease = {
          token,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + SCHEDULE_LEASE_DURATION_MS).toISOString(),
        };
        await txn.write<ScheduleRefreshControl>({ lease });
        return { acquired: true, token };
      }
    );
  } catch {
    // EVERY transaction failure fails safe: no confirmed token, so the caller does
    // no provider work, and a lease that may have become durable expires within
    // five minutes. This deliberately catches ALL errors — the transaction's only
    // fallible operations are its own store read/write (the control normalize +
    // expiry check are pure), so there is no non-store logic to mask.
    return { acquired: false, reason: 'store-unavailable' };
  }
}

/**
 * Release the lease for one season. TOKEN-CHECKED: clears only when the durable
 * record still holds THIS token. An older holder whose lease was reclaimed by a
 * newer refresh finds a different (or absent) token and writes nothing, so it can
 * never clear or mutate the newer lease. Best-effort: a store failure is swallowed
 * (the caller's primary response/error must not be masked); the lease expires
 * within five minutes regardless.
 */
export async function releaseScheduleRefreshLease(params: {
  year: number;
  token: string;
}): Promise<void> {
  const { year, token } = params;
  try {
    await withAppStateKeyTransaction<void>(
      SCHEDULE_REFRESH_CONTROL_SCOPE,
      String(year),
      async (txn) => {
        const control = normalizeScheduleRefreshControl((await txn.read<unknown>())?.value);
        if (!control.lease || control.lease.token !== token) return;
        await txn.write<ScheduleRefreshControl>({ lease: null });
      }
    );
  } catch {
    // Best-effort finalize — never mask the primary response/error.
  }
}
