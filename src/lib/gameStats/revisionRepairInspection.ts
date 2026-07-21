/**
 * PLATFORM-086H3B — narrow administrator INSPECTION facade
 * (PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION /
 * PLATFORM-086H3B-DORMANT-BOUNDARY-LAUNDERING-REMEDIATION).
 *
 * The admin revision route is the one sanctioned production connection to the
 * dormant revision authority. It reaches ONLY the approved B-stage capabilities —
 * authenticated inspection, typed audit retrieval, and DRY-RUN repair planning —
 * and must NEVER acquire an applied-repair or any other lifecycle-mutation
 * capability. The route imports its revision capabilities EXCLUSIVELY through this
 * facade.
 *
 * This facade has NO runtime dependency on the applied-repair service. It imports
 * EVERYTHING from the MUTATION-FREE planner (`revisionRepairPlanning.ts`), which
 * never writes app state, never opens an app-state transaction, and has no import
 * path to `repairRevisionState`. So `planRevisionRepair`/`inspectRevisionState`/
 * `readRevisionAuditTrail` cannot transitively reach a mutation capability — there
 * is no local alias, wrapper, or side-effect import that could conceal one (the
 * parser-backed guard resolves aliases/wrappers and rejects side-effect imports).
 *
 * Export surface (verified by the dormant-boundary guard — no more, no less):
 *   - `inspectRevisionState`   — read-only inspection (re-exported from the planner).
 *   - `readRevisionAuditTrail` — typed audit availability (re-exported).
 *   - `isCfbdSeasonType`       — request validation predicate (re-exported).
 *   - `planRevisionRepair`     — DRY-RUN-only planning (re-exported; mutation-free).
 *   - approved request/result/inspection/audit TYPES (type-only).
 */

// Read-only inspection + typed audit + request validation + DRY-RUN-only planning —
// all mutation-free, from the planner. NONE reaches the applied-repair service.
export {
  inspectRevisionState,
  isCfbdSeasonType,
  planRevisionRepair,
  readRevisionAuditTrail,
} from './revisionRepairPlanning.ts';

// Approved types for request/response shaping. Types carry no runtime capability.
export type {
  RevisionRepairAction,
  RevisionRepairDryRunRequest,
  RevisionInspection,
  RevisionInspectionUnavailable,
  RevisionAuditRead,
  RevisionRepairResult,
} from './revisionRepairPlanning.ts';
