'use client';

import React from 'react';
import MiniTrendsGrid from '@/components/MiniTrendsGrid';
import { buildOwnerColorMap, isDarkTheme } from '@/lib/ownerColors';
import { sliceStandingsHistoryToResolvedWeeks } from '@/lib/selectors/historyResolution';
import { selectGamesBackTrend } from '@/lib/selectors/trends';
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

  // POLISH-013: `MiniTrendsGrid` takes its x-axis domain from
  // `standingsHistory.weeks`, so handing it the RAW archive draws a labelled
  // gridline for every week — including trailing weeks whose coverage never
  // completed, which the trend selectors then decline to populate. Overview
  // slices before it draws; this call site did not, so an archived season with
  // an incomplete tail showed `W14`/`W15` columns with no line behind them.
  const resolvedHistory = React.useMemo(
    () => sliceStandingsHistoryToResolvedWeeks(standingsHistory),
    [standingsHistory]
  );

  // POLISH-012: ask the SELECTOR, not `weeks`. `MiniTrendsGrid` renders nothing
  // when the series are empty, and since games-back now discards point-less
  // series, "weeks exist" stopped predicting "there is something to draw". An
  // archived season whose cumulative coverage never completed has weeks but no
  // resolved ones, and this section rendered its heading and subtitle over an
  // empty body while its own fallback was skipped.
  const hasTrendData = React.useMemo(
    () => selectGamesBackTrend({ standingsHistory }).length > 0,
    [standingsHistory]
  );

  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
        {year} Season Arc
      </h2>
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        Games back from first place, week by week.
      </p>
      {hasTrendData ? (
        <MiniTrendsGrid standingsHistory={resolvedHistory} ownerColorMap={ownerColorMap} />
      ) : (
        <p className="text-sm text-gray-500 dark:text-zinc-400">{TREND_EMPTY_MESSAGE}</p>
      )}
    </section>
  );
}
