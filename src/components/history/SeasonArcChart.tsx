'use client';

import React from 'react';
import MiniTrendsGrid from '@/components/MiniTrendsGrid';
import { buildOwnerColorMap, prefersDarkMode } from '@/lib/ownerColors';
import type { StandingsHistory } from '@/lib/standingsHistory';

type Props = {
  standingsHistory: StandingsHistory;
  year: number;
};

export default function SeasonArcChart({ standingsHistory, year }: Props): React.ReactElement {
  const ownerColorMap = React.useMemo(() => {
    const allOwners = Object.keys(standingsHistory.byOwner);
    return buildOwnerColorMap(allOwners, prefersDarkMode());
  }, [standingsHistory.byOwner]);

  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
        {year} Season Arc
      </h2>
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        Games back from first place, week by week.
      </p>
      {standingsHistory.weeks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No trend data available.</p>
      ) : (
        <MiniTrendsGrid standingsHistory={standingsHistory} ownerColorMap={ownerColorMap} />
      )}
    </section>
  );
}
