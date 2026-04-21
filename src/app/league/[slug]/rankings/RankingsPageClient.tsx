'use client';

import React from 'react';

import RankingsPageContent from '../../../../components/RankingsPageContent';
import {
  fetchSeasonRankings,
  getDefaultRankingsSeason,
  type RankingsWeek,
} from '../../../../lib/rankings';

const EXPLICIT_SEASON = Number.parseInt(process.env.NEXT_PUBLIC_SEASON ?? '', 10);
const DEFAULT_SEASON = getDefaultRankingsSeason(
  Number.isFinite(EXPLICIT_SEASON) ? EXPLICIT_SEASON : null
);

export default function RankingsPageClient({ slug }: { slug: string }): React.ReactElement {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [latestWeek, setLatestWeek] = React.useState<RankingsWeek | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetchSeasonRankings(DEFAULT_SEASON);
        if (!cancelled) {
          setLatestWeek(response.latestWeek);
          setError(null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load rankings');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RankingsPageContent
      latestWeek={latestWeek}
      loading={loading}
      error={error}
      season={DEFAULT_SEASON}
      leagueSlug={slug}
    />
  );
}
