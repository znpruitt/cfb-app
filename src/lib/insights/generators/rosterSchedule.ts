import type { Insight } from '../../selectors/insights';
import { registerGenerator } from '../engine';
import { buildRosterScheduleProfile, rankBySelfGames } from '../rosterSchedule';
import { formatOwnerList } from '../superlative';
import type { InsightContext, InsightGenerator, LifecycleState } from '../types';

/**
 * INSIGHTS-031 — what the season's schedule says about the board that was
 * drafted from it.
 *
 * A game between two of your own teams banks one win and one loss. In a league
 * where wins over OTHER owners decide the table, that is a wash — two
 * roster-games that cannot move you. Owner's framing (2026-08-16): "a roster
 * that doesn't maximize opportunity to win over others is a bad bet."
 *
 * So there are two insights here, not one: who made that bet most, and who
 * avoided it best. Same pass, opposite ends, the way `trending_up` and
 * `trending_down` already work.
 *
 * ## Why this needs a real draft
 *
 * Before a draft `currentRoster` is empty or borrowed from the most recent
 * archive. A borrowed map would describe LAST season's ownership against THIS
 * season's schedule — every number wrong, and wrong in a way that looks
 * plausible. `usingArchivedRoster` is the gate.
 *
 * ## Why the lifecycle list is broad
 *
 * The fact exists the moment a draft is confirmed and stays true all season, so
 * gating by lifecycle would be arbitrary. The DATA gates it instead: no roster,
 * no insight. Preseason after a draft is where it matters most, because it is
 * the only moment the information could still change how someone drafts.
 */

const ROSTER_SCHEDULE_LIFECYCLES: LifecycleState[] = [
  'preseason',
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
];

/**
 * The leader must reach this before "most self-games" is worth saying.
 *
 * Measured, not guessed: across 20 simulated 14-owner drafts on the real
 * conference structure, leaders landed between 5 and 8 with a league median of
 * 3. A floor of 6 stays quiet when a league is flat — which is the point, since
 * a table where everyone sits at 4 has no story in it.
 *
 * **A GAP requirement was considered and rejected on the same evidence.** Ties
 * at the top were the single most common outcome (10 of 20), and the largest
 * leader-to-second gap observed in twenty drafts was 2. Requiring an outlier
 * would silence this almost always, and "nobody else came close" would be false
 * half the time it did fire.
 */
const MIN_SELF_GAMES_TO_REPORT = 6;

/** Below this, "cleanest board" is noise rather than a distinction. */
const MAX_SELF_GAMES_FOR_CLEAN = 3;

/** At least this many owners must have a roster, or there is no league to compare. */
const MIN_OWNERS_FOR_COMPARISON = 4;

function heavyVariants(names: string, count: number, tied: boolean): string[] {
  if (tied) {
    // FIVE variants, deliberately the deepest pool here: ties are the most
    // common shape this insight takes, so this is the sentence most readers see.
    //
    // No "both" or "each" in the stem — the quantifier is what broke at three
    // tied owners, and dropping it entirely reads the same at two.
    return [
      `${names} drafted ${count} games against their own teams. Misery does love company.`,
      `${names} drafted ${count} games against their own teams. Same plan, same problem.`,
      `${names} drafted ${count} games against their own teams. Did they even notice?`,
      `${names} drafted ${count} games against their own teams. A tie nobody was chasing.`,
      `${names} drafted ${count} games against their own teams. Bad ideas all-around.`,
    ];
  }
  return [
    `${names}'s teams play each other ${count} times this year, that's one way to stay above .500.`,
    `${names} drafted ${count} games against their own teams — the most in the league, for whatever that's worth.`,
  ];
}

/**
 * `MAX_SELF_GAMES_FOR_CLEAN` is 3, so this only ever renders 0-3 and words read
 * better than digits at that size.
 */
function timesPhrase(count: number): string {
  if (count === 1) return 'once';
  if (count === 2) return 'twice';
  return `${count} times`;
}

