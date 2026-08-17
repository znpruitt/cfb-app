import { NO_CLAIM_OWNER } from '../standings';
import type { LeagueMembersSource } from './types';

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
 * Six owners announced as gone, mid-setup. Absence is only evidence when the list
 * is known to be finished.
 *
 * ## Why the first version of this gate did not hold
 *
 * INSIGHTS-025 shipped `lifecycleState === 'preseason' && !preseasonSetupComplete`
 * and both reviewers broke it the same way. `setupComplete` exists ONLY on the
 * preseason variant of `LeagueStatus` (`src/lib/league.ts`), and
 * `completeSeasonTransition` advances a league on `state` and `year` alone — it
 * never consults it. So the transition does not set the flag false, it DELETES
 * the field: an unfinished league is carried into `early_season`, the
 * preseason-only condition stops applying, and the same false card is served in
 * season instead of preseason. The gate relocated the defect rather than closing
 * it.
 *
 * That is the third slice on this project where a predicate grew a new edge per
 * review round, and the lesson recorded from the previous two is that the INPUT
 * is wrong rather than the edges. So this module asks its question of facts that
 * survive the transition, and asks it the same way in every lifecycle state.
 *
 * ## The rule: POSITIVE evidence, never the absence of a problem
 *
 * A list is complete only when something affirms it. Two facts can, and between
 * them they cover the whole year:
 *
 *  1. **The commissioner said so** — `setupComplete` is written by exactly one
 *     action (`completePreseasonSetup`) and means the setup checklist was
 *     finished. Available in preseason, where no roster exists yet to corroborate
 *     anything.
 *
 *  2. **The roster corroborates it** — every owner holding a team this season
 *     appears in the list. This is what survives the transition: an in-season
 *     league has an assigned roster, and an unfinished one does not have one at
 *     all (no draft ⇒ no owners CSV ⇒ the roster is borrowed from an archive, and
 *     a borrowed roster is last season's membership, so it cannot corroborate
 *     this season's).
 *
 * Anything else is `incomplete`, including every case this module cannot see. A
 * feature that publishes claims about who is gone must fail closed.
 *
 * ## Corroboration requires an INDEPENDENT list, which is the subtle part
 *
 * Rule 2 is only evidence when the member list did not come FROM the roster. When
 * members are derived from the roster (`official-roster`, `partial-roster`), the
 * comparison is a tautology — a half-assigned roster of four owners produces four
 * members who all appear in it, "corroborating" a list that omits ten people.
 * That is precisely the defect INSIGHTS-031 shipped, where a count-based check
 * passed on a partially entered roster.
 *
 * So corroboration counts only for `confirmed`, where the list is an independent
 * record (`preseason-owners:{slug}:{year}`) and the roster is a second witness to
 * it. A league that has never used the confirmation screen therefore publishes no
 * membership changes at all, and that is the correct answer rather than a
 * limitation: with one source there is no way to tell "typed four of fourteen"
 * from "shrank to four".
 *
 * ## What this deliberately does NOT do
 *
 * It does not change `membershipIsKnown` or any other generator's use of it. This
 * is a strictly stronger question asked by the one feature whose claims are about
 * absence; widening it to the career and rivalry generators would change content
 * those slices' owner rulings settled, and belongs to its own slice if it belongs
 * anywhere.
 */

export type MembershipCompleteness = {
  complete: boolean;
  /**
   * Which fact answered the question. Surfaced so the diagnostics page can say
   * WHY a feed is silent — the previous gate's silence was indistinguishable
   * from a generator that had simply produced nothing.
   */
  evidence: 'setup-complete' | 'roster-corroborates' | 'none';
  /** Owners holding a team this season who are absent from the member list. */
  unlistedRosterOwners: string[];
};

export function resolveMembershipCompleteness(params: {
  members: ReadonlySet<string>;
  source: LeagueMembersSource;
  /** Current-year team→owner map, as resolved for insight generation. */
  currentRoster: ReadonlyMap<string, string>;
  /**
   * True when `currentRoster` was borrowed from the most recent archive because
   * this season has no roster yet. A borrowed roster describes LAST season's
   * membership, so it can never corroborate this season's list — and the owners
   * it names are exactly the people who might have left.
   */
  usingArchivedRoster: boolean;
  /**
   * `status.setupComplete === true` for a preseason league; false everywhere
   * else, including in season, where the field does not exist. Passed as a plain
   * boolean rather than read here so this module holds no lifecycle knowledge.
   */
  preseasonSetupComplete: boolean;
}): MembershipCompleteness {
  const { members, source, currentRoster, usingArchivedRoster, preseasonSetupComplete } = params;

  // Computed before the early return so the diagnostics field is populated on
  // both paths — a caller reading `unlistedRosterOwners` to explain a silence
  // must not get an empty array merely because the other evidence answered first.
  const unlistedRosterOwners =
    usingArchivedRoster || currentRoster.size === 0
      ? []
      : [
          ...new Set(
            [...currentRoster.values()].filter(
              (owner) => owner && owner !== NO_CLAIM_OWNER && !members.has(owner)
            )
          ),
        ].sort((a, b) => a.localeCompare(b));

  if (preseasonSetupComplete) {
    return { complete: true, evidence: 'setup-complete', unlistedRosterOwners };
  }

  if (
    source === 'confirmed' &&
    !usingArchivedRoster &&
    currentRoster.size > 0 &&
    unlistedRosterOwners.length === 0
  ) {
    return { complete: true, evidence: 'roster-corroborates', unlistedRosterOwners };
  }

  return { complete: false, evidence: 'none', unlistedRosterOwners };
}
