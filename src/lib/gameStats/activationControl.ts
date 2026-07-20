import {
  getAppState,
  withAppStateKeyTransaction,
  type AppStateKeyTxn,
} from '../server/appStateStore.ts';

/**
 * PLATFORM-086H3B — durable game-stats activation-control fence (LIVE fence).
 *
 * The frozen contract §17 audit correction: a DURABLE fence such that, once
 * revisioned evidence exists for the game-stats lifecycle, the legacy
 * (pre-revision) writer can never resume writing. The
 * PLATFORM-086H3B-ACTIVATION-DORMANCY-REMEDIATION makes this fence GOVERN the
 * real production legacy writer (`setCachedGameStats`, in `cache.ts`) and the
 * revisioned writer — it is no longer a dormant wrapper alongside an
 * unfenced writer. This module is therefore LIVE and importable by production
 * (it activates nothing itself); what stays DORMANT is the transition into
 * `armed`/`active` (`setActivationState`, no B production caller), the
 * revisioned writer, and applied repair.
 *
 * States (one global record `game-stats-activation-control/global`):
 *   - `legacy`         — the pre-revision writer is authoritative
 *                        (behavior-equivalent to current `main`);
 *   - `armed`          — deployment preparation ONLY: legacy writing is fenced
 *                        off, but revisioned evidence commits are NOT yet
 *                        authorized;
 *   - `active`         — the ONLY state that authorizes revisioned evidence
 *                        commits; legacy writing stays fenced off;
 *   - `read-only-safe` — a safe stop: BOTH writers are fenced off (reads only).
 *
 * Fail-safe reads: an ABSENT record resolves to `legacy` ONLY when no revision
 * history is proven to survive (below); a MALFORMED record resolves to
 * `read-only-safe` and is never auto-normalized to `legacy`.
 *
 * Durable global witness: `game-stats-activation-control/revisioned-evidence-witness`
 * is a write-once, never-cleared marker set ATOMICALLY with the first revisioned
 * evidence commit. It — plus per-partition ledger/stamp history — is what forbids
 * the legacy writer (and any automatic return to `legacy`) after revisioned
 * evidence has ever existed, even if the activation record itself is lost.
 */

export const ACTIVATION_CONTROL_SCOPE = 'game-stats-activation-control';
export const ACTIVATION_CONTROL_KEY = 'global';
/** Write-once durable global "revisioned evidence has existed" witness. */
export const REVISIONED_EVIDENCE_WITNESS_KEY = 'revisioned-evidence-witness';

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
   * Mirror of the durable global witness on the record. Set true when revisioned
   * evidence commits; monotonic — never cleared — so a return to `legacy` is
   * permanently forbidden once evidence has existed (frozen contract §17). The
   * separate witness key is the authoritative durable witness that survives even
   * if this record is lost.
   */
  revisionedEvidenceEverExisted: boolean;
  reason?: string;
};

/** The write-once durable global witness value. */
export type RevisionedEvidenceWitness = { everExisted: true; firstAt: string };

/** Whether a raw witness value proves revisioned evidence has ever existed. */
export function witnessPresent(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { everExisted?: unknown }).everExisted === true
  );
}

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
 * `legacy` — callers resolve it to `read-only-safe`, blocking BOTH writers until
 * an operator inspects it, and it is never auto-normalized/overwritten.
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

/** Whether the revisioned writer may persist under `state` — ONLY `active`. */
export function revisionedWriteAllowed(state: ActivationState): boolean {
  return state === 'active';
}

// === Pure write gates (evaluated INSIDE the commit transaction) ===

export type LegacyWriteGate =
  | { allow: true }
  | {
      allow: false;
      reason: 'fenced-non-legacy' | 'fenced-revision-history' | 'fenced-malformed';
      state: ActivationState;
    };

/**
 * Whether a LEGACY (pre-revision) write may commit, given the durable activation
 * record, whether the global witness survives, and whether THIS partition already
 * carries revision history (a ledger row or a partition commit stamp). Blocking is
 * always safe. A missing revision field is never inferred here — the caller passes
 * the concrete witnesses.
 */
export function classifyLegacyWrite(
  recordRaw: unknown,
  witnessSeen: boolean,
  partitionHasRevisionHistory: boolean
): LegacyWriteGate {
  if (recordRaw === null) {
    // Absent record → `legacy` ONLY when NO revision history is proven to
    // survive; otherwise a lost activation row must not resurrect legacy writing.
    if (witnessSeen || partitionHasRevisionHistory) {
      return { allow: false, reason: 'fenced-revision-history', state: 'read-only-safe' };
    }
    return { allow: true };
  }
  const record = validateActivationRecord(recordRaw);
  if (!record) return { allow: false, reason: 'fenced-malformed', state: 'read-only-safe' };
  if (record.state !== 'legacy') {
    return { allow: false, reason: 'fenced-non-legacy', state: record.state };
  }
  // State is legacy — fail safe: any surviving revision witness refuses.
  if (witnessSeen || partitionHasRevisionHistory || record.revisionedEvidenceEverExisted) {
    return { allow: false, reason: 'fenced-revision-history', state: 'read-only-safe' };
  }
  return { allow: true };
}

export type RevisionedWriteGate =
  | { allow: true }
  | { allow: false; state: ActivationState | 'absent' | 'malformed' };

