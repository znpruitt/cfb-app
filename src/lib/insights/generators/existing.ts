import {
  deriveChampionMarginInsight,
  deriveClosingChaseInsight,
  deriveFinalCollapseInsight,
  deriveMovementInsights,
  deriveRecentSurgeInsight,
  deriveSeasonRunInsights,
  deriveTightClusterInsight,
  deriveTightRaceInsight,
  deriveToiletBowlInsight,
  SEASON_WRAP_LIFECYCLES,
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

type SeasonRecapSource = {
  rows: OwnerStandingsRow[];
  standingsHistory: StandingsHistory | null;
  /** The season these cards describe. Always the year of the table that was read. */
  season: number;
  /** True when that season is not the one being viewed, which navigation needs. */
  fromArchive: boolean;
};

/**
 * A recap must read the table of the season it describes, and may only speak
 * once that season is OVER.
 *
 * Outside preseason the current standings ARE that table — the year has not
 * rolled over. The one ambiguity is `postseason`, which `deriveLifecycleState`
 * returns both while the postseason is running and after it finishes;
 * `seasonContext === 'final'` (no unresolved weeks) is what separates them.
 *
 * In preseason the rollover has already advanced the league, so the current
 * standings belong to the season about to start and every row is 0-0. The
 * finished season survives only in its archive. Adjacency is required rather
 * than "most recent": only `currentYear - 1` is last season, and a league that
 * skipped a year would otherwise get a two-year-old champion. The archive set
 * also settles whether `currentYear` can be trusted at all — anything archived
 * at or after it proves the projection stale.
 */
function selectSeasonRecapSource(context: InsightContext): SeasonRecapSource | null {
  if (context.lifecycleState !== 'preseason') {
    if (context.lifecycleState === 'postseason' && context.seasonContext !== 'final') return null;
    return {
      rows: selectCurrentRows(context),
      standingsHistory: reconstructStandingsHistory(context),
      season: context.currentYear,
      fromArchive: false,
    };
  }
  if (context.archives.some((entry) => entry.year >= context.currentYear)) return null;
  const archive = context.archives.find((entry) => entry.year === context.currentYear - 1);
  if (!archive) return null;
  return {
    rows: archive.finalStandings,
    standingsHistory: archive.standingsHistory,
    season: archive.year,
    fromArchive: true,
  };
}

/**
 * Every claim here is about how a season FINISHED, so a table in which no game
 * has been recorded supports none of them — "took it by 0 games" over a 0-0
 * table is a fabricated result. Reachable from both sources: an archive can be
 * written for a league rolled straight over, and a live table reads 0-0 across
 * the board when score attachment has failed.
 */
function seasonWasPlayed(rows: OwnerStandingsRow[]): boolean {
  // Archives written before `finalGames` existed legitimately lack it, and
  // `undefined > 0` is false rather than an error, so the record half must stand
  // on its own.
  return rows.some((row) => row.finalGames > 0 || row.wins + row.losses > 0);
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

/**
 * INSIGHTS-033 — season-scale movement, registered separately from
 * `existing:trajectory` rather than folded into it.
 *
 * Its own generator because it answers its own question and should stand or fall
 * on its own: `trajectory` reports the week's movement and a trailing-window
 * surge, while this reports how far an owner has come back from their own low
 * across the whole season. Sharing a generator id would also share suppression
 * and diagnostics identity between three unrelated claims.
 */
export const seasonRunGenerator: InsightGenerator = {
  id: 'existing:season_run',
  category: 'trajectory',
  supportedLifecycles: TRAJECTORY_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const standingsHistory = reconstructStandingsHistory(context);
    if (!standingsHistory) return [];
    const { resolvedWeeks } = selectResolvedStandingsWeeks(standingsHistory);
    if (resolvedWeeks.length === 0) return [];
    return deriveSeasonRunInsights({ standingsHistory, resolvedWeeks });
  },
};

export const seasonWrapGenerator: InsightGenerator = {
  id: 'existing:season_wrap',
  category: 'season_wrap',
  supportedLifecycles: SEASON_WRAP_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const source = selectSeasonRecapSource(context);
    if (!source) return [];
    const { rows, standingsHistory, season } = source;
    if (!seasonWasPlayed(rows)) return [];

    // Passing the season is what switches every derivation to completed-season
    // copy, and those titles STATE the year — "How 2025 finished", "Who owns the
    // porcelain throne in 2025?". Owner ruling, 2026-08-18: a stated year is
    // clear and leaves no ambiguity about which season is meant. It is also what
    // AGENTS.md Insights invariant 5 leans on when it exempts these cards from
    // the departed-owner rule: a framed report of a finished season states
    // historical fact and asserts nothing about who is playing now, so it is NOT
    // filtered by current membership. Withholding instead would make the recap
    // dark until owners were confirmed and would silently delete the champion
    // card whenever last season's champion did not return.
    const insights: Insight[] = [];

    const championMargin = deriveChampionMarginInsight(rows, season);
    if (championMargin) insights.push(championMargin);

    if (standingsHistory) {
      const { resolvedWeeks } = selectResolvedStandingsWeeks(standingsHistory);
      if (resolvedWeeks.length > 0) {
        const chase = deriveClosingChaseInsight({
          standingsHistory,
          resolvedWeeks,
          rows,
          completedSeason: season,
        });
        if (chase) insights.push(chase);

        const collapse = deriveFinalCollapseInsight({
          standingsHistory,
          resolvedWeeks,
          rows,
          completedSeason: season,
        });
        if (collapse) insights.push(collapse);

        const toiletBowl = deriveToiletBowlInsight({
          standingsHistory,
          resolvedWeeks,
          completedSeason: season,
        });
        if (toiletBowl) insights.push(toiletBowl);
      }
    }

    return insights.map((insight) => ({
      ...insight,
      // The generator DECLARES the ageing policy and never applies it: a decayed
      // score computed here would be cached and freeze at whatever lifecycle
      // warmed the entry. `applyInsightDecay` runs at request time.
      decay: 'season_recap' as const,
      // `season` travels ONLY when the card describes a season other than the one
      // being viewed. Navigation reads it, so a "How 2025 finished" card served on
      // the 2026 page opens 2025 rather than an empty 2026 view.
      ...(source.fromArchive ? { season } : {}),
    }));
  },
};

export const championshipRaceGenerator: InsightGenerator = {
  id: 'existing:championship_race',
  category: 'championship_race',
  supportedLifecycles: RACE_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const rows = selectCurrentRows(context);

    // Row-content guard: derived race insights from a 0-0 row set produce
    // nonsense like "X owners finished within 0 games" or "Title race dead
    // heat" before any games have been played. Skip when no decisions exist.
    if (rows.length === 0 || rows.every((r) => r.wins + r.losses === 0)) {
      return [];
    }

    const insights: Insight[] = [];

    const tightCluster = deriveTightClusterInsight(rows);
    if (tightCluster) insights.push(tightCluster);

    const tightRace = deriveTightRaceInsight({ rows, seasonContext: context.seasonContext });
    if (tightRace) insights.push(tightRace);

    return insights;
  },
};

registerGenerator(trajectoryGenerator);
registerGenerator(seasonRunGenerator);
registerGenerator(seasonWrapGenerator);
registerGenerator(championshipRaceGenerator);
