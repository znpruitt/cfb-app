import { createHash, randomUUID } from 'node:crypto';

import type { CfbdSeasonType } from '../cfbd.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../providerRefreshScope.ts';
import { withAppStateKeyTransaction } from '../server/appStateStore.ts';
import { getGameStatsKey } from './cache.ts';
import {
  classifyPartitionStamp,
  GAME_STATS_REVISION_SCOPE,
  validateLedgerRecord,
  type PartitionIdentity,
  type PartitionStampClass,
  type RevisionLedgerRecord,
} from './revisionAuthority.ts';
import {
  isValidRevision,
  generateLineage,
  toCommitStamp,
  type CommitStamp,
} from './revisionStamp.ts';
import type { WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3B — operator revision inspection & repair (DORMANT except the
 * admin route).
 *
 * The frozen contract §14 operator-recovery surface for a scope the automatic
 * revision authority BLOCKED (lineage conflict / ambiguous history / suspected
 * evidence loss). It is narrowly scoped: it repairs only the revision LEDGER (and
 * the committed-evidence status stamp / partition commit-stamp METADATA needed to
 * make the ledger coherent). It NEVER alters game-stat rows and NEVER fabricates
 * provider evidence.
 *
 * Safety rails (all enforced under one advisory-locked transaction):
 *   - platform-admin authorization (enforced at the route boundary);
 *   - default dry-run / inspect;
 *   - exact partition + an expected-current-state DIGEST (compare-and-set) — a
 *     repair refuses if durable state changed since inspection;
 *   - refuses while an unexpired recovery claim exists;
 *   - refuses floors below surviving SAME-lineage evidence;
 *   - refuses malformed evidence it cannot safely derive from;
 *   - requires explicit acknowledgement of conflicting lineage or evidence loss;
 *   - appends an audit record (actor, time, reason, before digest, action, safe
 *     after state) and stamps the ledger with the audit reference.
 *
 * Lock order (frozen contract §6 / requirement 7): `E(P) → S(P) → C(P)` — the
 * evidence partition, then the refresh-status stamp, then the recovery
 * disposition. `game-stats` sorts below `provider-refresh-status` below
 * `recovery-disposition`, so this is the accepted forward order; the reverse is
 * rejected by the primitive.
 */

const GAME_STATS_SCOPE = 'game-stats';
const PROVIDER_REFRESH_STATUS_SCOPE = 'provider-refresh-status';
/**
 * Per-partition recovery disposition (D owns the full shape; B reads it to
 * refuse a repair racing an active recovery claim, and locks it as C(P)).
 * Named to sort strictly ABOVE `provider-refresh-status` so the `E → S → C`
 * acquisition order is monotonic under the transaction primitive.
 */
export const RECOVERY_DISPOSITION_SCOPE = 'recovery-disposition';
/** Append-only operator-repair audit trail, keyed 1:1 with the partition. */
export const REVISION_AUDIT_SCOPE = 'game-stats-revision-audit';

// === Public shapes ===

export type RevisionRepairAction =
  | { kind: 'rebuild-ledger' }
  | { kind: 'adopt-lineage'; lineage: string; floor: number }
  | { kind: 'establish-new-lineage'; floor?: number };

export type RevisionRepairRefusal =
  | 'state-changed'
  | 'active-recovery-claim'
  | 'floor-below-surviving-evidence'
  // PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION: a floor that cannot advance
  // safely — nonpositive, unsafe, or `Number.MAX_SAFE_INTEGER` — refused during
  // planning AND transactional apply validation.
  | 'revision-repair-floor-not-advanceable'
  | 'malformed-evidence'
  | 'acknowledgement-required'
  | 'invalid-action'
  | 'store-unavailable';

/** Safe, structured partition view — never internal SQL/paths/tokens. */
export type RevisionInspectionState = {
  partition: {
    present: boolean;
    stampClass: PartitionStampClass['kind'];
    stamp: CommitStamp | null;
    gameCount: number | null;
  };
  ledger: RevisionLedgerRecord | null;
  ledgerMarkerPresent: boolean;
  status: {
    committedStamp: CommitStamp | null;
    committedStampMarkerPresent: boolean;
    lastAttemptOrdinal: number | null;
  };
  recovery: { activeClaim: boolean };
};

export type RevisionInspection = {
  partitionKey: string;
  identity: PartitionIdentity;
  state: RevisionInspectionState;
  /** The digest the operator must echo back to authorize a repair (CAS). */
  expectedStateDigest: string;
};

export type RevisionRepairAuditEntry = {
  auditRef: string;
  actor: string;
  at: string;
  reason: string;
  action: RevisionRepairAction;
  beforeDigest: string;
  afterState: {
    ledger: RevisionLedgerRecord;
    committedStamp: CommitStamp | null;
    partitionStamp: CommitStamp | null;
  };
  /** Historical lineage preserved when a new lineage supersedes it (§14). */
  supersededLineage?: string | null;
};

export type RevisionRepairRequest = {
  identity: PartitionIdentity;
  action: RevisionRepairAction;
  /** Expected-current-state digest from a prior inspection (CAS). */
  expectedStateDigest: string;
  actor: string;
  reason: string;
  /** Default TRUE — inspect/plan without writing. */
  dryRun?: boolean;
  acknowledgeEvidenceLoss?: boolean;
  acknowledgeLineageConflict?: boolean;
};

export type RevisionRepairResult =
  | {
      ok: true;
      dryRun: boolean;
      beforeDigest: string;
      afterState: RevisionRepairAuditEntry['afterState'];
      auditRef: string;
    }
  | { ok: false; code: RevisionRepairRefusal; detail: string };

// === Digest (compare-and-set over durable state) ===

function stampKey(stamp: CommitStamp | null): string {
  return stamp ? `${stamp.lineage}#${stamp.revision}` : 'none';
}

/**
 * A stable digest of the salient durable state. Any change to the partition
 * stamp, ledger, committed status stamp, or recovery-claim state changes the
 * digest, so a repair authorized against an old digest is refused (CAS).
 */
function computeStateDigest(state: RevisionInspectionState): string {
  const canonical = JSON.stringify({
    p: `${state.partition.stampClass}:${stampKey(state.partition.stamp)}:${state.partition.gameCount ?? -1}`,
    l: state.ledger
      ? `${state.ledger.lineage}#${state.ledger.revision}:${state.ledger.initializedFrom}`
      : 'none',
    lm: state.ledgerMarkerPresent,
    s: stampKey(state.status.committedStamp),
    sm: state.status.committedStampMarkerPresent,
    r: state.recovery.activeClaim,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// === Durable reads (inside the locked transaction) ===

type LoadedState = {
  existing: WeeklyGameStats | null;
  state: RevisionInspectionState;
  digest: string;
};

function recoveryClaimActive(value: unknown, nowMs: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const claim = (value as { claim?: unknown }).claim;
  if (typeof claim !== 'object' || claim === null) return false;
  const lease = (claim as { leaseExpiresAt?: unknown }).leaseExpiresAt;
  if (typeof lease !== 'string') return false;
  const ms = Date.parse(lease);
  return Number.isFinite(ms) && ms > nowMs;
}

type RepairTxn = {
  read<T>(): Promise<{ value: T } | null>;
  readKey<T>(scope: string, key: string): Promise<{ value: T } | null>;
};

async function loadState(
  txn: RepairTxn,
  id: PartitionIdentity,
  partitionKey: string,
  statusKey: string,
  nowMs: number
): Promise<LoadedState> {
  const existing = (await txn.read<WeeklyGameStats>())?.value ?? null;
  const partitionClass = classifyPartitionStamp(existing);

  const ledgerRow = await txn.readKey<unknown>(GAME_STATS_REVISION_SCOPE, partitionKey);
  const ledgerRaw = ledgerRow?.value ?? null;
  const ledger = validateLedgerRecord(ledgerRaw, id);
  const ledgerMarkerPresent = ledgerRow !== null && ledgerRaw !== null && ledger === null;

  const statusRow = await txn.readKey<Record<string, unknown>>(
    PROVIDER_REFRESH_STATUS_SCOPE,
    statusKey
  );
  const statusValue = statusRow?.value ?? null;
  const statusHasStamp =
    statusValue !== null &&
    typeof statusValue === 'object' &&
    Object.prototype.hasOwnProperty.call(statusValue, 'lastCommittedStamp');
  const committedStamp = statusHasStamp
    ? toCommitStamp((statusValue as Record<string, unknown>).lastCommittedStamp)
    : null;
  const committedStampMarkerPresent = statusHasStamp && committedStamp === null;
  const lastAttemptOrdinal =
    statusValue && typeof statusValue === 'object'
      ? typeof (statusValue as Record<string, unknown>).lastAttemptOrdinal === 'number'
        ? ((statusValue as Record<string, unknown>).lastAttemptOrdinal as number)
        : null
      : null;

  const recoveryRow = await txn.readKey<unknown>(RECOVERY_DISPOSITION_SCOPE, partitionKey);
  const activeClaim = recoveryClaimActive(recoveryRow?.value ?? null, nowMs);

  const state: RevisionInspectionState = {
    partition: {
      present: existing !== null,
      stampClass: partitionClass.kind,
      stamp: partitionClass.kind === 'valid' ? partitionClass.stamp : null,
      gameCount: existing && Array.isArray(existing.games) ? existing.games.length : null,
    },
    ledger,
    ledgerMarkerPresent,
    status: { committedStamp, committedStampMarkerPresent, lastAttemptOrdinal },
    recovery: { activeClaim },
  };
  return { existing, state, digest: computeStateDigest(state) };
}

// === Inspection (safe, read-only) ===

/**
 * Inspect a partition's revision state and return the expected-current-state
 * digest an operator must echo back to authorize a repair. Read-only — takes
 * the E → S → C locks so the digest is a consistent snapshot, writes nothing.
 */
export async function inspectRevisionState(
  identity: PartitionIdentity
): Promise<RevisionInspection | { ok: false; code: 'store-unavailable'; detail: string }> {
  const partitionKey = getGameStatsKey(identity.year, identity.week, identity.seasonType);
  const statusKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(identity.year, identity.week, identity.seasonType)
  );
  const nowMs = Date.now();
  try {
    return await withAppStateKeyTransaction(GAME_STATS_SCOPE, partitionKey, async (txn) => {
      await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
      await txn.lockKey(RECOVERY_DISPOSITION_SCOPE, partitionKey);
      const loaded = await loadState(txn, identity, partitionKey, statusKey, nowMs);
      return {
        partitionKey,
        identity,
        state: loaded.state,
        expectedStateDigest: loaded.digest,
      };
    });
  } catch (error) {
    return {
      ok: false,
      code: 'store-unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

// === Repair action planning (pure) ===

type RepairPlan =
  | {
      ok: true;
      ledger: RevisionLedgerRecord;
      committedStamp: CommitStamp | null;
      partitionStamp: CommitStamp | null;
      supersededLineage: string | null;
    }
  | { ok: false; code: RevisionRepairRefusal; detail: string };

/**
 * A repair floor must be a positive safe integer that can still ADVANCE — a
 * nonpositive, unsafe, or `Number.MAX_SAFE_INTEGER` floor is refused, so a later
 * allocation (`floor + 1`) can never wrap past the safe-integer bound
 * (PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION).
 */
function floorNotAdvanceable(floor: number): boolean {
  return !isValidRevision(floor) || floor >= Number.MAX_SAFE_INTEGER;
}

function highestSurvivingSameLineage(state: RevisionInspectionState, lineage: string): number {
  let highest = 0;
  if (state.partition.stamp && state.partition.stamp.lineage === lineage) {
    highest = Math.max(highest, state.partition.stamp.revision);
  }
  if (state.status.committedStamp && state.status.committedStamp.lineage === lineage) {
    highest = Math.max(highest, state.status.committedStamp.revision);
  }
  return highest;
}

function planRepair(
  request: RevisionRepairRequest,
  state: RevisionInspectionState,
  now: string,
  auditRef: string
): RepairPlan {
  const id = request.identity;
  const base = (
    lineage: string,
    revision: number,
    initializedFrom: RevisionLedgerRecord['initializedFrom']
  ): RevisionLedgerRecord => ({
    schemaVersion: 1,
    year: id.year,
    week: id.week,
    seasonType: id.seasonType,
    lineage,
    revision,
    initializedFrom,
    initializedAt: now,
    repairAuditRef: auditRef,
  });

  switch (request.action.kind) {
    case 'rebuild-ledger': {
      // Only safe when SURVIVING same-lineage partition evidence proves the
      // lineage — never derived from a malformed or stampless partition.
      const stamp = state.partition.stamp;
      if (!stamp) {
        return {
          ok: false,
          code: 'malformed-evidence',
          detail:
            'rebuild-ledger requires a surviving partition with a valid commit stamp to derive the lineage and revision from',
        };
      }
      // A committed status stamp of the SAME lineage may prove a higher floor.
      const floor = highestSurvivingSameLineage(state, stamp.lineage);
      return {
        ok: true,
        ledger: base(stamp.lineage, Math.max(stamp.revision, floor), 'repair'),
        committedStamp: null, // rebuild does not touch the status stamp
        partitionStamp: null, // partition stamp already matches — unchanged
        supersededLineage: null,
      };
    }
    case 'adopt-lineage': {
      const { lineage, floor } = request.action;
      if (floorNotAdvanceable(floor)) {
        return {
          ok: false,
          code: 'revision-repair-floor-not-advanceable',
          detail: 'floor must be a positive safe integer strictly below Number.MAX_SAFE_INTEGER',
        };
      }
      if (typeof lineage !== 'string' || lineage.length === 0) {
        return { ok: false, code: 'invalid-action', detail: 'lineage must be a non-empty string' };
      }
      // Never floor BELOW surviving same-lineage evidence.
      const survivingSame = highestSurvivingSameLineage(state, lineage);
      if (survivingSame > floor) {
        return {
          ok: false,
          code: 'floor-below-surviving-evidence',
          detail: `surviving same-lineage evidence at revision ${survivingSame} exceeds the requested floor ${floor}`,
        };
      }
      // A partition / ledger / status carrying a DIFFERENT lineage is a lineage
      // conflict — require explicit acknowledgement.
      const conflictsWithPartition =
        state.partition.stamp !== null && state.partition.stamp.lineage !== lineage;
      const conflictsWithLedger = state.ledger !== null && state.ledger.lineage !== lineage;
      const conflictsWithStatus =
        state.status.committedStamp !== null && state.status.committedStamp.lineage !== lineage;
      const malformedEvidence =
        state.partition.stampClass === 'malformed' ||
        state.partition.stampClass === 'revision-era-no-stamp' ||
        state.status.committedStampMarkerPresent ||
        state.ledgerMarkerPresent;
      if (
        (conflictsWithPartition ||
          conflictsWithLedger ||
          conflictsWithStatus ||
          malformedEvidence) &&
        !request.acknowledgeLineageConflict
      ) {
        return {
          ok: false,
          code: 'acknowledgement-required',
          detail:
            'adopt-lineage conflicts with surviving evidence of a different or malformed lineage; set acknowledgeLineageConflict',
        };
      }
      let superseded: string | null = null;
      if (conflictsWithPartition && state.partition.stamp)
        superseded = state.partition.stamp.lineage;
      else if (conflictsWithLedger && state.ledger) superseded = state.ledger.lineage;
      else if (conflictsWithStatus && state.status.committedStamp) {
        superseded = state.status.committedStamp.lineage;
      }
      return {
        ok: true,
        ledger: base(lineage, floor, 'repair'),
        committedStamp: { lineage, revision: floor },
        // Reconcile a PRESENT partition's metadata stamp (rows untouched).
        partitionStamp: state.partition.present ? { lineage, revision: floor } : null,
        supersededLineage: superseded,
      };
    }
    case 'establish-new-lineage': {
      if (!request.acknowledgeEvidenceLoss) {
        return {
          ok: false,
          code: 'acknowledgement-required',
          detail: 'establish-new-lineage requires acknowledgeEvidenceLoss',
        };
      }
      const floor = request.action.floor ?? 1;
      if (floorNotAdvanceable(floor)) {
        return {
          ok: false,
          code: 'revision-repair-floor-not-advanceable',
          detail: 'floor must be a positive safe integer strictly below Number.MAX_SAFE_INTEGER',
        };
      }
      const lineage = generateLineage();
      const superseded =
        state.partition.stamp?.lineage ??
        state.status.committedStamp?.lineage ??
        state.ledger?.lineage ??
        null;
      return {
        ok: true,
        ledger: base(lineage, floor, 'repair'),
        committedStamp: { lineage, revision: floor },
        partitionStamp: state.partition.present ? { lineage, revision: floor } : null,
        supersededLineage: superseded,
      };
    }
  }
}

// === Repair (transactional, audited) ===

/**
 * Inspect-or-repair one partition's revision state. Defaults to `dryRun: true`
 * (plan only, no write). A real repair requires the exact expected-state digest,
 * refuses while a recovery claim is active, refuses unsafe floors / malformed
 * evidence / missing acknowledgements, and appends an audit record.
 */
export async function repairRevisionState(
  request: RevisionRepairRequest
): Promise<RevisionRepairResult> {
  const dryRun = request.dryRun ?? true;
  const id = request.identity;
  const partitionKey = getGameStatsKey(id.year, id.week, id.seasonType);
  const statusKey = providerRefreshScopeKey(
    'game-stats',
    weekPartitionScope(id.year, id.week, id.seasonType)
  );
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const auditRef = randomUUID();

  try {
    return await withAppStateKeyTransaction<RevisionRepairResult>(
      GAME_STATS_SCOPE,
      partitionKey,
      async (txn) => {
        // Lock order E → S → C, enforced by the primitive.
        await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
        await txn.lockKey(RECOVERY_DISPOSITION_SCOPE, partitionKey);
        const loaded = await loadState(txn, id, partitionKey, statusKey, nowMs);

        // Compare-and-set: refuse if durable state changed since inspection.
        if (loaded.digest !== request.expectedStateDigest) {
          return {
            ok: false,
            code: 'state-changed',
            detail: 'durable state changed since inspection; re-inspect and retry',
          };
        }
        // Refuse racing an active recovery attempt.
        if (loaded.state.recovery.activeClaim) {
          return {
            ok: false,
            code: 'active-recovery-claim',
            detail: 'an unexpired recovery claim exists for this partition; retry after it expires',
          };
        }

        const plan = planRepair(request, loaded.state, now, auditRef);
        if (!plan.ok) return plan;

        const afterState: RevisionRepairAuditEntry['afterState'] = {
          ledger: plan.ledger,
          committedStamp: plan.committedStamp,
          partitionStamp: plan.partitionStamp,
        };

        if (dryRun) {
          return { ok: true, dryRun: true, beforeDigest: loaded.digest, afterState, auditRef };
        }

        // Apply-time re-validation of floor advanceability (again, transactionally)
        // so no unadvanceable ledger revision can ever be persisted.
        if (floorNotAdvanceable(plan.ledger.revision)) {
          return {
            ok: false,
            code: 'revision-repair-floor-not-advanceable',
            detail: 'planned ledger revision is not safely advanceable',
          };
        }

        // Apply. Ledger (co-serialized under E). NEVER touches game-stat rows —
        // only the partition's internal commit-stamp METADATA is reconciled.
        await txn.writeKey(GAME_STATS_REVISION_SCOPE, partitionKey, plan.ledger);
        if (plan.partitionStamp && loaded.existing) {
          const reconciled: WeeklyGameStats = {
            ...loaded.existing,
            commitStamp: plan.partitionStamp,
          };
          await txn.write(reconciled);
        }
        if (plan.committedStamp) {
          // Establish the lineage transition on the status stamp (under S(P)).
          const statusRow = await txn.readKey<Record<string, unknown>>(
            PROVIDER_REFRESH_STATUS_SCOPE,
            statusKey
          );
          const priorStatus =
            statusRow?.value && typeof statusRow.value === 'object' ? statusRow.value : {};
          await txn.writeKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey, {
            ...priorStatus,
            lastCommittedStamp: plan.committedStamp,
          });
        }

        // Append the audit entry (co-serialized under E via the audit key).
        const auditRow = await txn.readKey<RevisionRepairAuditEntry[]>(
          REVISION_AUDIT_SCOPE,
          partitionKey
        );
        const prior = Array.isArray(auditRow?.value) ? auditRow!.value : [];
        const entry: RevisionRepairAuditEntry = {
          auditRef,
          actor: request.actor,
          at: now,
          reason: request.reason,
          action: request.action,
          beforeDigest: loaded.digest,
          afterState,
          supersededLineage: plan.supersededLineage,
        };
        await txn.writeKey(REVISION_AUDIT_SCOPE, partitionKey, [...prior, entry]);

        return { ok: true, dryRun: false, beforeDigest: loaded.digest, afterState, auditRef };
      }
    );
  } catch (error) {
    return {
      ok: false,
      code: 'store-unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read a partition's operator-repair audit trail (safe, read-only). */
export async function readRevisionAuditTrail(
  identity: PartitionIdentity
): Promise<RevisionRepairAuditEntry[]> {
  const partitionKey = getGameStatsKey(identity.year, identity.week, identity.seasonType);
  try {
    return await withAppStateKeyTransaction(GAME_STATS_SCOPE, partitionKey, async (txn) => {
      const row = await txn.readKey<RevisionRepairAuditEntry[]>(REVISION_AUDIT_SCOPE, partitionKey);
      return Array.isArray(row?.value) ? row!.value : [];
    });
  } catch {
    return [];
  }
}

/** Parse/validate a raw season type for the admin route. */
export function isCfbdSeasonType(value: unknown): value is CfbdSeasonType {
  return value === 'regular' || value === 'postseason';
}
