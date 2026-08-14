import { type DraftState } from '../draft.ts';
import { hasUsableOfficialRoster } from './confirmedRoster.ts';
import {
  draftPickCountIsComplete,
  draftPicksAreComplete,
  isDraftPublished,
} from './draftPublication.ts';

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
  /** Every pick exists but at least one slot is empty — only the summary can fix it. */
  | 'draft-has-unassigned-picks'
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
    // Publication first, because it is the fact that settles the question.
    // `isDraftPublished` already requires `phase === 'complete'`, a non-empty
    // pick list, and a signature matching those picks — so a published draft has
    // been through `POST /confirm`, which validated the pick counts. Re-deriving
    // "are the picks complete" for it would only add a way to fail.
    if (isDraftPublished(draft)) {
      // Publication is a PAST event. `PUT /api/owners` can blank the CSV without
      // touching the draft, so the roster has to be checked separately or the
      // record would outlive its data.
      if (!hasUsableOfficialRoster(officialRosterCsv)) return blocked('published-roster-missing');
      return ASSIGNED;
    }

    // Not published — the blocker names which step is actually outstanding.
    //
    // The pick count decides, NOT the phase. These used to disagree: one branch
    // asked whether the draft was publishable while the other assumed `complete`
    // implied a full pick set. `PUT /api/draft/{slug}/{year}` allows
    // `live → complete` without validating any pick count, so a complete draft
    // holding a partial set answered `draft-not-published`, the checklist routed
    // to the summary page, and that page offered NEITHER control — publishable
    // false because the picks are short, reopenable false because it never
    // published. Told to publish, sent somewhere with no publish button.
    //
    // A draft still `live` with every pick in is one that was REOPENED: not
    // incomplete, simply not published.
    // A draft holding an UNASSIGNED slot is not "incomplete" in the sense that
    // routes to the board — every pick exists, one is temporarily empty, and only
    // the summary editor can show or fill it. Routing it to the board sent the
    // commissioner somewhere the slot renders exactly like a pick never made and
    // `POST /pick` refuses, which is the defect PLATFORM-095 existed to close.
    // Order matters: a draft that is genuinely SHORT is incomplete even if it
    // also holds a hole, and its outstanding work is on the board. Only a draft
    // whose slots all exist is "mid-correction" and routed to the summary.
    if (!draftPickCountIsComplete(draft)) return blocked('draft-incomplete');
    if (draft && Array.isArray(draft.picks) && draft.picks.some((p) => p?.team == null)) {
      return blocked('draft-has-unassigned-picks');
    }
    if (!draftPicksAreComplete(draft)) return blocked('draft-incomplete');
    return blocked('draft-not-published');
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