function cleanVariants(names: string, count: number, tied: boolean): string[] {
  // ZERO is its own pool, and it is the case that most deserves a good line —
  // it is the best possible board. The first draft of this copy hardcoded "a
  // single time" because the simulated distribution bottomed out at 1, so a
  // zero-self-game league was told it had one. The count was right there.
  if (count === 0) {
    return [
      `${names}'s teams never face each other all year. Nobody drafted cleaner.`,
      `Not one of ${names}'s games is against themselves. Best ${tied ? 'boards' : 'board'} in the league.`,
      `${names} avoided themselves entirely — no wasted matchups at all.`,
    ];
  }

  const times = timesPhrase(count);
  if (tied) {
    return [
      `${names}'s teams each meet themselves ${times}. Best in the league.`,
      `${names}'s teams each meet themselves ${times}. Barely a wasted matchup on their boards.`,
      `${names}'s teams each meet themselves ${times} — no appetite for beating up on themselves.`,
    ];
  }
  return [
    `${names}'s teams meet ${times} all year. Nobody drafted cleaner.`,
    // "a leg up, if they win" is about the games against OTHER owners that were
    // preserved by not spending them on themselves — beating another owner moves
    // you and holds them back, where a self-game moves nobody. Not about winning
    // the self-matchup, which is what I first assumed.
    `${names}'s teams only face themselves ${times} — a leg up, if they win.`,
    `${names}'s teams only face themselves ${times} — a solid starting point.`,
  ];
}

export const rosterScheduleGenerator: InsightGenerator = {
  id: 'draft:self_schedule',
  category: 'draft_patterns',
  supportedLifecycles: ROSTER_SCHEDULE_LIFECYCLES,
  tone: 'playful',
  generate(context: InsightContext): Insight[] {
    // A borrowed roster describes last season's ownership against this season's
    // schedule. Every number would be wrong and none of them would look it.
    if (context.usingArchivedRoster) return [];
    if (context.currentRoster.size === 0) return [];

    const profile = buildRosterScheduleProfile(context.games, context.currentRoster);
    if (profile.byOwner.size < MIN_OWNERS_FOR_COMPARISON) return [];

    const insights: Insight[] = [];
    const ranked = rankBySelfGames(profile);

    // --- the bad bet -------------------------------------------------------
    const worst = ranked[0];
    if (worst && worst.selfGames >= MIN_SELF_GAMES_TO_REPORT) {
      const tiedWorst = ranked.filter((p) => p.selfGames === worst.selfGames);
      const owners = tiedWorst.map((p) => p.owner);
      const variants = heavyVariants(formatOwnerList(owners), worst.selfGames, owners.length > 1);
      insights.push({
        id: `self-schedule-heavy-${owners.map((o) => o.toLowerCase().replace(/\s+/g, '-')).join('-')}`,
        type: 'self_schedule_heavy',
        title: 'Playing themselves',
        description: variants[0]!,
        descriptionVariants: variants,
        owner: owners[0],
        relatedOwners: owners.slice(1),
        priorityScore: 74,
        lifecycle: ROSTER_SCHEDULE_LIFECYCLES,
        category: 'draft_patterns',
        newsHook: 'snapshot',
        // A draft fact: fixed forever, but less interesting every week.
        decay: 'draft',
        statValue: worst.selfGames,
      });
    }

    // --- the good bet ------------------------------------------------------
    // Ranked lowest-first among owners who HAVE a roster. `rankBySelfGames`
    // drops anyone at zero, so the cleanest board is read from the full profile
    // rather than from that list — an owner with no self-games at all is the
    // best possible outcome and must not be invisible.
    const all = [...profile.byOwner.values()].sort(
      (a, b) => a.selfGames - b.selfGames || a.owner.localeCompare(b.owner)
    );
    const best = all[0];
    if (best && best.selfGames <= MAX_SELF_GAMES_FOR_CLEAN) {
      const tiedBest = all.filter((p) => p.selfGames === best.selfGames);
      const owners = tiedBest.map((p) => p.owner);
      // Only a distinction if somebody did worse. A league where every owner
      // has the same count has no cleanest board.
      const someoneWorse = all.some((p) => p.selfGames > best.selfGames);
      if (someoneWorse) {
        const variants = cleanVariants(formatOwnerList(owners), best.selfGames, owners.length > 1);
        insights.push({
          id: `self-schedule-clean-${owners.map((o) => o.toLowerCase().replace(/\s+/g, '-')).join('-')}`,
          type: 'self_schedule_clean',
          title: 'Cleanest board',
          description: variants[0]!,
          descriptionVariants: variants,
          owner: owners[0],
          relatedOwners: owners.slice(1),
          priorityScore: 70,
          lifecycle: ROSTER_SCHEDULE_LIFECYCLES,
          category: 'draft_patterns',
          newsHook: 'snapshot',
          // A draft fact: fixed forever, but less interesting every week.
          decay: 'draft',
          statValue: best.selfGames,
        });
      }
    }

    return insights;
  },
};

registerGenerator(rosterScheduleGenerator);
