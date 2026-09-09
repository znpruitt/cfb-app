import { randomUUID } from 'node:crypto';

import type { CanonicalSlateResult } from './canonicalSlate.ts';
import { GAME_STATS_SCOPE, getGameStatsKey } from './cache.ts';
import type { GameStatsIngestionResult } from './ingestionCoordinator.ts';
import { evaluatePartitionCoverage } from './partitionCoverage.ts';
import { validateGameStatsEnvelope } from './publicProjection.ts';
import {
  readReconciliationLedger,
  reserveReconciliationAttempt,
  settleReconciliationAttempt,
  summarizeReconciliationPasses,
  type ReconciliationEntryOutcome,
  type ReconciliationReservation,
} from './reconciliationLedger.ts';
import {
  isReconcilablePartitionState,
  listReconciliationCandidates,
  reconciliationPartitionKey,
  type ReconciliationPass,
  type ReconciliationPassState,
  type ReconciliationTarget,
} from './reconciliationTarget.ts';
import { getAppState } from '../server/appStateStore.ts';

/**
 * PLATFORM-110B — the run-scoped adapter between the game-stats cron and the
 * correction-reconciliation authority.
 *
 * It exists so the route stays wiring: the cron asks whether a bounded
 * correction pass is due, and if one is, gets back the target it must fetch, the
 * report block it must attach to every response, and the two calls that bracket
 * the provider request — `reserve` before it, `settle` after. The cadence lives
 * in `reconciliationTarget.ts` and the durable record in
 * `reconciliationLedger.ts`; this module holds neither, and performs no provider
 * access, no merge, and no provider-refresh status recording.
 */

/**
 * Whether an ingestion result means the durable merge authority actually
 * COMPARED this partition and ruled on it — the only thing that may close a
 * pass.
 *
 * The distinction this predicate exists for, found by review and then observed
 * live: `ingestGameStatsPartitionResponse` returns a typed `merge-result` for
 * `unavailable` too, so "ingestion returned a typed result" is not the same as
 * "the partition was compared". A `control-not-active` refusal during a
 * writer-control transition compares nothing — and under the old rule it closed
 * the pass, which would have silently consumed every due correction in the
 * season for the length of a maintenance window.
 *
 *   - `written` / `partially-merged` / `unchanged` / `stale` / `conflict` — the
 *     merge read the partition under its lock and ruled. Asking again would
 *     spend a call to be told the same thing.
 *   - An exactly-empty provider response — CFBD authoritatively says the
 *     partition has no rows. Also a verdict.
 *   - `unavailable` (store, lock, or writer-control refusal), `indeterminate`
 *     (durability unknown), and a rejected payload (`invalid-payload` /
 *     `no-persistable-observations`) — nothing was compared. The pass stays open
 *     and the attempt cap bounds the retries.
 */
export function reachedMergeVerdict(result: GameStatsIngestionResult): boolean {
  if (result.kind === 'no-op') return true;
  if (result.kind === 'rejected') return false;
  switch (result.merge.outcome) {
    case 'written':
    case 'partially-merged':
    case 'unchanged':
    case 'stale':
    case 'conflict':
      return true;
    case 'unavailable':
    case 'indeterminate':
      return false;
  }
}

/**
 * What a reconciliation run reports about the pass it took. Present on EVERY
 * response of a reconciliation run — including a quota refusal, a missing
 * credential, a refused reservation, and a provider-fetch failure — so a reader
 * can always tell which job the invocation performed.
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
  /** How the durable reservation ended. `not-attempted` before one is made. */
  reservation: 'not-attempted' | ReconciliationReservation['status'];
  /** How the durable settlement ended, once the outcome is known. */
  settlement: 'not-settled' | 'settled' | 'not-found' | 'malformed' | 'write-failed';
};

/** The counts one settled attempt records, all from the merge authority. */
export type ReconciliationAttemptRecord = {
  reachedVerdict: boolean;
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
  /** Mutated in place by `reserve`/`settle`; attach it to the response. */
  report: ReconciliationReport;
  /**
   * Reserve this attempt durably. Call it AFTER the quota and credential gates
   * (so a refusal there burns nothing) and BEFORE the provider request.
   *
   * Returns whether the caller may spend. Anything other than `true` means the
   * attempt was not recorded and the request must NOT be issued — which is what
   * makes a store that cannot write unable to spend, instead of billing a call
   * on every run forever.
   */
  reserve: () => Promise<boolean>;
  /**
   * Record the outcome against the reserved attempt. Best-effort: a settlement
   * failure is REPORTED on `report.settlement` rather than thrown, because an
   * already-committed merge must never be relabelled by a bookkeeping fault. The
   * reservation stands either way, so the attempt is still counted and bounded.
   */
  settle: (attempt: ReconciliationAttemptRecord) => Promise<void>;
};

