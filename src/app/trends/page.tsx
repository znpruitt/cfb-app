'use client';

import React from 'react';

import TrendsDetailSurface from './TrendsDetailSurface';
import { getDefaultRankingsSeason } from '../../lib/rankings';
import { type SeasonContext } from '../../lib/selectors/seasonContext';
import type { StandingsHistory } from '../../lib/standingsHistory';
import { loadCanonicalTrendsPageData } from '../../lib/trendsPageData';

const EXPLICIT_SEASON = Number.parseInt(process.env.NEXT_PUBLIC_SEASON ?? '', 10);
const DEFAULT_SEASON = getDefaultRankingsSeason(
  Number.isFinite(EXPLICIT_SEASON) ? EXPLICIT_SEASON : null
);

export default function TrendsPage(): React.ReactElement {
  const [isLoading, setIsLoading] = React.useState(true);
  const [state, setState] = React.useState<{
    standingsHistory: StandingsHistory | null;
    seasonContext: SeasonContext | null;
    season: number;
    issues: string[];
  }>({
    standingsHistory: null,
    seasonContext: null,
    season: DEFAULT_SEASON,
    issues: [],
  });

  React.useEffect(() => {
    let isActive = true;

    void (async () => {
      setIsLoading(true);
      const loaded = await loadCanonicalTrendsPageData(DEFAULT_SEASON);
      if (!isActive) return;

      setState({
        standingsHistory: loaded.standingsHistory,
        seasonContext: loaded.seasonContext,
        season: loaded.season,
        issues: loaded.issues,
      });
      setIsLoading(false);
    })();

    return () => {
      isActive = false;
    };
  }, []);

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        <p className="text-sm text-gray-600 dark:text-zinc-300">Loading trends data…</p>
      </main>
    );
  }

  return (
    <TrendsDetailSurface
      standingsHistory={state.standingsHistory}
      season={state.season}
      seasonContext={state.seasonContext}
      issues={state.issues}
    />
  );
}
