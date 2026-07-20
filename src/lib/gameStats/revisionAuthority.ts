import type { CfbdSeasonType } from '../cfbd.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../providerRefreshScope.ts';
import type { AppStateKeyTxn } from '../server/appStateStore.ts';
import {
  generateLineage,
  isOpaqueLineage,
  isValidRevision,
  toCommitStamp,
  type CommitStamp,
} from './revisionStamp.ts';
import type { WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3B — lineage-aware revision authority (DORMANT).
 *
 * The dedicated owner of the frozen contract §5 revision policy: the durable
 * per-partition revision LEDGER, the lineage-aware commit stamp allocation, and
 * the state machine that decides — safely — whether a scope may allocate a new
 * revision or must BLOCK. `durableMerge.ts` calls this authority from inside the
 * evidence transaction; NOTHING in production calls it (no cron, manual refresh,
 * recovery, analytics, or route). The recursive dormant-boundary guard enforces
 * that.
 *
 * Why a dedicated module (frozen contract, requirement 2): revision policy is
 * substantial and independent of the field-level merge rules in `durableMerge.ts`
 * — keeping it here stops that module growing an unrelated second responsibility.
 *
 * Core guarantees:
 *   - the ledger is, once initialized, the SOLE ordinary allocator
 *     (`ledger.revision + 1`); refresh status is NEVER the ordinary allocation
 *     authority (frozen contract §5);
 *   - revisions compare ONLY within one lineage and partition; different
 *     lineages are never numerically ordered (see `revisionStamp.ts`);
 *   - a missing revision field ALONE never proves a scope is new — a scope is
 *     "genuinely new" only when NO partition, ledger, committed-success lineage,
 *     revision-era marker, or repair history survives;
 *   - anything the state machine cannot safely explain BLOCKS with a stable
 *     typed code, writing no evidence, allocating no stamp, and preserving all
 *     durable state, so an operator can inspect and repair it (§14).
 *
 * Lock discipline (frozen contract §6 / requirement 7):
 *   - the ledger row lives in its own scope but is keyed 1:1 with the evidence
 *     partition and is ONLY ever written co-transactionally with the evidence
 *     write, so every ledger writer already holds the evidence advisory lock —
 *     `readKey`/`writeKey` therefore take NO second lock (E(P) only for ordinary
 *     allocation);
 *   - the ONE multi-lock path is the one-time bootstrap, which consults the
 *     refresh-status committed-evidence stamp under THAT key's own lock
 *     (`E(P) → S(P)`); the `game-stats` partition tuple sorts below the
 *     `provider-refresh-status` tuple, so this is the accepted forward order and
 *     the reverse is rejected by the primitive.
 */

export const GAME_STATS_REVISION_SCOPE = 'game-stats-revision';
// Mirrors `providerRefreshStatus.PROVIDER_REFRESH_STATUS_SCOPE` as a literal so
// the dormant authority never takes a value import from the live status module.
const PROVIDER_REFRESH_STATUS_SCOPE = 'provider-refresh-status';

/** The exact weekly partition a ledger row and evidence partition share. */
export type PartitionIdentity = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
};

/** How revision authority was established for a scope (ledger `initializedFrom`). */
export type RevisionInitMode = 'new' | 'legacy' | 'reconstruct-partition' | 'repair';

/**
 * The durable per-partition revision ledger row (frozen contract §5,
 * requirement 4). Schema-versioned so a bootstrap decision is a MARKER, never an
 * inference from missing fields; carries the exact partition identity so a
 * mislabeled row is corrupt (never silently authoritative).
 */
export type RevisionLedgerRecord = {
  schemaVersion: 1;
  /** Exact partition identity (re-asserted against the read key). */
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /** Active lineage for this scope. */
  lineage: string;
  /** Last COMMITTED revision for this scope. */
  revision: number;
  /** How this ledger was established. */
  initializedFrom: RevisionInitMode;
  /** When this ledger was established (or last repaired). */
  initializedAt: string;
  /** Optional operator-repair audit reference (§14). */
  repairAuditRef?: string;
};

const INIT_MODES: ReadonlySet<string> = new Set<RevisionInitMode>([
  'new',
  'legacy',
  'reconstruct-partition',
  'repair',
]);

/**
 * Validate a stored ledger value against the partition identity it was read
 * under. A row that does not validate (wrong schema, bad revision/lineage,
 * mislabeled identity) is NOT a ledger — it is a revision-era MARKER the
 * bootstrap treats as ambiguous, never as "no ledger".
 */
