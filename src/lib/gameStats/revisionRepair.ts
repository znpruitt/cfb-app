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
  isCommitStamp,
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
  // CAS: the durable state changed since inspection (PLATFORM-086H3B-REPAIR-SAFETY-DOCS).
  | 'revision-repair-state-changed'
  | 'active-recovery-claim'
  | 'floor-below-surviving-evidence'
  // PLATFORM-086H3B-RESTORATION-STATUS-REMEDIATION: a floor that cannot advance
  // safely — nonpositive, unsafe, or `Number.MAX_SAFE_INTEGER` — refused during
  // planning AND transactional apply validation.
  | 'revision-repair-floor-not-advanceable'
  // PLATFORM-086H3B-REPAIR-SAFETY-DOCS: structurally invalid revision evidence —
  // a hard refusal for EVERY action that no acknowledgement can override.
  | 'revision-repair-evidence-malformed'
  // rebuild-ledger has no surviving valid same-lineage evidence to derive from.
  | 'malformed-evidence'
  | 'acknowledgement-required'
  | 'invalid-action'
  // The durable store read/transaction failed — a REDACTED, typed refusal (the
  // raw storage error is logged server-side only, never returned).
  | 'revision-repair-planning-unavailable';

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
  /**
   * The VERSIONED digest the operator must echo back to authorize a repair (CAS).
   * Covers the complete inspected durable state (PLATFORM-086H3B-REPAIR-SAFETY-DOCS)
   * — see `computeStateDigest`. Never embeds or exposes the underlying evidence.
   */
  expectedStateDigest: string;
};

/** A redacted, typed inspection failure — never carries a raw storage message. */
export type RevisionInspectionUnavailable = {
  ok: false;
  code: 'revision-repair-inspection-unavailable';
};

/**
 * Typed audit availability (PLATFORM-086H3B-REPAIR-SAFETY-DOCS): a failed or
 * malformed read is NEVER collapsed into an empty history.
 *   - `available` — read succeeded (a valid EMPTY entry list is still available);
 *   - `absent`    — no audit dataset has ever been written;
 *   - `unavailable` — the read failed or returned malformed audit state.
 */
export type RevisionAuditRead =
  | { state: 'available'; entries: RevisionRepairAuditEntry[] }
  | { state: 'absent' }
  | { state: 'unavailable' };

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

// === Versioned CAS digest over the COMPLETE inspected durable state ===

/**
 * Explicit digest schema version. Any change to what the digest covers (or how)
 * MUST bump this so an old digest fails the CAS clearly rather than silently
 * comparing incompatible digests.
 */
const STATE_DIGEST_VERSION = 'gsr-state-v1';

/**
 * Deterministic canonical form: object keys sorted recursively (so key insertion
 * order never changes the digest), ARRAY ORDER and actual durable values
 * preserved (they are significant). Primitives pass through.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The complete durable state the CAS digest binds (raw values, never exposed). */
type DigestInput = {
  identity: PartitionIdentity;
  partition: unknown; // full weekly envelope + every game row + fetchedAt + commitStamp
  ledger: unknown; // raw revision ledger row
  status: unknown; // full committed status + attempt state
  activation: unknown; // activation-control record
  witness: unknown; // irreversible revision-history witness
  recovery: unknown; // recovery-disposition (incl. active claim token/owner/expiry)
  audit: unknown; // repair history used by the planner
};

/**
 * A versioned, canonical, cryptographic digest of the COMPLETE inspected durable
 * state (PLATFORM-086H3B-REPAIR-SAFETY-DOCS). Every material change — a game
 * identifier/participant/statistic, `fetchedAt`, evidence metadata, the commit
 * stamp, the ledger, committed status, activation/witness state, or a
 * recovery-claim token/expiration — changes the digest; equivalent objects with
 * different key order do not. The evidence is HASHED, never embedded.
 */
function computeStateDigest(input: DigestInput): string {
  const json = JSON.stringify(canonicalize({ v: STATE_DIGEST_VERSION, ...input }));
  return `${STATE_DIGEST_VERSION}:${createHash('sha256').update(json).digest('hex')}`;
}

// === Durable reads (inside the locked transaction) ===

const ACTIVATION_CONTROL_SCOPE = 'game-stats-activation-control';
const ACTIVATION_CONTROL_KEY = 'global';
const REVISIONED_EVIDENCE_WITNESS_KEY = 'revisioned-evidence-witness';

