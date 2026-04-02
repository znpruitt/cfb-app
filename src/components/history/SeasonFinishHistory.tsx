import React from 'react';
import Link from 'next/link';
import type { OwnerSeasonRecord } from '@/lib/selectors/historySelectors';

type Props = {
  history: OwnerSeasonRecord[];
  slug: string;
};

export default function SeasonFinishHistory({ history, slug }: Props): React.ReactElement {
  const sorted = [...history].sort((a, b) => b.year - a.year);

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Season History
      </h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No seasons found.</p>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden dark:from-zinc-900" />
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-gray-500 dark:text-zinc-500">
                  {(['Season', 'Finish', 'Record', 'GB'] as const).map((label) => (
                    <th
                      key={label}
                      className="whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr
                    key={s.year}
                    className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                  >
                    <td className="border-b border-gray-100 px-1.5 py-2 sm:px-2 dark:border-zinc-800">
                      <Link
                        href={`/league/${slug}/history/${s.year}/`}
                        className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {s.year}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 sm:px-2 dark:border-zinc-800">
                      {s.isChampion ? (
                        <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
                          <span aria-hidden="true">🏆</span>
                          <span>#{s.finish}</span>
                          <span className="text-xs font-normal">of {s.totalOwners}</span>
                        </span>
                      ) : (
                        <span className="tabular-nums text-gray-900 dark:text-zinc-100">
                          #{s.finish}{' '}
                          <span className="text-xs text-gray-400 dark:text-zinc-500">
                            of {s.totalOwners}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 tabular-nums text-gray-700 sm:px-2 dark:border-zinc-800 dark:text-zinc-300">
                      {s.wins}–{s.losses}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {s.gamesBack === 0 ? '—' : s.gamesBack}
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
