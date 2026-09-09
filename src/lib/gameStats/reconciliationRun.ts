import type { CanonicalSlateResult } from './canonicalSlate.ts';
import {
  appendReconciliationEntry,
  readReconciliationLedger,
  summarizeReconciliationPasses,
  type ReconciliationAppendResult,
  type ReconciliationEntryOutcome,
} from './reconciliationLedger.ts';
import {
  listReconciliationCandidates,
  reconciliationPartitionKey,
  selectReconciliationTarget,
  type ReconciliationPass,
  type ReconciliationPassState,
  type ReconciliationTarget,
} from './reconciliationTarget.ts';

/**
 * PLATFORM-110B — the run-scoped adapter between the game-stats cron and the
 * correction-reconciliation authority.
 *
 * It exists so the route stays wiring: the cron asks whether a bounded
 * correction pass is due, and if one is, gets back the target it must fetch, the
 * report block it must attach to every response, and one function to record what
 * the attempt did. The cadence lives in `reconciliationTarget.ts` and the durable
 * record in `reconciliationLedger.ts`; this module holds neither, and performs no
 * provider access, no merge, and no status recording — those stay the unchanged
 * ones the ordinary polling path already uses.
 */

/**
 * What a reconciliation run reports about the pass it took. Present on EVERY
 * response of a reconciliation run — including a quota refusal, a missing
 * credential, and a provider-fetch failure — so a reader can always tell which
 * job the invocation performed.
 */
export type ReconciliationReport = {
  pass: ReconciliationPass;
  dueAt: string;
  anchorKickoff: string;
  /**
   * Games whose stored content the merge CHANGED. `null` until a merge produces
   * a count — a transport failure corrected nothing, but reporting `0` would
   * claim the partition was compared and found clean.
   */
  corrected: number | null;
  /** How the durable ledger append ended, or `not-attempted` before one is made. */
  ledger: 'not-attempted' | ReconciliationAppendResult['status'];
};

/** The counts one attempt contributes to the ledger, all from the merge authority. */
export type ReconciliationAttemptRecord = {
  /**
   * True only when the ingestion coordinator returned a typed result and the
   * interpreter ruled on it. This — not the outcome — CLOSES the pass.
   */
  reachedIngestion: boolean;
  outcome: ReconciliationEntryOutcome;
  reason: string;
  corrected: number;
  refreshed: number;
  inserted: number;
  conflicts: number;
  stale: number;
  notObserved: number;
  /** The observation fence: when the provider request STARTED. */
  observedAt: string;
};

export type ReconciliationRun = {
  target: ReconciliationTarget;
  /** Mutated in place by {@link ReconciliationRun.record}; attach it to the response. */
  report: ReconciliationReport;
  /**
   * Record one attempt durably. Call ONLY once the provider REQUEST has been
   * issued, so a run that spent nothing — paused, quota refused, credential
   * missing, ledger unreadable — leaves the pass due and the next run retries
   * it. That is the missed-run recovery guarantee.
   *
   * Best-effort by construction: an append failure is REPORTED on `report.ledger`
   * rather than thrown, because an already-committed merge must never be
   * relabelled by a bookkeeping fault. Call it AFTER the merge, never before: a
   * crash in between must cost one repeated call, never a skipped correction.
   */
  record: (attempt: ReconciliationAttemptRecord) => Promise<void>;
};

export type ReconciliationResolution =
  | { status: 'none' }
  /** The season ledger is unreadable or is not a ledger — fail closed, no fetch. */
  | { status: 'unavailable' }
  | { status: 'ok'; run: ReconciliationRun };

/**
 * Resolve the single bounded correction pass this run may take, or `none`.
 * The caller invokes this ONLY when ordinary polling found no target, which is
 * what preserves the at-most-one-CFBD-call-per-run promise.
 *
 * The time check runs FIRST, against an empty pass state, and short-circuits
 * before the durable ledger read. That is safe rather than merely cheap: pass
 * state can only ever REMOVE candidates (a closed pass, or one at its attempt
 * cap), so "nothing is time-due" already proves "nothing is due". On the ordinary
 * quiet run — which is most of them — reconciliation therefore costs no durable
 * read at all.
 *
 * An unreadable or malformed ledger suppresses the pass instead of defaulting to
 * "nothing has run". Reading a corrupt record as empty would re-run every pass of
 * the season on every invocation; failing closed costs one delayed correction.
 */
export async function resolveReconciliationRun(
  year: number,
  now: Date,
  slateResult: CanonicalSlateResult
): Promise<ReconciliationResolution> {
  if (slateResult.status !== 'available') return { status: 'none' };
  const slate = slateResult.slate;

  const timeDue = listReconciliationCandidates({ slate, now, passState: new Map() });
  if (timeDue.length === 0) return { status: 'none' };

  const read = await readReconciliationLedger(year);
  if (read.status === 'malformed' || read.status === 'read-failed') {
    return { status: 'unavailable' };
  }
  const passState: ReadonlyMap<string, ReconciliationPassState> =
    read.status === 'ok' ? summarizeReconciliationPasses(read.ledger) : new Map();

  const target = selectReconciliationTarget({ slate, now, passState });
  if (target === null) return { status: 'none' };

  const report: ReconciliationReport = {
    pass: target.pass,
    dueAt: target.dueAt,
    anchorKickoff: target.anchorKickoff,
    corrected: null,
    ledger: 'not-attempted',
  };

  return {
    status: 'ok',
    run: {
      target,
      report,
      record: async (attempt) => {
        const append = await appendReconciliationEntry(year, {
          partitionKey: reconciliationPartitionKey(target),
          pass: target.pass,
          dueAt: target.dueAt,
          observedAt: attempt.observedAt,
          reachedIngestion: attempt.reachedIngestion,
          outcome: attempt.outcome,
          reason: attempt.reason,
          corrected: attempt.corrected,
          refreshed: attempt.refreshed,
          inserted: attempt.inserted,
          conflicts: attempt.conflicts,
          stale: attempt.stale,
          notObserved: attempt.notObserved,
        });
        if (attempt.reachedIngestion) report.corrected = attempt.corrected;
        report.ledger = append.status;
      },
    },
  };
}
