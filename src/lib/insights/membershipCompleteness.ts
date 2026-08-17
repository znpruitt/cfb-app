import { NO_CLAIM_OWNER } from '../standings';
import { identityKey } from './membershipHistory';

/**
 * Is the league's member list COMPLETE — does it account for everyone playing?
 *
 * ## Why this is not `membershipIsKnown`
 *
 * `membershipIsKnown` answers "did this list come from a source that means
 * membership at all", and it is satisfied at `MIN_CONFIRMED_OWNERS` — two names.
 * That is the right question for copy that merely NAMES a member ("Alice leads
 * active owners"): a short list makes such a claim narrow, never false.
 *
 * Membership CHANGES are the opposite. They are claims about ABSENCE — "Carol has
 * left the league" is derived from Carol not appearing — so a list that is merely
 * started, rather than finished, does not make the claim narrow. It makes it
 * wrong about real people. Driven through the loader on an 8-owner league with
 * two names entered, the top card read:
 *
 *   "Heidi, Grace, Frank, Erin, Dave, and Carol have left the league."
 *
 * Six owners announced as gone. Absence is only evidence when the list is known
 * to be finished.
 *
 * ## Two failed models preceded this one, and both failed the same way
 *
 * **v1 — a lifecycle and a flag.** `lifecycleState === 'preseason' &&
 * !preseasonSetupComplete`. `setupComplete` exists only on the preseason variant
 * of `LeagueStatus`, and `completeSeasonTransition` advances a league on state and
 * year alone, so the transition DELETES the field: the gate silently stopped
 * applying and the same false card was served in season instead. Relocated, not
 * closed.
 *
 * **v2 — an assertion plus an independent witness.** `setupComplete` OR "the
 * roster corroborates a confirmed list". Both halves were wrong, and review
 * reproduced both end to end:
 *
 *  - The assertion IGNORED A VISIBLE CONTRADICTION. `confirmPreseasonOwners` is
 *    not gated on `setupComplete` and never resets it, and the owner editor stays
 *    reachable all preseason — so a re-confirm that drops a name leaves
 *    `setupComplete: true` beside a roster naming someone the list omits. That
 *    owner was then published as departed while still holding a team.
 *  - The witness COULD NOT SEE PARTIALITY. "Every roster owner appears in the
 *    list" is satisfied by a two-row roster against a two-name list, and
 *    `PUT /api/owners` enforces no minimum row count, so a mid-setup save is an
 *    ordinary state. Two independent records that are each half-finished agree
 *    perfectly. Independence is not completeness — a roster witnesses PRESENCE,
 *    never the absence of anyone it does not mention.
 *
 * ## The rule
 *
 * One question, asked the same way in every lifecycle state:
 *
 *   **Is the roster FINAL, and does the member list account for everyone on it?**
 *
 * `isDraftPublished` answers the first half. A published draft is the app's own
 * statement that team assignment is finished, it is stored per (slug, year) in
 * `draft:{slug}`, and — the property both previous models lacked — it is durable:
 * the season transition does not touch it. Partiality is impossible against it,
 * because a published draft assigns every eligible team.
 *
 * **OWNER RULING, 2026-08-17: "a confirmed draft should be the gate to report
 * results on who joined/left."** This is a product decision, not merely the
 * soundest predicate available — do not relax it to something weaker (a count, a
 * flag, an agreement between two records) because a league is waiting on content.
 * All three of those were tried and all three published false departures. The
 * ruling also settles the timing question it was asked in: a league sees no
 * membership news until its draft is confirmed, and that is the intended
 * behaviour rather than a delay to work around.
 *
 * The second half is the contradiction check, and it is MANDATORY rather than a
 * fallback. A published draft is run over the confirmed owner list, so every
 * participant holds teams; if someone holds a team and is not listed, the list is
 * missing a participant, whatever else may assert otherwise.
 *
 * Everything else is `incomplete`, including every case this module cannot see. A
 * feature that publishes claims about who is gone fails closed.
 *
 * A consequence worth stating plainly: a league that assigns teams by hand rather
 * than by draft publishes no membership changes at all. That is the correct
 * answer rather than a gap — a hand-uploaded CSV carries no signal that it is
 * finished, which is exactly what v2 got wrong.
 *
 * ## What this deliberately does NOT do
 *
 * It does not change `membershipIsKnown` or any other generator's use of it. This
 * is a strictly stronger question asked by the one feature whose claims are about
 * absence; widening it to the career and rivalry generators would change content
 * those slices' owner rulings settled.
 */

export type MembershipCompleteness = {
  complete: boolean;
  /**
   * Why the answer is what it is. Surfaced on the diagnostics page, because the
   * gate's silence is otherwise indistinguishable from a generator that simply
   * found nothing to say.
   */
  evidence: 'published-roster' | 'roster-not-final' | 'list-contradicted';
  /** Owners holding a team this season who are absent from the member list. */
  unlistedRosterOwners: string[];
};

export function resolveMembershipCompleteness(params: {
  members: ReadonlySet<string>;
  /** Current-year team→owner map, as resolved for insight generation. */
  currentRoster: ReadonlyMap<string, string>;
  /**
   * True when `currentRoster` was borrowed from the most recent archive because
   * this season has no roster yet. A borrowed roster describes LAST season's
   * membership, so it can neither be final for this one nor contradict this
   * season's list — and the owners it names are exactly the people who might have
   * left.
   */
  usingArchivedRoster: boolean;
  /**
   * `isDraftPublished(draft)` for THIS league and THIS season. The app's own
   * statement that team assignment is finished, and the only completeness fact
   * that survives the season transition.
   */
  rosterIsPublished: boolean;
}): MembershipCompleteness {
  const { members, currentRoster, usingArchivedRoster, rosterIsPublished } = params;

  // Compared on NORMALIZED identity, matching `buildMembershipHistory`. Compared
  // raw at first, which meant a case drift between the CSV and the confirmed list
  // — the exact drift the history layer resolves — put a name here and silenced
  // the whole feed. Failing closed, but silently and for no reason.
  const memberKeys = new Set([...members].map(identityKey));
  const unlistedRosterOwners = usingArchivedRoster
    ? []
    : [
        ...new Map(
          [...currentRoster.values()]
            .filter(
              (owner) => owner && owner !== NO_CLAIM_OWNER && !memberKeys.has(identityKey(owner))
            )
            .map((owner) => [identityKey(owner), owner])
        ).values(),
      ].sort((a, b) => a.localeCompare(b));

  // Checked FIRST and unconditionally. v2 made this a fallback that a
  // `setupComplete` assertion could skip, and a commissioner re-confirming a
  // shortened list then published an owner as departed while they still held a
  // team. A visible contradiction defeats any assertion of completeness.
  if (unlistedRosterOwners.length > 0) {
    return { complete: false, evidence: 'list-contradicted', unlistedRosterOwners };
  }

  if (!rosterIsPublished || usingArchivedRoster) {
    return { complete: false, evidence: 'roster-not-final', unlistedRosterOwners };
  }

  return { complete: true, evidence: 'published-roster', unlistedRosterOwners };
}
