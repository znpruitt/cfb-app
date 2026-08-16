/**
 * INSIGHTS-030 — one place that knows a record is measured against the whole
 * league while only a member may be named.
 *
 * Five generators hand-rolled the same two loops and five of them collapsed the
 * two populations into one, producing claims like "Alice still leads all-time
 * with 1,620 career league points" while the archives held a departed owner at
 * 2,700. Membership is the right filter for WHO MAY BE NAMED — that is what
 * INSIGHTS-023a established, and it is correct. It is the wrong filter for WHAT
 * A RECORD IS MEASURED AGAINST, because a record is a fact about the league's
 * history and history includes the people who left.
 *
 * **Owner ruling (2026-08-16): name the record holder.** When a departed owner
 * holds the record, the copy says so rather than narrowing the claim or going
 * silent — "Alice leads active owners with 1,620; Dave's 2,700 still stands as
 * the league record". A departure is worth seeing, not erasing.
 *
 * That does NOT breach AGENTS.md Insights invariant 5. The invariant forbids
 * asserting who will PARTICIPATE; citing a past record holder asserts the
 * opposite if anything, and lands squarely in its clause (b) — "a description
 * that states historical fact and asserts no participation is already safe".
 * Copy built from `recordHolder` must stay in that register: state what someone
 * DID, never what they will do.
 *
 * Taking the two populations as separate arguments is the point. Every previous
 * site derived one from the other, and that is the collapse itself.
 */

export type SuperlativeResult<T> = {
  /** The best entry among those eligible to be named. Never a non-member. */
  best: T;
  /** Whether `best` also holds the record across the full population. */
  holdsLeagueRecord: boolean;
  /**
   * The population's record holder — present ONLY when it is not `best`, so a
   * caller cannot accidentally cite a record the named member already holds.
   * `null` therefore means "the league record is the one being described".
   */
  recordHolder: { owner: string; value: number } | null;
};

/**
 * Resolve who to name and whether their standing is the league record.
 *
 * `nameable` must already be filtered to members; this function never widens the
 * guest list. `population` is everyone the record spans — pass the unfiltered
 * set, which after INSIGHTS-023a is what `context.ownerCareerStats` and the raw
 * archives hold.
 *
 * Ties: the first entry at the extreme wins, so callers control tie-breaking
 * through the order they pass. A member tied with the all-time best DOES hold
 * the record — equal is not beaten — which keeps "the most ever" true for a
 * shared record and is why the comparison is `===` rather than an ordering.
 */
export function resolveSuperlative<T>(params: {
  nameable: readonly T[];
  population: readonly T[];
  value: (entry: T) => number;
  owner: (entry: T) => string;
  /** `max` for "most/best", `min` for "fewest/lowest". Defaults to `max`. */
  direction?: 'max' | 'min';
}): SuperlativeResult<T> | null {
  const { nameable, population, value, owner, direction = 'max' } = params;
  if (nameable.length === 0) return null;

  const beats = (candidate: number, incumbent: number): boolean =>
    direction === 'max' ? candidate > incumbent : candidate < incumbent;

  // `T` is unconstrained, so `nameable[0]!` narrows to `NonNullable<T>` and a
  // later `best = entry` would not assign back. Index-tracked for the same
  // reason the record below is.
  let bestIndex = 0;
  for (let i = 1; i < nameable.length; i += 1) {
    if (beats(value(nameable[i]!), value(nameable[bestIndex]!))) bestIndex = i;
  }
  const best = nameable[bestIndex]!;

  // The population may legitimately be empty of anyone better — a league where
  // every record holder is still playing is the ordinary case, and it must
  // produce `holdsLeagueRecord: true` rather than a missing citation.
  // Tracked as an index rather than `T | null`: `T` is unconstrained, so a
  // caller may legitimately hold `null` or `undefined` entries and a nullable
  // accumulator cannot tell "no record yet" from "the record is a null entry".
  let recordIndex = -1;
  for (let i = 0; i < population.length; i += 1) {
    if (recordIndex === -1 || beats(value(population[i]!), value(population[recordIndex]!))) {
      recordIndex = i;
    }
  }
  const recordEntry = recordIndex === -1 ? null : population[recordIndex]!;

  const bestValue = value(best);
  const holdsLeagueRecord = recordEntry === null || value(recordEntry) === bestValue;

  return {
    best,
    holdsLeagueRecord,
    // Suppressed when the member holds it, so no site can cite itself. Also
    // suppressed when the record holder IS the named member under a different
    // object identity (same value), which the `===` on value already covers.
    recordHolder:
      holdsLeagueRecord || recordEntry === null
        ? null
        : { owner: owner(recordEntry), value: value(recordEntry) },
  };
}
