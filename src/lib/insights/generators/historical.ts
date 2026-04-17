import type { Insight } from '../../selectors/insights';
import type { SeasonArchive } from '../../seasonArchive';
import { registerGenerator } from '../engine';
import type { InsightContext, InsightGenerator, LifecycleState } from '../types';

const HISTORICAL_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];

const NO_CLAIM_OWNER = 'NoClaim';
const MIN_CONSISTENCY_SEASONS = 3;
const MIN_IMPROVEMENT_POSITIONS = 3;
const DROUGHT_BASE_PRIORITY = 60;
const DROUGHT_PER_SEASON_BONUS = 5;
const DROUGHT_PRIORITY_CAP = 85;
const DYNASTY_BASE_PRIORITY = 70;
const DYNASTY_PER_TITLE_BONUS = 10;
const DYNASTY_PRIORITY_CAP = 90;
const IMPROVEMENT_BASE_PRIORITY = 55;
const IMPROVEMENT_PER_POSITION_BONUS = 4;
const IMPROVEMENT_PRIORITY_CAP = 80;
const CONSISTENCY_PRIORITY = 65;

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
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
    category: 'historical',
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function sortedArchives(archives: SeasonArchive[]): SeasonArchive[] {
  return [...archives].sort((a, b) => a.year - b.year);
}

function isEligibleOwner(owner: string): boolean {
  return owner !== NO_CLAIM_OWNER;
}

function activeOwnerSet(currentRoster: Map<string, string>): Set<string> {
  const set = new Set(currentRoster.values());
  set.delete(NO_CLAIM_OWNER);
  return set;
}

function championOf(archive: SeasonArchive): string | null {
  const row = archive.finalStandings[0];
  if (!row) return null;
  if (!isEligibleOwner(row.owner)) return null;
  return row.owner;
}

function positionOf(archive: SeasonArchive, owner: string): number | null {
  const index = archive.finalStandings.findIndex((row) => row.owner === owner);
  if (index === -1) return null;
  return index + 1;
}

function deriveDroughtInsight(
  archives: SeasonArchive[],
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
): Insight | null {
  if (archives.length === 0) return null;
  const sorted = sortedArchives(archives);
  const latestYear = sorted[sorted.length - 1]!.year;

  // Track the last title year per owner and how many seasons each owner has appeared
  const lastTitleYear = new Map<string, number>();
  const appearedInYear = new Map<string, Set<number>>();
  for (const archive of sorted) {
    const champion = championOf(archive);
    if (champion) lastTitleYear.set(champion, archive.year);
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      const years = appearedInYear.get(row.owner) ?? new Set<number>();
      years.add(archive.year);
      appearedInYear.set(row.owner, years);
    }
  }

  let longestDrought = 0;
  let droughtOwner: string | null = null;
  let neverWon = false;

  for (const owner of activeOwners) {
    const lastYear = lastTitleYear.get(owner);
    const seasonsPlayed = appearedInYear.get(owner)?.size ?? 0;

    let drought: number;
    let ownerNeverWon: boolean;
    if (lastYear === undefined) {
      // Never won — drought equals seasons played
      drought = seasonsPlayed;
      ownerNeverWon = true;
    } else {
      drought = latestYear - lastYear;
      ownerNeverWon = false;
    }

    if (drought <= 0) continue;
    if (drought > longestDrought) {
      longestDrought = drought;
      droughtOwner = owner;
      neverWon = ownerNeverWon;
    }
  }

  if (!droughtOwner || longestDrought < 2) return null;

  const priority = Math.min(
    DROUGHT_PRIORITY_CAP,
    DROUGHT_BASE_PRIORITY + DROUGHT_PER_SEASON_BONUS * longestDrought
  );

  const description = neverWon
    ? `${droughtOwner} has never won a title in ${longestDrought} seasons — the longest active drought in the league.`
    : `${droughtOwner} hasn't won a title in ${longestDrought} seasons.`;

  return toInsight({
    id: `historical-drought-${ownerSlug(droughtOwner)}`,
    type: 'drought',
    title: 'Longest active title drought',
    description,
    owner: droughtOwner,
    priorityScore: priority,
    lifecycle: lifecycles,
  });
}

function deriveDynastyInsight(
  archives: SeasonArchive[],
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
): Insight | null {
  if (archives.length === 0) return null;
  const sorted = sortedArchives(archives);

  const titleCounts = new Map<string, number>();
  // Track the last title year per owner for tie-breaking copy
  const lastTitleYear = new Map<string, number>();
  for (const archive of sorted) {
    const champion = championOf(archive);
    if (!champion) continue;
    titleCounts.set(champion, (titleCounts.get(champion) ?? 0) + 1);
    lastTitleYear.set(champion, archive.year);
  }

  // Find max title count among active owners only
  let maxCount = 0;
  for (const owner of activeOwners) {
    const count = titleCounts.get(owner) ?? 0;
    if (count > maxCount) maxCount = count;
  }

  if (maxCount < 2) return null;

  // Collect all active owners tied at maxCount
  const tied: string[] = [];
  for (const owner of activeOwners) {
    if ((titleCounts.get(owner) ?? 0) === maxCount) tied.push(owner);
  }

  const priority = Math.min(
    DYNASTY_PRIORITY_CAP,
    DYNASTY_BASE_PRIORITY + DYNASTY_PER_TITLE_BONUS * maxCount
  );

  if (tied.length === 1) {
    const topOwner = tied[0]!;
    return toInsight({
      id: `historical-dynasty-${ownerSlug(topOwner)}`,
      type: 'dynasty',
      title: 'Dynasty on record',
      description: `${topOwner} owns ${maxCount} league titles — the most in league history.`,
      owner: topOwner,
      priorityScore: priority,
      lifecycle: lifecycles,
    });
  }

  // Multiple active owners tied — find who won most recently
  tied.sort((a, b) => (lastTitleYear.get(b) ?? 0) - (lastTitleYear.get(a) ?? 0));
  const mostRecent = tied[0]!;
  const mostRecentYear = lastTitleYear.get(mostRecent) ?? 0;
  const othersAtSameYear = tied.filter((o) => (lastTitleYear.get(o) ?? 0) === mostRecentYear);

  const allNames = tied.join(' and ');
  let description: string;
  if (othersAtSameYear.length > 1) {
    // Tied in recency too
    description = `${allNames} each own ${maxCount} league titles — the most in league history.`;
  } else {
    const others = tied.filter((o) => o !== mostRecent);
    const othersStr = others.join(' and ');
    description = `${mostRecent} now ties ${othersStr} for most titles in league history with ${maxCount}.`;
  }

  return toInsight({
    id: `historical-dynasty-${tied.map(ownerSlug).join('-')}`,
    type: 'dynasty',
    title: 'Dynasty on record',
    description,
    owner: tied[0],
    relatedOwners: tied.slice(1),
    priorityScore: priority,
    lifecycle: lifecycles,
  });
}