export function validateLedgerRecord(
  value: unknown,
  id: PartitionIdentity
): RevisionLedgerRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  if (!isValidRevision(record.revision)) return null;
  if (!isOpaqueLineage(record.lineage)) return null;
  if (typeof record.initializedFrom !== 'string' || !INIT_MODES.has(record.initializedFrom)) {
    return null;
  }
  if (record.year !== id.year || record.week !== id.week || record.seasonType !== id.seasonType) {
    return null;
  }
  const ledger: RevisionLedgerRecord = {
    schemaVersion: 1,
    year: id.year,
    week: id.week,
    seasonType: id.seasonType,
    lineage: record.lineage,
    revision: record.revision,
    initializedFrom: record.initializedFrom as RevisionInitMode,
    initializedAt: typeof record.initializedAt === 'string' ? record.initializedAt : '',
  };
  if (typeof record.repairAuditRef === 'string') ledger.repairAuditRef = record.repairAuditRef;
  return ledger;
}

// === Partition-carried commit-stamp classification ===

export type PartitionStampClass =
  | { kind: 'absent' }
  | { kind: 'legacy' }
  | { kind: 'valid'; stamp: CommitStamp }
  | { kind: 'malformed' }
  | { kind: 'revision-era-no-stamp' };

/**
 * A PROVABLY pre-revision legacy partition — an explicitly recognized shape,
 * never merely "revision fields are missing" (frozen contract §5). The revisioned
 * writer stamps the partition `commitStamp` and v2 row metadata together in one
 * transaction, so a partition with NO `commitStamp` own-property whose every game
 * carries neither `schemaVersion` nor `fetchStartedAt` can only be pre-activation
 * legacy data. A v2-marked row WITHOUT a partition stamp is revision-era damage,
 * NOT legacy.
 */
export function isRecognizedPreRevisionLegacyPartition(partition: WeeklyGameStats): boolean {
  if (Object.prototype.hasOwnProperty.call(partition, 'commitStamp')) return false;
  if (!Array.isArray(partition.games)) return false;
  return partition.games.every(
    (game) =>
      typeof game === 'object' &&
      game !== null &&
      !('schemaVersion' in game) &&
      !('fetchStartedAt' in game)
  );
}

/** Classify what a durable partition proves about revision lineage. */
export function classifyPartitionStamp(partition: WeeklyGameStats | null): PartitionStampClass {
  if (partition === null) return { kind: 'absent' };
  if (Object.prototype.hasOwnProperty.call(partition, 'commitStamp')) {
    const stamp = toCommitStamp((partition as { commitStamp?: unknown }).commitStamp);
    return stamp ? { kind: 'valid', stamp } : { kind: 'malformed' };
  }
  if (isRecognizedPreRevisionLegacyPartition(partition)) return { kind: 'legacy' };
  return { kind: 'revision-era-no-stamp' };
}

// === The revision state machine (pure) ===

export type RevisionBlockCode =
  | 'revision-lineage-conflict'
  | 'revision-history-ambiguous'
  | 'revision-evidence-loss-suspected';

export type RevisionAllocation = {
  /** The stamp to write on the partition (and mirror on the ledger lineage). */
  stamp: CommitStamp;
  /** The ledger row to co-commit with the evidence write. */
  ledger: RevisionLedgerRecord;
  /** Diagnostic label for the decision that produced this allocation. */
  mode: 'ordinary' | RevisionInitMode;
};

export type RevisionAllocationResult =
  | { ok: true; allocation: RevisionAllocation }
  | { ok: false; code: RevisionBlockCode };

/**
 * The facts the state machine decides from. `status` is populated ONLY on the
 * bootstrap path (no valid ledger), where it is read under the status key's own
 * advisory lock; the ordinary path leaves it unconsulted (E(P) only).
 */
export type RevisionSources = {
  partition: PartitionStampClass;
  ledger: { valid: RevisionLedgerRecord | null; markerPresent: boolean };
  status: { consulted: boolean; stamp: CommitStamp | null; markerPresent: boolean };
};

export type RevisionClassifyContext = {
  now: string;
  /** Injectable so tests can pin lineage; defaults to a fresh opaque id. */
  mintLineage?: () => string;
};

