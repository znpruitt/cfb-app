import React from 'react';

import type { OwnerMatchupMatrix } from '../lib/overview';

export default function MatchupMatrixView({
  matrix,
}: {
  matrix: OwnerMatchupMatrix;
}): React.ReactElement {
  if (matrix.owners.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-gray-50/80 p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
        <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          Matchup matrix
        </h2>
        <p className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
          No matrix data yet. Upload owner assignments and games to populate owner-vs-owner counts.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Matchup matrix
      </h2>
      <p className="mt-1.5 text-xs text-gray-500 dark:text-zinc-400">
        Full owner-vs-owner game counts and records from the canonical schedule-derived slate.
      </p>

      <div className="mt-3 -mx-1 overflow-x-auto px-1">
        <table className="min-w-max border-separate border-spacing-0 text-center text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
              <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-200 bg-white px-2 py-1.5 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">
                Owner
              </th>
              {matrix.owners.map((owner) => (
                <th
                  key={owner}
                  className="w-14 whitespace-nowrap border-b border-gray-200 px-2 py-1.5 font-semibold dark:border-zinc-700"
                >
                  {owner}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr
                key={row.owner}
                className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
              >
                <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-100 bg-inherit px-2 py-1.5 text-left font-semibold leading-tight text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                  {row.owner}
                </th>
                {row.cells.map((cell) => {
                  const isDiagonal = cell.owner === row.owner;
                  const hasGames = cell.gameCount > 0;

                  return (
                    <td
                      key={`${row.owner}-${cell.owner}`}
                      className={`w-14 border-b border-gray-100 px-2 py-1.5 align-middle leading-tight dark:border-zinc-800 ${
                        isDiagonal
                          ? 'bg-gray-100/80 dark:bg-zinc-800/70'
                          : hasGames
                            ? 'bg-blue-50/70 font-semibold text-gray-900 dark:bg-blue-950/20 dark:text-zinc-100'
                            : 'text-gray-400 dark:text-zinc-600'
                      }`}
                    >
                      {hasGames ? (
                        <div className="flex flex-col items-center leading-tight">
                          <span>{cell.gameCount}</span>
                          {cell.record ? (
                            <span className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">
                              {cell.record}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span>{isDiagonal ? '—' : ''}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
