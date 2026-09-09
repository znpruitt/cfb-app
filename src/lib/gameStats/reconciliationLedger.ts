import {
  RECONCILIATION_MAX_ATTEMPTS,
  RECONCILIATION_PASS_ORDER,
  reconciliationPassKey,
  type ReconciliationPass,
  type ReconciliationPassState,
} from './reconciliationTarget.ts';
import { getAppState, withAppStateKeyTransaction } from '../server/appStateStore.ts';

/**
 * PLATFORM-110B — the durable record of what correction reconciliation did
 * (`app_state` scope `game-stats-reconciliation`, one row per season year).
 *
 * It exists for three jobs, and each is a stated requirement rather than
 * observability for its own sake:
 *
 *  1. **It records changed games and failures, per run, truthfully.** The merge
 *     authority's own counts are copied verbatim — `corrected` is
 *     `merge.updated`, kept apart from `refreshed` (re-confirmed identical at a
 *     newer fence) so a clean pass can never read as a repair.
 *  2. **It bounds the work.** Dueness is derived from the calendar and never
 *     expires, so without a record of what has run a partition would be
 *     refetched on every invocation forever.
 *  3. **It can retire the +7d pass.** That pass is insurance against an
 *     unmeasured interval, not a measured need. A season of `p2` entries whose
 *     `corrected` is uniformly zero is the evidence that removes it — which only
 *     works if the number is written down where it survives log retention.
 *
 * ## Reserve BEFORE the spend, settle after — the ordering is the safety property
 *
 * An attempt is RESERVED (a placeholder entry committed) before the provider
 * request is issued, and SETTLED (that entry replaced) once the outcome is
 * known. That ordering, not a lease, is what makes the bound real:
 *
 *   - **A store that cannot record cannot spend.** The first shape of this
 *     module appended after the fetch, so a persistent write failure — or a full
 *     season row — recorded nothing, left the pass due, and billed one CFBD call
 *     on every run forever. Reserving first converts that into refusing to fetch.
 *   - **The attempt cap is enforced inside the transaction**, so two concurrent
 *     invocations cannot both pass a check that each made against its own
 *     snapshot.
 *   - **Two runs that genuinely both spend a call both appear**, because each
 *     reserved before spending. The ledger cannot under-report spend.
 *
 * The cost is one extra durable write per reconciliation run (~40 a season), and
 * one failure mode moves rather than disappearing: a run that reserves and then
 * dies mid-flight leaves a `not-settled` attempt that counts against the cap. A
 * consumed attempt is a far better failure than an unbounded spend, and `p2`
 * still backstops `p1`.
 *
 * ## Missed-run recovery, and the two bounds it needs
 *
 * A run that never reserves — automation paused, quota below reserve, credential
 * missing, this ledger unreadable — records NOTHING, so the pass stays due and
 * the next run retries it. A skipped day can never mean a permanently skipped
 * correction, and a quota-starved month burns no passes.
 *
 * Two different bounds answer two different risks. `reachedVerdict` closes a
 * pass immediately: the merge authority compared the partition and ruled, so
 * asking again would spend a call to be told the same thing.
 * {@link RECONCILIATION_MAX_ATTEMPTS} bounds the other case — a partition the
 * provider or the store keeps failing on.
 *
 * ## Reading fails CLOSED
 *
 * An unreadable, malformed, or JSON-`null` ledger suppresses reconciliation for
 * that run rather than defaulting to "nothing has run". Treating a corrupt
 * record as an empty one would re-run every pass of the season on every
 * invocation, which is the quota failure this record exists to prevent.
 */

export const RECONCILIATION_LEDGER_SCOPE = 'game-stats-reconciliation';

/** Durable key for one season's ledger. */
export function reconciliationLedgerKey(year: number): string {
  return String(year);
}

/**
 * How a settled attempt ended — the ingestion interpreter's four kinds, copied
 * verbatim with its exact reason. An attempt that never reached the interpreter
 * (a transport failure, a throw out of ingestion, or a run that died between
 * reserving and settling) records `failure` with the route's own stable reason.
 * `reachedVerdict` on the entry, NOT this field, is what closes a pass.
 */
export type ReconciliationEntryOutcome = 'success' | 'partial' | 'no-op' | 'failure';

