import type { SeasonContext } from './seasonContext';
import { selectResolvedStandingsWeeks } from './historyResolution';
import type { InsightCategory, LifecycleState } from '../insights/types';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

export type InsightType =
  | 'movement'
  | 'toilet_bowl'
  | 'surge'
  | 'collapse'
  | 'race'
  | 'champion_margin'
  | 'failed_chase'
  | 'tight_cluster';

export type Insight = {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  week?: number;
  navigationTarget?: 'standings' | 'trends' | 'matchup';
  category?: InsightCategory;
  lifecycle?: LifecycleState[];
  stat?: { label: string; value: string };
  // Backward-compatible aliases used by existing tests/UI until full migration.
  score?: number;
  owners?: string[];
};

const NO_CLAIM_OWNER = 'NoClaim';
const MIN_MEANINGFUL_MOVEMENT = 2;
const MIN_TOILET_BOWL_FINISHES = 2;
const TIGHT_RACE_GAP_THRESHOLD = 1;
const MIN_SURGE_WINS = 2;
const OVERVIEW_INSIGHT_LIMIT = 3;
const STANDINGS_INSIGHT_LIMIT = 3;
const FINAL_WEEKS_WINDOW = 3;
const FINAL_SURGE_MIN_WINS = 3;
const FINAL_SURGE_MIN_GAMES_BACK_GAIN = 2;
const STANDINGS_MIN_RACE_PRIORITY = 76;

const OVERVIEW_TYPE_PRIORITY: Record<InsightType, number> = {
  champion_margin: 120,
  failed_chase: 110,
  collapse: 105,
  surge: 102,
  tight_cluster: 98,
  race: 96,
  toilet_bowl: 92,
  movement: 90,
};

const STANDINGS_TYPE_PRIORITY: Record<InsightType, number> = {
  toilet_bowl: 120,
  collapse: 116,
  surge: 112,
  tight_cluster: 108,
  race: 104,
  failed_chase: 96,
  movement: 92,
  champion_margin: 88,
};

const IN_SEASON_LIFECYCLES: LifecycleState[] = ['early_season', 'mid_season', 'late_season'];
const RACE_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
];
const SEASON_WRAP_LIFECYCLES: LifecycleState[] = ['postseason', 'fresh_offseason'];

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
}

export function isNarrativeEligibleOwner(owner: string): boolean {
  return owner !== NO_CLAIM_OWNER;
}

// Reference owners can include synthetic buckets like NoClaim; only the
// primary narrative subject must pass isNarrativeEligibleOwner.
function canUseReferenceOwner(owner: string | null | undefined): boolean {
  if (!owner) return false;
  return owner !== NO_CLAIM_OWNER;
}

