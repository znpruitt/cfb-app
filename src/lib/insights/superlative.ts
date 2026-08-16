import type { LeagueMembersSource } from './types';

/**
 * INSIGHTS-030 — one place that knows a record is measured against the whole
 * league while only a member may be named.
 *
 * Five generators hand-rolled the same two loops and five of them collapsed the
 * two populations into one, producing claims like "Alice still leads all-time
 * with 1,620 career league points" while the archives held a departed owner at
 * 2,700. Membership is the right filter for WHO MAY BE NAMED — that is what
 * INSIGHTS-023a established. It is the wrong filter for WHAT A RECORD IS
 * MEASURED AGAINST, because a record is a fact about the league's history and
 * history includes the people who left.
 *
 * **Owner ruling (2026-08-16): name the record holder.** When a departed owner
 * holds the record the copy says so, rather than narrowing the claim or going
 * silent.
 *
 * ## Why this takes a PREDICATE and not two lists
 *
 * The first version took `nameable` and `population` as separate arrays, and
 * review found three distinct defects that were all the same defect: the two
 * lists drifting apart.
 *
 *  - Turnover margin filtered `nameable` by a two-season floor and `population`
 *    by margin alone, so a CURRENT member with one season could be cited as the
 *    departed record holder — a sentence saying an active owner had left.
 *  - Nothing required `nameable ⊆ population`. A caller that broke it got an
 *    INVERTED citation: "Alice leads with 1,620 — Dave's 1,400 still stands."
 *  - A tie collapsed to "holds", so a member "took the all-time lead" while a
 *    departed owner sat on the identical number.
 *
 * One population plus a predicate makes the first two unrepresentable rather
 * than merely tested for: eligibility is applied ONCE, by the caller, to the
 * whole population, and membership only ever partitions what survives. The
 * third became a real state — see `SuperlativeStanding`.
 */

/**
 * Three states, because two was wrong. `shares` exists so a member tied with a
 * departed record holder is neither told they took the lead nor told someone
 * beat them.
 */
export type SuperlativeStanding = 'holds' | 'shares' | 'trails';

/**
 * A record holder, WITH the entry it came from.
 *
 * The entry is here because callers need more than a name and a number to write
 * the sentence — the pair's scoreline, the season's year and game count. Two
 * sites went back to the population to re-find it and both got it wrong: rivalry
 * reduced over everyone with no membership filter and cited the member pair
 * against ITSELF, and greatest-season only looked on `trails`, so a shared
 * record silently kept the untouched "remains the best on record". Handing back
 * what was already found removes the reason to look again.
 */
export type RecordHolder<T = unknown> = { entry: T; owner: string; value: number };

export type SuperlativeResult<T> = {
  /** The best entry among members. Never a non-member. */
  best: T;
  standing: SuperlativeStanding;
  /**
   * Non-member holders of the league record. Empty when `standing === 'holds'`;
   * populated for both `shares` and `trails`, because in each case there is
   * someone outside the league whose figure the copy has to account for.
   */
  recordHolders: RecordHolder<T>[];
};

/**
 * Resolve who to name and how their standing relates to the league record.
 *
 * `population` must already carry the generator's ELIGIBILITY filters (season
 * minimums, stat floors) applied uniformly — that is the one filter. `isMember`
 * then decides who may be named. Passing a population that has been narrowed to
 * members defeats the entire purpose.
 *
 * `compareOn` exists because a rendered figure is what a reader compares. Win
 * rate is stored to full precision and printed to three digits, so .859504 and
 * .860000 both render `.860` — and comparing the raw values produced "Alice's
 * .860 … Dave's .860 remains the league record". Compare on what is shown.
 */
