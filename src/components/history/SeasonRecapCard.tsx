import React from 'react';
import Link from 'next/link';
import type { SeasonArchive } from '@/lib/seasonArchive';

type Props = {
  archive: SeasonArchive;
  slug: string;
};

export default function SeasonRecapCard({ archive, slug }: Props): React.ReactElement {
  const eligibleRows = archive.finalStandings.filter((r) => r.owner && r.owner !== 'NoClaim');
  const champion = eligibleRows[0];
  const top5 = eligibleRows.slice(0, 5);

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
        {archive.year} Season Recap
      </h2>
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-800/60">
        {champion && (
          <div className="mb-3 border-b border-gray-200 pb-3 dark:border-zinc-700">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
              Champion
            </p>
            <p className="mt-0.5 text-base font-semibold">
              <Link
                href={`/league/${slug}/history/owner/${encodeURIComponent(champion.owner)}/`}
                className="text-amber-700 hover:underline dark:text-amber-400"
              >
                {champion.owner}
              </Link>
            </p>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              {champion.wins}–{champion.losses}
            </p>
          </div>
        )}
        {top5.length > 0 && (
          <ul className="space-y-1.5">
            {top5.map((row, idx) => (
              <li key={row.owner} className="flex items-baseline gap-3 text-sm">
                <span className="w-4 shrink-0 text-right tabular-nums text-gray-400 dark:text-zinc-500">
                  {idx + 1}
                </span>
                <Link
                  href={`/league/${slug}/history/owner/${encodeURIComponent(row.owner)}/`}
                  className="truncate font-medium text-gray-900 hover:underline dark:text-zinc-100"
                >
                  {row.owner}
                </Link>
                <span className="ml-auto shrink-0 tabular-nums text-gray-500 dark:text-zinc-400">
                  {row.wins}–{row.losses}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 pt-2">
          <Link
            href={`/league/${slug}/history/${archive.year}/`}
            className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Full {archive.year} season →
          </Link>
        </div>
      </div>
    </section>
  );
}