function toInsight(params: {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  week?: number;
  navigationTarget?: 'standings' | 'trends' | 'matchup';
  category?: InsightCategory;
  lifecycle?: LifecycleState[];
  stat?: { label: string; value: string };
}): Insight {
  const { owner, relatedOwners = [], priorityScore } = params;
  return {
    ...params,
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function rankByOwner(rows: OwnerStandingsRow[]): Map<string, number> {
  return new Map(rows.map((row, index) => [row.owner, index + 1]));
}

function pushInsightUnique(
  insights: Insight[],
  seenIds: Set<string>,
  insight: Insight | null
): void {
  if (!insight || seenIds.has(insight.id)) return;
  seenIds.add(insight.id);
  insights.push(insight);
}

function uniqueInsightsById(insights: Insight[]): Insight[] {
  const seenIds = new Set<string>();
  return insights.filter((insight) => {
    if (seenIds.has(insight.id)) return false;
    seenIds.add(insight.id);
    return true;
  });
}

export function deriveMovementInsights(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
}): Insight[] {
  const { standingsHistory, resolvedWeeks } = args;
  if (resolvedWeeks.length < 2) return [];

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const previousWeek = resolvedWeeks[resolvedWeeks.length - 2]!;
  const latestSnapshot = standingsHistory.byWeek[latestWeek];
  const previousSnapshot = standingsHistory.byWeek[previousWeek];
  if (!latestSnapshot || !previousSnapshot) return [];

  const latestRankByOwner = rankByOwner(latestSnapshot.standings);
  const previousRankByOwner = rankByOwner(previousSnapshot.standings);

  const movements = Array.from(latestRankByOwner.entries())
    .map(([owner, currentRank]) => {
      if (!isNarrativeEligibleOwner(owner)) return null;
      const previousRank = previousRankByOwner.get(owner);
      if (previousRank == null) return null;
      return { owner, rankDelta: previousRank - currentRank };
    })
    .filter((movement): movement is { owner: string; rankDelta: number } => movement !== null);

  const biggestRise = [...movements]
    .filter((movement) => movement.rankDelta >= MIN_MEANINGFUL_MOVEMENT)
    .sort((left, right) => {
      if (right.rankDelta !== left.rankDelta) return right.rankDelta - left.rankDelta;
      return left.owner.localeCompare(right.owner);
    })[0];

  const biggestDrop = [...movements]
    .filter((movement) => movement.rankDelta <= -MIN_MEANINGFUL_MOVEMENT)
    .sort((left, right) => {
      const leftMagnitude = Math.abs(left.rankDelta);
      const rightMagnitude = Math.abs(right.rankDelta);
      if (rightMagnitude !== leftMagnitude) return rightMagnitude - leftMagnitude;
      return left.owner.localeCompare(right.owner);
    })[0];

  const insights: Insight[] = [];
  const localSeen = new Set<string>();

  if (biggestRise) {
    pushInsightUnique(
      insights,
      localSeen,
      toInsight({
        id: `biggest-rise-${ownerSlug(biggestRise.owner)}-wk${latestWeek}`,
        type: 'movement',
        title: 'Biggest rise',
        description: `${biggestRise.owner} climbed ${biggestRise.rankDelta} spots in the standings.`,
        owner: biggestRise.owner,
        priorityScore: 55 + biggestRise.rankDelta * 10,
        week: latestWeek,
        navigationTarget: 'standings',
        category: 'trajectory',
        lifecycle: IN_SEASON_LIFECYCLES,
      })
    );
  }

  if (biggestDrop) {
    const dropMagnitude = Math.abs(biggestDrop.rankDelta);
    pushInsightUnique(
      insights,
      localSeen,
      toInsight({
        id: `biggest-drop-${ownerSlug(biggestDrop.owner)}-wk${latestWeek}`,
        type: 'collapse',
        title: 'Biggest drop',
        description: `${biggestDrop.owner} fell ${dropMagnitude} spots in the standings.`,
        owner: biggestDrop.owner,
        priorityScore: 54 + dropMagnitude * 10,
        week: latestWeek,
        navigationTarget: 'standings',
        category: 'trajectory',
        lifecycle: IN_SEASON_LIFECYCLES,
      })
    );
  }

  return insights;
}

export function deriveToiletBowlInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
}): Insight | null {
  const { standingsHistory, resolvedWeeks } = args;
  if (resolvedWeeks.length === 0) return null;

  const finishesByOwner = new Map<string, number>();
  for (const week of resolvedWeeks) {
    const snapshot = standingsHistory.byWeek[week];
    const lastRow = snapshot?.standings[snapshot.standings.length - 1];
    if (!lastRow || !isNarrativeEligibleOwner(lastRow.owner)) continue;
    finishesByOwner.set(lastRow.owner, (finishesByOwner.get(lastRow.owner) ?? 0) + 1);
  }

  const leader = Array.from(finishesByOwner.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0];
  if (!leader) return null;

  const [owner, lastPlaceCount] = leader;
  if (lastPlaceCount < MIN_TOILET_BOWL_FINISHES) return null;

  return toInsight({
    id: `toilet-bowl-${ownerSlug(owner)}`,
    type: 'toilet_bowl',
    title: 'Toilet bowl leader',
    description: `${owner} recorded ${lastPlaceCount} last-place week${lastPlaceCount === 1 ? '' : 's'}.`,
    owner,
    priorityScore: 50 + lastPlaceCount * 6,
    navigationTarget: 'trends',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
  });
}

export function deriveTightRaceInsight(args: {
  rows: OwnerStandingsRow[];
  seasonContext: SeasonContext | null | undefined;
}): Insight | null {
  const { rows, seasonContext } = args;
  if (rows.length < 2 || seasonContext === 'final') return null;

  const leader = rows[0];
  if (!leader || !isNarrativeEligibleOwner(leader.owner)) return null;

  const runnerUp = rows.find(
    (row, index) => index > 0 && row.gamesBack <= TIGHT_RACE_GAP_THRESHOLD
  );
  if (!runnerUp || !canUseReferenceOwner(runnerUp.owner)) return null;

  const gap = runnerUp.gamesBack;
  return toInsight({
    id: `tight-race-${ownerSlug(leader.owner)}-${ownerSlug(runnerUp.owner)}`,
    type: 'race',
    title: gap === 0 ? 'Title race dead heat' : 'Tight title race',
    description:
      gap === 0
        ? `${leader.owner} and ${runnerUp.owner} are tied for first.`
        : `${leader.owner} leads ${runnerUp.owner} by ${gap} game${gap === 1 ? '' : 's'}.`,
    owner: leader.owner,
    relatedOwners: [runnerUp.owner],
    priorityScore: 76 - gap * 8,
    navigationTarget: 'standings',
    category: 'championship_race',
    lifecycle: RACE_LIFECYCLES,
  });
}

