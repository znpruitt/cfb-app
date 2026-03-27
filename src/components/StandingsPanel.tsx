import React from 'react';

import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';

type StandingsPanelProps = {
  rows: OwnerStandingsRow[];
  season: number;
  coverage: StandingsCoverage;
  onOwnerSelect?: (owner: string) => void;
  focusedOwner?: string | null;
};

type FocusableElement = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

export function scrollFocusedStandingsOwnerIntoView(params: {
  focusedOwner: string | null;
  refsByOwner: Map<string, FocusableElement>;
}): boolean {
  const { focusedOwner, refsByOwner } = params;
  if (!focusedOwner) return false;
  const row = refsByOwner.get(focusedOwner);
  if (!row) return false;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatGamesBack(value: number): string {
  return value === 0 ? '—' : String(value);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default function StandingsPanel({
  rows,
  season,
  coverage,
  onOwnerSelect,
  focusedOwner = null,
}: StandingsPanelProps): React.ReactElement {
  const ownerRowRefs = React.useRef<Map<string, HTMLTableRowElement>>(new Map());

  React.useEffect(() => {
    scrollFocusedStandingsOwnerIntoView({
      focusedOwner,
      refsByOwner: ownerRowRefs.current,
    });
  }, [focusedOwner]);

  return (
    <section className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {season} Standings
        </h2>
        {coverage.message ? (
          <p
            className={`text-sm ${
              coverage.state === 'error'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-gray-600 dark:text-zinc-300'
            }`}
          >
            {coverage.message}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          Upload surnames to populate league standings.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-zinc-400">
            <span>Swipe/scroll for full standings detail on small screens.</span>
            <span className="hidden sm:inline">
              PF, PA, Diff, and GB stay available without changing standings logic.
            </span>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
                  {['Rank', 'Team', 'Record', 'Win %', 'PF', 'PA', 'Diff', 'GB'].map((label) => (
                    <th
                      key={label}
                      className={`whitespace-nowrap border-b border-gray-200 px-2 py-2 font-semibold sm:px-3 dark:border-zinc-700 ${label === 'PF' || label === 'PA' || label === 'Diff' || label === 'GB' ? 'text-[11px] sm:text-xs text-gray-400 dark:text-zinc-500' : ''}`}
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
                    ref={(element) => {
                      if (!element) {
                        ownerRowRefs.current.delete(row.owner);
                        return;
                      }
                      ownerRowRefs.current.set(row.owner, element);
                    }}
                    className={`odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900 ${
                      focusedOwner === row.owner
                        ? 'ring-1 ring-inset ring-blue-400 dark:ring-blue-600'
                        : ''
                    }`}
                    data-standings-owner={row.owner}
                  >
                    <td className="border-b border-gray-100 px-2 py-2 text-base font-semibold tabular-nums text-gray-900 sm:px-3 dark:border-zinc-800 dark:text-zinc-100">
                      {index + 1}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-2 text-[0.95rem] font-semibold text-gray-950 sm:px-3 dark:border-zinc-800 dark:text-zinc-50">
                      <div className="min-w-[8.5rem] truncate sm:min-w-0">
                        {onOwnerSelect ? (
                          <button
                            type="button"
                            className="text-left underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
                            onClick={() => onOwnerSelect(row.owner)}
                          >
                            {row.owner}
                          </button>
                        ) : (
                          row.owner
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 font-semibold tabular-nums text-gray-900 sm:px-3 dark:border-zinc-800 dark:text-zinc-100">
                      {row.wins}–{row.losses}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-600 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                      {formatWinPct(row.winPct)}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                      {row.pointsFor}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                      {row.pointsAgainst}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                      {formatDiff(row.pointDifferential)}
                    </td>
                    <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                      {formatGamesBack(row.gamesBack)}
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