function deriveMostImprovedInsight(
  archives: SeasonArchive[],
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
): Insight | null {
  if (archives.length < 2) return null;
  const sorted = sortedArchives(archives);
  const prev = sorted[sorted.length - 2]!;
  const curr = sorted[sorted.length - 1]!;

  let bestOwner: string | null = null;
  let bestImprovement = 0;
  let bestPrev = 0;
  let bestCurr = 0;

  for (const row of curr.finalStandings) {
    if (!isEligibleOwner(row.owner)) continue;
    if (!activeOwners.has(row.owner)) continue;
    const prevPos = positionOf(prev, row.owner);
    const currPos = positionOf(curr, row.owner);
    if (prevPos === null || currPos === null) continue;
    const improvement = prevPos - currPos;
    if (improvement < MIN_IMPROVEMENT_POSITIONS) continue;
    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      bestOwner = row.owner;
      bestPrev = prevPos;
      bestCurr = currPos;
    }
  }

  if (!bestOwner) return null;

  const priority = Math.min(
    IMPROVEMENT_PRIORITY_CAP,
    IMPROVEMENT_BASE_PRIORITY + IMPROVEMENT_PER_POSITION_BONUS * bestImprovement
  );

  return toInsight({
    id: `historical-improvement-${ownerSlug(bestOwner)}-${curr.year}`,
    type: 'improvement',
    title: 'Biggest year-over-year leap',
    description: `${bestOwner} jumped from ${bestPrev} to ${bestCurr} between ${prev.year} and ${curr.year}.`,
    owner: bestOwner,
    priorityScore: priority,
    lifecycle: lifecycles,
  });
}

function deriveConsistencyInsight(
  archives: SeasonArchive[],
  activeOwners: Set<string>,
  lifecycles: LifecycleState[]
): Insight | null {
  if (archives.length < MIN_CONSISTENCY_SEASONS) return null;

  const topThreeCounts = new Map<string, number>();
  const appearances = new Map<string, number>();
  for (const archive of archives) {
    const topThree = archive.finalStandings.slice(0, 3);
    const seen = new Set<string>();
    for (const row of topThree) {
      if (!isEligibleOwner(row.owner)) continue;
      if (seen.has(row.owner)) continue;
      seen.add(row.owner);
      topThreeCounts.set(row.owner, (topThreeCounts.get(row.owner) ?? 0) + 1);
    }
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      appearances.set(row.owner, (appearances.get(row.owner) ?? 0) + 1);
    }
  }

  let bestOwner: string | null = null;
  let bestCount = 0;
  for (const [owner, count] of topThreeCounts) {
    if (!activeOwners.has(owner)) continue;
    const seasonsPlayed = appearances.get(owner) ?? 0;
    if (seasonsPlayed < MIN_CONSISTENCY_SEASONS) continue;
    if (count < MIN_CONSISTENCY_SEASONS) continue;
    if (count > bestCount || (count === bestCount && bestOwner !== null && owner < bestOwner)) {
      if (count >= bestCount) {
        bestOwner = owner;
        bestCount = count;
      }
    }
  }

  if (!bestOwner || bestCount < MIN_CONSISTENCY_SEASONS) return null;

  return toInsight({
    id: `historical-consistency-${ownerSlug(bestOwner)}`,
    type: 'consistency',
    title: 'Consistency award',
    description: `${bestOwner} has finished in the top three ${bestCount} seasons on record.`,
    owner: bestOwner,
    priorityScore: CONSISTENCY_PRIORITY,
    lifecycle: lifecycles,
  });
}

export const historicalGenerator: InsightGenerator = {
  id: 'historical',
  category: 'historical',
  supportedLifecycles: HISTORICAL_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const archives = context.archives;
    if (archives.length === 0) return [];

    const activeOwners = activeOwnerSet(context.currentRoster);

    const insights: Insight[] = [];
    const drought = deriveDroughtInsight(archives, activeOwners, HISTORICAL_LIFECYCLES);
    if (drought) insights.push(drought);

    const dynasty = deriveDynastyInsight(archives, activeOwners, HISTORICAL_LIFECYCLES);
    if (dynasty) insights.push(dynasty);

    const improvement = deriveMostImprovedInsight(archives, activeOwners, HISTORICAL_LIFECYCLES);
    if (improvement) insights.push(improvement);

    const consistency = deriveConsistencyInsight(archives, activeOwners, HISTORICAL_LIFECYCLES);
    if (consistency) insights.push(consistency);

    return insights;
  },
};

registerGenerator(historicalGenerator);
