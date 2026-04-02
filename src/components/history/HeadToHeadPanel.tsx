'use client';

import React from 'react';
import type { HeadToHeadEntry } from '@/lib/selectors/historySelectors';

type Props = {
  headToHead: HeadToHeadEntry[];
};

type ExpandedKey = string; // `${ownerA}::${ownerB}`

function entryKey(entry: HeadToHeadEntry): ExpandedKey {
  return `${entry.ownerA}::${entry.ownerB}`;
}

function RecordLabel({ wins, losses }: { wins: number; losses: number }): React.ReactElement {
  return (
    <span className="tabular-nums text-gray-800 dark:text-zinc-100">
      {wins}–{losses}
    </span>
  );
}

export default function HeadToHeadPanel({ headToHead }: Props): React.ReactElement {
  const [expanded, setExpanded] = React.useState<Set<ExpandedKey>>(new Set());

  function toggle(key: ExpandedKey): void {
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

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        Head-to-Head Results
      </h2>

      {headToHead.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-4 py-6 text-center dark:border-zinc-700 dark:bg-zinc-800/40">
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Owner vs. owner matchup data is not available for archived seasons.
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
            Individual game pairings are not stored in the season archive.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
          {headToHead.map((entry) => {
            const key = entryKey(entry);
            const isOpen = expanded.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-sm hover:bg-gray-50/60 dark:hover:bg-zinc-800/40"
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                >
                  <span className="font-semibold text-gray-900 dark:text-zinc-50">
                    {entry.ownerA} vs {entry.ownerB}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                    <RecordLabel wins={entry.wins} losses={entry.losses} />
                    <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {isOpen && entry.matchups.length > 0 ? (
                  <ul className="mb-2 ml-4 space-y-1">
                    {entry.matchups.map((m) => (
                      <li
                        key={m.week}
                        className="flex items-center gap-3 rounded bg-gray-50 px-3 py-1.5 text-xs dark:bg-zinc-800/60"
                      >
                        <span className="w-12 text-gray-400 dark:text-zinc-500">
                          Week {m.week}
                        </span>
                        <span className="tabular-nums text-gray-700 dark:text-zinc-300">
                          {m.ownerAScore}–{m.ownerBScore}
                        </span>
                        <span className="font-semibold text-gray-900 dark:text-zinc-50">
                          {m.winner} wins
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : isOpen ? (
                  <p className="mb-2 ml-4 text-xs text-gray-400 dark:text-zinc-500">
                    No matchup details available.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
