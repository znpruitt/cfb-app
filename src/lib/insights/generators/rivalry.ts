import type { Insight } from '../../selectors/insights';
import type { AppGame } from '../../schedule';
import type { ScorePack } from '../../scores';
import type { SeasonArchive } from '../../seasonArchive';
import { registerGenerator } from '../engine';
import { formatOwnerList, holderVerb, membershipIsKnown, resolveSuperlative } from '../superlative';
import type {
  InsightContext,
  InsightGenerator,
  LeagueMembersSource,
  LifecycleState,
  NewsHook,
} from '../types';

const RIVALRY_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];

const NO_CLAIM_OWNER = 'NoClaim';
const MIN_LOPSIDED_MEETINGS = 4;
const LOPSIDED_BASE_PRIORITY = 70;
const LOPSIDED_PER_WIN_DIFF_BONUS = 3;
const LOPSIDED_PRIORITY_CAP = 88;
const MIN_EVEN_MEETINGS = 6;
const EVEN_MAX_WIN_DIFF = 1;
const EVEN_PRIORITY = 65;
const MIN_DOMINANCE_STREAK = 3;
const DOMINANCE_BASE_PRIORITY = 72;
const DOMINANCE_PER_WIN_BONUS = 4;
const DOMINANCE_PRIORITY_CAP = 88;

export type HeadToHeadResult = {
  year: number;
  week: number;
  date: string | null;
  winner: string;
  loser: string;
};

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function isEligibleOwner(owner: string): boolean {
  return owner !== NO_CLAIM_OWNER;
}

function toInsight(params: {
  id: string;
  type: Insight['type'];
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  lifecycle: LifecycleState[];
  newsHook: NewsHook;
  statValue: number;
}): Insight {
  const { owner, relatedOwners = [], priorityScore } = params;
  return {
    ...params,
    category: 'rivalry',
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function resolveGameOwners(
  game: AppGame,
  roster: Map<string, string>
): { homeOwner: string; awayOwner: string } | null {
  const homeOwner = roster.get(game.csvHome) ?? roster.get(game.canHome);
  const awayOwner = roster.get(game.csvAway) ?? roster.get(game.canAway);
  if (!homeOwner || !awayOwner) return null;
  if (homeOwner === awayOwner) return null;
  return { homeOwner, awayOwner };
}

function resolveWinner(
  game: AppGame,
  score: ScorePack | undefined,
  homeOwner: string,
  awayOwner: string
): { winner: string; loser: string } | null {
  if (!score) return null;
  if (game.status !== 'final' && score.status !== 'final') return null;
  const homeScore = score.home.score;
  const awayScore = score.away.score;
  if (homeScore === null || awayScore === null) return null;
  if (homeScore === awayScore) return null;
  return homeScore > awayScore
    ? { winner: homeOwner, loser: awayOwner }
    : { winner: awayOwner, loser: homeOwner };
}

export function collectHeadToHead(
  archives: SeasonArchive[],
  historicalRosters: Record<number, Map<string, string>>
): Map<string, HeadToHeadResult[]> {
  const pairs = new Map<string, HeadToHeadResult[]>();

  for (const archive of archives) {
    const roster = historicalRosters[archive.year];
    if (!roster) continue;

    for (const game of archive.games) {
      const owners = resolveGameOwners(game, roster);
      if (!owners) continue;
      const { homeOwner, awayOwner } = owners;
      if (!isEligibleOwner(homeOwner) || !isEligibleOwner(awayOwner)) continue;

      const outcome = resolveWinner(game, archive.scoresByKey[game.key], homeOwner, awayOwner);
      if (!outcome) continue;

      const key = pairKey(homeOwner, awayOwner);
      const list = pairs.get(key) ?? [];
      list.push({
        year: archive.year,
        week: game.week,
        date: game.date,
        winner: outcome.winner,
        loser: outcome.loser,
      });
      pairs.set(key, list);
    }
  }

  for (const list of pairs.values()) {
    list.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.week !== b.week) return a.week - b.week;
      const aDate = a.date ?? '';
      const bDate = b.date ?? '';
      return aDate.localeCompare(bDate);
    });
  }

  return pairs;
}

function pairOwners(key: string): [string, string] {
  const [a, b] = key.split('|');
  return [a ?? '', b ?? ''];
}

function countWins(results: HeadToHeadResult[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.winner, (counts.get(result.winner) ?? 0) + 1);
  }
  return counts;
}

