import React from 'react';

import type { OwnerStandingsRow } from '../lib/standings';

type StandingsPanelProps = {
  rows: OwnerStandingsRow[];
  season: number;
};

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatGamesBack(value: number): string {
  return value === 0 ? '—' : String(value);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default function StandingsPanel({ rows, season }: StandingsPanelProps): React.ReactElement {
  return (
    <section className="space-y-4 rounded border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {season} Standings
        </h2>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          Upload owners to populate league standings.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
                {['Rank', 'Owner', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB'].map((label) => (
                  <th
                    key={label}
                    className="border-b border-gray-200 px-3 py-2 font-semibold dark:border-zinc-700"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.owner}
                  className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                >
                  <td className="border-b border-gray-100 px-3 py-2 text-base font-semibold tabular-nums text-gray-900 dark:border-zinc-800 dark:text-zinc-100">
                    {index + 1}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 text-[0.95rem] font-semibold text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                    {row.owner}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 font-semibold tabular-nums text-gray-900 dark:border-zinc-800 dark:text-zinc-100">
                    {row.wins}–{row.losses}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 tabular-nums text-gray-600 dark:border-zinc-800 dark:text-zinc-300">
                    {formatWinPct(row.winPct)}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 tabular-nums text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                    {row.pointsFor}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 tabular-nums text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                    {row.pointsAgainst}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 tabular-nums text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                    {formatDiff(row.pointDifferential)}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2 tabular-nums text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                    {formatGamesBack(row.gamesBack)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