function block(code: RevisionBlockCode): RevisionAllocationResult {
  return { ok: false, code };
}

function advanceLedger(ledger: RevisionLedgerRecord, revision: number): RevisionLedgerRecord {
  return { ...ledger, revision };
}

function mintLedger(
  id: PartitionIdentity,
  lineage: string,
  revision: number,
  initializedFrom: RevisionInitMode,
  now: string
): RevisionLedgerRecord {
  return {
    schemaVersion: 1,
    year: id.year,
    week: id.week,
    seasonType: id.seasonType,
    lineage,
    revision,
    initializedFrom,
    initializedAt: now,
  };
}

/**
 * The frozen revision state machine (frozen contract §5). PURE and deterministic
 * given its inputs (lineage minting and `now` are injected). Blocking is always
 * the safe outcome — it writes nothing and preserves all durable state — so any
 * state the machine cannot positively explain BLOCKS.
 */
export function classifyRevisionAllocation(
  sources: RevisionSources,
  id: PartitionIdentity,
  ctx: RevisionClassifyContext
): RevisionAllocationResult {
  const mintLineage = ctx.mintLineage ?? generateLineage;
  const { partition, ledger, status } = sources;

  // --- ORDINARY path: an initialized ledger is the SOLE authority. ---
  if (ledger.valid) {
    const led = ledger.valid;
    switch (partition.kind) {
      case 'absent':
        // The ledger records committed revisions, but the evidence partition is
        // gone: committed history survives while its evidence does not →
        // suspected evidence loss. The ONE exception is an operator-REPAIRED
        // ledger (`initializedFrom: 'repair'`): the operator has already
        // attested to the state (§14), so the scope CONTINUES from the ledger
        // rather than re-blocking a partition the operator chose to rebuild.
        if (led.initializedFrom === 'repair') {
          const next = led.revision + 1;
          return {
            ok: true,
            allocation: {
              stamp: { lineage: led.lineage, revision: next },
              ledger: advanceLedger(led, next),
              mode: 'ordinary',
            },
          };
        }
        return block('revision-evidence-loss-suspected');
      case 'legacy':
        // The ledger says lineage committed, but the durable partition is
        // pre-revision legacy — revisioned evidence was lost or overwritten.
        return block('revision-evidence-loss-suspected');
      case 'malformed':
      case 'revision-era-no-stamp':
        return block('revision-history-ambiguous');
      case 'valid': {
        const { lineage: Lp, revision: Rp } = partition.stamp;
        if (Lp !== led.lineage) return block('revision-lineage-conflict');
        if (led.revision > Rp) {
          // The ledger records a revision newer than the surviving partition —
          // the partition lost committed revisions.
          return block('revision-evidence-loss-suspected');
        }
        // Rp >= led.revision: healthy (equal) or ledger behind surviving
        // evidence (recoverable same-lineage) — allocate strictly above the
        // highest surviving revision either way.
        const next = Rp + 1;
        return {
          ok: true,
          allocation: {
            stamp: { lineage: led.lineage, revision: next },
            ledger: advanceLedger(led, next),
            mode: led.revision === Rp ? 'ordinary' : 'reconstruct-partition',
          },
        };
      }
    }
  }

  // --- BOOTSTRAP path: no valid ledger; status was consulted under S(P). ---
  const partStamp = partition.kind === 'valid' ? partition.stamp : null;
  const statusStamp = status.stamp;

  // 1. Valid lineage-bearing sources must agree on lineage.
  if (partStamp && statusStamp && partStamp.lineage !== statusStamp.lineage) {
    return block('revision-lineage-conflict');
  }

  // 2. A corrupt partition stamp (own-property present but invalid) or a
  //    v2-marked partition without a stamp is unexplained revision-era state —
  //    never guessed past, even alongside a valid same-lineage status stamp.
  if (partition.kind === 'malformed' || partition.kind === 'revision-era-no-stamp') {
    return block('revision-history-ambiguous');
  }

  // 3. Exactly one lineage across the valid sources → recover it.
  if (partStamp || statusStamp) {
    const lineage = (partStamp ?? statusStamp)!.lineage;
    const Rpart = partStamp?.revision ?? null;
    const Rstatus = statusStamp?.revision ?? null;
    if (Rpart === null) {
      // Committed history (the status stamp) survives, but the partition carries
      // no revisioned evidence (absent or legacy) → possible evidence loss.
      return block('revision-evidence-loss-suspected');
    }
    if (Rstatus !== null && Rstatus > Rpart) {
      // Status recorded a newer commit than the surviving partition proves.
      return block('revision-evidence-loss-suspected');
    }
    const next = Rpart + 1;
    return {
      ok: true,
      allocation: {
        stamp: { lineage, revision: next },
        ledger: mintLedger(id, lineage, next, 'reconstruct-partition', ctx.now),
        mode: 'reconstruct-partition',
      },
    };
  }

  // 4. No valid lineage source. Any surviving revision-era marker → ambiguous.
  if (ledger.markerPresent || status.markerPresent) {
    return block('revision-history-ambiguous');
  }

  // 5. The only cases that mint lineage 1: genuinely new, or recognized legacy.
  const initializedFrom: RevisionInitMode = partition.kind === 'legacy' ? 'legacy' : 'new';
  const lineage = mintLineage();
  return {
    ok: true,
    allocation: {
      stamp: { lineage, revision: 1 },
      ledger: mintLedger(id, lineage, 1, initializedFrom, ctx.now),
      mode: initializedFrom,
    },
  };
}

