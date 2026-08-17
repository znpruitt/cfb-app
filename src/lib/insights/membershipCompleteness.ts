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
 * The second half is the two-way match, and it is MANDATORY rather than a
 * fallback. A published draft is run over the confirmed owner list, so every
 * participant holds teams and every member should hold one:
 *
 *  - someone holding a team but NOT listed ⇒ the list is missing a participant;
 *  - someone listed but holding NO team ⇒ the list has moved on since the draft
 *    published, and publication is a past event that does not follow it.
 *
 * How load-bearing that is depends on where membership came from, and the honest
 * statement is worth making because an earlier version of this comment implied it
 * always bites. It is a genuine second condition ONLY for
 * `leagueMembersSource === 'confirmed'`, where the list is an independent record.
 * For `official-roster` and `partial-roster`, `resolveLeagueMembers` DERIVES the
 * members from the same owners CSV that produces the roster, so both directions
 * hold by construction and publication is doing all the work. That is sound —
 * with a published roster the derived list is the participant list — but it is
 * one condition there, not two, and a reader should not count on the match to
 * catch anything in that case.
 *
 * Everything else is `incomplete`, including every case this module cannot see. A
 * feature that publishes claims about who is gone fails closed.
 *
 * A consequence worth stating plainly: a league that assigns teams by hand rather
 * than by draft publishes no membership changes at all. A hand-uploaded CSV
 * carries no signal that it is finished, which is exactly what v2 got wrong.
 *
 * That is a GAP, not the final answer. The owner ruled (2026-08-17) that
 * completing setup should be the fallback gate so a commissioner-assigned roster
 * keeps full insight access, and that ruling is accepted — it is not implemented
 * here because it cannot be yet. `manualAssignmentComplete` has no writer, so a
 * manual league can never complete setup at all (it cannot finish preseason
 * either, which is the larger problem), and the fallback branch would be
 * unreachable code in the one module on this feature where an evidence rule with
 * no real state behind it has already caused two published falsehoods. Whatever
 * records that completion must also be per-season and durable, because
 * `setupComplete` is deleted by the season transition. Filed as queue item 51
 * with both constraints; add the branch when a manual league can reach the
 * state.
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
   * found nothing to say — and because the four reasons call for different
   * responses from an operator.
   */
  evidence:
    | 'published-roster'
    | 'roster-not-final'
    | 'list-contradicted'
    | 'roster-behind-list'
    | 'identity-ambiguous';
  /** Owners holding a team this season who are absent from the member list. */
  unlistedRosterOwners: string[];
  /** Members who hold no team in the published roster. */
  unrosteredMembers: string[];
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

  const memberNames = [...members].filter((o) => o && o !== NO_CLAIM_OWNER && o.trim());
  const rosterOwners = usingArchivedRoster
    ? []
    : [
        ...new Set(
          [...currentRoster.values()].filter((o) => o && o !== NO_CLAIM_OWNER && o.trim())
        ),
      ];

  // IDENTITY AMBIGUITY FAILS CLOSED. Two different spellings sharing one
  // normalized identity is either a re-typed name or two owners the app cannot
  // tell apart, and `cleanOwnerNames` permits both (`Mike` and `mike` are
  // distinct owners; AGENTS.md invariant 11 defers canonical owner identity). The
  // matching below normalizes, so without this a collapsed pair could corroborate
  // itself. `membershipHistory` already refuses to speak about such an identity;
  // this makes the completeness answer agree rather than leaving the two layers
  // to disagree about who exists.
  const spellings = new Map<string, Set<string>>();
  for (const raw of [...memberNames, ...rosterOwners]) {
    const seen = spellings.get(identityKey(raw)) ?? new Set<string>();
    seen.add(raw);
    spellings.set(identityKey(raw), seen);
  }
  const ambiguous = [...spellings.values()].some((set) => set.size > 1);

  const memberKeys = new Set(memberNames.map(identityKey));
  const rosterKeys = new Set(rosterOwners.map(identityKey));

  // Compared on NORMALIZED identity. Compared raw at first, which meant a case
  // drift between the CSV and the confirmed list silenced the whole feed for no
  // reason; ambiguity is handled above instead, where it can be reported.
  const unlistedRosterOwners = rosterOwners
    .filter((owner) => !memberKeys.has(identityKey(owner)))
    .sort((a, b) => a.localeCompare(b));
  const unrosteredMembers = usingArchivedRoster
    ? []
    : memberNames
        .filter((owner) => !rosterKeys.has(identityKey(owner)))
        .sort((a, b) => a.localeCompare(b));

  const base = { unlistedRosterOwners, unrosteredMembers };

  if (ambiguous) return { complete: false, evidence: 'identity-ambiguous', ...base };

  // Checked FIRST and unconditionally. An earlier version made this a fallback
  // that an assertion of completeness could skip, and a commissioner re-confirming
  // a shortened list then published an owner as departed while they still held a
  // team. A visible contradiction defeats any evidence.
  if (unlistedRosterOwners.length > 0) {
    return { complete: false, evidence: 'list-contradicted', ...base };
  }

  if (!rosterIsPublished || usingArchivedRoster || rosterOwners.length === 0) {
    return { complete: false, evidence: 'roster-not-final', ...base };
  }

  // THE SECOND DIRECTION, and it is not symmetry for its own sake. Publication is
  // a PAST event: publishing an A/B draft and then re-confirming A/B/C leaves the
  // publication valid while the list has moved on, and one-way containment
  // (roster ⊆ members) still held — so C was announced as joining a league whose
  // final roster does not include them. The same gap let a blanked roster pass,
  // because an empty set is contained in everything.
  if (unrosteredMembers.length > 0) {
    return { complete: false, evidence: 'roster-behind-list', ...base };
  }

  return { complete: true, evidence: 'published-roster', ...base };
}
