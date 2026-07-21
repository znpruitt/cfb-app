import type { CfbdSeasonType } from '../cfbd.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../providerRefreshScope.ts';
import type { AppStateKeyTxn } from '../server/appStateStore.ts';
import {
  isCanonicalTimestamp,
  isPlainObject,
  toDurableRead,
  type DurableRead,
} from './durableState.ts';
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
 * Lock discipline (frozen contract §6; extended by
 * PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION):
 *   - the ledger row lives in its own scope but is keyed 1:1 with the evidence
 *     partition and is ONLY ever written co-transactionally with the evidence
 *     write, so every ledger writer already holds the evidence advisory lock —
 *     `readKey`/`writeKey` therefore take NO second lock for the ledger;
 *   - EVERY allocation (ordinary AND bootstrap) also consults the committed
 *     refresh-status stamp under THAT key's own lock, so the acquisition is
 *     `E(P) → S(P)` (or `E(P) → activation-control → S(P)` under the revisioned
 *     writer, which holds the fence lock first). `game-stats` sorts below
 *     `game-stats-activation-control` below `provider-refresh-status`, so this is
 *     the accepted forward order and the reverse is rejected by the primitive.
 *     (Committed status is a high-water WITNESS, never the allocator.)
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

/** The EXACT set of keys a durable ledger row may carry (no extra fields). */
const LEDGER_ALLOWED_KEYS: ReadonlySet<string> = new Set<keyof RevisionLedgerRecord>([
  'schemaVersion',
  'year',
  'week',
  'seasonType',
  'lineage',
  'revision',
  'initializedFrom',
  'initializedAt',
  'repairAuditRef',
]);

/**
 * Validate a stored ledger value against the partition identity it was read under,
 * with EXACT strictness (PLATFORM-086H3B-DURABLE-STATE-CLASSIFICATION): a row that
 * does not validate — wrong schema, bad revision/lineage, mislabeled identity, a
 * NONCANONICAL / non-string `initializedAt` (never normalized to `""`), a malformed
 * `repairAuditRef`, or ANY unexpected extra key — is NOT a ledger. It is a
 * revision-era MARKER the bootstrap treats as ambiguous, never as "no ledger" and
 * never silently normalized. Every returned field is a fresh validated primitive
 * (no stored object retained by reference).
 */
export function validateLedgerRecord(
  value: unknown,
  id: PartitionIdentity
): RevisionLedgerRecord | null {
  if (!isPlainObject(value)) return null;
  const record = value;
  // Exact allowlist — an unexpected extra key is malformed, never ignored.
  if (Object.keys(record).some((k) => !LEDGER_ALLOWED_KEYS.has(k))) return null;
  if (record.schemaVersion !== 1) return null;
  if (!isValidRevision(record.revision)) return null;
  if (!isOpaqueLineage(record.lineage)) return null;
  if (typeof record.initializedFrom !== 'string' || !INIT_MODES.has(record.initializedFrom)) {
    return null;
  }
  if (record.year !== id.year || record.week !== id.week || record.seasonType !== id.seasonType) {
    return null;
  }
  // `initializedAt` MUST be the exact canonical timestamp form — never an object,
  // an empty-string fallback, or any noncanonical value.
  if (!isCanonicalTimestamp(record.initializedAt)) return null;
  // `repairAuditRef`, when present, MUST be a non-empty string (exact shape).
  if ('repairAuditRef' in record) {
    if (typeof record.repairAuditRef !== 'string' || record.repairAuditRef.length === 0)
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
    initializedAt: record.initializedAt as string,
  };
  if ('repairAuditRef' in record) ledger.repairAuditRef = record.repairAuditRef as string;
  return ledger;
}

// === Shared refresh-status classifier (PLATFORM-086H3B-DURABLE-STATE-CLASSIFICATION) ===

/** The revision-relevant projection of a validated committed refresh-status row. */
export type ValidatedRevisionStatus = {
  /** The valid committed stamp, or null for a recognized legacy (pre-revision) row. */
  committedStamp: CommitStamp | null;
  /** The validated per-scope attempt ordinal (null when absent). */
  lastAttemptOrdinal: number | null;
};

/**
 * Presence-aware classification of a committed refresh-status row, shared by
 * ordinary allocation AND repair planning so both interpret the SAME durable
 * contract identically. Row PRESENCE is preserved separately from its value:
 *   - `absent`            — no row.
 *   - `recognized-legacy` — a self-describing provider-status record with NO
 *                           revision-era committed stamp (the frozen contract's
 *                           legacy shape — never broadened).
 *   - `valid-revisioned`  — a valid committed stamp (+ well-formed chronology).
 *   - `malformed`         — a PRESENT row that is JSON `null`, a primitive, an
 *                           array, an unrecognized object, a malformed committed
 *                           stamp, or malformed attempt chronology.
 */