export type ReconciliationLedgerEntry = {
  /** Unique per attempt; the handle {@link settleReconciliationAttempt} replaces by. */
  attemptId: string;
  /** `year:week:seasonType`, the durable partition key. */
  partitionKey: string;
  pass: ReconciliationPass;
  /** ISO instant the pass fell due (`anchorKickoff + offset`). */
  dueAt: string;
  /** ISO instant this attempt was reserved — before any provider request. */
  reservedAt: string;
  /** ISO observation fence (when the provider request STARTED); null until settled. */
  observedAt: string | null;
  /**
   * True ONLY when the durable merge authority COMPARED this partition and
   * ruled: `written`, `partially-merged`, `unchanged`, `stale`, `conflict`, or
   * an authoritative empty provider response. It is false for everything that
   * never got that far — a transport failure, an unusable payload, a store or
   * writer-control refusal (`unavailable`), an `indeterminate` commit, or a run
   * that never settled. This, not the outcome, is what closes the pass.
   *
   * The distinction is the one this field exists for: an `unavailable` merge
   * returns a typed result while comparing nothing, so treating "ingestion
   * returned" as closure let a single writer-control transition consume every
   * due pass in the season.
   */
  reachedVerdict: boolean;
  outcome: ReconciliationEntryOutcome;
  /** The interpreter's exact reason, or a route-level reason. */
  reason: string;
  /**
   * Games whose stored content the merge CHANGED (`merge.updated`).
   *
   * Read it as "something in the stored row differs from the provider's current
   * evidence", not as "a consumer-visible statistic was corrected". Two measured
   * caveats, both real: a raw category the provider ADDS counts here even though
   * `publicProjection` never exposes an unrecognized category (observed
   * 2026-09-09 — `kickingPoints` absent → 7 on one team-side), and a stored
   * LEGACY row with no fence is classified `updated` unconditionally by the H2
   * merge computation, with no content comparison. The second is
   * unreachable for a current-season partition, whose rows can only have been
   * written under writer control `active`; the first is not. So a `p2` entry
   * with a nonzero `corrected` warrants a look before it is read as evidence the
   * pass earns its place.
   */
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
 * argument about how many partitions a season has. Reaching it REFUSES the
 * reservation, so a full row stops the spend instead of starting a refetch loop.
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
    attemptId,
    partitionKey,
    pass,
    dueAt,
    reservedAt,
    observedAt,
    reachedVerdict,
    outcome,
    reason,
  } = value;
  if (typeof attemptId !== 'string' || attemptId.length === 0) return null;
  if (typeof partitionKey !== 'string' || partitionKey.length === 0) return null;
  if (!isPass(pass)) return null;
  if (typeof dueAt !== 'string' || typeof reservedAt !== 'string') return null;
  if (observedAt !== null && typeof observedAt !== 'string') return null;
  if (typeof reachedVerdict !== 'boolean') return null;
  if (!isOutcome(outcome)) return null;
  if (typeof reason !== 'string') return null;
  const counts = {
    corrected: finiteNonNegativeInt(value.corrected),
    refreshed: finiteNonNegativeInt(value.refreshed),
    inserted: finiteNonNegativeInt(value.inserted),
    conflicts: finiteNonNegativeInt(value.conflicts),
    stale: finiteNonNegativeInt(value.stale),
    notObserved: finiteNonNegativeInt(value.notObserved),
  };
  for (const count of Object.values(counts)) {
    if (count === null) return null;
  }
  return {
    attemptId,
    partitionKey,
    pass,
    dueAt,
    reservedAt,
    observedAt,
    reachedVerdict,
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

/**
 * Read one season's ledger, distinguishing absence from corruption from a store
 * failure. A record that EXISTS but holds JSON `null` is MALFORMED, not absent:
 * a `jsonb` column can store `null`, and reading that as "no ledger" would
 * reopen every pass of the season. Absence is the missing ROW only.
 */
export async function readReconciliationLedger(year: number): Promise<ReconciliationLedgerRead> {
  let record: { value: unknown } | null;
  try {
    record = await getAppState<unknown>(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(year));
  } catch {
    return { status: 'read-failed' };
  }
  if (record === null) return { status: 'absent' };
  const ledger = parseReconciliationLedger(record.value, year);
  return ledger === null ? { status: 'malformed' } : { status: 'ok', ledger };
}

/**
 * Collapse a ledger into the per-pass state the target selector consumes:
 * attempts reserved, and whether any of them reached a merge verdict.
 */
export function summarizeReconciliationPasses(
  ledger: ReconciliationLedger
): Map<string, ReconciliationPassState> {
  const summary = new Map<string, ReconciliationPassState>();
  for (const entry of ledger.entries) {
    const key = reconciliationPassKey(entry.partitionKey, entry.pass);
    const existing = summary.get(key);
    if (existing === undefined) {
      summary.set(key, { attempts: 1, reachedVerdict: entry.reachedVerdict });
    } else {
      existing.attempts += 1;
      existing.reachedVerdict = existing.reachedVerdict || entry.reachedVerdict;
    }
  }
  return summary;
}

export type ReconciliationReservation =
  | { status: 'reserved'; attemptId: string }
  /** Another run already completed this pass. Do not spend. */
  | { status: 'already-closed' }
  /** This pass has used every permitted attempt. Do not spend. */
  | { status: 'attempt-cap-reached' }
  /** The season row is at its ceiling and cannot record. Do not spend. */
  | { status: 'ledger-full' }
  /** A stored value that is not a ledger is never overwritten. Do not spend. */
  | { status: 'malformed' }
  /**
   * The reservation did not commit because the store failed — at the
   * transaction's read, its write, or its commit; the three are not
   * distinguished because the caller's decision is the same for all of them.
   * Do not spend; the pass stays due and a later run retries it.
   */
  | { status: 'write-failed' };

/**
 * Reserve one attempt under the season row's advisory lock, BEFORE any provider
 * request. Every refusal means "do not spend": the caller must not issue the
 * CFBD request unless this returns `reserved`.
 *
 * Closure and the attempt cap are both evaluated INSIDE the transaction, so two
 * overlapping invocations serialize on the ledger key and cannot each pass a
 * check made against its own stale snapshot.
 *
 * A malformed stored value is REFUSED rather than replaced. Overwriting it would
 * erase the record of every pass that had already run and reopen them all.
 */
export async function reserveReconciliationAttempt(input: {
  year: number;
  partitionKey: string;
  pass: ReconciliationPass;
  dueAt: string;
  attemptId: string;
  reservedAt: string;
}): Promise<ReconciliationReservation> {
  const { year, partitionKey, pass, dueAt, attemptId, reservedAt } = input;
  try {
    return await withAppStateKeyTransaction(
      RECONCILIATION_LEDGER_SCOPE,
      reconciliationLedgerKey(year),
      async (txn) => {
        const stored = await txn.read<unknown>();
        let ledger: ReconciliationLedger;
        if (stored === null) {
          ledger = { year, entries: [] };
        } else {
          const parsed = parseReconciliationLedger(stored.value, year);
          if (parsed === null) return { status: 'malformed' as const };
          ledger = parsed;
        }
        const state = summarizeReconciliationPasses(ledger).get(
          reconciliationPassKey(partitionKey, pass)
        );
        if (state?.reachedVerdict === true) return { status: 'already-closed' as const };
        if ((state?.attempts ?? 0) >= RECONCILIATION_MAX_ATTEMPTS) {
          return { status: 'attempt-cap-reached' as const };
        }
        if (ledger.entries.length >= RECONCILIATION_LEDGER_MAX_ENTRIES) {
          return { status: 'ledger-full' as const };
        }
        const placeholder: ReconciliationLedgerEntry = {
          attemptId,
          partitionKey,
          pass,
          dueAt,
          reservedAt,
          observedAt: null,
          reachedVerdict: false,
          outcome: 'failure',
          // A run that dies between reserving and settling leaves exactly this,
          // and it is the truth: the attempt was made and never completed.
          reason: 'attempt-not-settled',
          corrected: 0,
          refreshed: 0,
          inserted: 0,
          conflicts: 0,
          stale: 0,
          notObserved: 0,
        };
        await txn.write<ReconciliationLedger>({
          year,
          entries: [...ledger.entries, placeholder],
        });
        return { status: 'reserved' as const, attemptId };
      }
    );
  } catch {
    return { status: 'write-failed' };
  }
}

export type ReconciliationSettlement =
  | { status: 'settled' }
  /** The reserved entry is gone (concurrent repair, or a malformed row). */
  | { status: 'not-found' }
  | { status: 'malformed' }
  /**
   * The settlement did not commit. The RESERVATION stands, so the attempt is
   * still counted and still bounded — only its outcome detail is lost.
   */
  | { status: 'write-failed' };

/** The outcome fields a settled attempt records, all from the merge authority. */
export type ReconciliationSettlementInput = {
  reachedVerdict: boolean;
  outcome: ReconciliationEntryOutcome;
  reason: string;
  observedAt: string;
  corrected: number;
  refreshed: number;
  inserted: number;
  conflicts: number;
  stale: number;
  notObserved: number;
};

/**
 * Replace a reserved attempt with its outcome, under the same advisory lock.
 * Never appends a second entry for the same attempt: a settlement whose
 * reservation is missing is reported, not invented, so the ledger can never
 * over-count spend.
 */
export async function settleReconciliationAttempt(
  year: number,
  attemptId: string,
  settlement: ReconciliationSettlementInput
): Promise<ReconciliationSettlement> {
  try {
    return await withAppStateKeyTransaction(
      RECONCILIATION_LEDGER_SCOPE,
      reconciliationLedgerKey(year),
      async (txn) => {
        const stored = await txn.read<unknown>();
        if (stored === null) return { status: 'not-found' as const };
        const ledger = parseReconciliationLedger(stored.value, year);
        if (ledger === null) return { status: 'malformed' as const };
        const index = ledger.entries.findIndex((entry) => entry.attemptId === attemptId);
        if (index < 0) return { status: 'not-found' as const };
        const entries = [...ledger.entries];
        entries[index] = { ...entries[index]!, ...settlement };
        await txn.write<ReconciliationLedger>({ year, entries });
        return { status: 'settled' as const };
      }
    );
  } catch {
    return { status: 'write-failed' };
  }
}
