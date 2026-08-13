import { getAppState } from './appStateStore.ts';
import { draftScope, type DraftState } from '../draft.ts';
import { selectTeamAssignment, type TeamAssignment } from '../selectors/teamAssignment.ts';

/**
 * PLATFORM-094 — the storage half of "have this league's teams been assigned?"
 *
 * Reads the two records the pure selector decides from and hands them over. Both
 * the preseason checklist and the Complete Setup action call this, so the page a
 * commissioner reads and the action that writes `setupComplete` cannot disagree.
 *
 * **These reads are deliberately NOT inside the lifecycle write transaction.**
 * `completePreseasonSetup` roots on `leagues`/`registry`, and lock acquisition
 * order is enforced upward: a secondary key must sort strictly above the held
 * root, so `owners:*` is reachable but `draft:*` is not — it sorts below
 * `leagues` and is rejected fail-fast with `AppStateTxnLockOrderError`. Locking
 * both would mean rerooting the registry write, and AGENTS.md forbids a second
 * read-modify-write path onto the registry.
 *
 * The residual window is between this read and the lifecycle commit, and it is
 * accepted knowingly: reaching it means editing the draft or blanking the roster
 * in the same instant Complete Setup is submitted, by the single operator doing
 * both. The cost is one stale checklist tick for one submission; the lifecycle
 * authority still refuses a league that is not in preseason.
 */
export async function getTeamAssignment(
  slug: string,
  year: number,
  league: { assignmentMethod?: 'draft' | 'manual' | null; manualAssignmentComplete?: boolean }
): Promise<TeamAssignment> {
  const [draftRecord, ownersCsvRecord] = await Promise.all([
    getAppState<DraftState>(draftScope(slug), String(year)),
    getAppState<unknown>(`owners:${slug}:${year}`, 'csv'),
  ]);

  return selectTeamAssignment({
    assignmentMethod: league.assignmentMethod ?? null,
    draft: draftRecord?.value ?? null,
    officialRosterCsv: ownersCsvRecord?.value ?? null,
    manualAssignmentComplete: league.manualAssignmentComplete,
  });
}
