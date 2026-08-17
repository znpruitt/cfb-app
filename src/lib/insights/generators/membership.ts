import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import { buildMembershipHistory, type MembershipEvent } from '../membershipHistory';
import { parseOwnersCsv } from '../../parseOwnersCsv';
import { formatOwnerList, membershipIsKnown } from '../superlative';
import type { InsightContext, InsightGenerator, LifecycleState } from '../types';

/**
 * INSIGHTS-025 — who joined, who came back, who is gone.
 *
 * Every figure is derived at request time from `context.archives` and
 * `context.leagueMembers`. No owner name, year, count or placement appears as a
 * literal anywhere in this file or its derivation — a source scan in
 * `__tests__/membership.test.ts` fails the build if one ever does.
 *
 * ## Why this needed a ruling first
 *
 * AGENTS.md Insights invariant 5 forbade naming who is returning, on the grounds
 * that it "requires comparing a FINALIZED upcoming roster against league history,
 * which no generator has". INSIGHTS-023a supplied the roster; INSIGHTS-023
 * established that a CONFIRMED list is finalized enough; INSIGHTS-023 then
 * explicitly fenced returning claims to this slice. That fence comes down here,
 * and the invariant is amended in the same change — INSIGHTS-022's recorded
 * lesson is that removing such a framing without amending the rule breaks it.
 *
 * ## These events expire on their own
 *
 * No suppression rule is needed. Next season the returner appears in the newest
 * archive, so they are no longer computed as returning; the new owner is in it
 * too, so they are no longer new. The facts stop being derivable rather than
 * needing to be hidden — unlike a career record, which stays true and must be
 * rotated instead.
 */

/**
 * A membership change is news while the roster is fresh. It is settled fact once
 * games are being played, which is what `decay` handles at the serving edge.
 */