export function resolveSuperlative<T>(params: {
  population: readonly T[];
  isMember: (entry: T) => boolean;
  value: (entry: T) => number;
  owner: (entry: T) => string;
  /** `max` for "most/best", `min` for "fewest/lowest". Defaults to `max`. */
  direction?: 'max' | 'min';
  /** The DISPLAYED value, when it differs from `value`. Defaults to `value`. */
  compareOn?: (entry: T) => number;
}): SuperlativeResult<T> | null {
  const { population, isMember, value, owner, direction = 'max' } = params;
  const compareOn = params.compareOn ?? value;

  const beats = (candidate: number, incumbent: number): boolean =>
    direction === 'max' ? candidate > incumbent : candidate < incumbent;

  // Index-tracked rather than `T | null`: `T` is unconstrained, so a caller may
  // legitimately hold `null` entries and a nullable accumulator cannot tell
  // "none yet" from "the extreme is a null entry".
  let bestIndex = -1;
  let recordIndex = -1;
  for (let i = 0; i < population.length; i += 1) {
    const entry = population[i]!;
    if (recordIndex === -1 || beats(compareOn(entry), compareOn(population[recordIndex]!))) {
      recordIndex = i;
    }
    if (!isMember(entry)) continue;
    if (bestIndex === -1 || beats(compareOn(entry), compareOn(population[bestIndex]!))) {
      bestIndex = i;
    }
  }

  if (bestIndex === -1) return null;

  const best = population[bestIndex]!;
  const recordValue = recordIndex === -1 ? compareOn(best) : compareOn(population[recordIndex]!);
  const bestValue = compareOn(best);

  // Everyone at the record who is NOT a member. When `best` is at the record
  // these are co-holders; when it trails they are the holders.
  //
  // No entry here satisfies `isMember` — `best` is the member extreme, so a
  // member at the record value IS `best`. **That is a statement about ENTRIES,
  // not about owners**, and an earlier version of this comment claimed the
  // stronger "a member can never appear here". It is false for a pair-shaped
  // caller: `rivalry` tests `has(dominant) && has(loser)` while its `owner`
  // accessor returns `dominant`, so a series where an ACTIVE owner swept a
  // departed one is a non-member entry whose `owner` is a current member.
  // Rivalry formats from `entry` and is unaffected, but any caller reaching for
  // `formatHolderNames` on a pair-shaped population would name a current owner
  // as the departed record holder.
  // NOTE the asymmetry: holders are SELECTED by `compareOn` but carry the RAW
  // `value`. When a caller supplies `compareOn`, co-holders are equal as
  // displayed and may differ underneath, so `recordHolders[0].value` is one
  // arbitrary pick among them. Read `entry` when the exact figure matters —
  // `greatest_season`, the only `compareOn` caller today, does.
  const outsideHolders: RecordHolder<T>[] = population
    .filter((entry) => !isMember(entry) && compareOn(entry) === recordValue)
    .map((entry) => ({ entry, owner: owner(entry), value: value(entry) }));

  if (bestValue === recordValue) {
    return {
      best,
      standing: outsideHolders.length > 0 ? 'shares' : 'holds',
      recordHolders: outsideHolders,
    };
  }

  return { best, standing: 'trails', recordHolders: outsideHolders };
}

/**
 * Whether the league's membership is KNOWN, and therefore whether copy may say
 * who is active.
 *
 * `confirmed` is an owner decision and `official-roster` is this season's actual
 * roster; both answer "who is playing". `previous-roster` does not — it is last
 * season's snapshot standing in, so an owner who merely sat a season out is
 * absent from it. Saying such an owner is not "still playing", or calling the
 * rest "active owners", asserts participation from archived data, which
 * AGENTS.md Insights invariant 5 forbids and which INSIGHTS-022 already removed
 * once as `applyReturningOwnerFraming`.
 *
 * Both reviewers found this independently, and the fallback is NOT the pre-030
 * wording — that wording is the false claim this slice exists to remove. It is
 * neutral copy that states both figures and asserts nothing about who is
 * playing: "Alice has 3,500 career league points; Dave's 4,100 is the league
 * record."
 */
export function membershipIsKnown(source: LeagueMembersSource): boolean {
  return source === 'confirmed' || source === 'official-roster';
}

/**
 * Every record holder, named — never just the first.
 *
 * Four separate sites formatted this list themselves and three got it wrong in
 * the same way: `historical` joined with `' and '` and produced "Dave and Erin
 * and Frank's 3", while `rivalry` and `greatest_season` took `recordHolders[0]`
 * so a four-way tie read as a two-way one. `career.ts` had a correct
 * `formatOwnerList` the whole time and it simply was not shared.
 *
 * Holder formatting lives here now for the same reason the population does: a
 * thing every call site re-derives is a thing every call site can get wrong.
 */
export function formatOwnerList(owners: readonly string[]): string {
  if (owners.length === 0) return '';
  if (owners.length === 1) return owners[0]!;
  if (owners.length === 2) return `${owners[0]} and ${owners[1]}`;
  return `${owners.slice(0, -1).join(', ')}, and ${owners[owners.length - 1]}`;
}

/**
 * The holders' names, possessive, ready to carry a figure:
 * "Dave's", "Dave and Erin's", "Dave, Erin, and Frank's".
 */
export function formatHolderNames(holders: readonly RecordHolder<unknown>[]): string {
  return formatOwnerList(holders.map((h) => h.owner));
}

/**
 * The verb for a holder list. "Dave's 4,100 **remains** the league record" but
 * "Dave's 2019 and Erin's 2021 **remain** the league record".
 *
 * Here rather than at each site because the multi-holder path was deliberately
 * built and then rendered with a hardcoded singular at three of them — the same
 * per-site drift the list formatter was moved here to stop.
 */
export function holderVerb(
  holders: readonly RecordHolder<unknown>[],
  singular: string,
  plural: string
): string {
  return holders.length > 1 ? plural : singular;
}
