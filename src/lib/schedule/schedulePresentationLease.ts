/**
 * PLATFORM-086E1C1 — durable, token-safe schedule-presentation refresh leases.
 *
 * TWO independent controls, so the media and venue parts never block each other:
 *   - `schedule-media-refresh-control/<year>` — the year-wide game-media refresh;
 *   - `venue-catalog-refresh-control/current` — the global venue-catalog refresh.
 * Media can proceed while the venue refresh is in progress, and vice versa.
 *
 * Concurrency contract (mirrors the E1A schedule refresh lease verbatim):
 *   - acquisition/release run inside `withAppStateKeyTransaction` on the control
 *     key, so overlapping acquirers serialize — at most one wins, the loser is
 *     told `refresh-in-progress` and does no provider work;
 *   - the token is a `crypto.randomUUID()`; a lease lasts five minutes; a
 *     missing/malformed/expired lease is reclaimable (a crashed holder never
 *     wedges the target);
 *   - release is TOKEN-CHECKED — only the exact holder clears its own lease;
 *   - store failures FAIL SAFE: acquisition maps every store error to
 *     `store-unavailable` with no confirmed token (no provider work proceeds);
 *     release is best-effort and never masks the primary outcome.
 * There is NO durable backoff — cadence is entirely caller-driven.
 */

import { randomUUID } from 'node:crypto';

import { withAppStateKeyTransaction } from '../server/appStateStore.ts';

export const SCHEDULE_MEDIA_REFRESH_CONTROL_SCOPE = 'schedule-media-refresh-control';
export const VENUE_CATALOG_REFRESH_CONTROL_SCOPE = 'venue-catalog-refresh-control';
export const VENUE_CATALOG_REFRESH_CONTROL_KEY = 'current';

/** A presentation lease is valid for five minutes; after that it is reclaimable. */
export const SCHEDULE_PRESENTATION_LEASE_DURATION_MS = 5 * 60 * 1000;

type PresentationLease = {
  token: string;
  acquiredAt: string;
  expiresAt: string;
};

type PresentationLeaseControl = {
  lease: PresentationLease | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLease(value: unknown): PresentationLease | null {
  if (!isPlainObject(value)) return null;
  const { token, acquiredAt, expiresAt } = value;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof acquiredAt !== 'string' || typeof expiresAt !== 'string') return null;
  return { token, acquiredAt, expiresAt };
}

function normalizeControl(value: unknown): PresentationLeaseControl {
  if (!isPlainObject(value)) return { lease: null };
  return { lease: normalizeLease(value.lease) };
}

function isLeaseActive(control: PresentationLeaseControl, now: number): boolean {
  if (!control.lease) return false;
  const expiresMs = Date.parse(control.lease.expiresAt);
  // An unparseable expiry cannot prove the lease is still valid — fail toward
  // reclaim, never toward a permanent wedge.
  if (!Number.isFinite(expiresMs)) return false;
  return now < expiresMs;
}

export type PresentationLeaseAcquireResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: 'refresh-in-progress' }
  | { acquired: false; reason: 'store-unavailable' };

export async function acquireSchedulePresentationLease(params: {
  controlScope: string;
  controlKey: string;
  now: number;
}): Promise<PresentationLeaseAcquireResult> {
  const { controlScope, controlKey, now } = params;
  const token = randomUUID();
  try {
    return await withAppStateKeyTransaction<PresentationLeaseAcquireResult>(
      controlScope,
      controlKey,
      async (txn) => {
        const control = normalizeControl((await txn.read<unknown>())?.value);
        if (isLeaseActive(control, now)) {
          return { acquired: false, reason: 'refresh-in-progress' };
        }
        const lease: PresentationLease = {
          token,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + SCHEDULE_PRESENTATION_LEASE_DURATION_MS).toISOString(),
        };
        await txn.write<PresentationLeaseControl>({ lease });
        return { acquired: true, token };
      }
    );
  } catch {
    // EVERY transaction failure fails safe: no confirmed token, so the caller
    // does no provider work; a lease that may have become durable expires within
    // five minutes. The callback's only fallible operations are the store
    // read/write (normalize + expiry check are pure).
    return { acquired: false, reason: 'store-unavailable' };
  }
}

export async function releaseSchedulePresentationLease(params: {
  controlScope: string;
  controlKey: string;
  token: string;
}): Promise<void> {
  const { controlScope, controlKey, token } = params;
  try {
    await withAppStateKeyTransaction<void>(controlScope, controlKey, async (txn) => {
      const control = normalizeControl((await txn.read<unknown>())?.value);
      if (!control.lease || control.lease.token !== token) return;
      await txn.write<PresentationLeaseControl>({ lease: null });
    });
  } catch {
    // Best-effort finalize — never mask the primary outcome; the lease expires
    // within five minutes regardless.
  }
}
