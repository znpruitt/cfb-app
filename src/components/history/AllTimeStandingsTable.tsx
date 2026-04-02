import React from 'react';
import Link from 'next/link';
import type { AllTimeStandingRow } from '@/lib/selectors/historySelectors';

type Props = {
  rows: AllTimeStandingRow[];
  slug: string;
  liveSeasonYear?: number;
};

export default function AllTimeStandingsTable({
  rows,
  slug,
  liveSeasonYear,
}: Props): React.ReactElement {
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          All-Time Standings
        </h2>
        {liveSeasonYear !== undefined && (
          <span className="text-xs text-blue-600 dark:text-blue-400">
            Includes live {liveSeasonYear} season (in progress)
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No data available.</p>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden dark:from-zinc-900" />
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-gray-500 dark:text-zinc-500">
                  {(['#', 'Owner', 'Record', 'Win%', 'Titles', 'Seasons', 'Avg Finish'] as const).map(
                    (label) => {
                      const isNumeric = label !== '#' && label !== 'Owner';
                      return (
                        <th
                          key={label}
                          className={`whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700 ${
                            label === '#' ? 'w-[2rem]' : ''
                          } ${isNumeric ? 'text-right' : ''}`}
                        >
                          {label}
                        </th>
                      );
                    }
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.owner}
                    className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                  >
                    <td className="border-b border-gray-100 px-1.5 py-2 text-sm tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {idx + 1}
                    </td>
                    <td className="min-w-[9.5rem] border-b border-gray-100 px-1.5 py-2 sm:px-2 dark:border-zinc-800">
                      <Link
                        href={`/league/${slug}/history/owner/${encodeURIComponent(row.owner)}/`}
                        className="font-semibold text-gray-950 hover:text-blue-600 hover:underline dark:text-zinc-50 dark:hover:text-blue-400"
                      >
                        {row.owner}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-900 sm:px-2 dark:border-zinc-800 dark:text-zinc-100">
                      {row.totalWins}–{row.totalLosses}
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {(row.winPct * 100).toFixed(1)}%
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-right tabular-nums sm:px-2 dark:border-zinc-800">
                      {row.championships > 0 ? (
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          {row.championships}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {row.seasonsPlayed}
                    </td>
                    <td className="border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {row.avgFinish.toFixed(1)}
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
