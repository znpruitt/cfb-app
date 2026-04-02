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
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Season Archive
      </h2>
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
              <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-zinc-300">
                <span className="text-amber-500" aria-hidden="true">
                  🏆
                </span>
                <Link
                  href={`/league/${slug}/history/owner/${encodeURIComponent(entry.champion)}/`}
                  className="font-medium hover:underline"
                >
                  {entry.champion}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