function deriveLopsidedInsight(
  pairs: Map<string, HeadToHeadResult[]>,
  activeOwners: ReadonlySet<string>,
  lifecycles: LifecycleState[],
  membersSource: LeagueMembersSource
): Insight | null {
  let bestKey: string | null = null;
  let bestDiff = 0;
  let bestDominant: string | null = null;
  let bestLoser: string | null = null;
  let bestDominantWins = 0;
  let bestLoserWins = 0;

  for (const [key, results] of pairs) {
    if (results.length < MIN_LOPSIDED_MEETINGS) continue;
    const [ownerA, ownerB] = pairOwners(key);
    if (!activeOwners.has(ownerA) || !activeOwners.has(ownerB)) continue;
    const wins = countWins(results);
    const winsA = wins.get(ownerA) ?? 0;
    const winsB = wins.get(ownerB) ?? 0;
    const diff = Math.abs(winsA - winsB);
    if (diff <= bestDiff) continue;
    bestDiff = diff;
    bestKey = key;
    if (winsA >= winsB) {
      bestDominant = ownerA;
      bestLoser = ownerB;
      bestDominantWins = winsA;
      bestLoserWins = winsB;
    } else {
      bestDominant = ownerB;
      bestLoser = ownerA;
      bestDominantWins = winsB;
      bestLoserWins = winsA;
    }
  }

  if (!bestKey || !bestDominant || !bestLoser || bestDiff < 2) return null;

  const priority = Math.min(
    LOPSIDED_PRIORITY_CAP,
    LOPSIDED_BASE_PRIORITY + LOPSIDED_PER_WIN_DIFF_BONUS * bestDiff
  );

  // INSIGHTS-030 — the league's most lopsided series, across EVERY qualifying
  // pair. The member filter that used to sit in this loop made the record mean
  // "most lopsided among pairs still playing", so the copy called a member's
  // series the most lopsided on record while a departed pair's was worse.
  //
  // Pair-shaped rather than owner-shaped, so the record holder is two names and
  // a scoreline. `resolveSuperlative` decides WHETHER the named pair holds it;
  // the entry itself carries what the citation needs.
  type PairRecord = { dominant: string; loser: string; diff: number; wins: number; losses: number };
  const qualifying: PairRecord[] = [];
  for (const [key, results] of pairs) {
    if (results.length < MIN_LOPSIDED_MEETINGS) continue;
    const [a, b] = pairOwners(key);
    const wins = countWins(results);
    const aWins = wins.get(a) ?? 0;
    const bWins = wins.get(b) ?? 0;
    qualifying.push(
      aWins >= bWins
        ? { dominant: a, loser: b, diff: aWins - bWins, wins: aWins, losses: bWins }
        : { dominant: b, loser: a, diff: bWins - aWins, wins: bWins, losses: aWins }
    );
  }

  const lopsidedStanding = resolveSuperlative({
    population: qualifying,
    isMember: (p) => activeOwners.has(p.dominant) && activeOwners.has(p.loser),
    value: (p) => p.diff,
    owner: (p) => p.dominant,
  });
  // Taken from `recordHolders`, NOT re-derived. The reduce that used to sit here
  // scanned the whole population with no membership filter and kept the FIRST
  // entry at the max — so in the `shares` state, where a member pair and a
  // departed pair are level, insertion order decided and the copy cited the
  // member pair against itself: "Alice leads Bob 5–0, level with Alice's 5–0
  // over Bob". `resolveSuperlative` had already computed the right partition.
  const recordPair = lopsidedStanding?.recordHolders[0]?.entry ?? null;
  const rivalryKnown = membershipIsKnown(membersSource);

  const hook: NewsHook = recordPair ? 'streak_extended' : 'new_record';

  // EVERY pair level at the record, not just the first. With Dave 6–0 over Carol
  // and Erin 6–0 over Frank both at the top, naming one of them attributed sole
  // possession to a co-holder.
  const holderPairs = lopsidedStanding?.recordHolders.map((h) => h.entry) ?? [];
  const recordText = formatOwnerList(
    holderPairs.map((p) => `${p.dominant}'s ${p.wins}–${p.losses} series over ${p.loser}`)
  );
  // Each series is wrapped so a multi-pair list cannot be misread: without it,
  // "Dave's 6–0 over Carol and Erin's 6–0 over Frank" parses as one opponent
  // phrase. The verb agrees with the number of pairs.
  const holders = lopsidedStanding?.recordHolders ?? [];
  const remains = holderVerb(holders, 'remains', 'remain');
  const isAre = holderVerb(holders, 'is', 'are');
  const description = !recordPair
    ? `${bestDominant} leads ${bestLoser} ${bestDominantWins}–${bestLoserWins} — the most lopsided rivalry on record.`
    : lopsidedStanding?.standing === 'shares'
      ? `${bestDominant} leads ${bestLoser} ${bestDominantWins}–${bestLoserWins}, level with ${recordText}.`
      : rivalryKnown
        ? `${bestDominant} leads ${bestLoser} ${bestDominantWins}–${bestLoserWins} — the most lopsided rivalry among active owners. ${recordText} ${remains} the league record.`
        : `${bestDominant} leads ${bestLoser} ${bestDominantWins}–${bestLoserWins}; ${recordText} ${isAre} the league record.`;

  return toInsight({
    id: `rivalry-lopsided-${ownerSlug(bestDominant)}-${ownerSlug(bestLoser)}`,
    type: 'lopsided_rivalry',
    title: lopsidedStanding?.standing === 'holds' ? 'Most lopsided rivalry' : 'Lopsided rivalry',
    description,
    owner: bestDominant,
    relatedOwners: [bestLoser],
    priorityScore: priority,
    lifecycle: lifecycles,
    newsHook: hook,
    statValue: bestDiff,
  });
}