const MEMBERSHIP_LIFECYCLES: LifecycleState[] = ['preseason', 'early_season', 'mid_season'];

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${n % 10 <= 3 ? suffix : 'th'}`;
}

function joinedInsight(owners: string[], year: number): Insight {
  const names = formatOwnerList(owners);
  const verb = owners.length > 1 ? 'join' : 'joins';
  const variants = [
    `${names} ${verb} the league for ${year}.`,
    `${names} ${owners.length > 1 ? 'are' : 'is'} new. No history to hide behind.`,
  ];
  return {
    // Grouped into ONE insight. Three arrivals must not consume three of the
    // Overview's five slots.
    id: `membership-joined-${year}-${owners.map((o) => o.toLowerCase().replace(/\s+/g, '-')).join('-')}`,
    type: 'owners_joined',
    title: owners.length > 1 ? 'New owners' : 'New owner',
    description: variants[0]!,
    descriptionVariants: variants,
    owner: owners[0],
    relatedOwners: owners.slice(1),
    priorityScore: 82,
    lifecycle: MEMBERSHIP_LIFECYCLES,
    category: 'narrative',
    newsHook: 'snapshot',
    decay: 'draft',
    statValue: owners.length,
  };
}

function returnedInsight(
  event: Extract<MembershipEvent, { kind: 'returned' }>,
  year: number
): Insight {
  const { owner, lastSeason, bestSeason } = event;
  // Owner's wording (2026-08-17): a returner gets a WELCOME, not a scorecard.
  // "They last appeared in {year}" rather than a gap count — a year is concrete
  // where "four seasons away" makes the reader do arithmetic.
  const variants = [
    `This year ${owner} returns to the league — they last appeared in ${lastSeason.year}.`,
  ];
  // The warm variant needs more than one prior season, or "their best finish"
  // collapses to "their only finish" and welcomes someone back with their worst
  // result. `bestSeason` is null in that case by construction.
  if (bestSeason !== null && bestSeason.placement !== null) {
    variants.push(
      `This year ${owner} returns to the league — their best finish was ${ordinal(bestSeason.placement)} in ${bestSeason.year}.`
    );
  }
  return {
    id: `membership-returned-${year}-${owner.toLowerCase().replace(/\s+/g, '-')}`,
    type: 'owner_returned',
    title: 'Back in the league',
    description: variants[0]!,
    descriptionVariants: variants,
    owner,
    priorityScore: 84,
    lifecycle: MEMBERSHIP_LIFECYCLES,
    category: 'narrative',
    newsHook: 'snapshot',
    decay: 'draft',
    statValue: event.seasonsAway,
  };
}

/**
 * Beyond this many departures, placements are dropped and the bare form carries
 * the news. Owner ruling (2026-08-17): cap at three.
 */
const MAX_NAMED_DEPARTURES = 3;

/** Small counts read better as words; beyond that a digit is clearer. */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

/**
 * Departures, as one insight.
 *
 * GROUPED rather than one card each, and the reason is slot economy: the Overview
 * holds five, and two departure cards would spend 40% of the front page
 * reporting that the roster shrank. Joins are grouped for the same reason, so
 * splitting departures would be inconsistent for no gain.
 *
 * The copy is TIERED BY COUNT, because the natural sentence at two does not
 * survive at three: "they finished 14th and 5th" makes the reader map names to
 * placements positionally, which collapses the moment there is a third. The
 * parenthetical form binds each placement to its own name and scales; the bare
 * form drops placements entirely and always works.
 *
 * Owner framing (2026-08-17): this is NEWS, not a sour note — "people come and
 * go". So no line comments on why anyone left, and none implies the finish
 * caused it. An earlier draft read "finished last and did the same", which
 * carried exactly that implication.
 */
function leftInsight(
  events: Extract<MembershipEvent, { kind: 'left' }>[],
  currentYear: number
): Insight {
  // Worst finish first — a stable rule rather than an editorial one. Unranked
  // owners sort last.
  const ordered = [...events].sort(
    (a, b) => (b.finalSeason.placement ?? 0) - (a.finalSeason.placement ?? 0)
  );
  const names = formatOwnerList(ordered.map((e) => e.owner));
  const finalYear = ordered[0]!.finalSeason.year;
  const withPlacements = ordered
    .filter((e) => e.finalSeason.placement !== null)
    .map((e) => `${e.owner} (${ordinal(e.finalSeason.placement!)})`);

  const variants: string[] = [];
  if (ordered.length === 1) {
    const only = ordered[0]!;
    variants.push(
      only.finalSeason.placement === null
        ? `${only.owner} has left the league.`
        : `${only.owner} has left the league after finishing ${ordinal(only.finalSeason.placement)} in ${finalYear}.`
    );
  } else if (ordered.length === 2 && withPlacements.length === 2) {
    // Only at TWO. Positional mapping is readable with one "and" and not beyond.
    const [a, b] = ordered;
    variants.push(
      `${names} are out for ${currentYear} — they finished ${ordinal(a!.finalSeason.placement!)} and ${ordinal(b!.finalSeason.placement!)} in ${finalYear}.`
    );
  }
  // Past three names the parenthetical form is a table, not a sentence — five
  // names with five ordinals is something you scan. Same width limit the
  // self-play insights carry, which review had to make me apply to both sides
  // after I capped only one. Beyond the cap the bare form does the job.
  if (ordered.length > 1 && ordered.length <= MAX_NAMED_DEPARTURES && withPlacements.length > 0) {
    variants.push(
      // Capitalised: this word opens the sentence, and `countWord` returns
      // lowercase because it is also usable mid-sentence.
      `${capitalize(countWord(ordered.length))} owners are out for ${currentYear}: ${formatOwnerList(withPlacements)}.`
    );
  }
  variants.push(`${names} ${ordered.length > 1 ? 'have' : 'has'} left the league.`);

  return {
    id: `membership-left-${currentYear}-${ordered.map((e) => e.owner.toLowerCase().replace(/\s+/g, '-')).join('-')}`,
    type: 'owners_left',
    title: ordered.length > 1 ? 'Owners out' : 'Owner out',
    description: variants[0]!,
    descriptionVariants: variants,
    owner: ordered[0]!.owner,
    relatedOwners: ordered.slice(1).map((e) => e.owner),
    priorityScore: 80,
    lifecycle: MEMBERSHIP_LIFECYCLES,
    category: 'narrative',
    newsHook: 'snapshot',
    decay: 'draft',
    statValue: ordered.length,
  };
}

export const membershipGenerator: InsightGenerator = {
  id: 'narrative:membership',
  category: 'narrative',
  supportedLifecycles: MEMBERSHIP_LIFECYCLES,
  tone: 'factual',
  generate(context: InsightContext): Insight[] {
    // Membership must be KNOWN. With `previous-roster` the "members" ARE last
    // season's roster, so nobody could ever be computed as joining or leaving —
    // and anyone who merely sat a season out would be reported as departed. This
    // is the one generator where an unknown membership makes the whole subject
    // unanswerable rather than merely unsafe to word.
    if (!membershipIsKnown(context.leagueMembersSource)) return [];
    if (context.archives.length === 0) return [];

    const history = buildMembershipHistory({
      archives: context.archives,
      members: context.leagueMembers,
      parseCsv: parseOwnersCsv,
    });

    const insights: Insight[] = [];
    for (const event of history.events) {
      if (event.kind === 'joined') insights.push(joinedInsight(event.owners, context.currentYear));
      if (event.kind === 'returned') insights.push(returnedInsight(event, context.currentYear));
    }
    // Departures are collected and emitted as ONE insight — see `leftInsight`.
    const departures = history.events.filter(
      (e): e is Extract<MembershipEvent, { kind: 'left' }> => e.kind === 'left'
    );
    if (departures.length > 0) insights.push(leftInsight(departures, context.currentYear));

    return insights;
  },
};

registerGenerator(membershipGenerator);
