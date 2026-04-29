import React from 'react';
import type { SeasonArchive } from '@/lib/seasonArchive';
import type { ChampionshipEntry, AllTimeStandingRow } from '@/lib/selectors/historySelectors';

type Props = {
  archives: SeasonArchive[];
  championshipHistory: ChampionshipEntry[];
  allTimeStandings: AllTimeStandingRow[];
  activeOwners: Set<string>;
};

export type EraSummaryStats = {
  yearRange: string | null;
  seasonCount: number;
  championCount: number;
  ownersChasingFirstTitle: number;
};

export function computeEraSummaryStats({
  archives,
  championshipHistory,
  allTimeStandings,
  activeOwners,
}: Props): EraSummaryStats {
  if (archives.length === 0) {
    return {
      yearRange: null,
      seasonCount: 0,
      championCount: 0,
      ownersChasingFirstTitle: 0,
    };
  }

  const years = archives.map((a) => a.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearRange = minYear === maxYear ? `${minYear}` : `${minYear}–${maxYear}`;

  const distinctChampions = new Set(championshipHistory.map((c) => c.champion));
  const championCount = distinctChampions.size;

  const ownersChasingFirstTitle = allTimeStandings.filter(
    (row) => row.championships === 0 && activeOwners.has(row.owner)
  ).length;

  return {
    yearRange,
    seasonCount: archives.length,
    championCount,
    ownersChasingFirstTitle,
  };
}

export default function EraSummary(props: Props): React.ReactElement {
  const stats = computeEraSummaryStats(props);

  if (stats.yearRange === null) {
    return (
      <section>
        <p className="text-sm text-gray-500 dark:text-zinc-400">No archived seasons yet.</p>
      </section>
    );
  }

  const seasonLabel = `${stats.seasonCount} season${stats.seasonCount === 1 ? '' : 's'}`;
  const championLabel = `${stats.championCount} champion${stats.championCount === 1 ? '' : 's'}`;
  const chasingLabel = `${stats.ownersChasingFirstTitle} owner${
    stats.ownersChasingFirstTitle === 1 ? '' : 's'
  } still chasing first title`;

  return (
    <section className="space-y-1">
      <p className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
        {stats.yearRange}
        <span className="mx-2 text-gray-300 dark:text-zinc-600">•</span>
        {seasonLabel}
        <span className="mx-2 text-gray-300 dark:text-zinc-600">•</span>
        {championLabel}
      </p>
      {stats.ownersChasingFirstTitle > 0 && (
        <p className="text-[13px] text-gray-500 dark:text-zinc-400">{chasingLabel}</p>
      )}
    </section>
  );
}
