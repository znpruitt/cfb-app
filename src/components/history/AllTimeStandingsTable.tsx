import React from 'react';
import Link from 'next/link';
import type { AllTimeStandingRow } from '@/lib/selectors/historySelectors';

type Props = {
  rows: AllTimeStandingRow[];
  slug: string;
  liveSeasonYear?: number;
  activeOwners?: string[];
};

export default function AllTimeStandingsTable({
  rows,
  slug,
  liveSeasonYear,
  activeOwners,
}: Props): React.ReactElement {
  const activeSet = activeOwners ? new Set(activeOwners) : null;

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
                  {(
                    ['#', 'Owner', 'Record', 'Win%', 'Titles', 'Seasons', 'Avg Finish'] as const
                  ).map((label) => {
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
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isFormer = activeSet !== null && !activeSet.has(row.owner);
                  const textClass = isFormer
                    ? 'text-gray-400 dark:text-zinc-500'
                    : 'text-gray-900 dark:text-zinc-100';
                  const mutedClass = isFormer
                    ? 'text-gray-300 dark:text-zinc-600'
                    : 'text-gray-500 dark:text-zinc-400';

                  return (
                    <tr
                      key={row.owner}
                      className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                    >
                      <td
                        className={`border-b border-gray-100 px-1.5 py-2 text-sm tabular-nums sm:px-2 dark:border-zinc-800 ${mutedClass}`}
                      >
                        {idx + 1}
                      </td>
                      <td className="min-w-[9.5rem] border-b border-gray-100 px-1.5 py-2 sm:px-2 dark:border-zinc-800">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/league/${slug}/history/owner/${encodeURIComponent(row.owner)}/`}
                            className={`font-semibold hover:text-blue-600 hover:underline dark:hover:text-blue-400 ${isFormer ? 'text-gray-400 dark:text-zinc-500' : 'text-gray-950 dark:text-zinc-50'}`}
                          >
                            {row.owner}
                          </Link>
                          {isFormer && (
                            <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 ring-1 ring-gray-200 dark:text-zinc-500 dark:ring-zinc-700">
                              Former
                            </span>
                          )}
                        </span>
                      </td>
                      <td
                        className={`whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums sm:px-2 dark:border-zinc-800 ${textClass}`}
                      >
                        {row.totalWins}–{row.totalLosses}
                      </td>
                      <td
                        className={`border-b border-gray-100 px-1.5 py-2 text-right tabular-nums sm:px-2 dark:border-zinc-800 ${mutedClass}`}
                      >
                        {(row.winPct * 100).toFixed(1)}%
                      </td>
                      <td className="border-b border-gray-100 px-1.5 py-2 text-right tabular-nums sm:px-2 dark:border-zinc-800">
                        {row.championships > 0 ? (
                          <span
                            className={
                              isFormer
                                ? 'font-semibold text-amber-400 dark:text-amber-600'
                                : 'font-semibold text-amber-700 dark:text-amber-400'
                            }
                          >
                            {row.championships}
                          </span>
                        ) : (
                          <span className={mutedClass}>—</span>
                        )}
                      </td>
                      <td
                        className={`border-b border-gray-100 px-1.5 py-2 text-right tabular-nums sm:px-2 dark:border-zinc-800 ${mutedClass}`}
                      >
                        {row.seasonsPlayed}
                      </td>
                      <td
                        className={`border-b border-gray-100 px-1.5 py-2 text-right tabular-nums sm:px-2 dark:border-zinc-800 ${mutedClass}`}
                      >
                        {row.avgFinish.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
