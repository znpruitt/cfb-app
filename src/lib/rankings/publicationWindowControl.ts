/**
 * PLATFORM-086E2B — durable per-window duplicate suppression for the automatic
 * rankings cron.
 *
 * ONE durable record per exact E2A publication key
 * (`rankings-publication-window/<year>:<kind>:<YYYY-MM-DD>`) guarantees each
 * publication window is delivered AT MOST ONCE even under QStash's
 * at-least-once delivery: a COMPLETED window is immutable and refuses forever
 * (`publication-window-complete` — no `/info` probe, no provider request), and
 * an unfinished window admits one claimant at a time through a five-minute
 * token-safe claim (`publication-window-in-progress` for the loser).
 *
 * Contract (mirrors the E1A/E2A lease discipline):
 *   - Acquisition, finalization, and release each run inside
 *     `withAppStateKeyTransaction` rooted on the window key, so overlapping
 *     deliveries serialize.
 *   - The claim token is a `crypto.randomUUID()`; a missing, malformed, or
 *     expired UNFINISHED control is reclaimable (a crashed claimant never wedges
 *     the window).
 *   - Finalization and release are TOKEN-CHECKED: an older claimant whose claim
 *     was reclaimed can neither complete nor clear the newer claim.
 *   - A store failure while acquiring fails CLOSED (`store-unavailable`, no
 *     confirmed token — the caller performs no quota or provider work).
 *   - Completion returns whether it was durably CONFIRMED; an unconfirmed
 *     completion after successful provider work is the caller's
 *     `publication-completion-unconfirmed` partial — the claim is left to
 *     expire/reconcile, never blindly retried.
 *
 * This is operational duplicate-suppression control ONLY — not a
 * provider-refresh attempt, not a heartbeat table, and never a substitute for
 * E2A's own per-year refresh lease.
 */

import { randomUUID } from 'node:crypto';

import { withAppStateKeyTransaction } from '../server/appStateStore.ts';

export const RANKINGS_PUBLICATION_WINDOW_SCOPE = 'rankings-publication-window';
/** A claim is valid for five minutes; after that any delivery may reclaim it. */
export const RANKINGS_PUBLICATION_CLAIM_DURATION_MS = 5 * 60 * 1000;

export type RankingsPublicationWindowClaim = {
  token: string;
  acquiredAt: string;
  expiresAt: string;
};

export type RankingsPublicationWindowControl = {
  version: 1;
  publicationKey: string;
  /** Set exactly once when the window's refresh outcome was finalized. */
  completedAt: string | null;
  claim: RankingsPublicationWindowClaim | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeClaim(value: unknown): RankingsPublicationWindowClaim | null {
  if (!isPlainObject(value)) return null;
  const { token, acquiredAt, expiresAt } = value;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof acquiredAt !== 'string' || typeof expiresAt !== 'string') return null;
  return { token, acquiredAt, expiresAt };
}

/**
 * Normalize an unknown stored value into a control record for `publicationKey`.
 * A malformed record — wrong version, mismatched key, non-string completion, or
 * a malformed claim — degrades to a reclaimable UNFINISHED state rather than
 * wedging (or falsely completing) the window; only an intact record can prove
 * completion.
 */
export function normalizeRankingsPublicationWindowControl(
  publicationKey: string,
  value: unknown
): RankingsPublicationWindowControl {
  const empty: RankingsPublicationWindowControl = {
    version: 1,
    publicationKey,
    completedAt: null,
    claim: null,
  };
  if (!isPlainObject(value)) return empty;
  if (value.version !== 1) return empty;
  if (value.publicationKey !== publicationKey) return empty;
  const completedAt = typeof value.completedAt === 'string' ? value.completedAt : null;
  return { version: 1, publicationKey, completedAt, claim: normalizeClaim(value.claim) };
}

/** Whether the control holds a claim that has NOT yet expired at `now`. */
export function isPublicationClaimActive(
  control: RankingsPublicationWindowControl,
  now: number
): boolean {
  if (!control.claim) return false;
  const expiresMs = Date.parse(control.claim.expiresAt);
  // An unparseable expiry cannot prove the claim is still valid — reclaimable.
  if (!Number.isFinite(expiresMs)) return false;
  return now < expiresMs;
}

