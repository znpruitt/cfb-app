import { getAppState, withAppStateKeyTransaction } from '../server/appStateStore.ts';
import { getGameStatsKey } from './cache.ts';
import type { WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3B — durable game-stats activation-control fence (DORMANT).
 *
 * The frozen contract §17 audit correction: a DURABLE fence such that, once
 * revisioned evidence exists for the game-stats lifecycle, the legacy
 * (pre-revision) writer can never resume writing. This is what makes the A→E
 * sequence safe to land and revert incrementally — there is never a window in
 * which a stale/rolled-back deploy reintroduces a blind-overwrite writer
 * alongside revisioned evidence.
 *
 * States (one global key `game-stats-activation-control/global`):
 *   - `legacy`         — the pre-revision writer path is authoritative
 *                        (behavior-equivalent to current `main`);
 *   - `armed`          — the revisioned lifecycle is wired but not yet the
 *                        authoritative writer (legacy writing is now fenced OFF);
 *   - `active`         — revisioned evidence is being written; legacy writing is
 *                        permanently fenced off for this lifecycle;
 *   - `read-only-safe` — a safe stop: BOTH writers are fenced off (reads only).
 *
 * Dormancy (this PR): NOTHING in B transitions production into `armed` or
 * `active`. The production legacy writer remains `setCachedGameStats` (unchanged,
 * behavior-equivalent) while the state is `legacy`. The fenced legacy setter and
 * the transition state machine below are BUILT and tested but have no production
 * caller — E wires them. The recursive dormant-boundary guard proves no route
 * imports this module or transitions the fence.
 */

// Mirrors the evidence scope constant — the fenced legacy setter's primary lock.
const GAME_STATS_SCOPE = 'game-stats';
export const ACTIVATION_CONTROL_SCOPE = 'game-stats-activation-control';
export const ACTIVATION_CONTROL_KEY = 'global';

export type ActivationState = 'legacy' | 'armed' | 'active' | 'read-only-safe';

const ACTIVATION_STATES: ReadonlySet<string> = new Set<ActivationState>([
  'legacy',
  'armed',
  'active',
  'read-only-safe',
]);

export type ActivationControlRecord = {
  schemaVersion: 1;
  state: ActivationState;
  updatedAt: string;
  /**
   * Set true once the lifecycle reaches `active` (revisioned evidence exists).
   * Monotonic — never cleared — so automatic return to `legacy` is permanently
   * forbidden after evidence has existed (frozen contract §17).
   */
  revisionedEvidenceEverExisted: boolean;
  /** Optional operator note for audit/diagnostics. */
  reason?: string;
};

/** The default when no record exists: `legacy`, no revisioned evidence yet. */
export function defaultActivationRecord(now: string): ActivationControlRecord {
  return {
    schemaVersion: 1,
    state: 'legacy',
    updatedAt: now,
    revisionedEvidenceEverExisted: false,
  };
}

/**
 * Validate a stored activation record. A malformed record is NOT trusted as
 * `legacy` — it resolves (via the readers below) to `read-only-safe`, blocking
 * BOTH writers until an operator inspects it.
 */
export function validateActivationRecord(value: unknown): ActivationControlRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  if (typeof record.state !== 'string' || !ACTIVATION_STATES.has(record.state)) return null;
  if (typeof record.revisionedEvidenceEverExisted !== 'boolean') return null;
  const out: ActivationControlRecord = {
    schemaVersion: 1,
    state: record.state as ActivationState,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    revisionedEvidenceEverExisted: record.revisionedEvidenceEverExisted,
  };
  if (typeof record.reason === 'string') out.reason = record.reason;
  return out;
}

/** Whether the legacy (pre-revision) writer may persist under `state`. */
export function legacyWriteAllowed(state: ActivationState): boolean {
  return state === 'legacy';
}

/** Whether the revisioned writer may persist under `state`. */
export function revisionedWriteAllowed(state: ActivationState): boolean {
  return state === 'armed' || state === 'active';
}

/**
 * Resolve the durable activation record for reads/decisions. Absent → `legacy`
 * (safe: reaching any non-legacy state requires an explicit write, so an absent
 * record proves no revisioned history exists — frozen contract §17). A stored
 * but MALFORMED record → a synthetic `read-only-safe` with evidence conservatively
 * assumed, so a corrupt fence never re-enables the legacy writer.
 */
export async function readActivationControl(): Promise<ActivationControlRecord> {
  const stored = await getAppState<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
  if (!stored) return defaultActivationRecord('');
  const record = validateActivationRecord(stored.value);
  if (record) return record;
  return {
    schemaVersion: 1,
    state: 'read-only-safe',
    updatedAt: stored.updatedAt,
    revisionedEvidenceEverExisted: true,
    reason: 'malformed activation-control record (fenced read-only-safe)',
  };
}

/** Convenience: the resolved activation STATE (absent → `legacy`). */
export async function readActivationState(): Promise<ActivationState> {
  return (await readActivationControl()).state;
}

// === Transition state machine (dormant; no production caller to armed/active) ===

