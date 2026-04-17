import type { Insight } from '../../selectors/insights';
import type { AppGame } from '../../schedule';
import type { ScorePack } from '../../scores';
import type { SeasonArchive } from '../../seasonArchive';
import { registerGenerator } from '../engine';
import type { InsightContext, InsightGenerator, LifecycleState } from '../types';

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

type HeadToHeadResult = {
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

function collectHeadToHead(
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
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
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

  return toInsight({
    id: `rivalry-lopsided-${ownerSlug(bestDominant)}-${ownerSlug(bestLoser)}`,
    type: 'lopsided_rivalry',
    title: 'Most lopsided rivalry',
    description: `${bestDominant} leads the all-time series against ${bestLoser} ${bestDominantWins}–${bestLoserWins}.`,
    owner: bestDominant,
    relatedOwners: [bestLoser],
    priorityScore: priority,
    lifecycle: lifecycles,
  });
}

function deriveEvenRivalryInsight(
  pairs: Map<string, HeadToHeadResult[]>,
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
): Insight | null {
  let bestKey: string | null = null;
  let bestMeetings = 0;
  let bestOwnerA: string | null = null;
  let bestOwnerB: string | null = null;
  let bestWinsA = 0;
  let bestWinsB = 0;

  for (const [key, results] of pairs) {
    if (results.length < MIN_EVEN_MEETINGS) continue;
    const [ownerA, ownerB] = pairOwners(key);
    if (!activeOwners.has(ownerA) || !activeOwners.has(ownerB)) continue;
    const wins = countWins(results);
    const winsA = wins.get(ownerA) ?? 0;
    const winsB = wins.get(ownerB) ?? 0;
    const diff = Math.abs(winsA - winsB);
    if (diff > EVEN_MAX_WIN_DIFF) continue;
    if (results.length <= bestMeetings) continue;
    bestMeetings = results.length;
    bestKey = key;
    bestOwnerA = ownerA;
    bestOwnerB = ownerB;
    bestWinsA = winsA;
    bestWinsB = winsB;
  }

  if (!bestKey || !bestOwnerA || !bestOwnerB) return null;

  return toInsight({
    id: `rivalry-even-${ownerSlug(bestOwnerA)}-${ownerSlug(bestOwnerB)}`,
    type: 'even_rivalry',
    title: 'Most evenly matched rivalry',
    description: `${bestOwnerA} and ${bestOwnerB} are tied at ${bestWinsA}–${bestWinsB} across ${bestMeetings} meetings.`,
    owner: bestOwnerA,
    relatedOwners: [bestOwnerB],
    priorityScore: EVEN_PRIORITY,
    lifecycle: lifecycles,
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
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
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

  return toInsight({
    id: `rivalry-dominance-${ownerSlug(bestWinner)}-${ownerSlug(bestLoser)}`,
    type: 'dominance_streak',
    title: 'Active dominance streak',
    description: `${bestWinner} has beaten ${bestLoser} ${bestLength} straight times.`,
    owner: bestWinner,
    relatedOwners: [bestLoser],
    priorityScore: priority,
    lifecycle: lifecycles,
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

    const activeOwners = new Set(context.currentRoster.values());
    activeOwners.delete(NO_CLAIM_OWNER);

    const insights: Insight[] = [];
    const lopsided = deriveLopsidedInsight(pairs, activeOwners, RIVALRY_LIFECYCLES);
    if (lopsided) insights.push(lopsided);

    const even = deriveEvenRivalryInsight(pairs, activeOwners, RIVALRY_LIFECYCLES);
    if (even) insights.push(even);

    const dominance = deriveDominanceStreakInsight(pairs, activeOwners, RIVALRY_LIFECYCLES);
    if (dominance) insights.push(dominance);

    return insights;
  },
};

registerGenerator(rivalryGenerator);
