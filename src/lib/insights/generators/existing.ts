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
import { membershipIsKnown } from '../superlative';
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

/**
 * The archive names LAST season's field, and some of those owners have left.
 *
 * On the live path this cannot happen — the table is this season's participants
 * by construction — which is why the wrap never needed the check before. Reading
 * an archive introduces it: last season's champion may not be in the league, and
 * AGENTS.md Insights invariant 5 (with INSIGHTS-025's wiring tests behind it)
 * says a departed owner is named ONLY by the membership event.
 *
 * The filter is applied to FINISHED insights, never to the input rows. Dropping
 * a departed owner from the table before deriving would hand the title to
 * whoever placed second — a false result, which is worse than a missing card.
 * So the facts are computed from the complete season and the card is WITHHELD
 * when it would name someone who is gone.
 */
function namesOnlyCurrentMembers(insight: Insight, members: ReadonlySet<string>): boolean {
  const named = [insight.owner, ...(insight.owners ?? []), ...(insight.relatedOwners ?? [])];
  return named.every((owner) => {
    if (!owner) return true;
    // NoClaim is a bucket for unowned teams, not a person who can depart.
    if (owner === 'NoClaim') return true;
    return members.has(owner);
  });
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
    if (source.archivedYear !== null) {
      // Reading an archive puts BOTH membership questions in play, in order:
      // do we know who is playing this season, and does this card name only
      // owners who still are. Without a known list "who left" is unanswerable,
      // so the wrap is withheld entirely rather than guessed at.
      if (!membershipIsKnown(context.leagueMembersSource)) return [];
      return insights
        .filter((insight) => namesOnlyCurrentMembers(insight, context.leagueMembers))
        .map(applyLastSeasonFraming);
    }
    if (context.usingArchivedRoster) {
      return insights.map(applyLastSeasonFraming);
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