export type ActivationTransitionResult =
  | { ok: true; record: ActivationControlRecord }
  | {
      ok: false;
      reason: 'legacy-forbidden-after-evidence' | 'invalid-transition' | 'store-unavailable';
      current?: ActivationControlRecord;
    };

/**
 * Whether `current.state → next` is a permitted transition. Enforces the two
 * durable invariants: `active` requires arming first, and returning to `legacy`
 * is forbidden once revisioned evidence has ever existed (frozen contract §17).
 * Pure — the transactional setter below applies the result.
 */
export function classifyActivationTransition(
  current: ActivationControlRecord,
  next: ActivationState
):
  | { ok: true; revisionedEvidenceEverExisted: boolean }
  | { ok: false; reason: 'legacy-forbidden-after-evidence' | 'invalid-transition' } {
  const evidenceEver = current.revisionedEvidenceEverExisted;
  switch (next) {
    case 'legacy':
      // Once revisioned evidence has existed (or the current state is active),
      // automatic return to legacy is permanently forbidden.
      if (evidenceEver || current.state === 'active') {
        return { ok: false, reason: 'legacy-forbidden-after-evidence' };
      }
      return { ok: true, revisionedEvidenceEverExisted: false };
    case 'armed':
      // Arming (fencing the legacy writer off) is allowed from any state.
      return { ok: true, revisionedEvidenceEverExisted: evidenceEver };
    case 'active':
      // The revisioned writer may only go active from armed — never straight
      // from legacy — so the legacy writer is fenced BEFORE evidence is written.
      if (current.state !== 'armed' && current.state !== 'active') {
        return { ok: false, reason: 'invalid-transition' };
      }
      return { ok: true, revisionedEvidenceEverExisted: true };
    case 'read-only-safe':
      // A safe stop is always reachable.
      return { ok: true, revisionedEvidenceEverExisted: evidenceEver };
  }
}

/**
 * Transition the durable activation state under the activation-control advisory
 * lock (single-key transaction on `game-stats-activation-control/global`).
 * DORMANT: no B production path calls this into `armed`/`active`; it exists so E
 * can activate atomically and so operators/tests can exercise the fence.
 */
export async function setActivationState(
  next: ActivationState,
  opts: { now?: string; reason?: string } = {}
): Promise<ActivationTransitionResult> {
  const now = opts.now ?? new Date().toISOString();
  try {
    return await withAppStateKeyTransaction<ActivationTransitionResult>(
      ACTIVATION_CONTROL_SCOPE,
      ACTIVATION_CONTROL_KEY,
      async (txn) => {
        const stored = (await txn.read<unknown>())?.value ?? null;
        const current = validateActivationRecord(stored) ?? defaultActivationRecord(now);
        const decision = classifyActivationTransition(current, next);
        if (!decision.ok) return { ok: false, reason: decision.reason, current };
        const record: ActivationControlRecord = {
          schemaVersion: 1,
          state: next,
          updatedAt: now,
          revisionedEvidenceEverExisted: decision.revisionedEvidenceEverExisted,
          ...(opts.reason ? { reason: opts.reason } : {}),
        };
        await txn.write(record);
        return { ok: true, record };
      }
    );
  } catch {
    return { ok: false, reason: 'store-unavailable' };
  }
}

// === Fenced legacy setter (dormant) ===

export type LegacyWriteResult =
  | { ok: true }
  | { ok: false; reason: 'fenced-non-legacy'; state: ActivationState }
  | { ok: false; reason: 'store-unavailable' };

/**
 * Persist a legacy (pre-revision) weekly partition ONLY while the fence is
 * `legacy`. Roots the transaction at the evidence partition E(P) and acquires
 * the activation-control lock as a secondary (forward order:
 * `game-stats` sorts below `game-stats-activation-control`), so the state cannot
 * change under it during the write. Behavior-equivalent to `setCachedGameStats`
 * in `legacy`; refuses (writing nothing) in `armed`/`active`/`read-only-safe`.
 *
 * DORMANT: `setCachedGameStats` remains the production legacy writer under
 * `legacy`. This fenced setter is what E will make authoritative.
 */
export async function writeLegacyGameStatsPartition(
  stats: WeeklyGameStats
): Promise<LegacyWriteResult> {
  const key = getGameStatsKey(stats.year, stats.week, stats.seasonType);
  try {
    return await withAppStateKeyTransaction<LegacyWriteResult>(
      GAME_STATS_SCOPE,
      key,
      async (txn) => {
        await txn.lockKey(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
        const stored =
          (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY))?.value ??
          null;
        const record = validateActivationRecord(stored);
        // Absent → legacy (safe default). Malformed → read-only-safe (refuse).
        const state: ActivationState =
          stored === null ? 'legacy' : (record?.state ?? 'read-only-safe');
        if (!legacyWriteAllowed(state)) {
          return { ok: false, reason: 'fenced-non-legacy', state };
        }
        await txn.write(stats);
        return { ok: true };
      }
    );
  } catch {
    return { ok: false, reason: 'store-unavailable' };
  }
}
