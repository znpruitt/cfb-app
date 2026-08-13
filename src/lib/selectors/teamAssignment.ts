import { type DraftState } from '../draft.ts';
import { hasUsableOfficialRoster } from './confirmedRoster.ts';
import { isDraftPublished, selectDraftPublicationControls } from './draftPublication.ts';

/**
 * PLATFORM-094 — the ONE answer to "have this league's teams been assigned?"
 *
 * The preseason checklist and the Complete Setup action both decide this, and
 * they decided it differently: the checklist read `draftPhase === 'complete'`,
 * while the action checked nothing at all and relied on a disabled button. A
 * `disabled` attribute is not a guard — the Server Action is reachable without
 * the form, and Server Action arguments cross HTTP unvalidated.
 *
 * **Neither the draft's phase nor the roster's existence is evidence on its
 * own.** `complete` fires on the final pick, before anything is written. And the
 * `owners:{slug}:{year}` record has several writers that have nothing to do with
 * this draft — the repair import at `/admin/{slug}/roster`, and the demo
 * year-migration that copies one season's roster to the next — so a roster can
 * predate the draft entirely and describe assignments it never made.
 *
 * So this asks for two different kinds of fact:
 *   - publication — the draft's `publishedPicks` digest matches the picks it
 *     holds now, meaning the stored roster describes THIS set of selections.
 *     Written atomically with the roster by the confirm route, and retracted by
 *     any change to the picks without a writer maintaining it.
 *   - a usable roster — that published assignment is still there. Publication
 *     records a past event, and `PUT /api/owners` can blank the CSV without
 *     touching the draft, so the digest alone would outlive its data.
 *
 * **This asks the OFFICIAL roster specifically, not "does the league have
 * owners".** `getConfirmedRoster` answers participant membership and prefers the
 * confirmation record, so it reports a confirmed roster for a league that has
 * named its owners but never published assignments — the exact state this check
 * exists to refuse.
 */
export type TeamAssignmentInput = {
  /** `League.assignmentMethod` — how this league assigns teams. */
  assignmentMethod: 'draft' | 'manual' | null | undefined;
  /**
   * The stored draft for this league-year, or null when none exists.
   *
   * Taken as a SLICE rather than loose fields so the phase, the picks, and the
   * published digest cannot be passed from different records — the answer turns
   * on all three describing the same draft.
   */
  draft: Pick<DraftState, 'phase' | 'picks' | 'publishedPicks' | 'owners' | 'settings'> | null;
  /** The raw `owners:{slug}:{year}` CSV record, untrusted. */
  officialRosterCsv: unknown;
  /** `League.manualAssignmentComplete`. */
  manualAssignmentComplete: boolean | undefined;
};

/**
 * Why teams are not assigned yet. `null` when they are.
 *
 * Distinct reasons rather than a boolean: "the draft has not finished", "it
 * finished but was never published", and "it published and the roster is now
 * gone" are three different operator situations with three different next steps.
 */
export type TeamAssignmentBlocker =
  | 'no-assignment-method'
  | 'draft-incomplete'
  | 'draft-not-published'
  | 'published-roster-missing'
  | 'manual-assignment-incomplete';

export type TeamAssignment = {
  isAssigned: boolean;
  blocker: TeamAssignmentBlocker | null;
};

const ASSIGNED: TeamAssignment = { isAssigned: true, blocker: null };

function blocked(blocker: TeamAssignmentBlocker): TeamAssignment {
  return { isAssigned: false, blocker };
}

export function selectTeamAssignment(input: TeamAssignmentInput): TeamAssignment {
  const { assignmentMethod, draft, officialRosterCsv, manualAssignmentComplete } = input;

  if (assignmentMethod === 'draft') {
    // Ordered so the blocker names the operator's ACTUAL next step: finish the
    // draft, then publish it, then restore a roster that went missing. A single
    // "not assigned" would send all three to the same dead end.
    // A reopened draft keeps every pick and moves to `live`. Calling that
    // "incomplete" is false — the picks ARE in — and it routed the checklist to
    // the setup screen while the only publish control sat on the summary page.
    // `selectDraftPublicationControls` already owns the definition of
    // publishable, so it decides here too rather than a second rule drifting.
    if (draft?.phase !== 'complete') {
      if (draft && selectDraftPublicationControls(draft).canPublish) {
        return blocked('draft-not-published');
      }
      return blocked('draft-incomplete');
    }
    if (!isDraftPublished(draft)) return blocked('draft-not-published');
    if (!hasUsableOfficialRoster(officialRosterCsv)) return blocked('published-roster-missing');
    return ASSIGNED;
  }

  if (assignmentMethod === 'manual') {
    // `manualAssignmentComplete` has NO writer today — manual assignment is
    // unimplemented — so this branch is permanently false in practice. Kept
    // faithful to the stored field rather than pretending otherwise: inventing a
    // roster-derived answer here would let a manual league complete setup on
    // assignments nothing recorded.
    return manualAssignmentComplete === true ? ASSIGNED : blocked('manual-assignment-incomplete');
  }

  return blocked('no-assignment-method');
}
