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
  // Tolerates a malformed stored row for the same reason `allPicksAreIn` does:
  // nothing validates what comes back from the store, and a crash here would
  // replace a refusal with a 500.
  if (!Array.isArray(picks)) return JSON.stringify([]);
  // `team` may be null for an unassigned slot; JSON encodes that distinctly from
  // any team name, so a draft with a hole can never share a signature with a
  // filled one.
  return JSON.stringify(picks.map((pick) => [pick?.pickNumber, pick?.owner, pick?.team ?? null]));
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

  // A malformed row must not match. `draftPicksSignature` degrades to `'[]'` for
  // a missing or non-array pick list, and `'[]'` is ALSO the honest signature of
  // an empty draft — so `{ phase: 'complete', publishedPicks: '[]' }` with no
  // picks compared equal and read as published, and any usable roster then
  // completed setup. Making the signature total was right; choosing a degraded
  // value that collides with a real one was not.
  //
  // Requiring picks costs nothing legitimate: `POST /confirm` refuses a draft
  // with zero picks, so a genuinely published draft always has at least one.
  if (!Array.isArray(draft.picks) || draft.picks.length === 0) return false;

  return published === draftPicksSignature(draft.picks);
}

/**
 * Whether the expected NUMBER of picks exists, ignoring whether each holds a
 * team. Named for the count deliberately: an earlier name said "slots are
 * filled", which is the opposite of what it checks, and a caller choosing it by
 * name would have got the weaker predicate.
 *
 * `draftPicksAreComplete` additionally requires each slot to be filled, which is
 * right for "can this be published" and wrong for "has this draft been run" — a
 * fully-drafted league with one slot temporarily vacated during a correction
 * would otherwise read as in-progress, re-opening the hole PLATFORM-095 closed
 * in `setAssignmentMethod`: switching to `manual` mid-correction would strand the
 * whole draft.
 */
export function draftPickCountIsComplete(
  draft: Parameters<typeof draftPicksAreComplete>[0]
): boolean {
  if (!draft) return false;
  const rounds = draft.settings?.totalRounds;
  const ownerCount = draft.owners?.length;
  if (typeof rounds !== 'number' || typeof ownerCount !== 'number') return false;
  if (!Array.isArray(draft.picks)) return false;
  const expected = rounds * ownerCount;
  return expected > 0 && draft.picks.length === expected;
}

/**
 * Whether every configured pick has been made AND holds a team — the predicate
 * for "can this be published".
 *
 * Reads defensively: `getAppState` performs no runtime validation, so a partial
 * or hand-edited row must produce `false` rather than a `TypeError`.
 */
export function draftPicksAreComplete(draft: ControllableDraft | null | undefined): boolean {
  if (!draft) return false;
  const rounds = draft.settings?.totalRounds;
  const ownerCount = draft.owners?.length;
  if (typeof rounds !== 'number' || typeof ownerCount !== 'number') return false;
  if (!Array.isArray(draft.picks)) return false;
  const expected = rounds * ownerCount;
  if (expected <= 0 || draft.picks.length !== expected) return false;

  // PLATFORM-096 — every slot must HOLD a team, not merely exist. A pick can be
  // temporarily unassigned while the commissioner corrects the draft, and the
  // count alone cannot see that: the hole leaves the length unchanged. Without
  // this the summary would offer Confirm for a draft the confirm route then
  // refuses, which is the publish control lying about what it can do.
  return draft.picks.every((pick) => pick?.team != null);
}

/**
 * Whether this draft's results are currently serving as the league's roster.
 *
 * The condition `pick/[n]` uses to refuse moving a team between owners, and the
 * one the summary picker must use to decide whether to offer the move. It lived
 * in both places independently and DRIFTED once already — the component used
 * `hasUsableOfficialRoster` (two distinct owners) while the route accepts any
 * non-blank record, so a degenerate roster left entries enabled and every click
 * 422'd. AGENTS.md invariant 9 puts derived league data here for exactly this
 * reason.
 *
 * Deliberately weaker than publication: it is true for a draft confirmed before
 * `publishedPicks` existed, and for one beside a repair-imported CSV.
 */
export function draftRosterIsLive(
  draft: Pick<DraftState, 'phase'> | null | undefined,
  rosterRecordIsPresent: boolean
): boolean {
  return draft?.phase === 'complete' && rosterRecordIsPresent;
}

export type DraftPublicationControls = {
  /**
   * Every configured pick exists but at least one slot is empty, so the draft is
   * mid-correction: neither publishable nor reopenable.
   *
   * Without this the summary page rendered NO banner in that state — `canPublish`
   * false because of the hole, `canReopen` false because it never published — so
   * the only sign anything was outstanding was the word "Unassigned" in one table
   * row. A state with no control and no explanation is the exact defect this
   * campaign has been about, and this one is created by the correction feature
   * itself.
   */
  hasUnassignedPicks: boolean;
  /** Offer "Confirm Draft — Write Rosters to League". */
  canPublish: boolean;
  /** Offer "Reopen Draft". */
  canReopen: boolean;
};

export type DraftPublicationFacts = {
  /**
   * Whether the roster this draft published is still stored.
   *
   * A separate fact because publication records a PAST event: `PUT /api/owners`
   * can blank `owners:{slug}:{year}` without touching the draft, and the picks
   * still match their signature afterwards.
   */
  publishedRosterExists: boolean;
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
  draft: ControllableDraft | null | undefined,
  facts: DraftPublicationFacts = { publishedRosterExists: true }
): DraftPublicationControls {
  if (!draft) return { canPublish: false, canReopen: false, hasUnassignedPicks: false };

  // A published draft whose roster has since been cleared is published in name
  // only: `selectTeamAssignment` blocks setup with `published-roster-missing`,
  // and that blocker's stated next step — put the roster back — had no control
  // that performed it. Confirm was hidden because publication still "held", so
  // recovery meant Reopen then Confirm: the same two-step workaround this work
  // exists to remove. Treat a missing roster as unpublished FOR THE CONTROLS,
  // which puts Confirm back and withdraws a Reopen that would reopen nothing.
  const standing = isDraftPublished(draft) && facts.publishedRosterExists;
  // NOT gated on the count. A draft that is both short and holed produced no
  // banner and no control — reachable by reopening, taking a held team, then
  // unpicking — which is the same no-explanation state this exists to remove.
  // The count gate belongs in `selectTeamAssignment`, which uses it to decide
  // WHERE to route; the banner's text is true either way.
  const hasUnassignedPicks =
    Array.isArray(draft.picks) && draft.picks.some((pick) => pick?.team == null);

  return {
    canPublish: !standing && draftPicksAreComplete(draft),
    canReopen: standing,
    hasUnassignedPicks,
  };
}
