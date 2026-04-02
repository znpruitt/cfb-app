'use client';

import React from 'react';
import type { AllTimeHeadToHeadEntry } from '@/lib/selectors/historySelectors';

type Props = {
  /** Top rivalries to display prominently. */
  rivalries: AllTimeHeadToHeadEntry[];
  /** Full all-time H2H list for the expandable matrix. */
  allH2H: AllTimeHeadToHeadEntry[];
  slug: string;
};

function recordLabel(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return '—';
  return `${wins}–${losses}`;
}

export default function AllTimeHeadToHeadPanel({ rivalries, allH2H }: Props): React.ReactElement {
  const [showAll, setShowAll] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggleEntry(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const displayList = showAll ? allH2H : rivalries;

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {showAll ? 'All-Time Head-to-Head' : 'Top Rivalries'}
        </h2>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          {showAll ? 'Show top rivalries' : 'Show all matchups'}
        </button>
      </div>

      {displayList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-4 py-6 text-center dark:border-zinc-700 dark:bg-zinc-800/40">
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            No cross-season head-to-head data available.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
          {displayList.map((entry) => {
            const key = `${entry.ownerA}::${entry.ownerB}`;
            const isOpen = expanded.has(key);
            const total = entry.wins + entry.losses;
            return (
              <li key={key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-sm hover:bg-gray-50/60 dark:hover:bg-zinc-800/40"
                  onClick={() => toggleEntry(key)}
                  aria-expanded={isOpen}
                >
                  <span className="font-semibold text-gray-900 dark:text-zinc-50">
                    {entry.ownerA} vs {entry.ownerB}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                    <span className="tabular-nums text-gray-800 dark:text-zinc-100">
                      {recordLabel(entry.wins, entry.losses)}
                    </span>
                    <span className="text-gray-400 dark:text-zinc-500">
                      {total} game{total !== 1 ? 's' : ''} · {entry.seasons} season
                      {entry.seasons !== 1 ? 's' : ''}
                    </span>
                    <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="mb-2 ml-4 space-y-1">
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                      All-time: {entry.ownerA} leads {recordLabel(entry.wins, entry.losses)}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