export function deriveRecentSurgeInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
  rows?: OwnerStandingsRow[];
  finalOnly?: boolean;
  minWinsRequired?: number;
  minGamesBackGain?: number;
}): Insight | null {
  const {
    standingsHistory,
    resolvedWeeks,
    rows = [],
    finalOnly = false,
    minWinsRequired = MIN_SURGE_WINS,
    minGamesBackGain = 1,
  } = args;
  if (resolvedWeeks.length < 3) return null;

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const baselineWeek = resolvedWeeks[Math.max(0, resolvedWeeks.length - FINAL_WEEKS_WINDOW)]!;
  const rankByOwnerNow = new Map(rows.map((row, index) => [row.owner, index + 1]));

  const deltas = Object.entries(standingsHistory.byOwner)
    .map(([owner, series]) => {
      if (!isNarrativeEligibleOwner(owner)) return null;
      const latestPoint = series.find((point) => point.week === latestWeek);
      const baselinePoint = series.find((point) => point.week === baselineWeek);
      if (!latestPoint || !baselinePoint) return null;

      return {
        owner,
        deltaWins: latestPoint.wins - baselinePoint.wins,
        deltaGamesBack: baselinePoint.gamesBack - latestPoint.gamesBack,
        finalRank: rankByOwnerNow.get(owner) ?? Number.POSITIVE_INFINITY,
      };
    })
    .filter(
      (
        entry
      ): entry is { owner: string; deltaWins: number; deltaGamesBack: number; finalRank: number } =>
        entry !== null
    )
    .filter(
      (entry) => entry.deltaWins >= minWinsRequired || entry.deltaGamesBack >= minGamesBackGain
    )
    .filter((entry) => (finalOnly ? entry.finalRank > 1 : true));

  if (deltas.length === 0) return null;

  deltas.sort((left, right) => {
    if (right.deltaWins !== left.deltaWins) return right.deltaWins - left.deltaWins;
    if (right.deltaGamesBack !== left.deltaGamesBack)
      return right.deltaGamesBack - left.deltaGamesBack;
    return left.owner.localeCompare(right.owner);
  });

  const top = deltas[0];
  if (!top) return null;

  const isLateStory = finalOnly;
  return toInsight({
    id: `${isLateStory ? 'late-surge-short' : 'recent-surge'}-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'surge',
    title: isLateStory ? 'Late surge fell short' : 'Recent surge',
    description: isLateStory
      ? `${top.owner} surged late (+${top.deltaWins} wins over the last ${latestWeek - baselineWeek} weeks) but fell short.`
      : `${top.owner} gained ${top.deltaWins} wins over the last ${latestWeek - baselineWeek} weeks.`,
    owner: top.owner,
    priorityScore:
      (isLateStory ? 96 : 58) + top.deltaWins * 9 + Math.max(0, top.deltaGamesBack) * 4,
    week: latestWeek,
    navigationTarget: 'trends',
    category: isLateStory ? 'season_wrap' : 'trajectory',
    lifecycle: isLateStory ? SEASON_WRAP_LIFECYCLES : IN_SEASON_LIFECYCLES,
  });
}

export function deriveChampionMarginInsight(rows: OwnerStandingsRow[]): Insight | null {
  if (rows.length < 2) return null;
  const leader = rows[0];
  const runnerUp = rows[1];
  if (
    !leader ||
    !runnerUp ||
    !isNarrativeEligibleOwner(leader.owner) ||
    !canUseReferenceOwner(runnerUp.owner)
  ) {
    return null;
  }

  const margin = runnerUp.gamesBack;
  const variant =
    margin <= 1 ? 'tight finish' : margin <= 3 ? 'comfortable margin' : 'dominant season';
  return toInsight({
    id: `champion-margin-${ownerSlug(leader.owner)}-${ownerSlug(runnerUp.owner)}`,
    type: 'champion_margin',
    title: 'Champion margin',
    description: `Title secured by ${leader.owner} over ${runnerUp.owner} by ${margin} game${margin === 1 ? '' : 's'} (${variant}).`,
    owner: leader.owner,
    relatedOwners: [runnerUp.owner],
    priorityScore: 125 + margin * 4,
    navigationTarget: 'standings',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
  });
}

export function deriveFailedChaseInsight(rows: OwnerStandingsRow[]): Insight | null {
  if (rows.length < 2) return null;
  const leader = rows[0];
  if (!leader || !canUseReferenceOwner(leader.owner)) return null;

  const candidates = rows
    .slice(1, 4)
    .filter((row) => isNarrativeEligibleOwner(row.owner))
    .filter((row) => row.gamesBack >= 2)
    .filter((row) => row.wins >= Math.max(2, leader.wins - 2));

  candidates.sort((left, right) => {
    if (right.wins !== left.wins) return right.wins - left.wins;
    if (left.gamesBack !== right.gamesBack) return left.gamesBack - right.gamesBack;
    return left.owner.localeCompare(right.owner);
  });

  const top = candidates[0];
  if (!top) return null;

  return toInsight({
    id: `failed-chase-${ownerSlug(top.owner)}-${ownerSlug(leader.owner)}`,
    type: 'failed_chase',
    title: 'Failed chase',
    description: `Despite ${top.wins} wins, ${top.owner} couldn't close the gap to ${leader.owner}.`,
    owner: top.owner,
    relatedOwners: [leader.owner],
    priorityScore: 108 + top.wins * 2 + Math.round(top.gamesBack * 2),
    navigationTarget: 'standings',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
  });
}

