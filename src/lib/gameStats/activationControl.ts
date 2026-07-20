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

// === Presence-aware durable control reads ===
//
// PLATFORM-086H3B-ACTIVATION-STATE-CORRUPTION-REMEDIATION: a durable row's
// PRESENCE is preserved independently of its decoded value, so a PRESENT row
// whose JSON value is `null` (or otherwise malformed) is NEVER mistaken for an
// ABSENT row. Callers must build a `ControlRead` from the raw transaction record
// (`AppStateRecord | null`) BEFORE decoding — never via `?.value ?? null`, which
// collapses a present-null value into absence.

/** A durable control read that keeps row presence separate from its value. */
export type ControlRead = { present: boolean; value: unknown };

/** Build a `ControlRead` from a raw transaction/store record (never `?? null`). */
export function toControlRead(row: { value: unknown } | null | undefined): ControlRead {
  return row ? { present: true, value: row.value } : { present: false, value: undefined };
}

/**
 * A witness ROW's mere PRESENCE forbids legacy ownership. A present witness is
 * either the valid write-once `{ everExisted: true }` (history definitely
 * existed) or a malformed/JSON-null value (which can NEVER prove history never
 * existed) — both fail safe. Only a genuinely ABSENT witness row proves no
 * history.
 */
export function witnessSurvives(read: ControlRead): boolean {
  return read.present;
}

/** Presence-aware resolution of the activation record for a decision. */
export type ResolvedActivation =
  | { kind: 'valid'; record: ActivationControlRecord }
  | { kind: 'malformed' } // present but not a valid record → fail safe (read-only-safe)
  | { kind: 'absent' }; // no row at all