function deriveEvenRivalryInsight(
  pairs: Map<string, HeadToHeadResult[]>,
  activeOwners: ReadonlySet<string>,
  lifecycles: LifecycleState[],
  membersSource: LeagueMembersSource
): Insight | null {
  // INSIGHTS-033 — "the closest rivalry in the league" was wrong twice over, and
  // the first remediation round fixed only one half. The population was member
  // pairs only, so a departed pair level across more meetings was never
  // considered; and the SELECTION ranked by meeting count alone, so a 4-3 pair
  // that had met seven times outranked a dead-even 3-3 pair that had met six.
  // Fixing the population while keeping the ranking produced the sharper
  // nonsense of naming the 4-3 pair "the closest on record" beside the 3-3 one.
  //
  // Closeness is the win DIFFERENCE first and the meeting count only as a
  // tiebreaker: a pair that has stayed dead level is closer than one a game
  // apart, however long they have played. Both reviewers found this, and
  // `docs/next-tasks.md` item 33 had recorded it before either did.
  type EvenPair = { a: string; b: string; meetings: number; winsA: number; winsB: number };
  const qualifying: EvenPair[] = [];
  for (const [key, results] of pairs) {
    if (results.length < MIN_EVEN_MEETINGS) continue;
    const [a, b] = pairOwners(key);
    const wins = countWins(results);
    const winsA = wins.get(a) ?? 0;
    const winsB = wins.get(b) ?? 0;
    if (Math.abs(winsA - winsB) > EVEN_MAX_WIN_DIFF) continue;
    qualifying.push({ a, b, meetings: results.length, winsA, winsB });
  }

  // Lower is closer. The win difference dominates; meetings break ties by
  // subtracting, so more meetings sorts earlier within one difference.
  // `MEETINGS_BOUND` exceeds any real series — `EVEN_MAX_WIN_DIFF` is 1, so the
  // two rungs are 0 and 1,000 and a 999-meeting rivalry would be needed to cross
  // between them.
  const MEETINGS_BOUND = 1_000;
  const closeness = (p: EvenPair): number =>
    Math.abs(p.winsA - p.winsB) * MEETINGS_BOUND - p.meetings;

  // The named MEMBER pair is taken from the resolver rather than found by a
  // second loop. The hand-rolled search this replaces ranked by meetings while
  // the resolver ranked by closeness, so the pair named in the scoreline and the
  // pair the standing described could be different pairs — the exact drift
  // `superlative.ts` documents from the first INSIGHTS-030 round.
  const evenStanding = resolveSuperlative({
    population: qualifying,
    isMember: (p) => activeOwners.has(p.a) && activeOwners.has(p.b),
    value: (p) => p.meetings,
    owner: (p) => p.a,
    direction: 'min',
    compareOn: closeness,
  });
  if (!evenStanding) return null;

  const best = evenStanding.best;
  // Formatted from `entry`, never `owner`. The pair-shaped warning in
  // `superlative.ts` applies here exactly as it does to `lopsided`: a non-member
  // ENTRY can carry a current member in its `owner` slot.
  const holderPairs = evenStanding.recordHolders.map((h) => h.entry);
  const holders = evenStanding.recordHolders;
  const recordText = formatOwnerList(
    holderPairs.map((p) => `${p.a} and ${p.b} at ${p.winsA}–${p.winsB} over ${p.meetings} meetings`)
  );
  const holdsRecord = holderPairs.length === 0;

  const winDiff = Math.abs(best.winsA - best.winsB);
  const scoreline =
    winDiff === 0
      ? `${best.a} and ${best.b} are tied at ${best.winsA}–${best.winsB} across ${best.meetings} meetings`
      : (() => {
          const leader = best.winsA > best.winsB ? best.a : best.b;
          const trailer = best.winsA > best.winsB ? best.b : best.a;
          return `${leader} leads ${trailer} ${Math.max(best.winsA, best.winsB)}–${Math.min(
            best.winsA,
            best.winsB
          )} across ${best.meetings} meetings`;
        })();

  // OWNER RULING (2026-08-19): say BOTH, active first. When a member pair is the
  // closest among people currently playing and a departed pair holds the
  // all-time mark, the card states the member standing and then cites the
  // record — it neither hides the departed pair nor lets them take the card.
  // This is the shape `lopsided` (above), `dynasty`, `career_points_leader` and
  // `greatest_season` already use; the ruling makes it the class's shape rather
  // than four independent choices.
  //
  // The `holds` branch needs no active framing: holding it outright is the wider
  // claim, and the title says so on the same line. `/code-review` found the
  // first round's version asserting BOTH — a league-wide title over an
  // active-owners body — which is the title/body split this slice exists to
  // close.
  const evenKnown = membershipIsKnown(membersSource);
  const description = holdsRecord
    ? `${scoreline} — the closest rivalry on record.`
    : evenStanding.standing === 'shares'
      ? `${scoreline}, level with ${recordText}.`
      : evenKnown
        ? `${scoreline} — the closest rivalry among active owners. ${recordText} ${holderVerb(holders, 'is', 'are')} the closest on record.`
        : `${scoreline}; ${recordText} ${holderVerb(holders, 'is', 'are')} the closest on record.`;

  return toInsight({
    id: `rivalry-even-${ownerSlug(best.a)}-${ownerSlug(best.b)}`,
    type: 'even_rivalry',
    title: holdsRecord ? 'Most evenly matched rivalry' : 'An even rivalry',
    description,
    owner: best.a,
    relatedOwners: [best.b],
    priorityScore: EVEN_PRIORITY,
    lifecycle: lifecycles,
    newsHook: 'streak_extended',
    statValue: best.meetings,
  });
}

