import {
  AppStateKeyLockAcquireError,
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  withAppStateKeyTransaction,
} from '../server/appStateStore.ts';
import {
  WRITER_CONTROL_KEY,
  WRITER_CONTROL_RECORD_VERSION,
  WRITER_CONTROL_SCOPE,
  toWriterControlRead,
  type WriterControlRecord,
  type WriterControlState,
} from './writerFence.ts';

/**
 * PLATFORM-086H3D — strict writer-control transition authority (DORMANT).
 *
 * The single atomic operation that moves the existing
 * `game-stats-writer-control/state` record between rollout states. It completes
 * the fence PLATFORM-086H3B deployed: the fenced legacy writer and the dormant
 * H2 merge service both reread this record inside their own partition
 * transactions, so a committed transition here is a serialization barrier — a
 * writer holding the control lock finishes first, and every writer arriving
 * after the transition rereads the new state and refuses.
 *
 * The transition graph is CLOSED and directional:
 *
 *   legacy ⇄ armed → active ⇄ read-only-safe
 *
 * i.e. exactly `legacy→armed`, `armed→legacy`, `armed→active`,
 * `active→read-only-safe`, and `read-only-safe→active`. Everything else refuses
 * without writing — same-state requests, every unlisted edge, and (by
 * construction: no state after `armed` has an edge back) EVERY return to
 * `legacy` after activation. There is no repair, force, or reset path: an
 * absent or malformed record refuses untouched, and an expected-state mismatch
 * refuses with the actual state so the operator rereads before acting.
 *
 * The reread, expected-state check, edge validation, and conditional write all
 * run in ONE transaction rooted (and advisory-locked) on the control key, and
 * only the exact existing `{recordVersion, state}` shape is ever persisted.
 * Success is reported ONLY after the transaction commits; a commit whose
 * acknowledgement was lost after mutation SQL was submitted is a typed
 * `store-indeterminate` (either state may be durable — the operator must
 * REREAD, never retry blindly), and every other store failure is a typed
 * `store-unavailable` with no durable transition.
 *
 * DORMANT: no route, cron, reader, or production caller invokes this. Its only
 * caller is the operator CLI (`scripts/transition-game-stats-writer-control.ts`),
 * and the recursive dormant-boundary guard forbids any live import. Deploying
 * this capability performs NO transition — production stays `legacy` until the
 * staged rollout (E) executes the documented runbook.
 */

/** The closed transition graph: every permitted `from → to` edge. */
const ALLOWED_TRANSITIONS: Readonly<Record<WriterControlState, readonly WriterControlState[]>> = {
  legacy: ['armed'],
  armed: ['legacy', 'active'],
  active: ['read-only-safe'],
  'read-only-safe': ['active'],
};

