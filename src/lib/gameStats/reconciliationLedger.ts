import {
  RECONCILIATION_PASS_ORDER,
  reconciliationPassKey,
  type ReconciliationPass,
  type ReconciliationPassState,
} from './reconciliationTarget.ts';
import { getAppState, withAppStateKeyTransaction } from '../server/appStateStore.ts';

/**
 * PLATFORM-110B — the durable record of what correction reconciliation actually
 * did (`app_state` scope `game-stats-reconciliation`, one row per season year).
 *
 * It exists for three jobs, and each is a stated requirement rather than
 * observability for its own sake:
 *
 *  1. **It records changed games and failures, per run, truthfully.** The merge
 *     authority's own counts are copied verbatim — `corrected` is
 *     `merge.updated`, the games whose stored content actually changed, kept
 *     separate from `refreshed` (re-confirmed identical at a newer fence) so a
 *     pass that found nothing wrong can never read as a pass that fixed
 *     something.
 *  2. **It bounds the work.** Dueness is derived from the calendar and never
 *     expires, so without a record of what has run, a partition would be
 *     refetched on every invocation forever. A pass is closed by ONE attempt
 *     that reached ingestion, or by `RECONCILIATION_MAX_ATTEMPTS` attempts that
 *     did not.
 *  3. **It can retire the +7d pass.** That pass is insurance against an
 *     unmeasured interval, not a measured need. A season of `p2` entries whose
 *     `corrected` is uniformly zero is the evidence that removes it — which only
 *     works if the number is written down where it survives log retention.
 *
 * ## Missed-run recovery, and the two different bounds it needs
 *
 * An entry is appended for every run that ISSUED a provider request — whether
 * the response reached ingestion or the transport failed. A run that never got
 * that far (automation paused, quota below reserve, credential missing, or this
 * ledger unreadable) appends NOTHING, so the pass stays due and the next run
 * retries it. A skipped day can therefore never mean a permanently skipped
 * correction, and a quota-starved month burns no passes.
 *
 * Those are two different bounds because they answer two different risks.
 * `reachedIngestion` closes a pass immediately: the provider answered and the
 * merge authority ruled, so asking again would spend a call to be told the same
 * thing. `RECONCILIATION_MAX_ATTEMPTS` bounds the other case: dueness never
 * expires, so a partition CFBD keeps failing on would otherwise be refetched
 * every run forever. A `p1` exhausted by a provider outage is not a lost
 * correction — `p2` is still due at +7 days and backstops it.
 *
 * ## Reading fails CLOSED
 *
 * An unreadable or malformed ledger suppresses reconciliation for that run
 * rather than defaulting to "nothing has run". Treating a corrupt record as an
 * empty one would re-run every pass of the season on every invocation, which is
 * the quota failure this record exists to prevent — the same fail-toward-
 * -not-spending stance `pollingTarget` takes on an unprovable kickoff.
 */

export const RECONCILIATION_LEDGER_SCOPE = 'game-stats-reconciliation';

/** Durable key for one season's ledger. */
export function reconciliationLedgerKey(year: number): string {
  return String(year);
}

/**
 * How a recorded attempt ended — the ingestion interpreter's four kinds, copied
 * verbatim with its exact reason. An attempt that never reached the interpreter
 * (a transport failure, or a throw out of ingestion) records `failure` with the
 * route's own stable reason. `reachedIngestion` on the entry, NOT this field, is
 * what closes a pass.
 */
export type ReconciliationEntryOutcome = 'success' | 'partial' | 'no-op' | 'failure';

