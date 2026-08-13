import type { DraftPick, DraftState } from '../draft.ts';

/**
 * PLATFORM-094 — whether a draft's results are the league's official roster,
 * and which publication control a commissioner should be offered.
 *
 * Lives here because `AGENTS.md` invariant 9 is unconditional: all derived
 * league data is computed in `src/lib/selectors/`, and any derivation found
 * outside it is an architecture violation. The first cut of this put the
 * predicate in `src/lib/draft.ts` and recombined the control state inline in
 * `DraftSummaryClient`, which is exactly the shape the invariant forbids.
 */

/** The draft fields publication is derived from. */
type PublishableDraft = Pick<DraftState, 'phase' | 'picks' | 'publishedPicks'>;

/** Adds what "every pick is in" needs — the configured size of the draft. */
type ControllableDraft = PublishableDraft & Pick<DraftState, 'owners' | 'settings'>;

/**
 * A canonical, INJECTIVE representation of a draft's picks — the identity of
 * "this set of selections", used to tell whether the league's stored roster
 * still describes the draft in front of us.
 *
 * **Injective, not hashed, and that is a correction.** This was a 32-bit FNV-1a
 * digest whose comment claimed it was "practically collision-free for this
 * domain". Review disproved that with real catalog teams: three picks owned by
 * Alice/Bob/Carol reading `App State, Buffalo, South Carolina` and
 * `Arkansas, Bowling Green, Fresno State` both hashed to `3-5a8e6545`. A
 * collision is not cosmetic here — publish the first set, reset, run the draft
 * again into the second, and the retained value would match, so readiness would
 * pass against the OLD roster and Confirm would stay hidden. That is precisely
 * the defect this field exists to prevent.
 *
 * `JSON.stringify` over ordered `[pickNumber, owner, team]` triples is injective
 * by construction: its escaping makes the encoding unambiguous for names that
 * contain quotes, commas, or brackets, so no two distinct pick sets can share a
 * representation. It costs a few KB on a record that already stores every pick
 * in full — cheap for exactness on the fact the checklist depends on.
 *
 * `pickedAt` and `autoSelected` are deliberately excluded: they move when a pick
 * is re-made or auto-selected without changing who owns which team, and so must
 * not retract a valid publication.
 */
export function draftPicksSignature(picks: readonly DraftPick[]): string {
  return JSON.stringify(picks.map((pick) => [pick.pickNumber, pick.owner, pick.team]));
}

/**
 * Whether the league's stored roster describes this draft AS IT STANDS.
 *
 * The ONE reading of `publishedPicks`, so no surface re-derives publication from
 * `phase` — the mistake this field exists to correct.
 *
 * `complete` is required as well as a matching signature: a reopened draft holds
 * the same picks it published, but it is being edited again, and the reopen
 * route's contract is that the previous roster stays in effect only until the
 * commissioner confirms anew. Callers needing to know the roster is still THERE
 * must additionally check the roster — `PUT /api/owners` can blank the CSV
 * without touching the draft.
 */
export function isDraftPublished(draft: PublishableDraft | null | undefined): boolean {
  if (!draft || draft.phase !== 'complete') return false;
  const published = draft.publishedPicks;
  if (typeof published !== 'string' || published === '') return false;
  return published === draftPicksSignature(draft.picks);
}

/** Whether every configured pick has been made. */
function allPicksAreIn(draft: ControllableDraft): boolean {
  const expected = draft.settings.totalRounds * draft.owners.length;
  return expected > 0 && draft.picks.length === expected;
}

export type DraftPublicationControls = {
  /** Offer "Confirm Draft — Write Rosters to League". */
  canPublish: boolean;
  /** Offer "Reopen Draft". */
  canReopen: boolean;
};

/**
 * Which publication control the draft summary should offer.
 *
 * **`canPublish` deliberately does NOT require `phase === 'complete'`.** Reopen
 * sets the phase to `live` while preserving every pick, so a reopened draft is
 * publishable but not complete. Requiring `complete` here stranded it with
 * neither control: Confirm was withheld because the phase was `live`, Reopen
 * because publication had lapsed, and this button is the app's only caller of
 * `POST /confirm`. A commissioner who reopened to fix one pick had no way back —
 * the same dead end this work exists to remove, reached through a different
 * door. What makes a draft publishable is that its picks are all in.
 *
 * The confirm route re-validates pick counts, ownership skew, duplicates and
 * eligibility regardless; this decides what to OFFER, never what is allowed.
 */
export function selectDraftPublicationControls(
  draft: ControllableDraft | null | undefined
): DraftPublicationControls {
  if (!draft) return { canPublish: false, canReopen: false };
  const published = isDraftPublished(draft);
  return {
    canPublish: !published && allPicksAreIn(draft),
    canReopen: published,
  };
}
