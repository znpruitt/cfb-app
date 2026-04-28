import React from 'react';
import Link from 'next/link';
import type { ChampionshipEntry } from '@/lib/selectors/historySelectors';

type Props = {
  history: ChampionshipEntry[];
  slug: string;
};

export default function SeasonListPanel({ history, slug }: Props): React.ReactElement {
  const sorted = [...history].sort((a, b) => b.year - a.year);

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Season Archive</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No archived seasons.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
          {sorted.map((entry) => (
            <li key={entry.year} className="flex items-center justify-between gap-4 py-2.5">
              <Link
                href={`/league/${slug}/history/${entry.year}/`}
                className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                {entry.year} Season
              </Link>
              <Link
                href={`/league/${slug}/history/owner/${encodeURIComponent(entry.champion)}/`}
                className="text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400"
              >
                {entry.champion}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