export type ReconciliationLedgerEntry = {
  /** `year:week:seasonType`, the durable partition key. */
  partitionKey: string;
  pass: ReconciliationPass;
  /** ISO instant the pass fell due (`anchorKickoff + offset`). */
  dueAt: string;
  /** ISO observation fence — when the provider request STARTED. */
  observedAt: string;
  /**
   * True when the provider response reached the ingestion coordinator and it
   * returned a typed result. This — not the outcome — is what closes the pass.
   */
  reachedIngestion: boolean;
  outcome: ReconciliationEntryOutcome;
  /** The interpreter's exact reason, or a route-level reason for a throw. */
  reason: string;
  /** Games whose stored content the merge CHANGED. The number `p2` is judged on. */
  corrected: number;
  /** Games re-confirmed identical at a strictly newer fence (fence-only write). */
  refreshed: number;
  /** Games the partition did not previously hold. */
  inserted: number;
  /** Games the merge refused rather than mutate. */
  conflicts: number;
  /** Observations older than the stored fence, refused. */
  stale: number;
  /** Stored games the provider response did not carry, retained untouched. */
  notObserved: number;
};

export type ReconciliationLedger = {
  year: number;
  entries: ReconciliationLedgerEntry[];
};

/**
 * A hard ceiling on one season's row. Two passes over ~20 partitions with a
 * three-attempt cap is at most ~120 entries; 400 leaves generous headroom while
 * keeping the durable value's growth PROVABLY bounded rather than bounded by an
 * argument about how many partitions a season has.
 */
export const RECONCILIATION_LEDGER_MAX_ENTRIES = 400;

export type ReconciliationLedgerRead =
  | { status: 'ok'; ledger: ReconciliationLedger }
  /** No ledger yet for this season — a legitimate, cacheable absence. */
  | { status: 'absent' }
  /** A record exists but is not a ledger. Fails closed; never read as absent. */
  | { status: 'malformed' }
  /** The store itself failed. Distinct from absence, and also fails closed. */
  | { status: 'read-failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isPass(value: unknown): value is ReconciliationPass {
  return RECONCILIATION_PASS_ORDER.includes(value as ReconciliationPass);
}

function isOutcome(value: unknown): value is ReconciliationEntryOutcome {
  return value === 'success' || value === 'partial' || value === 'no-op' || value === 'failure';
}

/**
 * Strictly parse one stored entry. A single malformed member makes the WHOLE
 * record malformed rather than being dropped: silently discarding an entry would
 * reopen a pass that had already run, which is exactly the double-spend this
 * record prevents.
 */
function parseEntry(value: unknown): ReconciliationLedgerEntry | null {
  if (!isRecord(value)) return null;
  const {
    partitionKey,
    pass,
    dueAt,
    observedAt,
    reachedIngestion,
    outcome,
    reason,
    corrected,
    refreshed,
    inserted,
    conflicts,
    stale,
    notObserved,
  } = value;
  if (typeof partitionKey !== 'string' || partitionKey.length === 0) return null;
  if (!isPass(pass)) return null;
  if (typeof dueAt !== 'string' || typeof observedAt !== 'string') return null;
  if (typeof reachedIngestion !== 'boolean') return null;
  if (!isOutcome(outcome)) return null;
  if (typeof reason !== 'string') return null;
  const counts = {
    corrected: finiteNonNegativeInt(corrected),
    refreshed: finiteNonNegativeInt(refreshed),
    inserted: finiteNonNegativeInt(inserted),
    conflicts: finiteNonNegativeInt(conflicts),
    stale: finiteNonNegativeInt(stale),
    notObserved: finiteNonNegativeInt(notObserved),
  };
  for (const count of Object.values(counts)) {
    if (count === null) return null;
  }
  return {
    partitionKey,
    pass,
    dueAt,
    observedAt,
    reachedIngestion,
    outcome,
    reason,
    corrected: counts.corrected!,
    refreshed: counts.refreshed!,
    inserted: counts.inserted!,
    conflicts: counts.conflicts!,
    stale: counts.stale!,
    notObserved: counts.notObserved!,
  };
}