export function deriveFinalCollapseInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
  rows: OwnerStandingsRow[];
}): Insight | null {
  const { standingsHistory, resolvedWeeks, rows } = args;
  if (resolvedWeeks.length < 3 || rows.length === 0) return null;

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const baselineWeek = resolvedWeeks[Math.max(0, resolvedWeeks.length - FINAL_WEEKS_WINDOW)]!;
  const baselineSnapshot = standingsHistory.byWeek[baselineWeek];
  if (!baselineSnapshot) return null;

  const baselineRank = rankByOwner(baselineSnapshot.standings);
  const finalRank = new Map(rows.map((row, index) => [row.owner, index + 1]));

  const collapses = rows
    .filter((row) => isNarrativeEligibleOwner(row.owner))
    .map((row) => {
      const start = baselineRank.get(row.owner);
      const finish = finalRank.get(row.owner);
      if (start == null || finish == null) return null;
      return { owner: row.owner, dropSpots: finish - start };
    })
    .filter((entry): entry is { owner: string; dropSpots: number } =>
      Boolean(entry && entry.dropSpots >= 2)
    );

  collapses.sort((left, right) => {
    if (right.dropSpots !== left.dropSpots) return right.dropSpots - left.dropSpots;
    return left.owner.localeCompare(right.owner);
  });

  const top = collapses[0];
  if (!top) return null;

  const weeks = latestWeek - baselineWeek;
  return toInsight({
    id: `final-collapse-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'collapse',
    title: 'Late collapse',
    description: `${top.owner} dropped ${top.dropSpots} spots over the final ${weeks} weeks.`,
    owner: top.owner,
    priorityScore: 100 + top.dropSpots * 7,
    week: latestWeek,
    navigationTarget: 'trends',
    category: 'season_wrap',
    lifecycle: SEASON_WRAP_LIFECYCLES,
  });
}

export function deriveTightClusterInsight(rows: OwnerStandingsRow[]): Insight | null {
  const eligible = rows.filter((row) => isNarrativeEligibleOwner(row.owner));
  if (eligible.length < 3) return null;

  let bestCluster: { count: number; gap: number; owners: string[] } | null = null;
  for (let start = 0; start < eligible.length; start += 1) {
    for (let end = start + 2; end < eligible.length; end += 1) {
      const subset = eligible.slice(start, end + 1);
      const gap = subset[subset.length - 1]!.gamesBack - subset[0]!.gamesBack;
      if (gap > 2) break;
      const candidate = { count: subset.length, gap, owners: subset.map((row) => row.owner) };
      if (!bestCluster) {
        bestCluster = candidate;
        continue;
      }
      if (candidate.count > bestCluster.count) {
        bestCluster = candidate;
        continue;
      }
      if (candidate.count === bestCluster.count && candidate.gap < bestCluster.gap) {
        bestCluster = candidate;
      }
    }
  }

  if (!bestCluster) return null;

  return toInsight({
    id: `tight-cluster-${bestCluster.owners.map(ownerSlug).join('-')}`,
    type: 'tight_cluster',
    title: 'Crowded finish',
    description: `${bestCluster.count} owners finished within ${bestCluster.gap} game${bestCluster.gap === 1 ? '' : 's'}.`,
    owner: bestCluster.owners[0],
    relatedOwners: bestCluster.owners.slice(1),
    priorityScore: 95 + bestCluster.count * 3 - bestCluster.gap,
    navigationTarget: 'standings',
    category: 'championship_race',
    lifecycle: RACE_LIFECYCLES,
  });
}

function sortByPriority(insights: Insight[]): Insight[] {
  return insights.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
    if ((right.week ?? -1) !== (left.week ?? -1)) return (right.week ?? -1) - (left.week ?? -1);
    return left.id.localeCompare(right.id);
  });
}

export function deriveLeagueInsights(args: {
  rows: OwnerStandingsRow[];
  standingsHistory: StandingsHistory | null;
  seasonContext?: SeasonContext | null;
}): Insight[] {
  const { rows, standingsHistory, seasonContext = null } = args;
  const insights: Insight[] = [];
  const seenIds = new Set<string>();

  const resolvedWeeks = standingsHistory
    ? selectResolvedStandingsWeeks(standingsHistory).resolvedWeeks
    : [];

  if (seasonContext === 'final') {
    pushInsightUnique(insights, seenIds, deriveChampionMarginInsight(rows));
    pushInsightUnique(insights, seenIds, deriveFailedChaseInsight(rows));
    pushInsightUnique(insights, seenIds, deriveTightClusterInsight(rows));

    if (standingsHistory && resolvedWeeks.length > 0) {
      pushInsightUnique(
        insights,
        seenIds,
        deriveRecentSurgeInsight({
          standingsHistory,
          resolvedWeeks,
          rows,
          finalOnly: true,
          minWinsRequired: FINAL_SURGE_MIN_WINS,
          minGamesBackGain: FINAL_SURGE_MIN_GAMES_BACK_GAIN,
        })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveFinalCollapseInsight({ standingsHistory, resolvedWeeks, rows })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveToiletBowlInsight({ standingsHistory, resolvedWeeks })
      );
    }
  } else {
    if (standingsHistory && resolvedWeeks.length > 0) {
      for (const movementInsight of deriveMovementInsights({ standingsHistory, resolvedWeeks })) {
        pushInsightUnique(insights, seenIds, movementInsight);
      }
      pushInsightUnique(
        insights,
        seenIds,
        deriveRecentSurgeInsight({ standingsHistory, resolvedWeeks, rows })
      );
      pushInsightUnique(
        insights,
        seenIds,
        deriveToiletBowlInsight({ standingsHistory, resolvedWeeks })
      );
    }
    pushInsightUnique(insights, seenIds, deriveTightRaceInsight({ rows, seasonContext }));
  }

  return uniqueInsightsById(sortByPriority(insights));
}

export function deriveOverviewInsights(insights: Insight[]): Insight[] {
  const unique = uniqueInsightsById(insights);
  const ranked = [...unique].sort((left, right) => {
    const leftScore = left.priorityScore + (OVERVIEW_TYPE_PRIORITY[left.type] ?? 0);
    const rightScore = right.priorityScore + (OVERVIEW_TYPE_PRIORITY[right.type] ?? 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });
  return ranked.slice(0, OVERVIEW_INSIGHT_LIMIT);
}

export function deriveStandingsInsights(insights: Insight[]): Insight[] {
  const unique = uniqueInsightsById(insights);
  const ranked = [...unique].sort((left, right) => {
    const leftScore = left.priorityScore + (STANDINGS_TYPE_PRIORITY[left.type] ?? 0);
    const rightScore = right.priorityScore + (STANDINGS_TYPE_PRIORITY[right.type] ?? 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });

  const contextual = ranked.filter((insight) => {
    if (insight.type === 'race') return insight.priorityScore >= STANDINGS_MIN_RACE_PRIORITY;
    return insight.type !== 'movement';
  });

  return contextual.slice(0, STANDINGS_INSIGHT_LIMIT);
}