function activeStreak(results: HeadToHeadResult[]): { winner: string; length: number } | null {
  if (results.length === 0) return null;
  const last = results[results.length - 1]!;
  let length = 1;
  for (let i = results.length - 2; i >= 0; i--) {
    if (results[i]!.winner === last.winner) {
      length += 1;
    } else {
      break;
    }
  }
  return { winner: last.winner, length };
}

function deriveDominanceStreakInsight(
  pairs: Map<string, HeadToHeadResult[]>,
  activeOwners: ReadonlySet<string>,
  lifecycles: LifecycleState[],
  membersSource: LeagueMembersSource
): Insight | null {
  let bestKey: string | null = null;
  let bestLength = 0;
  let bestWinner: string | null = null;
  let bestLoser: string | null = null;

  for (const [key, results] of pairs) {
    const streak = activeStreak(results);
    if (!streak) continue;
    if (streak.length < MIN_DOMINANCE_STREAK) continue;
    if (streak.length <= bestLength) continue;
    const [ownerA, ownerB] = pairOwners(key);
    if (!activeOwners.has(ownerA) || !activeOwners.has(ownerB)) continue;
    bestLength = streak.length;
    bestKey = key;
    bestWinner = streak.winner;
    bestLoser = streak.winner === ownerA ? ownerB : ownerA;
  }

  if (!bestKey || !bestWinner || !bestLoser) return null;

  const priority = Math.min(
    DOMINANCE_PRIORITY_CAP,
    DOMINANCE_BASE_PRIORITY + DOMINANCE_PER_WIN_BONUS * bestLength
  );

  // Look at all archived streaks (active + historical) to determine if this
  // length is a league record.
  let allTimeMaxStreak = 0;
  for (const [, results] of pairs) {
    let run = 1;
    for (let i = 1; i < results.length; i += 1) {
      if (results[i]!.winner === results[i - 1]!.winner) {
        run += 1;
        if (run > allTimeMaxStreak) allTimeMaxStreak = run;
      } else {
        run = 1;
      }
    }
    if (run > allTimeMaxStreak) allTimeMaxStreak = run;
  }

  // INSIGHTS-033 — the RECORD half of this generator is sound: `allTimeMaxStreak`
  // above spans every pair, members or not, so "in league history" is measured
  // correctly and needs no conversion. What was never gated is that all four
  // phrasings describe a live relationship — a streak that is still running,
  // between two people still playing each other. Drawn from the archives with
  // membership unknown, that is a claim about participation the data cannot
  // support, and the pair may not even be in the league any more.
  const dominanceKnown = membershipIsKnown(membersSource);

  let hook: NewsHook;
  let description: string;
  if (bestLength >= allTimeMaxStreak && allTimeMaxStreak > MIN_DOMINANCE_STREAK) {
    hook = 'new_record';
    description = dominanceKnown
      ? `${bestWinner} has beaten ${bestLoser} ${bestLength} straight — the longest active dominance streak in league history.`
      : `${bestWinner} has beaten ${bestLoser} ${bestLength} straight — the longest dominance streak in league history.`;
  } else if (bestLength === MIN_DOMINANCE_STREAK) {
    hook = 'streak_started';
    description = dominanceKnown
      ? `${bestWinner} has won ${bestLength} straight against ${bestLoser}. A pattern is emerging.`
      : `${bestWinner} has won ${bestLength} straight against ${bestLoser}.`;
  } else if (bestLength >= 8) {
    hook = 'streak_extended';
    description = dominanceKnown
      ? `${bestWinner} has lived rent-free in ${bestLoser}'s head for ${bestLength} straight meetings.`
      : `${bestWinner} has won ${bestLength} straight meetings against ${bestLoser}.`;
  } else {
    hook = 'streak_extended';
    description = dominanceKnown
      ? `${bestWinner} has beaten ${bestLoser} ${bestLength} straight times. At some point this is a subscription.`
      : `${bestWinner} has beaten ${bestLoser} ${bestLength} straight times.`;
  }

  return toInsight({
    id: `rivalry-dominance-${ownerSlug(bestWinner)}-${ownerSlug(bestLoser)}`,
    type: 'dominance_streak',
    // Gated for the same reason `drought`'s is: a constant "ACTIVE dominance
    // streak" renders one line above the body and restores the claim the body
    // just dropped.
    title: dominanceKnown ? 'Active dominance streak' : 'Dominance streak',
    description,
    owner: bestWinner,
    relatedOwners: [bestLoser],
    priorityScore: priority,
    lifecycle: lifecycles,
    newsHook: hook,
    statValue: bestLength,
  });
}

export const rivalryGenerator: InsightGenerator = {
  id: 'rivalry',
  category: 'rivalry',
  supportedLifecycles: RIVALRY_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    if (context.archives.length === 0) return [];
    const pairs = collectHeadToHead(context.archives, context.historicalRosters);
    if (pairs.size === 0) return [];

    // INSIGHTS-023a — membership, not team assignments. See the shared note in
    // `career.ts`: this was `new Set(currentRoster.values())`, which before a
    // draft is last season's owners.
    const activeOwners = context.leagueMembers;

    const insights: Insight[] = [];
    const lopsided = deriveLopsidedInsight(
      pairs,
      activeOwners,
      RIVALRY_LIFECYCLES,
      context.leagueMembersSource
    );
    if (lopsided) insights.push(lopsided);

    const even = deriveEvenRivalryInsight(
      pairs,
      activeOwners,
      RIVALRY_LIFECYCLES,
      context.leagueMembersSource
    );
    if (even) insights.push(even);

    const dominance = deriveDominanceStreakInsight(
      pairs,
      activeOwners,
      RIVALRY_LIFECYCLES,
      context.leagueMembersSource
    );
    if (dominance) insights.push(dominance);

    return insights;
  },
};

registerGenerator(rivalryGenerator);