/** Strictly parse a stored ledger value for `year`. Never coerces. */
export function parseReconciliationLedger(
  value: unknown,
  year: number
): ReconciliationLedger | null {
  if (!isRecord(value)) return null;
  if (value.year !== year) return null;
  if (!Array.isArray(value.entries)) return null;
  const entries: ReconciliationLedgerEntry[] = [];
  for (const raw of value.entries) {
    const entry = parseEntry(raw);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { year, entries };
}

/** Read one season's ledger, distinguishing absence from corruption from a store failure. */
export async function readReconciliationLedger(year: number): Promise<ReconciliationLedgerRead> {
  let record: { value: unknown } | null;
  try {
    record = await getAppState<unknown>(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(year));
  } catch {
    return { status: 'read-failed' };
  }
  if (record === null || record.value === null || record.value === undefined) {
    return { status: 'absent' };
  }
  const ledger = parseReconciliationLedger(record.value, year);
  return ledger === null ? { status: 'malformed' } : { status: 'ok', ledger };
}

/**
 * Collapse a ledger into the per-pass state the target selector consumes:
 * attempts recorded, and whether any of them reached ingestion.
 */
export function summarizeReconciliationPasses(
  ledger: ReconciliationLedger
): Map<string, ReconciliationPassState> {
  const summary = new Map<string, ReconciliationPassState>();
  for (const entry of ledger.entries) {
    const key = reconciliationPassKey(entry.partitionKey, entry.pass);
    const existing = summary.get(key);
    if (existing === undefined) {
      summary.set(key, { attempts: 1, reachedIngestion: entry.reachedIngestion });
    } else {
      existing.attempts += 1;
      existing.reachedIngestion = existing.reachedIngestion || entry.reachedIngestion;
    }
  }
  return summary;
}

export type ReconciliationAppendResult =
  | { status: 'appended' }
  /** The pass was already closed by a concurrent run; nothing was written. */
  | { status: 'already-closed' }
  /** The season row is at its ceiling; nothing was written. */
  | { status: 'ledger-full' }
  /** A stored value that is not a ledger is never overwritten. */
  | { status: 'malformed' }
  /**
   * The append did not happen because the store failed — at the transaction's
   * read, its write, or its commit; the three are not distinguished because the
   * caller's decision is the same for all of them. The pass stays due, so the
   * only cost is one repeated CFBD call on a later run.
   */
  | { status: 'write-failed' };

/**
 * Append one attempt under the season row's advisory lock, so two overlapping
 * invocations cannot drop one another's entry.
 *
 * Idempotence is by CLOSURE, not by exact-duplicate detection: if the pass is
 * already closed when this transaction runs, the append is skipped. Two runs
 * that genuinely both spent a call both record — that is the truth, and the
 * attempt cap is what bounds it.
 *
 * A malformed stored value is REFUSED rather than replaced. Overwriting it would
 * erase the record of every pass that had already run and reopen them all.
 */
export async function appendReconciliationEntry(
  year: number,
  entry: ReconciliationLedgerEntry
): Promise<ReconciliationAppendResult> {
  try {
    return await withAppStateKeyTransaction(
      RECONCILIATION_LEDGER_SCOPE,
      reconciliationLedgerKey(year),
      async (txn) => {
        const stored = await txn.read<unknown>();
        let ledger: ReconciliationLedger;
        if (stored === null || stored.value === null || stored.value === undefined) {
          ledger = { year, entries: [] };
        } else {
          const parsed = parseReconciliationLedger(stored.value, year);
          if (parsed === null) return { status: 'malformed' as const };
          ledger = parsed;
        }
        const closed = summarizeReconciliationPasses(ledger).get(
          reconciliationPassKey(entry.partitionKey, entry.pass)
        );
        if (closed?.reachedIngestion === true) return { status: 'already-closed' as const };
        if (ledger.entries.length >= RECONCILIATION_LEDGER_MAX_ENTRIES) {
          return { status: 'ledger-full' as const };
        }
        await txn.write<ReconciliationLedger>({
          year,
          entries: [...ledger.entries, entry],
        });
        return { status: 'appended' as const };
      }
    );
  } catch {
    return { status: 'write-failed' };
  }
}
