import {
  deriveChampionMarginInsight,
  deriveClosingChaseInsight,
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

    // The season these cards describe. On the archive path it is the archived
    // year; otherwise the current one, which in `postseason` and
    // `fresh_offseason` IS the season that just finished.
    //
    // Passing it is what switches every card to completed-season copy, and the
    // titles then STATE the year: "How 2025 finished", "Who owns the porcelain
    // throne in 2025?". That replaces `applyLastSeasonFraming` here — owner
    // ruling, 2026-08-18, "it's clear and leaves no ambiguity about the year
    // being referenced". A stated year is also stronger framing than a relative
    // prefix: it survives being read out of context, which matters because
    // AGENTS.md Insights invariant 5 exempts these cards from the departed-owner
    // rule only while their framing is unambiguous.
    const completedSeason = source.archivedYear ?? context.currentYear;
    const insights: Insight[] = [];

    const championMargin = deriveChampionMarginInsight(rows, completedSeason);
    if (championMargin) insights.push(championMargin);

    if (standingsHistory) {
      const { resolvedWeeks } = selectResolvedStandingsWeeks(standingsHistory);
      if (resolvedWeeks.length > 0) {
        const chase = deriveClosingChaseInsight({
          standingsHistory,
          resolvedWeeks,
          rows,
          completedSeason,
        });
        if (chase) insights.push(chase);

        const collapse = deriveFinalCollapseInsight({
          standingsHistory,
          resolvedWeeks,
          rows,
          completedSeason,
        });
        if (collapse) insights.push(collapse);

        const toiletBowl = deriveToiletBowlInsight({
          standingsHistory,
          resolvedWeeks,
          completedSeason,
        });
        if (toiletBowl) insights.push(toiletBowl);
      }
    }

    // A finished season is the headline while it is the most recent thing that
    // happened, and background once the next one is being set up. The generator
    // DECLARES that policy and never applies it — a decayed score computed
    // inside the cache freezes at whatever lifecycle warmed the entry.
    //
    // NOTE — these cards are deliberately NOT filtered by current membership,
    // and that is a decision rather than an omission. An earlier revision
    // withheld any card naming a departed owner, which made the whole recap dark
    // until owners were confirmed and silently deleted the champion card
    // whenever last season's champion did not come back. AGENTS.md Insights
    // invariant 5 clause (b) governs instead: a report of a COMPLETED season
    // states historical fact and asserts nothing about who is playing. Owner
    // ruling, 2026-08-18. The INSIGHTS-025 rule that a departed owner is named
    // only by the membership event still binds every generator whose claim is
    // about the CURRENT season.
    // `season` travels with the card ONLY when it describes a season other than
    // the one being viewed. Navigation reads it: without it a "How 2025 finished"
    // card served on the 2026 page routes the reader to 2026's history and an
    // empty 2026 trends view — the card's own text disagreeing with where it
    // lands. On the live path the described season IS the viewed one, so the
    // field stays absent and existing routing is untouched.
    return insights.map((insight) => ({
      ...insight,
      decay: 'season_recap' as const,
      ...(source.archivedYear !== null ? { season: source.archivedYear } : {}),
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
registerGenerator(seasonWrapGenerator);
registerGenerator(championshipRaceGenerator);
