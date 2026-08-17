import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import { buildMembershipHistory, type MembershipEvent } from '../membershipHistory';
import { parseOwnersCsv } from '../../parseOwnersCsv';
import { formatOwnerList } from '../superlative';
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

/**
 * A stable id fragment that PRESERVES distinct owner identities.
 *
 * `ownerKey(owner)` collapsed two names the roster layer
 * treats as distinct — `cleanOwnerNames` trims but does not fold case — and the
 * views key React rows on `insight.id`, so two returners could reconcile onto one
 * row. The suffix is a small hash of the RAW name, so casing and spacing survive
 * into the key while the readable part stays readable.
 */
function ownerKey(owner: string): string {
  let hash = 2166136261;
  for (let i = 0; i < owner.length; i += 1) {
    hash ^= owner.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const slug = owner
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}${(hash >>> 0).toString(36)}`;
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
    id: `membership-joined-${year}-${owners.map((o) => ownerKey(o)).join('-')}`,
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
    id: `membership-returned-${year}-${ownerKey(owner)}`,
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
  // EVERY departure must have a placement for this form, not merely one of them.
  // `withPlacements` drops unranked owners while the count came from the full
  // list, so two departures where one is unranked rendered "Two owners are out:
  // C (3rd)." — a count of two above a single name, in the DEFAULT description
  // rather than only in a rotation variant.
  if (
    ordered.length > 1 &&
    ordered.length <= MAX_NAMED_DEPARTURES &&
    withPlacements.length === ordered.length
  ) {
    variants.push(
      // Capitalised: this word opens the sentence, and `countWord` returns
      // lowercase because it is also usable mid-sentence.
      `${capitalize(countWord(ordered.length))} owners are out for ${currentYear}: ${formatOwnerList(withPlacements)}.`
    );
  }
  // Deduped. A single UNRANKED departure took the bare form from the branch above
  // and then appended it again, producing two identical variants — and the test
  // asserting `length === 2` passed on the duplicate, because it counted entries
  // rather than distinct ones.
  const bare = `${names} ${ordered.length > 1 ? 'have' : 'has'} left the league.`;
  if (!variants.includes(bare)) variants.push(bare);

  return {
    id: `membership-left-${currentYear}-${ordered.map((e) => ownerKey(e.owner)).join('-')}`,
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

/** Several returners in one year: report the fact, drop the per-owner detail. */
function groupedReturnInsight(
  events: Extract<MembershipEvent, { kind: 'returned' }>[],
  year: number
): Insight {
  const owners = [...events].sort((a, b) => a.owner.localeCompare(b.owner)).map((e) => e.owner);
  const names = formatOwnerList(owners);
  const variants = [
    `This year ${names} return to the league.`,
    `${names} are back in the league for ${year}.`,
  ];
  return {
    id: `membership-returned-${year}-${owners.map((o) => ownerKey(o)).join('-')}`,
    type: 'owner_returned',
    title: 'Back in the league',
    description: variants[0]!,
    descriptionVariants: variants,
    owner: owners[0],
    relatedOwners: owners.slice(1),
    priorityScore: 84,
    lifecycle: MEMBERSHIP_LIFECYCLES,
    category: 'narrative',
    newsHook: 'snapshot',
    decay: 'draft',
    statValue: owners.length,
  };
}

export const membershipGenerator: InsightGenerator = {
  id: 'narrative:membership',
  category: 'narrative',
  supportedLifecycles: MEMBERSHIP_LIFECYCLES,
  tone: 'factual',
  generate(context: InsightContext): Insight[] {
    // THE WHOLE GATE, and it is non-bypassable on purpose.
    //
    // `seasonOwners` is the owner set of this season's CONFIRMED DRAFT. A
    // confirmed draft cannot be half-finished, and rosters must be balanced so
    // every owner drafts — so this set IS the league for that season and there is
    // nothing left to verify. Owner ruling, 2026-08-17: "a confirmed draft should
    // be the gate to report results on who joined/left."
    //
    // Four review rounds of this feature were spent proving the CONFIRMED OWNER
    // LIST (`context.leagueMembers`) complete, because claims about who LEFT are
    // inferred from absence and a half-typed list makes them false about real
    // people. Every version of that proof — a lifecycle flag, an assertion, two
    // records agreeing — could be true while the fact was false. This input needs
    // no proof, which is why the completeness authority that used to sit here is
    // deleted rather than fixed.
    //
    // Non-bypassable because `shouldSuppressGenerator` is lifted by
    // `?bypassSuppression=1`, which any caller can set on a passwordless league
    // (PLATFORM-101). The entry there LABELS the skip for diagnostics; this
    // ENFORCES it.
    if (!context.seasonOwners) return [];
    if (context.archives.length === 0) return [];

    const { year, owners } = context.seasonOwners;

    const history = buildMembershipHistory({
      archives: context.archives,
      // The draft's owners, not `context.leagueMembers`. The confirmed list is a
      // commissioner's work-in-progress until the draft is confirmed; the draft
      // is the record of who actually took part.
      members: new Set(owners),
      parseCsv: parseOwnersCsv,
      // The year the DRAFT was confirmed for, carried with its owners. Reading
      // both from one place is what makes `?year=` coherent by construction: an
      // earlier version took membership from the requested year and `currentYear`
      // from the league record, and diffed the 2024 roster against the 2026
      // archive.
      currentYear: year,
    });

    const insights: Insight[] = [];
    for (const event of history.events) {
      if (event.kind === 'joined') insights.push(joinedInsight(event.owners, year));
    }

    // RETURNERS: one insight when there is one, GROUPED when there are several.
    //
    // Emitting one each broke the rule stated three lines up in this same file —
    // "three arrivals must not consume three of the Overview's five slots" — and
    // did it at `priorityScore: 84`, near the top of the engine's range. Four
    // returners would have taken four of the five slots.
    //
    // An earlier version of this sentence said 84 was "higher than any
    // pre-existing insight in the engine, which topped out at 78". Measured, four
    // caps sit above it and are all reachable: dynasty 90, lopsided 88, dominance
    // 88, drought 85. The grouping decision does not depend on the figure, which
    // is why the wrong one survived being written down.
    //
    // A single returner keeps the good copy, which names the year they last
    // played. Several cannot: the sentence would have to carry a year each, so
    // the grouped form drops the detail and reports the fact.
    const returners = history.events.filter(
      (e): e is Extract<MembershipEvent, { kind: 'returned' }> => e.kind === 'returned'
    );
    if (returners.length === 1) {
      insights.push(returnedInsight(returners[0]!, year));
    } else if (returners.length > 1) {
      insights.push(groupedReturnInsight(returners, year));
    }
    // Departures are collected and emitted as ONE insight — see `leftInsight`.
    const departures = history.events.filter(
      (e): e is Extract<MembershipEvent, { kind: 'left' }> => e.kind === 'left'
    );
    if (departures.length > 0) insights.push(leftInsight(departures, year));

    return insights;
  },
};

registerGenerator(membershipGenerator);
