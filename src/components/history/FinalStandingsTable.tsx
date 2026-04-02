import React from 'react';
import type { StandingsRow } from '@/lib/selectors/historySelectors';

type Props = {
  rows: StandingsRow[];
  year: number;
};

function formatGamesBack(value: number): string {
  return value === 0 ? '\u2014' : String(value);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default function FinalStandingsTable({ rows, year }: Props): React.ReactElement {
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        {year} Final Standings
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No standings data available.</p>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden dark:from-zinc-900" />
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-gray-500 dark:text-zinc-500">
                  {(['Rank', 'Owner', 'Record', 'GB', 'Diff'] as const).map((label) => {
                    const isNumeric = label === 'GB' || label === 'Diff';
                    const isRank = label === 'Rank';
                    return (
                      <th
                        key={label}
                        className={`whitespace-nowrap border-b border-gray-200 px-1.5 py-2 font-semibold sm:px-2 dark:border-zinc-700 ${
                          isRank ? 'w-[2.8rem]' : ''
                        } ${isNumeric ? 'w-[4.2rem] text-right text-xs text-gray-400 dark:text-zinc-500' : ''}`}
                      >
                        {label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.owner}
                    className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                  >
                    <td className="w-[2.8rem] border-b border-gray-100 px-1.5 py-2 text-base font-semibold tabular-nums text-gray-900 sm:px-2 dark:border-zinc-800 dark:text-zinc-100">
                      {row.rank}
                    </td>
                    <td className="min-w-[9.5rem] border-b border-gray-100 px-1.5 py-2 text-[0.95rem] font-semibold text-gray-950 sm:px-2 dark:border-zinc-800 dark:text-zinc-50">
                      {row.owner}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-1.5 py-2 font-semibold tabular-nums text-gray-900 sm:px-2 dark:border-zinc-800 dark:text-zinc-100">
                      {row.wins}–{row.losses}
                    </td>
                    <td className="w-[4.2rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {formatGamesBack(row.gamesBack)}
                    </td>
                    <td className="w-[4.2rem] whitespace-nowrap border-b border-gray-100 px-1.5 py-2 text-right tabular-nums text-gray-500 sm:px-2 dark:border-zinc-800 dark:text-zinc-400">
                      {formatDiff(row.pointDifferential)}
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
