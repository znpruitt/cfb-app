'use client';

import React from 'react';
import Link from 'next/link';
import type { HeadToHeadEntry } from '@/lib/selectors/historySelectors';

type Props = {
  headToHead: HeadToHeadEntry[];
  slug?: string;
};

type ExpandedKey = string; // `${ownerA}::${ownerB}`

function entryKey(entry: HeadToHeadEntry): ExpandedKey {
  return `${entry.ownerA}::${entry.ownerB}`;
}

export default function HeadToHeadPanel({ headToHead, slug }: Props): React.ReactElement {
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

  function ownerLabel(name: string): React.ReactNode {
    if (!slug) {
      return <span className="text-gray-900 dark:text-zinc-50">{name}</span>;
    }
    return (
      <Link
        href={`/league/${slug}/history/owner/${encodeURIComponent(name)}/`}
        className="text-gray-900 hover:text-blue-600 hover:underline dark:text-zinc-50 dark:hover:text-blue-400"
      >
        {name}
      </Link>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
        Head-to-Head Results
      </h2>

      {headToHead.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          No owned-vs-owned matchups found in this season archive.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
          {headToHead.map((entry) => {
            const key = entryKey(entry);
            const isOpen = expanded.has(key);
            return (
              <li key={key}>
                <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="font-semibold text-gray-900 dark:text-zinc-50">
                    {ownerLabel(entry.ownerA)}{' '}
                    <span className="font-normal text-gray-500 dark:text-zinc-500">vs</span>{' '}
                    {ownerLabel(entry.ownerB)}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                    <span className="tabular-nums text-gray-800 dark:text-zinc-100">
                      {entry.wins}–{entry.losses}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen
                          ? `Collapse details for ${entry.ownerA} vs ${entry.ownerB}`
                          : `Expand details for ${entry.ownerA} vs ${entry.ownerB}`
                      }
                      className="rounded px-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
                    >
                      <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    </button>
                  </span>
                </div>
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
