import type { SeasonContext } from './seasonContext';
import { selectResolvedStandingsWeeks } from './historyResolution';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

export type InsightType = 'movement' | 'toilet_bowl' | 'surge' | 'collapse' | 'race';

export type Insight = {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  score: number;
  owners: string[];
  week?: number;
  navigationTarget?: {
    type: 'standings' | 'matchup' | 'trends';
    params?: Record<string, string | number>;
  };
};

const MIN_MEANINGFUL_MOVEMENT = 2;
const MIN_TOILET_BOWL_FINISHES = 2;
const TIGHT_RACE_GAP_THRESHOLD = 1;
const MIN_SURGE_WINS = 2;

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
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

function deriveMovementInsights(args: {
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
      const previousRank = previousRankByOwner.get(owner);
      if (previousRank == null) return null;
      return {
        owner,
        rankDelta: previousRank - currentRank,
      };
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

  if (biggestRise) {
    pushInsightUnique(insights, new Set(), {
      id: `biggest-rise-${ownerSlug(biggestRise.owner)}-wk${latestWeek}`,
      type: 'movement',
      title: 'Biggest rise this week',
      description: `${biggestRise.owner} climbed ${biggestRise.rankDelta} spots in the standings.`,
      score: 55 + biggestRise.rankDelta * 10,
      owners: [biggestRise.owner],
      week: latestWeek,
      navigationTarget: { type: 'standings' },
    });
  }

  if (biggestDrop) {
    const dropMagnitude = Math.abs(biggestDrop.rankDelta);
    pushInsightUnique(insights, new Set(), {
      id: `biggest-drop-${ownerSlug(biggestDrop.owner)}-wk${latestWeek}`,
      type: 'collapse',
      title: 'Biggest drop this week',
      description: `${biggestDrop.owner} fell ${dropMagnitude} spots in the standings.`,
      score: 54 + dropMagnitude * 10,
      owners: [biggestDrop.owner],
      week: latestWeek,
      navigationTarget: { type: 'standings' },
    });
  }

  return insights;
}

function deriveToiletBowlInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
}): Insight | null {
  const { standingsHistory, resolvedWeeks } = args;
  if (resolvedWeeks.length === 0) return null;

  const finishesByOwner = new Map<string, number>();
  for (const week of resolvedWeeks) {
    const snapshot = standingsHistory.byWeek[week];
    const lastRow = snapshot?.standings[snapshot.standings.length - 1];
    if (!lastRow) continue;
    finishesByOwner.set(lastRow.owner, (finishesByOwner.get(lastRow.owner) ?? 0) + 1);
  }

  if (finishesByOwner.size === 0) return null;

  const leader = Array.from(finishesByOwner.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0];

  if (!leader) return null;

  const [owner, lastPlaceCount] = leader;
  if (lastPlaceCount < MIN_TOILET_BOWL_FINISHES) return null;

  return {
    id: `toilet-bowl-${ownerSlug(owner)}`,
    type: 'toilet_bowl',
    title: 'Toilet bowl leader',
    description: `${owner} has ${lastPlaceCount} last-place week${lastPlaceCount === 1 ? '' : 's'} so far.`,
    score: 50 + lastPlaceCount * 6,
    owners: [owner],
    navigationTarget: { type: 'trends', params: { metric: 'gamesBack' } },
  };
}

function deriveTightRaceInsight(args: {
  rows: OwnerStandingsRow[];
  seasonContext: SeasonContext | null | undefined;
}): Insight | null {
  const { rows, seasonContext } = args;
  if (rows.length < 2 || seasonContext === 'final') return null;

  const leader = rows[0];
  const runnerUp = rows[1];
  if (!leader || !runnerUp) return null;
  const gap = runnerUp.gamesBack;
  if (gap > TIGHT_RACE_GAP_THRESHOLD) return null;

  const title = gap === 0 ? 'Title race dead heat' : 'Tight title race';
  const description =
    gap === 0
      ? `${leader.owner} and ${runnerUp.owner} are tied for first.`
      : `${leader.owner} leads ${runnerUp.owner} by ${gap} game${gap === 1 ? '' : 's'}.`;

  return {
    id: `tight-race-${ownerSlug(leader.owner)}-${ownerSlug(runnerUp.owner)}`,
    type: 'race',
    title,
    description,
    score: 76 - gap * 8,
    owners: [leader.owner, runnerUp.owner],
    navigationTarget: { type: 'standings' },
  };
}

function deriveRecentSurgeInsight(args: {
  standingsHistory: StandingsHistory;
  resolvedWeeks: number[];
}): Insight | null {
  const { standingsHistory, resolvedWeeks } = args;
  if (resolvedWeeks.length < 3) return null;

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1]!;
  const baselineWeek = resolvedWeeks[Math.max(0, resolvedWeeks.length - 3)]!;

  const deltas = Object.entries(standingsHistory.byOwner)
    .map(([owner, series]) => {
      const latestPoint = series.find((point) => point.week === latestWeek);
      const baselinePoint = series.find((point) => point.week === baselineWeek);
      if (!latestPoint || !baselinePoint) return null;

      return {
        owner,
        deltaWins: latestPoint.wins - baselinePoint.wins,
        deltaGamesBack: baselinePoint.gamesBack - latestPoint.gamesBack,
      };
    })
    .filter(
      (entry): entry is { owner: string; deltaWins: number; deltaGamesBack: number } =>
        entry !== null
    )
    .sort((left, right) => {
      if (right.deltaWins !== left.deltaWins) return right.deltaWins - left.deltaWins;
      if (right.deltaGamesBack !== left.deltaGamesBack)
        return right.deltaGamesBack - left.deltaGamesBack;
      return left.owner.localeCompare(right.owner);
    });

  const top = deltas[0];
  if (!top) return null;
  if (top.deltaWins < MIN_SURGE_WINS && top.deltaGamesBack <= 0) return null;

  return {
    id: `recent-surge-${ownerSlug(top.owner)}-wk${latestWeek}`,
    type: 'surge',
    title: 'Recent surge',
    description: `${top.owner} gained ${top.deltaWins} wins over the last ${latestWeek - baselineWeek} weeks.`,
    score: 58 + top.deltaWins * 9 + Math.max(0, top.deltaGamesBack) * 4,
    owners: [top.owner],
    week: latestWeek,
    navigationTarget: { type: 'trends', params: { metric: 'winPct' } },
  };
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

  if (standingsHistory && resolvedWeeks.length > 0) {
    for (const movementInsight of deriveMovementInsights({ standingsHistory, resolvedWeeks })) {
      pushInsightUnique(insights, seenIds, movementInsight);
    }

    pushInsightUnique(
      insights,
      seenIds,
      deriveToiletBowlInsight({ standingsHistory, resolvedWeeks })
    );
    pushInsightUnique(
      insights,
      seenIds,
      deriveRecentSurgeInsight({ standingsHistory, resolvedWeeks })
    );
  }

  pushInsightUnique(insights, seenIds, deriveTightRaceInsight({ rows, seasonContext }));

  return insights.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if ((right.week ?? -1) !== (left.week ?? -1)) return (right.week ?? -1) - (left.week ?? -1);
    return left.id.localeCompare(right.id);
  });
}