/** Whether `from → to` is one of the five permitted edges (never same-state). */
export function isAllowedWriterControlTransition(
  from: WriterControlState,
  to: WriterControlState
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type WriterControlTransitionRequest = {
  /** The state the operator believes is durably current — revalidated in-transaction. */
  expected: WriterControlState;
  /** The requested next state. */
  to: WriterControlState;
  /** `false` = read-only dry run (validate everything, write nothing). */
  apply: boolean;
};

/**
 * The bounded outcome vocabulary. Only `transitioned` claims a durable
 * transition, and only after a confirmed COMMIT. `would-transition` is the
 * dry-run report — it is NOT a reservation; a later apply repeats the whole
 * atomic check. Every `refused` and `store-unavailable` outcome is
 * KNOWN-UNCHANGED (nothing was written, or the transaction provably persisted
 * nothing). `store-indeterminate` is UNCERTAIN: mutation SQL was submitted and
 * the transaction could not be confirmed committed or cleanly rolled back, so
 * EITHER state may be durable — reread the record; do not retry, repair, or
 * infer which state won.
 */
export type WriterControlTransitionOutcome =
  | { kind: 'transitioned'; from: WriterControlState; to: WriterControlState }
  | { kind: 'would-transition'; from: WriterControlState; to: WriterControlState }
  | { kind: 'refused'; reason: 'control-absent' }
  | { kind: 'refused'; reason: 'control-malformed' }
  | {
      kind: 'refused';
      reason: 'expected-state-mismatch';
      expected: WriterControlState;
      actual: WriterControlState;
    }
  | { kind: 'refused'; reason: 'forbidden-edge'; from: WriterControlState; to: WriterControlState }
  | { kind: 'store-unavailable' }
  | { kind: 'store-indeterminate' };

/**
 * Atomically transition the writer-control record, or refuse without writing.
 *
 * One `withAppStateKeyTransaction` rooted on the control key runs, in order:
 * the presence-aware reread, the strict parse, the expected-state check, the
 * edge validation, and (apply only) the conditional write of the exact
 * `{recordVersion, state}` shape. Concurrent commands with the same expected
 * state therefore serialize on the control lock: at most one commits, and the
 * loser rereads the committed state and refuses with a truthful mismatch.
 *
 * Store failures are typed, never collapsed into success: a lock-acquisition
 * failure, a failed read/write with a confirmed rollback, or a finalize that
 * provably submitted no mutation SQL is `store-unavailable` (no durable
 * transition); a finalize/cleanup failure AFTER mutation SQL was submitted is
 * `store-indeterminate` (either state may be durable — reread required). An
 * unexpected programming defect (e.g. a lock-order violation) throws loudly.
 */
export async function transitionWriterControl(
  request: WriterControlTransitionRequest
): Promise<WriterControlTransitionOutcome> {
  try {
    return await withAppStateKeyTransaction<WriterControlTransitionOutcome>(
      WRITER_CONTROL_SCOPE,
      WRITER_CONTROL_KEY,
      async (txn) => {
        let read: ReturnType<typeof toWriterControlRead>;
        try {
          read = toWriterControlRead(await txn.read<unknown>());
        } catch {
          // Failed reread with nothing staged: the transaction rolls back and
          // durable state is certainly untouched.
          return { kind: 'store-unavailable' };
        }
        if (!read.present) return { kind: 'refused', reason: 'control-absent' };
        if (read.record === null) return { kind: 'refused', reason: 'control-malformed' };
        const actual = read.record.state;
        if (actual !== request.expected) {
          return {
            kind: 'refused',
            reason: 'expected-state-mismatch',
            expected: request.expected,
            actual,
          };
        }
        if (!isAllowedWriterControlTransition(request.expected, request.to)) {
          return {
            kind: 'refused',
            reason: 'forbidden-edge',
            from: request.expected,
            to: request.to,
          };
        }
        if (!request.apply) {
          return { kind: 'would-transition', from: actual, to: request.to };
        }
        const next: WriterControlRecord = {
          recordVersion: WRITER_CONTROL_RECORD_VERSION,
          state: request.to,
        };
        try {
          await txn.write(next);
        } catch {
          // The write failed at staging/statement time; the transaction rolls
          // back before this result surfaces — no durable transition.
          return { kind: 'store-unavailable' };
        }
        // The primitive resolves ONLY after a confirmed COMMIT, so this result
        // never surfaces for an uncommitted transition.
        return { kind: 'transitioned', from: actual, to: request.to };
      }
    );
  } catch (error) {
    if (error instanceof AppStateTxnFinalizeError || error instanceof AppStateTxnCleanupError) {
      // The durability-uncertainty threshold is whether mutation SQL was
      // SUBMITTED — a lost COMMIT acknowledgement (or a failed rollback after a
      // submitted write) means EITHER state may be durable.
      return error.writeAttempted ? { kind: 'store-indeterminate' } : { kind: 'store-unavailable' };
    }
    if (error instanceof AppStateKeyLockAcquireError) {
      return { kind: 'store-unavailable' };
    }
    // Anything else is an unexpected programming/machinery defect — loud.
    throw error;
  }
}
