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
            No owned-vs-owned matchups found in this season archive.
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
                    <span className="tabular-nums text-gray-800 dark:text-zinc-100">
                      {entry.wins}–{entry.losses}
                    </span>
                    <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {isOpen ? (
                  <ul className="mb-2 ml-4 space-y-1">
                    {entry.matchups.map((m) => (
                      <li
                        key={`${m.week}::${m.gameDescription}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-gray-50 px-3 py-1.5 text-xs dark:bg-zinc-800/60"
                      >
                        <span className="w-12 shrink-0 text-gray-400 dark:text-zinc-500">
                          Wk {m.week}
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-700 dark:text-zinc-300">
                          {m.ownerAScore}–{m.ownerBScore}
                        </span>
                        <span className="font-semibold text-gray-900 dark:text-zinc-50">
                          {m.winner} wins
                        </span>
                        <span className="text-gray-400 dark:text-zinc-500">
                          {m.gameDescription}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
