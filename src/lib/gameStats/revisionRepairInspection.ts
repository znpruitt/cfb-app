// Only the applied-repair function is used in this module's BODY (to build the
// dry-run-only wrapper). The safe read/validation APIs are re-exported below
// without being referenced here.
import {
  repairRevisionState,
  type RevisionRepairRequest,
  type RevisionRepairResult,
} from './revisionRepair.ts';

/**
 * PLATFORM-086H3B — narrow administrator INSPECTION facade
 * (PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION).
 *
 * The admin revision route is the one sanctioned production connection to the
 * dormant revision authority. It must reach ONLY the approved B-stage
 * capabilities — authenticated inspection, typed audit retrieval, and DRY-RUN
 * repair planning — and must NEVER acquire an applied-repair or any other
 * lifecycle-mutation capability. The route imports its revision capabilities
 * EXCLUSIVELY through this facade (never `revisionRepair` directly), so the
 * applied-repair function (`repairRevisionState`) is not a route-reachable
 * binding at all.
 *
 * Export surface (verified by the dormant-boundary guard — no more, no less):
 *   - `inspectRevisionState`   — read-only inspection (re-exported).
 *   - `readRevisionAuditTrail` — typed audit availability (re-exported).
 *   - `isCfbdSeasonType`       — request validation predicate (re-exported).
 *   - `planRevisionRepair`     — DRY-RUN-ONLY repair planning (defined here).
 *   - approved request/result/inspection/audit TYPES (type-only).
 *
 * This facade DOES import the applied-repair function internally to build the
 * dry-run plan, but it does NOT re-export it — `planRevisionRepair` forces
 * `dryRun: true`, so no caller of this facade can execute an applied repair.
 * The guard enforces that this export surface never silently expands to a
 * mutation capability (directly, via alias, or through a barrel/re-export).
 */

// Read-only inspection + typed audit + request validation — safe to expose.
export {
  inspectRevisionState,
  isCfbdSeasonType,
  readRevisionAuditTrail,
} from './revisionRepair.ts';

// Approved types for request/response shaping. Types carry no runtime capability.
export type {
  RevisionRepairAction,
  RevisionInspection,
  RevisionInspectionUnavailable,
  RevisionAuditRead,
  RevisionRepairResult,
} from './revisionRepair.ts';

/**
 * A repair-planning request WITHOUT the `dryRun` flag: the facade always plans
 * (dry-run) and can never be asked to apply, so the flag is not part of the
 * admin-route surface.
 */
export type RevisionRepairDryRunRequest = Omit<RevisionRepairRequest, 'dryRun'>;

/**
 * Build a DRY-RUN repair plan (validate + CAS + shape a plan) WITHOUT ever
 * executing an applied repair. `dryRun: true` is forced here — it cannot be
 * overridden by the caller (the request type omits the flag, and the explicit
 * `true` wins over any spread), so this facade exposes zero applied-repair
 * capability. Returns the same typed result as an inspection-time plan.
 */
export async function planRevisionRepair(
  request: RevisionRepairDryRunRequest
): Promise<RevisionRepairResult> {
  return repairRevisionState({ ...request, dryRun: true });
}