/** Whether a REVISIONED write may commit — ONLY when the record is valid `active`. */
export function classifyRevisionedWrite(recordRaw: unknown): RevisionedWriteGate {
  if (recordRaw === null) return { allow: false, state: 'absent' };
  const record = validateActivationRecord(recordRaw);
  if (!record) return { allow: false, state: 'malformed' };
  if (record.state !== 'active') return { allow: false, state: record.state };
  return { allow: true };
}

// === Durable reads (optimization only — never the commit authority) ===

/**
 * Resolve the durable activation record for a NON-authoritative read/optimization
 * (e.g. an early bail before the revisioned writer opens its transaction). Absent
 * → `legacy` UNLESS the durable global witness survives (then `read-only-safe`);
 * malformed → `read-only-safe`. The authoritative decision is always re-taken
 * inside the commit transaction under the activation-control lock.
 */
export async function readActivationControl(): Promise<ActivationControlRecord> {
  const stored = await getAppState<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
  if (!stored) {
    const witness = await getAppState<unknown>(
      ACTIVATION_CONTROL_SCOPE,
      REVISIONED_EVIDENCE_WITNESS_KEY
    );
    if (witnessPresent(witness?.value)) {
      return {
        schemaVersion: 1,
        state: 'read-only-safe',
        updatedAt: '',
        revisionedEvidenceEverExisted: true,
        reason: 'activation record absent but revisioned-evidence witness survives',
      };
    }
    return defaultActivationRecord('');
  }
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

/** Convenience: the resolved activation STATE (optimization read). */
export async function readActivationState(): Promise<ActivationState> {
  return (await readActivationControl()).state;
}

// === Transition state machine (DORMANT — no B production caller) ===

export type ActivationTransitionResult =
  | { ok: true; record: ActivationControlRecord }
  | {
      ok: false;
      reason: 'legacy-forbidden-after-evidence' | 'invalid-transition' | 'store-unavailable';
      current?: ActivationControlRecord;
    };

/**
 * Whether `current.state → next` is a permitted transition, given whether
 * revisioned history has ever existed (`hasHistory` = the durable witness OR the
 * record's own flag). The permitted forward transitions are exactly:
 *
 *   legacy → armed, armed → active, armed → read-only-safe, active → read-only-safe
 *
 * plus an idempotent same-state no-op. A transition TO `legacy` is permitted only
 * when NO revision history has existed (aborting arming/safe-stop before evidence)
 * and never from `active`. Pure — the transactional setter applies the result.
 */
export function classifyActivationTransition(
  current: ActivationControlRecord,
  next: ActivationState,
  hasHistory: boolean
): { ok: true } | { ok: false; reason: 'legacy-forbidden-after-evidence' | 'invalid-transition' } {
  if (next === current.state) return { ok: true };
  switch (next) {
    case 'legacy':
      if (hasHistory) return { ok: false, reason: 'legacy-forbidden-after-evidence' };
      if (current.state === 'armed' || current.state === 'read-only-safe') return { ok: true };
      return { ok: false, reason: 'invalid-transition' };
    case 'armed':
      return current.state === 'legacy'
        ? { ok: true }
        : { ok: false, reason: 'invalid-transition' };
    case 'active':
      return current.state === 'armed' ? { ok: true } : { ok: false, reason: 'invalid-transition' };
    case 'read-only-safe':
      return current.state === 'armed' || current.state === 'active'
        ? { ok: true }
        : { ok: false, reason: 'invalid-transition' };
  }
}

/**
 * Transition the durable activation state under the activation-control advisory
 * lock. Reads the durable witness so `hasHistory` reflects it (and re-syncs the
 * record flag from the witness). DORMANT: no B production path calls this into
 * `armed`/`active`; reaching `active` does NOT itself set the evidence witness —
 * only the first revisioned evidence commit does (`markRevisionedEvidenceCommitted`).
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
        const witnessRaw =
          (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY))
            ?.value ?? null;
        const current = validateActivationRecord(stored) ?? defaultActivationRecord(now);
        const hasHistory = witnessPresent(witnessRaw) || current.revisionedEvidenceEverExisted;
        const decision = classifyActivationTransition(current, next, hasHistory);
        if (!decision.ok) return { ok: false, reason: decision.reason, current };
        const record: ActivationControlRecord = {
          schemaVersion: 1,
          state: next,
          updatedAt: now,
          // Preserve/sync the evidence flag from the durable witness — never clear.
          revisionedEvidenceEverExisted: hasHistory,
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

/**
 * Set the durable global "revisioned evidence has existed" witness (write-once)
 * and sync the activation record's flag, co-committed with the first revisioned
 * evidence write. MUST be called from inside the revisioned writer's transaction
 * while it holds the activation-control lock, so the witness persists atomically
 * with the evidence (or neither persists). Idempotent thereafter.
 */
export async function markRevisionedEvidenceCommitted(
  txn: AppStateKeyTxn,
  now: string
): Promise<void> {
  const witnessRaw =
    (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY))
      ?.value ?? null;
  if (!witnessPresent(witnessRaw)) {
    await txn.writeKey<RevisionedEvidenceWitness>(
      ACTIVATION_CONTROL_SCOPE,
      REVISIONED_EVIDENCE_WITNESS_KEY,
      { everExisted: true, firstAt: now }
    );
  }
  const recordRaw =
    (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY))?.value ?? null;
  const record = validateActivationRecord(recordRaw);
  if (record && !record.revisionedEvidenceEverExisted) {
    await txn.writeKey<ActivationControlRecord>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, {
      ...record,
      revisionedEvidenceEverExisted: true,
      updatedAt: now,
    });
  }
}