export type RevisionStatusState =
  | { kind: 'absent' }
  | { kind: 'recognized-legacy'; value: unknown }
  | { kind: 'valid-revisioned'; value: ValidatedRevisionStatus }
  | { kind: 'malformed'; value: unknown };

/** A self-describing provider-refresh-status record carries string identity fields. */
function isRecognizedProviderStatus(record: Record<string, unknown>): boolean {
  return typeof record.dataset === 'string' && typeof record.scopeKey === 'string';
}

/** The attempt ordinal, when present, must be a POSITIVE safe integer. */
function validatedAttemptOrdinal(record: Record<string, unknown>): {
  ok: boolean;
  value: number | null;
} {
  if (!Object.prototype.hasOwnProperty.call(record, 'lastAttemptOrdinal'))
    return { ok: true, value: null };
  const ord = record.lastAttemptOrdinal;
  if (typeof ord === 'number' && Number.isSafeInteger(ord) && ord >= 1)
    return { ok: true, value: ord };
  return { ok: false, value: null };
}

export function classifyRevisionStatus(read: DurableRead): RevisionStatusState {
  if (!read.present) return { kind: 'absent' };
  const value = read.value;
  // A PRESENT JSON-null / primitive / array is malformed (never absence).
  if (!isPlainObject(value)) return { kind: 'malformed', value };
  const record = value;
  const ordinal = validatedAttemptOrdinal(record);
  if (!ordinal.ok) return { kind: 'malformed', value }; // malformed attempt chronology
  if (Object.prototype.hasOwnProperty.call(record, 'lastCommittedStamp')) {
    const stamp = toCommitStamp(record.lastCommittedStamp);
    if (!stamp) return { kind: 'malformed', value }; // present-but-invalid committed stamp
    return {
      kind: 'valid-revisioned',
      value: { committedStamp: stamp, lastAttemptOrdinal: ordinal.value },
    };
  }
  // No committed stamp: a recognized legacy provider-status record is fine; any
  // other object is an unexplained revision-era marker → malformed.
  if (isRecognizedProviderStatus(record)) return { kind: 'recognized-legacy', value };
  return { kind: 'malformed', value };
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
  | 'revision-evidence-loss-suspected'
  // PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION: the counter cannot advance
  // safely (`Number.MAX_SAFE_INTEGER`) — refuse rather than wrap.
  | 'revision-counter-exhausted';

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
 * The facts the state machine decides from. `status` is the committed
 * refresh-status stamp, read under the status key's advisory lock and consulted
 * on BOTH the ordinary AND bootstrap paths
 * (PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION): it is a mandatory restoration
 * and HIGH-WATER witness — never the ordinary allocator (the ledger is), but it
 * BLOCKS allocation when it proves history newer than (or a different lineage
 * from) the surviving partition/ledger, so a restored-behind ledger can never
 * reuse a commit stamp already represented in status.
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
 * The frozen revision state machine (frozen contract §5, extended by the
 * PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION so committed refresh status is a
 * mandatory high-water witness on BOTH paths). PURE and deterministic given its
 * inputs. Blocking is always the safe outcome — it writes nothing and preserves
 * all durable state — so any state the machine cannot positively explain BLOCKS.
 */
export function classifyRevisionAllocation(
  sources: RevisionSources,
  id: PartitionIdentity,
  ctx: RevisionClassifyContext
): RevisionAllocationResult {
  const mintLineage = ctx.mintLineage ?? generateLineage;
  const { partition, ledger, status } = sources;

  // Committed status is a WITNESS, never the allocator: it may only BLOCK when it
  // proves history a `lineage` did not survive up to `highWater`. Absent status
  // (no committed stamp) — including a legacy/unrelated provider-status record —
  // never blocks; a malformed revision-era stamp is unexplained → ambiguous.
  const statusVerdict = (lineage: string, highWater: number): RevisionAllocationResult | null => {
    if (status.stamp) {
      if (status.stamp.lineage !== lineage) return block('revision-lineage-conflict');
      if (status.stamp.revision > highWater) return block('revision-evidence-loss-suspected');
      return null;
    }
    if (status.markerPresent) return block('revision-history-ambiguous');
    return null;
  };
  // Allocate strictly above the surviving high-water, refusing at exhaustion
  // rather than wrapping past `Number.MAX_SAFE_INTEGER`.
  const allocateAbove = (
    lineage: string,
    highWater: number,
    ledgerFor: (next: number) => RevisionLedgerRecord,
    mode: 'ordinary' | RevisionInitMode
  ): RevisionAllocationResult => {
    if (highWater >= Number.MAX_SAFE_INTEGER) return block('revision-counter-exhausted');
    const next = highWater + 1;
    return {
      ok: true,
      allocation: { stamp: { lineage, revision: next }, ledger: ledgerFor(next), mode },
    };
  };

  // --- ORDINARY path: an initialized ledger is the SOLE allocator. ---
  if (ledger.valid) {
    const led = ledger.valid;
    switch (partition.kind) {
      case 'absent':
        // Committed revisions recorded, but the evidence partition is gone →
        // suspected evidence loss. The ONE exception is an operator-REPAIRED
        // ledger (`initializedFrom: 'repair'`): the operator has attested to the
        // state (§14), so the scope CONTINUES — still gated by the status witness.
        if (led.initializedFrom === 'repair') {
          return (
            statusVerdict(led.lineage, led.revision) ??
            allocateAbove(led.lineage, led.revision, (n) => advanceLedger(led, n), 'ordinary')
          );
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
        // Rp >= led.revision. The committed status witness now decides whether a
        // restored-behind ledger would reuse a stamp already committed: status
        // AHEAD of the surviving evidence (or a foreign lineage) BLOCKS.
        return (
          statusVerdict(led.lineage, Rp) ??
          allocateAbove(
            led.lineage,
            Rp,
            (n) => advanceLedger(led, n),
            led.revision === Rp ? 'ordinary' : 'reconstruct-partition'
          )
        );
      }
    }
  }

  // --- BOOTSTRAP path: no valid ledger; status consulted under S(P). ---
  const partStamp = partition.kind === 'valid' ? partition.stamp : null;

  // 1. Valid lineage-bearing sources must agree on lineage.
  if (partStamp && status.stamp && partStamp.lineage !== status.stamp.lineage) {
    return block('revision-lineage-conflict');
  }

  // 2. A corrupt partition stamp or a v2-marked partition without a stamp is
  //    unexplained revision-era state — never guessed past.
  if (partition.kind === 'malformed' || partition.kind === 'revision-era-no-stamp') {
    return block('revision-history-ambiguous');
  }

  // 2b. A PRESENT-but-invalid revision-ledger row (incl. a present JSON-`null`
  //     value) is a revision-era marker — unexplained corruption that BLOCKS
  //     even alongside a valid partition stamp; only a genuinely ABSENT ledger
  //     row is "no ledger" (PLATFORM-086H3B-ACTIVATION-STATE-CORRUPTION-REMEDIATION).
  if (ledger.markerPresent) return block('revision-history-ambiguous');

  // 3. Surviving same-lineage partition evidence → reconstruct above it, gated by
  //    the status witness (status ahead → evidence loss; foreign → conflict).
  if (partStamp) {
    return (
      statusVerdict(partStamp.lineage, partStamp.revision) ??
      allocateAbove(
        partStamp.lineage,
        partStamp.revision,
        (n) => mintLedger(id, partStamp.lineage, n, 'reconstruct-partition', ctx.now),
        'reconstruct-partition'
      )
    );
  }

  // 4. No surviving partition evidence. Committed status history that claims a
  //    lineage while the partition is absent/legacy → block rather than
  //    reconstruct; a malformed status/ledger marker → ambiguous.
  if (status.stamp) return block('revision-evidence-loss-suspected');
  if (ledger.markerPresent || status.markerPresent) return block('revision-history-ambiguous');

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
  const ledgerValid = validateLedgerRecord(ledgerRow?.value, id);
  // PRESENCE, not value, decides a revision-era marker
  // (PLATFORM-086H3B-ACTIVATION-STATE-CORRUPTION-REMEDIATION): a present ledger
  // ROW that does not validate — INCLUDING a present JSON-`null` value — is a
  // revision-era marker that blocks allocation as `revision-history-ambiguous`.
  // Only a genuinely ABSENT row is "no ledger".
  const ledgerMarkerPresent = ledgerRow !== null && ledgerValid === null;

  // ALWAYS consult committed refresh status under S(P) — a mandatory restoration
  // and high-water witness on BOTH the ordinary and bootstrap paths
  // (PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION). It is acquired under the
  // status key's own lock so a concurrent publisher cannot race the read; the
  // acquisition is monotonic within the caller's chain (`E → S`, or
  // `E → activation-control → S` under the revisioned writer). The status value
  // is read ONLY after the lock is held — never a stale pre-lock read.
  const statusKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(id.year, id.week, id.seasonType)
  );
  await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
  const statusRow = await txn.readKey<Record<string, unknown>>(
    PROVIDER_REFRESH_STATUS_SCOPE,
    statusKey
  );
  // PRESENCE-AWARE classification via the SHARED classifier — a present JSON-null,
  // primitive, array, unrecognized object, malformed committed stamp, or malformed
  // attempt chronology is a MALFORMED revision-era marker (never absence, never a
  // silent restart). A valid committed stamp is a high-water witness; a recognized
  // legacy record never blocks.
  const statusClass = classifyRevisionStatus(toDurableRead(statusRow));
  const statusStamp =
    statusClass.kind === 'valid-revisioned' ? statusClass.value.committedStamp : null;
  const statusMarkerPresent = statusClass.kind === 'malformed';

  return classifyRevisionAllocation(
    {
      partition,
      ledger: { valid: ledgerValid, markerPresent: ledgerMarkerPresent },
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