type LoadedState = {
  existing: WeeklyGameStats | null;
  state: RevisionInspectionState;
  digest: string;
  /** False when the durable evidence is structurally invalid (hard refusal). */
  evidenceCertified: boolean;
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

/**
 * Certify that the durable evidence is not STRUCTURALLY invalid. Absent (null) and
 * recognized-legacy partitions are NOT malformed; a present partition is malformed
 * when its envelope, identity, commit stamp, or revision-era shape cannot be
 * safely classified — which no acknowledgement may override.
 */
function certifyEvidence(existingRaw: unknown, id: PartitionIdentity): boolean {
  if (existingRaw === null) return true;
  if (typeof existingRaw !== 'object') return false;
  const env = existingRaw as Record<string, unknown>;
  // Invalid / inconsistent partition identity.
  if (env.year !== id.year || env.week !== id.week || env.seasonType !== id.seasonType)
    return false;
  // Malformed weekly envelope.
  if (!Array.isArray(env.games)) return false;
  // Malformed / unsafe commit stamp (own-property present but not a valid stamp).
  if (Object.prototype.hasOwnProperty.call(env, 'commitStamp') && !isCommitStamp(env.commitStamp)) {
    return false;
  }
  // Revision-era fields (v2-marked rows) without a valid partition stamp.
  const cls = classifyPartitionStamp(existingRaw as WeeklyGameStats);
  if (cls.kind === 'malformed' || cls.kind === 'revision-era-no-stamp') return false;
  return true;
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
  const existingRaw = (await txn.read<unknown>())?.value ?? null;
  const existing = existingRaw as WeeklyGameStats | null;
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

  const recoveryRaw =
    (await txn.readKey<unknown>(RECOVERY_DISPOSITION_SCOPE, partitionKey))?.value ?? null;
  const activeClaim = recoveryClaimActive(recoveryRaw, nowMs);

  // Additional durable inputs the digest binds (read within E → S → C; the
  // activation/witness/audit keys are read, not separately locked — the CAS
  // recompute catches any change between inspection and apply).
  const activationRaw =
    (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY))?.value ?? null;
  const witnessRaw =
    (await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY))
      ?.value ?? null;
  const auditRaw = (await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey))?.value ?? null;

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
  const digest = computeStateDigest({
    identity: id,
    partition: existingRaw,
    ledger: ledgerRaw,
    status: statusValue,
    activation: activationRaw,
    witness: witnessRaw,
    recovery: recoveryRaw,
    audit: auditRaw,
  });
  return { existing, state, digest, evidenceCertified: certifyEvidence(existingRaw, id) };
}

// === Inspection (safe, read-only) ===

/**
 * Inspect a partition's revision state and return the expected-current-state
 * digest an operator must echo back to authorize a repair. Read-only — takes
 * the E → S → C locks so the digest is a consistent snapshot, writes nothing.
 */
export async function inspectRevisionState(
  identity: PartitionIdentity
): Promise<RevisionInspection | RevisionInspectionUnavailable> {
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
    // REDACT: the raw storage/SQL/path/stack error is logged server-side ONLY;
    // the caller receives a stable typed code with no diagnostic detail.
    console.error('revisionRepair: inspection failed', {
      identity,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: 'revision-repair-inspection-unavailable' };
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
  evidenceCertified: boolean,
  now: string,
  auditRef: string
): RepairPlan {
  const id = request.identity;
  // HARD refusal for structurally invalid evidence — checked FIRST, for EVERY
  // action, so no acknowledgement (lineage-conflict / evidence-loss) can convert
  // malformed evidence into valid evidence.
  if (!evidenceCertified) {
    return {
      ok: false,
      code: 'revision-repair-evidence-malformed',
      detail:
        'the durable revision evidence is structurally invalid (malformed envelope, identity, commit stamp, or revision-era shape); repair refused',
    };
  }
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

        // Compare-and-set: recompute the COMPLETE-state digest transactionally and
        // refuse if ANY included durable state changed since inspection.
        if (loaded.digest !== request.expectedStateDigest) {
          return {
            ok: false,
            code: 'revision-repair-state-changed',
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

        const plan = planRepair(request, loaded.state, loaded.evidenceCertified, now, auditRef);
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
    // REDACT: log the raw storage error server-side ONLY; return a stable code.
    console.error('revisionRepair: repair planning/transaction failed', {
      identity: request.identity,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      code: 'revision-repair-planning-unavailable',
      detail: 'the durable store was unavailable; no durable state was changed',
    };
  }
}

/**
 * Read a partition's operator-repair audit trail with TYPED availability
 * (PLATFORM-086H3B-REPAIR-SAFETY-DOCS). A read failure or malformed audit state is
 * `unavailable` — NEVER collapsed into an empty history; a genuinely absent
 * dataset is `absent`; a successfully-read (possibly empty) list is `available`.
 */
export async function readRevisionAuditTrail(
  identity: PartitionIdentity
): Promise<RevisionAuditRead> {
  const partitionKey = getGameStatsKey(identity.year, identity.week, identity.seasonType);
  try {
    return await withAppStateKeyTransaction<RevisionAuditRead>(
      GAME_STATS_SCOPE,
      partitionKey,
      async (txn) => {
        const row = await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey);
        if (!row) return { state: 'absent' };
        if (Array.isArray(row.value)) {
          return { state: 'available', entries: row.value as RevisionRepairAuditEntry[] };
        }
        // Present but not an array → malformed audit state.
        return { state: 'unavailable' };
      }
    );
  } catch (error) {
    console.error('revisionRepair: audit read failed', {
      identity,
      error: error instanceof Error ? error.message : String(error),
    });
    return { state: 'unavailable' };
  }
}

/** Parse/validate a raw season type for the admin route. */
export function isCfbdSeasonType(value: unknown): value is CfbdSeasonType {
  return value === 'regular' || value === 'postseason';
}