export type ReconciliationResolution =
  | { status: 'none' }
  /** The season ledger is unreadable or is not a ledger — fail closed, no fetch. */
  | { status: 'unavailable' }
  | { status: 'ok'; run: ReconciliationRun };

/**
 * Read one partition's committed record cache-only and evaluate its coverage
 * through the shared authority. A missing, mispaired, or unreadable record
 * yields `null`, which the caller treats as "not reconcilable" — failing toward
 * not spending, exactly as `pollingTarget` fails toward not spending on an
 * unprovable kickoff.
 */
async function partitionIsReconcilable(
  slate: Extract<CanonicalSlateResult, { status: 'available' }>['slate'],
  target: ReconciliationTarget
): Promise<boolean> {
  let stored: unknown;
  try {
    const record = await getAppState<unknown>(
      GAME_STATS_SCOPE,
      getGameStatsKey(target.year, target.week, target.seasonType)
    );
    stored = record?.value ?? null;
  } catch {
    return false;
  }
  const validation = validateGameStatsEnvelope(stored, target.year, target.week, target.seasonType);
  if (validation.status !== 'ok') return false;
  const coverage = evaluatePartitionCoverage(
    slate,
    target.week,
    target.seasonType,
    validation.record,
    'current'
  );
  return isReconcilablePartitionState(coverage.state);
}

/**
 * Resolve the single bounded correction pass this run may take, or `none`. The
 * caller invokes this ONLY when ordinary polling found no target, which is what
 * preserves the at-most-one-CFBD-call-per-run promise.
 *
 * Three gates, in increasing cost order:
 *
 *  1. **Time.** Cheapest, and it short-circuits before any durable read: pass
 *     state can only ever REMOVE candidates, so "nothing is time-due" already
 *     proves "nothing is due". On the ordinary quiet run — most of them —
 *     reconciliation costs no durable read at all.
 *  2. **The ledger.** One read. Unreadable or malformed suppresses the pass
 *     instead of defaulting to "nothing has run", because reading a corrupt
 *     record as empty would re-run every pass of the season on every invocation.
 *  3. **Coverage.** One read per still-eligible candidate, in selection order,
 *     until one is `complete`. This is the ruling that reconciliation revisits
 *     SATISFIED partitions only: a pass that filled a partition polling never
 *     collected would hide the collection gap rather than surface it.
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

  const candidates = listReconciliationCandidates({ slate, now, passState });
  let target: ReconciliationTarget | null = null;
  for (const candidate of candidates) {
    if (await partitionIsReconcilable(slate, candidate)) {
      target = candidate;
      break;
    }
  }
  if (target === null) return { status: 'none' };

  const report: ReconciliationReport = {
    pass: target.pass,
    dueAt: target.dueAt,
    anchorKickoff: target.anchorKickoff,
    corrected: null,
    reservation: 'not-attempted',
    settlement: 'not-settled',
  };
  const attemptId = randomUUID();
  const partitionKey = reconciliationPartitionKey(target);

  return {
    status: 'ok',
    run: {
      target,
      report,
      reserve: async () => {
        const reservation = await reserveReconciliationAttempt({
          year,
          partitionKey,
          pass: target.pass,
          dueAt: target.dueAt,
          attemptId,
          reservedAt: new Date().toISOString(),
        });
        report.reservation = reservation.status;
        return reservation.status === 'reserved';
      },
      settle: async (attempt) => {
        const settlement = await settleReconciliationAttempt(year, attemptId, {
          reachedVerdict: attempt.reachedVerdict,
          outcome: attempt.outcome,
          reason: attempt.reason,
          observedAt: attempt.observedAt,
          corrected: attempt.corrected,
          refreshed: attempt.refreshed,
          inserted: attempt.inserted,
          conflicts: attempt.conflicts,
          stale: attempt.stale,
          notObserved: attempt.notObserved,
        });
        // `corrected` stays null unless the merge actually compared the
        // partition — a transport failure corrected nothing, but reporting `0`
        // would claim the partition was compared and found clean.
        if (attempt.reachedVerdict) report.corrected = attempt.corrected;
        report.settlement = settlement.status;
      },
    },
  };
}
