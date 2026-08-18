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
import { applyLastSeasonFraming } from '../framing';
import type { InsightContext, InsightGenerator, LifecycleState } from '../types';

const TRAJECTORY_LIFECYCLES: LifecycleState[] = ['early_season', 'mid_season', 'late_season'];
const RACE_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
];
const SEASON_WRAP_LIFECYCLES: LifecycleState[] = ['preseason', 'postseason', 'fresh_offseason'];

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

type SeasonWrapSource = {
  rows: OwnerStandingsRow[];
  standingsHistory: StandingsHistory | null;
  /** The archived year when the wrap describes a season other than the current one. */
  archivedYear: number | null;
};

/**
 * A season wrap must read the table of the season it is describing.
 *
 * In `postseason` and `fresh_offseason` that is the CURRENT standings — the year
 * has not rolled over, so `context.currentStandings` still holds the finished
 * season's finals. In `preseason` it is not: the rollover has already advanced
 * the league to the new year, and the current standings are the new season's
 * rows, where nobody has played. Reading them there would derive a champion
 * margin and a failed chase from a 0-0 table. The finished season survives only
 * in its archive, so preseason reads the archive or produces nothing at all.
 *
 * Adjacency is required, not "most recent": only the archive for `currentYear -
 * 1` is last season. A league that skipped a year would otherwise have a
 * two-year-old wrap framed as "last season's".
 */
function selectSeasonWrapSource(context: InsightContext): SeasonWrapSource | null {
  if (context.lifecycleState !== 'preseason') {
    return {
      rows: selectCurrentRows(context),
      standingsHistory: reconstructStandingsHistory(context),
      archivedYear: null,
    };
  }
  // `context.currentYear` is `league.year`, the SYNCHRONIZED PROJECTION of the
  // lifecycle authority rather than the authority itself (`league.status.year`).
  // `applyLifecycleStatus` writes both in one registry transaction, so they agree
  // for any record the current authority has written — but a legacy
  // desynchronized record would put this generator a year behind and label a
  // two-year-old champion "last season's".
  //
  // The archive set settles it without a new context field: the season being
  // wrapped must be the most recent one archived. If anything at or after
  // `currentYear` is already archived, the projection is stale and the adjacent
  // year cannot be trusted, so the wrap is withheld rather than guessed.
  if (context.archives.some((entry) => entry.year >= context.currentYear)) return null;
  const archive = context.archives.find((entry) => entry.year === context.currentYear - 1);
  if (!archive) return null;
  return {
    rows: archive.finalStandings,
    standingsHistory: archive.standingsHistory,
    archivedYear: archive.year,
  };
}

/**
 * Every claim in this generator is about how a season FINISHED, so a table in
 * which no game has been recorded supports none of them — "title secured by X
 * over Y by 0 games" is a fabricated result, not a thin one.
 *
 * Applied to both sources, because both can present one: an archive can be
 * written for a season that was created and rolled straight over without play,
 * and a live postseason table reads 0-0 across the board whenever score
 * attachment has failed.
 */
function seasonWasPlayed(rows: OwnerStandingsRow[]): boolean {
  // `finalGames` is the direct count, but archives written before it existed
  // legitimately lack it — and `undefined > 0` is false rather than an error, so
  // the record half has to stand on its own.
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

export const seasonWrapGenerator: InsightGenerator = {
  id: 'existing:season_wrap',
  category: 'season_wrap',
  supportedLifecycles: SEASON_WRAP_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const source = selectSeasonWrapSource(context);
    if (!source) return [];
    const { rows, standingsHistory } = source;
    if (!seasonWasPlayed(rows)) return [];
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

    // Two different ways this generator ends up describing the prior season, and
    // BOTH have to be framed or the title reads as a current-year claim:
    //
    //  - the rollover window (current CSV empty, archived roster borrowed), and
    //  - preseason, where the source above is the archive by construction.
    //
    // Preseason is the one that cannot rely on `usingArchivedRoster`: once the
    // draft is confirmed the current roster exists, the flag goes false, and the
    // unframed title "Toilet bowl leader" would sit on the Overview of a season
    // whose first game has not kicked off.
    // A finished season is the headline while it is the most recent thing that
    // happened, and background once the next one is being set up. The generator
    // DECLARES that policy and never applies it — a decayed score computed
    // inside the cache freezes at whatever lifecycle warmed the entry.
    const recap = insights.map((insight) => ({ ...insight, decay: 'season_recap' as const }));

    // Two different ways this generator ends up describing the prior season, and
    // BOTH have to be framed or the title reads as a current-year claim:
    //
    //  - the rollover window (current CSV empty, archived roster borrowed), and
    //  - preseason, where the source above is the archive by construction.
    //
    // Preseason is the one that cannot rely on `usingArchivedRoster`: once the
    // draft is confirmed the current roster exists, the flag goes false, and the
    // unframed title "Toilet bowl leader" would sit on the Overview of a season
    // whose first game has not kicked off.
    //
    // NOTE — these cards are deliberately NOT filtered by current membership,
    // and that is a decision rather than an omission. An earlier revision
    // withheld any card naming a departed owner, which made the whole recap dark
    // until owners were confirmed and silently deleted the champion card
    // whenever last season's champion did not come back. AGENTS.md Insights
    // invariant 5 clause (b) governs instead: a framed report of a COMPLETED
    // season states historical fact and asserts nothing about who is playing, so
    // it is already safe and must not be given a membership gate. Owner ruling,
    // 2026-08-18. The INSIGHTS-025 rule that a departed owner is named only by
    // the membership event still binds every generator whose claim is about the
    // CURRENT season.
    if (source.archivedYear !== null || context.usingArchivedRoster) {
      return recap.map(applyLastSeasonFraming);
    }
    return recap;
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
registerGenerator(seasonWrapGenerator);
registerGenerator(championshipRaceGenerator);