export type RankingsPublicationClaimResult =
  | { kind: 'claimed'; token: string }
  | { kind: 'complete' }
  | { kind: 'in-progress' }
  | { kind: 'store-unavailable' };

/**
 * Claim one publication window, or refuse. `now` is a FRESH timestamp captured
 * immediately before this call (never the route-entry instant). The reread,
 * completion check, expiry check, and conditional write all run in ONE
 * advisory-locked transaction. A completed window refuses immutably; a store
 * failure fails closed with no confirmed token.
 */
export async function claimRankingsPublicationWindow(params: {
  publicationKey: string;
  now: number;
}): Promise<RankingsPublicationClaimResult> {
  const { publicationKey, now } = params;
  const token = randomUUID();
  try {
    return await withAppStateKeyTransaction<RankingsPublicationClaimResult>(
      RANKINGS_PUBLICATION_WINDOW_SCOPE,
      publicationKey,
      async (txn) => {
        const control = normalizeRankingsPublicationWindowControl(
          publicationKey,
          (await txn.read<unknown>())?.value
        );
        if (control.completedAt !== null) return { kind: 'complete' };
        if (isPublicationClaimActive(control, now)) return { kind: 'in-progress' };
        const claim: RankingsPublicationWindowClaim = {
          token,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + RANKINGS_PUBLICATION_CLAIM_DURATION_MS).toISOString(),
        };
        await txn.write<RankingsPublicationWindowControl>({
          version: 1,
          publicationKey,
          completedAt: null,
          claim,
        });
        return { kind: 'claimed', token };
      }
    );
  } catch {
    // Fail closed: no confirmed token → no quota/provider work; a claim that may
    // have become durable simply expires within five minutes.
    return { kind: 'store-unavailable' };
  }
}

/**
 * Finalize one publication window after its refresh outcome resolved
 * (success or clean no-op). TOKEN-CHECKED: completes only while the durable
 * record still holds THIS claim token — an older reclaimed claimant writes
 * nothing. Returns whether completion was durably CONFIRMED; `false` (token
 * lost or store failure) is the caller's `publication-completion-unconfirmed`
 * signal. Never throws.
 */
export async function completeRankingsPublicationWindow(params: {
  publicationKey: string;
  token: string;
  completedAt: string;
}): Promise<{ confirmed: boolean }> {
  const { publicationKey, token, completedAt } = params;
  try {
    return await withAppStateKeyTransaction<{ confirmed: boolean }>(
      RANKINGS_PUBLICATION_WINDOW_SCOPE,
      publicationKey,
      async (txn) => {
        const control = normalizeRankingsPublicationWindowControl(
          publicationKey,
          (await txn.read<unknown>())?.value
        );
        // Already complete (an earlier confirmed finalize) — idempotent success.
        if (control.completedAt !== null) return { confirmed: true };
        if (!control.claim || control.claim.token !== token) return { confirmed: false };
        await txn.write<RankingsPublicationWindowControl>({
          version: 1,
          publicationKey,
          completedAt,
          claim: null,
        });
        return { confirmed: true };
      }
    );
  } catch {
    return { confirmed: false };
  }
}

/**
 * Release an unfinished claim WITHOUT completing the window (quota refusal,
 * refresh failure, or refresh contention — the window stays eligible for a
 * later delivery). TOKEN-CHECKED and best-effort: a store failure is swallowed
 * (the claim expires within five minutes regardless), and a completed window is
 * never touched.
 */
export async function releaseRankingsPublicationWindow(params: {
  publicationKey: string;
  token: string;
}): Promise<void> {
  const { publicationKey, token } = params;
  try {
    await withAppStateKeyTransaction<void>(
      RANKINGS_PUBLICATION_WINDOW_SCOPE,
      publicationKey,
      async (txn) => {
        const control = normalizeRankingsPublicationWindowControl(
          publicationKey,
          (await txn.read<unknown>())?.value
        );
        if (control.completedAt !== null) return;
        if (!control.claim || control.claim.token !== token) return;
        await txn.write<RankingsPublicationWindowControl>({
          version: 1,
          publicationKey,
          completedAt: null,
          claim: null,
        });
      }
    );
  } catch {
    // Best-effort — never mask the caller's primary outcome.
  }
}
