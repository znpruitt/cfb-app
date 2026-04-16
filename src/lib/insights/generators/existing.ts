import {
  deriveChampionMarginInsight,
  deriveFailedChaseInsight,
  deriveFinalCollapseInsight,
  deriveMovementInsights,
  deriveRecentSurgeInsight,
  deriveTightClusterInsight,
  deriveTightRaceInsight,
  deriveToiletBowlInsight,
  type Insight,
} from '../../selectors/insights';
import { selectResolvedStandingsWeeks } from '../../selectors/historyResolution';
import type { OwnerStandingsRow } from '../../standings';
import type { StandingsHistory } from '../../standingsHistory';
import { registerGenerator } from '../engine';
import type { InsightContext, InsightGenerator, LifecycleState } from '../types';

const TRAJECTORY_LIFECYCLES: LifecycleState[] = ['early_season', 'mid_season', 'late_season'];
const RACE_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
];
const SEASON_WRAP_LIFECYCLES: LifecycleState[] = ['postseason', 'fresh_offseason'];

function reconstructStandingsHistory(context: InsightContext): StandingsHistory | null {
  if (context.weeklyStandings.length === 0) return null;
  const weeks: number[] = [];
  const byWeek: StandingsHistory['byWeek'] = {};
  const byOwner: StandingsHistory['byOwner'] = {};
  for (const snapshot of context.weeklyStandings) {
    weeks.push(snapshot.week);
    byWeek[snapshot.week] = snapshot;
    for (const row of snapshot.standings) {
      const series = byOwner[row.owner] ?? [];
      series.push({
        week: snapshot.week,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        winPct: row.winPct,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        pointDifferential: row.pointDifferential,
        gamesBack: row.gamesBack,
      });
      byOwner[row.owner] = series;
    }
  }
  return { weeks, byWeek, byOwner };
}

function selectCurrentRows(context: InsightContext): OwnerStandingsRow[] {
  return context.currentStandings;
}

export const trajectoryGenerator: InsightGenerator = {
  id: 'existing:trajectory',
  category: 'trajectory',
  supportedLifecycles: TRAJECTORY_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const standingsHistory = reconstructStandingsHistory(context);
    if (!standingsHistory) return [];
    const { resolvedWeeks } = selectResolvedStandingsWeeks(standingsHistory);
    if (resolvedWeeks.length === 0) return [];

    const insights: Insight[] = [];
    insights.push(...deriveMovementInsights({ standingsHistory, resolvedWeeks }));
    const surge = deriveRecentSurgeInsight({
      standingsHistory,
      resolvedWeeks,
      rows: selectCurrentRows(context),
    });
    if (surge) insights.push(surge);
    return insights;
  },
};

export const seasonWrapGenerator: InsightGenerator = {
  id: 'existing:season_wrap',
  category: 'season_wrap',
  supportedLifecycles: SEASON_WRAP_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const rows = selectCurrentRows(context);
    const standingsHistory = reconstructStandingsHistory(context);
    const insights: Insight[] = [];

    const championMargin = deriveChampionMarginInsight(rows);
    if (championMargin) insights.push(championMargin);

    const failedChase = deriveFailedChaseInsight(rows);
    if (failedChase) insights.push(failedChase);

    if (standingsHistory) {
      const { resolvedWeeks } = selectResolvedStandingsWeeks(standingsHistory);
      if (resolvedWeeks.length > 0) {
        const collapse = deriveFinalCollapseInsight({ standingsHistory, resolvedWeeks, rows });
        if (collapse) insights.push(collapse);

        const toiletBowl = deriveToiletBowlInsight({ standingsHistory, resolvedWeeks });
        if (toiletBowl) insights.push(toiletBowl);
      }
    }

    return insights;
  },
};

export const championshipRaceGenerator: InsightGenerator = {
  id: 'existing:championship_race',
  category: 'championship_race',
  supportedLifecycles: RACE_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const rows = selectCurrentRows(context);
    const insights: Insight[] = [];

    const tightCluster = deriveTightClusterInsight(rows);
    if (tightCluster) insights.push(tightCluster);

    const tightRace = deriveTightRaceInsight({ rows, seasonContext: context.seasonContext });
    if (tightRace) insights.push(tightRace);

    return insights;
  },
};

registerGenerator(trajectoryGenerator);
registerGenerator(seasonWrapGenerator);
registerGenerator(championshipRaceGenerator);