// === Transactional allocator (co-committed with the evidence write) ===

/**
 * Allocate the next durable commit stamp for one partition INSIDE the evidence
 * transaction (the caller already holds E(P)). Reads the ledger with no extra
 * lock (co-serialized under E(P)); only when there is no valid ledger does it
 * take the ONE additional lock — S(P) — to fold the refresh-status committed
 * stamp into the bootstrap floor without racing a concurrent publisher.
 *
 * Returns a typed allocation (stamp + ledger to co-commit) or a typed block
 * code. On a block, the caller writes NOTHING (durable state untouched). This
 * function performs NO write — the caller co-commits the returned ledger with
 * the stamped partition so evidence and ledger persist together or neither does.
 */
export async function allocateGameStatsCommitStamp(
  txn: AppStateKeyTxn,
  id: PartitionIdentity,
  existing: WeeklyGameStats | null,
  partitionKey: string,
  now: string
): Promise<RevisionAllocationResult> {
  const partition = classifyPartitionStamp(existing);
  const ledgerRow = await txn.readKey<unknown>(GAME_STATS_REVISION_SCOPE, partitionKey);
  const ledgerRaw = ledgerRow?.value ?? null;
  const ledgerValid = validateLedgerRecord(ledgerRaw, id);
  const ledgerMarkerPresent = ledgerRow !== null && ledgerRaw !== null && ledgerValid === null;

  if (ledgerValid) {
    // ORDINARY allocation — E(P) only; the ledger is the sole authority.
    return classifyRevisionAllocation(
      {
        partition,
        ledger: { valid: ledgerValid, markerPresent: false },
        status: { consulted: false, stamp: null, markerPresent: false },
      },
      id,
      { now }
    );
  }

  // BOOTSTRAP — consult the committed-evidence stamp under the status key's own
  // lock so a concurrently publishing status writer serializes with us.
  const statusKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(id.year, id.week, id.seasonType)
  );
  await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
  const statusRow = await txn.readKey<Record<string, unknown>>(
    PROVIDER_REFRESH_STATUS_SCOPE,
    statusKey
  );
  const statusValue = statusRow?.value ?? null;
  const statusHasStamp =
    statusValue !== null &&
    typeof statusValue === 'object' &&
    Object.prototype.hasOwnProperty.call(statusValue, 'lastCommittedStamp');
  const statusStamp = statusHasStamp
    ? toCommitStamp((statusValue as Record<string, unknown>).lastCommittedStamp)
    : null;
  const statusMarkerPresent = statusHasStamp && statusStamp === null;

  return classifyRevisionAllocation(
    {
      partition,
      ledger: { valid: null, markerPresent: ledgerMarkerPresent },
      status: { consulted: true, stamp: statusStamp, markerPresent: statusMarkerPresent },
    },
    id,
    { now }
  );
}

/** Read a partition's ledger row (no lock — co-serialized under E(P)). */
export async function readRevisionLedger(
  txn: AppStateKeyTxn,
  id: PartitionIdentity,
  partitionKey: string
): Promise<RevisionLedgerRecord | null> {
  const row = await txn.readKey<unknown>(GAME_STATS_REVISION_SCOPE, partitionKey);
  return validateLedgerRecord(row?.value ?? null, id);
}
