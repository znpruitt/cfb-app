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
 * Whether every configured pick has been made.
 *
 * Reads defensively. `getAppState` performs no runtime validation, which is why
 * `selectTeamAssignment` types its roster input `unknown` and says so — the same
 * discipline has to apply to the DRAFT record, and briefly did not: this
 * dereferenced `settings.totalRounds` and `owners.length` on a trusted typed
 * slice, so a partial or hand-edited row threw `TypeError` instead of producing
 * a blocker. On the checklist that throw was swallowed and silently read as
 * "not assigned"; in `completeSetup` there is no catch, so a commissioner got a
 * raw crash in place of the refusal this derivation exists to produce.
 *
 * An unreadable draft is not a publishable one, so every degraded shape answers
 * `false`.
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

export type DraftPublicationControls = {
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
  if (!draft) return { canPublish: false, canReopen: false };

  // A published draft whose roster has since been cleared is published in name
  // only: `selectTeamAssignment` blocks setup with `published-roster-missing`,
  // and that blocker's stated next step — put the roster back — had no control
  // that performed it. Confirm was hidden because publication still "held", so
  // recovery meant Reopen then Confirm: the same two-step workaround this work
  // exists to remove. Treat a missing roster as unpublished FOR THE CONTROLS,
  // which puts Confirm back and withdraws a Reopen that would reopen nothing.
  const standing = isDraftPublished(draft) && facts.publishedRosterExists;
  return {
    canPublish: !standing && draftPicksAreComplete(draft),
    canReopen: standing,
  };
}
