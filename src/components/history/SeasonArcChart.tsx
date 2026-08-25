'use client';

import React from 'react';
import MiniTrendsGrid from '@/components/MiniTrendsGrid';
import { buildOwnerColorMap, isDarkTheme } from '@/lib/ownerColors';
import {
  isDrawableTrendSeries,
  seasonOriginApplies,
  selectGamesBackTrend,
} from '@/lib/selectors/trends';
import type { StandingsHistory } from '@/lib/standingsHistory';
import { TREND_EMPTY_MESSAGE } from '@/lib/trendEmptyState';

type Props = {
  standingsHistory: StandingsHistory;
  year: number;
};

export default function SeasonArcChart({ standingsHistory, year }: Props): React.ReactElement {
  const ownerColorMap = React.useMemo(() => {
    const allOwners = Object.keys(standingsHistory.byOwner);
    return buildOwnerColorMap(allOwners, isDarkTheme());
  }, [standingsHistory.byOwner]);

  // POLISH-012: ask the SELECTOR, not `weeks`. `MiniTrendsGrid` renders nothing
  // when the series are empty, and since games-back now discards point-less
  // series, "weeks exist" stopped predicting "there is something to draw". An
  // archived season whose cumulative coverage never completed has weeks but no
  // resolved ones, and this section rendered its heading and subtitle over an
  // empty body while its own fallback was skipped.
  // POLISH-014: ask whether a series can be DRAWN, not whether one exists. This
  // guard was still mere presence after POLISH-013 gave the same file its empty
  // sentence, so an archive with exactly one resolved week rendered the axes over
  // moveto-only paths — the very "empty box" the sentence exists to prevent.
  // `isDrawableTrendSeries` is shared with the Overview guard and the grid.
  // An archive is the whole season, but that is NOT enough to justify the origin:
  // this chart plots only RESOLVED weeks, and its own POLISH-012 note describes
  // the reachable case where early weeks were played and never resolved. The
  // shared predicate asks the real question — was anything played before the
  // first week we draw?
  const originApplies = React.useMemo(
    () =>
      seasonOriginApplies(
        standingsHistory,
        selectGamesBackTrend({ standingsHistory })[0]?.points[0]?.week
      ),
    [standingsHistory]
  );
  const hasTrendData = React.useMemo(() => {
    const series = selectGamesBackTrend({ standingsHistory });
    const drawn = originApplies ? series : series.map((s) => ({ ...s, origin: null }));
    return drawn.some(isDrawableTrendSeries);
  }, [standingsHistory, originApplies]);

  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
        {year} Season Arc
      </h2>
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        Games back from first place, week by week.
      </p>
      {hasTrendData ? (
        <MiniTrendsGrid
          standingsHistory={standingsHistory}
          ownerColorMap={ownerColorMap}
          startsAtSeasonStart={originApplies}
        />
      ) : (
        <p className="text-sm text-gray-500 dark:text-zinc-400">{TREND_EMPTY_MESSAGE}</p>
      )}
    </section>
  );
}
