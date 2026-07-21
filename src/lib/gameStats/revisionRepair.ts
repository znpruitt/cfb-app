import { randomUUID } from 'node:crypto';

import { providerRefreshScopeKey, weekPartitionScope } from '../providerRefreshScope.ts';
import { withAppStateKeyTransaction, type AppStateKeyTxn } from '../server/appStateStore.ts';
import { getGameStatsKey } from './cache.ts';
import { GAME_STATS_REVISION_SCOPE, type PartitionIdentity } from './revisionAuthority.ts';
import type { WeeklyGameStats } from './types.ts';
import {
  ACTIVATION_CONTROL_KEY,
  ACTIVATION_CONTROL_SCOPE,
  GAME_STATS_SCOPE,
  PROVIDER_REFRESH_STATUS_SCOPE,
  RECOVERY_DISPOSITION_SCOPE,
  REVISION_AUDIT_SCOPE,
  REVISIONED_EVIDENCE_WITNESS_KEY,
  classifyAuditDataset,
  floorNotAdvanceable,
  isPlainObject,
  planRepair,
  presentValue,
  shapeLoadedState,
  toDurableRead,
  type DurableReads,
  type LoadedState,
  type RevisionRepairAuditEntry,
  type RevisionRepairRequest,
  type RevisionRepairResult,
} from './revisionRepairPlanning.ts';

/**
 * PLATFORM-086H3B — operator revision repair APPLIED SERVICE (DORMANT).
 *
 * The frozen contract §14 operator-recovery surface for a scope the automatic
 * revision authority BLOCKED (lineage conflict / ambiguous history / suspected
 * evidence loss). It repairs only the revision LEDGER (and the committed-evidence
 * status stamp / partition commit-stamp METADATA needed to make the ledger
 * coherent). It NEVER alters game-stat rows and NEVER fabricates provider evidence.
 *
 * PLATFORM-086H3B-DORMANT-BOUNDARY-LAUNDERING-REMEDIATION: this module is the
 * ONLY app-state MUTATION owner of the repair surface. It CONSUMES the mutation-free
 * planner (`revisionRepairPlanning.ts`) — the direction is service→planner, never
 * planner→service — so the admin inspection facade (which imports ONLY from the
 * planner) has no runtime import path to `repairRevisionState` or
 * `withAppStateKeyTransaction`. The read-only inspection / dry-run / audit surface
 * is re-exported here for existing consumers, but the applied write path
 * (`repairRevisionState`) lives ONLY in this module and stays dormant through the
 * live admin route.
 *
 * Lock order: `E(P) → activation-control → S(P) → C(P)` (activation-control held
 * EXCLUSIVE), enforced by the transaction primitive; the applied path re-reads +
 * re-validates the complete-state CAS digest transactionally under those locks.
 */

// Re-export the mutation-free surface + types for existing consumers. The admin
// facade imports these from the planner directly (never from this module).
export {
  RECOVERY_DISPOSITION_SCOPE,
  REVISION_AUDIT_SCOPE,
  classifyRepairEvidence,
  inspectRevisionState,
  isCfbdSeasonType,
  planRevisionRepair,
  readRevisionAuditTrail,
  validateAuditEntry,
} from './revisionRepairPlanning.ts';
export type {
  DurableRead,
  RepairEvidenceClass,
  RevisionAuditRead,
  RevisionInspection,
  RevisionInspectionState,
  RevisionInspectionUnavailable,
  RevisionRepairAction,
  RevisionRepairAuditEntry,
  RevisionRepairDryRunRequest,
  RevisionRepairRefusal,
  RevisionRepairRequest,
  RevisionRepairResult,
  SurvivingHighWater,
  SurvivingHistoryAssessment,
} from './revisionRepairPlanning.ts';

/**
 * Transactional load: read every durable row UNDER the held CAS locks (presence
 * aware) and shape it with the SAME pure `shapeLoadedState` the read-only planner
 * uses, so both compute an identical complete-state digest.
 */
