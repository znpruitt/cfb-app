'use client';

import React from 'react';
import Link from 'next/link';
import type { OwnerCareerHeadToHead } from '@/lib/selectors/historySelectors';

type Props = {
  ownerName: string;
  headToHead: OwnerCareerHeadToHead[];
  slug: string;
};

export default function AllTimeOwnerHeadToHeadPanel({
  ownerName,
  headToHead,
  slug,
}: Props): React.ReactElement {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggle(opponent: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(opponent)) {
        next.delete(opponent);
      } else {
        next.add(opponent);
      }
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        All-Time Head-to-Head
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-zinc-400">
        {ownerName}&apos;s record against every opponent across all archived seasons.
      </p>

      <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
        {headToHead.map((entry) => {
          const isOpen = expanded.has(entry.opponent);
          const total = entry.wins + entry.losses;
          return (
            <li key={entry.opponent}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-sm hover:bg-gray-50/60 dark:hover:bg-zinc-800/40"
                onClick={() => toggle(entry.opponent)}
                aria-expanded={isOpen}
              >
                <span className="font-semibold text-gray-900 dark:text-zinc-50">
                  <Link
                    href={`/league/${slug}/history/owner/${encodeURIComponent(entry.opponent)}/`}
                    className="hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {entry.opponent}
                  </Link>
                </span>
                <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                  <span className="tabular-nums text-gray-800 dark:text-zinc-100">
                    {entry.wins}–{entry.losses}
                  </span>
                  <span className="text-gray-400 dark:text-zinc-500">
                    {total} game{total !== 1 ? 's' : ''}
                  </span>
                  <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>
              {isOpen && (
                <ul className="mb-2 ml-4 space-y-1">
                  {entry.seasons.map((s) => (
                    <li
                      key={s.year}
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-gray-50 px-3 py-1.5 text-xs dark:bg-zinc-800/60"
                    >
                      <Link
                        href={`/league/${slug}/history/${s.year}/`}
                        className="w-10 shrink-0 font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {s.year}
                      </Link>
                      <span className="tabular-nums text-gray-700 dark:text-zinc-300">
                        {s.wins}–{s.losses}
                      </span>
                      {s.wins > s.losses && (
                        <span className="text-green-700 dark:text-green-400">
                          {ownerName} leads
                        </span>
                      )}
                      {s.losses > s.wins && (
                        <span className="text-red-600 dark:text-red-400">
                          {entry.opponent} leads
                        </span>
                      )}
                      {s.wins === s.losses && (
                        <span className="text-gray-400 dark:text-zinc-500">Even</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
