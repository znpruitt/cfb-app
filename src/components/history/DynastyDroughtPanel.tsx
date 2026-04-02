import React from 'react';
import Link from 'next/link';
import type { DynastyDroughtResult } from '@/lib/selectors/historySelectors';

type Props = {
  result: DynastyDroughtResult;
  slug: string;
};

export default function DynastyDroughtPanel({ result, slug }: Props): React.ReactElement {
  const { rows } = result;

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Dynasty &amp; Drought
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No data available.</p>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden dark:from-zinc-900" />
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-gray-500 dark:text-zinc-500">
                  <th className="min-w-[9.5rem] border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700">
                    Owner
                  </th>
                  <th className="whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700">
                    Best Streak
                  </th>
                  <th className="whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700">
                    Years
                  </th>
                  <th className="whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700">
                    Drought
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.owner}
                    className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                  >
                    <td className="min-w-[9.5rem] border-b border-gray-100 px-1.5 py-2 sm:px-2 dark:border-zinc-800">
                      <Link
                        href={`/league/${slug}/history/owner/${encodeURIComponent(row.owner)}/`}
                        className="font-semibold text-gray-950 hover:text-blue-600 hover:underline dark:text-zinc-50 dark:hover:text-blue-400"
                      >
                        {row.owner}
                      </Link>
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-center tabular-nums sm:px-2 dark:border-zinc-800">
                      {row.longestWinStreak > 0 ? (
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          {row.longestWinStreak} in a row
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-xs text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {row.longestWinStreakYears.length > 0
                        ? row.longestWinStreakYears.join(', ')
                        : '—'}
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-center tabular-nums sm:px-2 dark:border-zinc-800">
                      {row.longestDrought > 0 ? (
                        <span className="text-gray-600 dark:text-zinc-300">
                          {row.longestDrought} season{row.longestDrought !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
