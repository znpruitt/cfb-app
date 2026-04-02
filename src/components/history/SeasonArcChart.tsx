'use client';

import React from 'react';
import MiniTrendsGrid from '@/components/MiniTrendsGrid';
import type { StandingsHistory } from '@/lib/standingsHistory';

type Props = {
  standingsHistory: StandingsHistory;
  year: number;
};

export default function SeasonArcChart({ standingsHistory, year }: Props): React.ReactElement {
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        {year} Season Arc
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-zinc-400">
        Games back from first place, week by week.
      </p>
      {standingsHistory.weeks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No trend data available.</p>
      ) : (
        <MiniTrendsGrid standingsHistory={standingsHistory} />
      )}
    </section>
  );
}