export function resolveActivation(read: ControlRead): ResolvedActivation {
  if (!read.present) return { kind: 'absent' };
  const record = validateActivationRecord(read.value);
  return record ? { kind: 'valid', record } : { kind: 'malformed' };
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
 * Whether a LEGACY (pre-revision) write may commit, given the PRESENCE-AWARE
 * activation read, whether the global witness survives, and whether THIS
 * partition already carries revision history (a ledger row or a partition commit
 * stamp). Blocking is always safe. A PRESENT-but-malformed activation record
 * (including a JSON-null value) fails safe to `read-only-safe`; only a genuinely
 * ABSENT record with NO surviving history may write.
 */
export function classifyLegacyWrite(
  activation: ControlRead,
  witnessSurvives: boolean,
  partitionHasRevisionHistory: boolean
): LegacyWriteGate {
  const resolved = resolveActivation(activation);
  if (resolved.kind === 'malformed') {
    // Present but invalid → never normalized, never treated as legacy.
    return { allow: false, reason: 'fenced-malformed', state: 'read-only-safe' };
  }
  if (resolved.kind === 'absent') {
    // Genuinely absent → `legacy` ONLY when NO revision history survives;
    // otherwise a lost activation row must not resurrect legacy writing.
    if (witnessSurvives || partitionHasRevisionHistory) {
      return { allow: false, reason: 'fenced-revision-history', state: 'read-only-safe' };
    }
    return { allow: true };
  }
  const record = resolved.record;
  if (record.state !== 'legacy') {
    return { allow: false, reason: 'fenced-non-legacy', state: record.state };
  }
  // State is legacy — fail safe: any surviving revision witness refuses.
  if (witnessSurvives || partitionHasRevisionHistory || record.revisionedEvidenceEverExisted) {
    return { allow: false, reason: 'fenced-revision-history', state: 'read-only-safe' };
  }
  return { allow: true };
}

export type RevisionedWriteGate =
  | { allow: true }
  | { allow: false; state: ActivationState | 'absent' | 'malformed' };

/**
 * Whether a REVISIONED write may commit — ONLY when the PRESENT activation record
 * is a VALID `active`. A present-but-malformed record fails safe (`malformed`,
 * never normalized); a genuinely absent record is `absent`.
 */
export function classifyRevisionedWrite(activation: ControlRead): RevisionedWriteGate {
  const resolved = resolveActivation(activation);
  if (resolved.kind === 'absent') return { allow: false, state: 'absent' };
  if (resolved.kind === 'malformed') return { allow: false, state: 'malformed' };
  if (resolved.record.state !== 'active') return { allow: false, state: resolved.record.state };
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
    // Activation row absent → `legacy` ONLY when the witness row is ALSO absent.
    // ANY present witness row (valid OR malformed/JSON-null) fails safe.
    const witnessRow = await getAppState<unknown>(
      ACTIVATION_CONTROL_SCOPE,
      REVISIONED_EVIDENCE_WITNESS_KEY
    );
    if (witnessSurvives(toControlRead(witnessRow))) {
      return {
        schemaVersion: 1,
        state: 'read-only-safe',
        updatedAt: '',
        revisionedEvidenceEverExisted: true,
        reason: 'activation record absent but a revisioned-evidence witness row survives',
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

export type ActivationTransitionReason =
  | 'legacy-forbidden-after-evidence'
  | 'invalid-transition'
  | 'activation-state-malformed'
  | 'store-unavailable';

export type ActivationTransitionResult =
  | { ok: true; record: ActivationControlRecord }
  | {
      ok: false;
      reason: ActivationTransitionReason;
      current?: ActivationControlRecord;
    };

/**
 * Whether `current.state → next` is a permitted transition. The graph is STRICTLY
 * FORWARD-ONLY (PLATFORM-086H3B-ACTIVATION-STATE-CORRUPTION-REMEDIATION):
 *
 *   legacy → armed, armed → active, armed → read-only-safe, active → read-only-safe
 *
 * There is NO path back to `legacy` from any other state (arming is irreversible
 * even before evidence commits), and `read-only-safe` is TERMINAL. Idempotent
 * same-state requests are permitted where safe; a same-state `legacy` request is
 * refused when revisioned history survives (`hasHistory`), so idempotence can
 * never mask a resurrection. Pure — the transactional setter applies the result.
 */
export function classifyActivationTransition(
  current: ActivationControlRecord,
  next: ActivationState,
  hasHistory: boolean
): { ok: true } | { ok: false; reason: 'legacy-forbidden-after-evidence' | 'invalid-transition' } {
  if (next === current.state) {
    // Idempotent — safe EXCEPT staying `legacy` while revisioned history survives.
    if (next === 'legacy' && hasHistory) {
      return { ok: false, reason: 'legacy-forbidden-after-evidence' };
    }
    return { ok: true };
  }
  switch (next) {
    case 'legacy':
      // No backward path to legacy from armed / active / read-only-safe.
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
        // Presence-aware reads — a present-null / malformed row is NEVER absence.
        const activation = resolveActivation(toControlRead(await txn.read<unknown>()));
        const survives = witnessSurvives(
          toControlRead(
            await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY)
          )
        );

        // A present-but-malformed activation record fails safe: refuse EVERY
        // transition and NEVER normalize it to a default `legacy` record.
        if (activation.kind === 'malformed') {
          return { ok: false, reason: 'activation-state-malformed' };
        }
        // An absent activation record whose evidence witness nevertheless survives
        // is an inconsistent (read-only-safe) state — refuse, never resurrect.
        if (activation.kind === 'absent' && survives) {
          return { ok: false, reason: 'activation-state-malformed' };
        }

        const current =
          activation.kind === 'valid' ? activation.record : defaultActivationRecord(now);
        const hasHistory = survives || current.revisionedEvidenceEverExisted;
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
  // Write the witness ONLY when its row is genuinely ABSENT — a present row
  // (valid write-once witness OR a malformed value) is left byte-identical
  // (never cleared, never normalized).
  const witnessRow = await txn.readKey<unknown>(
    ACTIVATION_CONTROL_SCOPE,
    REVISIONED_EVIDENCE_WITNESS_KEY
  );
  if (witnessRow === null) {
    await txn.writeKey<RevisionedEvidenceWitness>(
      ACTIVATION_CONTROL_SCOPE,
      REVISIONED_EVIDENCE_WITNESS_KEY,
      { everExisted: true, firstAt: now }
    );
  }
  const record = validateActivationRecord(
    (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY))?.value
  );
  if (record && !record.revisionedEvidenceEverExisted) {
    await txn.writeKey<ActivationControlRecord>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY, {
      ...record,
      revisionedEvidenceEverExisted: true,
      updatedAt: now,
    });
  }
}