async function loadStateTxn(
  txn: AppStateKeyTxn,
  id: PartitionIdentity,
  partitionKey: string,
  statusKey: string,
  nowMs: number
): Promise<LoadedState> {
  const reads: DurableReads = {
    partition: toDurableRead(await txn.read<unknown>()),
    ledger: toDurableRead(await txn.readKey<unknown>(GAME_STATS_REVISION_SCOPE, partitionKey)),
    status: toDurableRead(await txn.readKey<unknown>(PROVIDER_REFRESH_STATUS_SCOPE, statusKey)),
    activation: toDurableRead(
      await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY)
    ),
    witness: toDurableRead(
      await txn.readKey<unknown>(ACTIVATION_CONTROL_SCOPE, REVISIONED_EVIDENCE_WITNESS_KEY)
    ),
    recovery: toDurableRead(await txn.readKey<unknown>(RECOVERY_DISPOSITION_SCOPE, partitionKey)),
    audit: toDurableRead(await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey)),
  };
  return shapeLoadedState(reads, id, nowMs);
}

/**
 * Inspect-or-repair one partition's revision state. Defaults to `dryRun: true`
 * (plan only, no write). A real repair requires the exact expected-state digest,
 * refuses while a recovery claim is active, refuses unsafe floors / malformed
 * evidence / missing acknowledgements, and appends an audit record. DORMANT through
 * the live admin route (which never calls it and refuses `apply:true`).
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
        // Lock order E → activation-control → S → C, enforced by the primitive.
        // Acquiring activation-control BEFORE reading the activation record and
        // the irreversible witness serializes those CAS inputs, so a concurrent
        // activation transition (or another partition's first revisioned commit)
        // cannot mutate them inside this CAS window.
        await txn.lockKey(ACTIVATION_CONTROL_SCOPE, ACTIVATION_CONTROL_KEY);
        await txn.lockKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey);
        await txn.lockKey(RECOVERY_DISPOSITION_SCOPE, partitionKey);
        const loaded = await loadStateTxn(txn, id, partitionKey, statusKey, nowMs);

        // Compare-and-set: recompute the COMPLETE-state digest transactionally and
        // refuse if ANY included durable state changed since inspection.
        if (loaded.digest !== request.expectedStateDigest) {
          return {
            ok: false,
            code: 'revision-repair-state-changed',
            detail: 'durable state changed since inspection; re-inspect and retry',
          };
        }
        // A malformed durable audit history is NEVER trusted or appended to.
        if (loaded.auditRead.state === 'unavailable') {
          return {
            ok: false,
            code: 'revision-repair-audit-unavailable',
            detail:
              'the durable repair audit history is malformed/unavailable; resolve it before repairing',
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
          return {
            ok: true,
            dryRun: true,
            beforeDigest: loaded.digest,
            afterState,
            survivingHighWater: plan.survivingHighWater,
            auditRef,
          };
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
          // Presence-aware: a present-null / malformed status merges as `{}` (the
          // stamp is set fresh) rather than collapsing present-null into absence.
          const statusRead = toDurableRead(
            await txn.readKey<Record<string, unknown>>(PROVIDER_REFRESH_STATUS_SCOPE, statusKey)
          );
          const priorStatus = isPlainObject(presentValue(statusRead))
            ? presentValue(statusRead)
            : {};
          await txn.writeKey(PROVIDER_REFRESH_STATUS_SCOPE, statusKey, {
            ...(priorStatus as Record<string, unknown>),
            lastCommittedStamp: plan.committedStamp,
          });
        }

        // Append to the VALIDATED audit history (a malformed one was already
        // refused above). `absent` starts a fresh list; `available` uses the
        // re-validated entries so no unapproved stored content is ever carried
        // forward.
        const priorAudit = classifyAuditDataset(
          (await txn.readKey<unknown>(REVISION_AUDIT_SCOPE, partitionKey)) ?? null
        );
        if (priorAudit.state === 'unavailable') {
          return {
            ok: false,
            code: 'revision-repair-audit-unavailable',
            detail:
              'the durable repair audit history is malformed/unavailable; resolve it before repairing',
          };
        }
        const prior = priorAudit.state === 'available' ? priorAudit.entries : [];
        const entry: RevisionRepairAuditEntry = {
          schemaVersion: 1,
          auditRef,
          actor: request.actor,
          at: now,
          reason: request.reason,
          action: request.action,
          beforeDigest: loaded.digest,
          afterState,
          supersededLineage: plan.supersededLineage,
          survivingHighWater: plan.survivingHighWater,
        };
        await txn.writeKey(REVISION_AUDIT_SCOPE, partitionKey, [...prior, entry]);

        return {
          ok: true,
          dryRun: false,
          beforeDigest: loaded.digest,
          afterState,
          survivingHighWater: plan.survivingHighWater,
          auditRef,
        };
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
