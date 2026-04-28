'use client';

import React from 'react';
import Link from 'next/link';
import type { AllTimeHeadToHeadEntry } from '@/lib/selectors/historySelectors';
import FormerOwnerBadge from './FormerOwnerBadge';

type Props = {
  /** Top rivalries to display prominently. */
  rivalries: AllTimeHeadToHeadEntry[];
  /** Full all-time H2H list for the expandable matrix. */
  allH2H: AllTimeHeadToHeadEntry[];
  slug: string;
  /** Active owner names — former owners are shown with muted styling. */
  activeOwners?: string[];
};

function recordLabel(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return '—';
  return `${wins}–${losses}`;
}

export default function AllTimeHeadToHeadPanel({
  rivalries,
  allH2H,
  slug,
  activeOwners,
}: Props): React.ReactElement {
  const [showAll, setShowAll] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const activeSet = activeOwners ? new Set(activeOwners) : null;

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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">
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
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          No cross-season head-to-head data available.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
          {displayList.map((entry) => {
            const key = `${entry.ownerA}::${entry.ownerB}`;
            const isOpen = expanded.has(key);
            const total = entry.wins + entry.losses;
            const aIsFormer = activeSet !== null && !activeSet.has(entry.ownerA);
            const bIsFormer = activeSet !== null && !activeSet.has(entry.ownerB);
            return (
              <li key={key}>
                <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="font-semibold text-gray-900 dark:text-zinc-50">
                    <Link
                      href={`/league/${slug}/history/owner/${encodeURIComponent(entry.ownerA)}/`}
                      className={`hover:text-blue-600 hover:underline dark:hover:text-blue-400 ${aIsFormer ? 'text-gray-400 dark:text-zinc-500' : ''}`}
                    >
                      {entry.ownerA}
                    </Link>
                    {aIsFormer && <FormerOwnerBadge className="ml-1" />}
                    <span className="font-normal text-gray-500 dark:text-zinc-500"> vs </span>
                    <Link
                      href={`/league/${slug}/history/owner/${encodeURIComponent(entry.ownerB)}/`}
                      className={`hover:text-blue-600 hover:underline dark:hover:text-blue-400 ${bIsFormer ? 'text-gray-400 dark:text-zinc-500' : ''}`}
                    >
                      {entry.ownerB}
                    </Link>
                    {bIsFormer && <FormerOwnerBadge className="ml-1" />}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                    <span className="tabular-nums text-gray-800 dark:text-zinc-100">
                      {recordLabel(entry.wins, entry.losses)}
                    </span>
                    <span className="text-gray-400 dark:text-zinc-500">
                      {total} game{total !== 1 ? 's' : ''} · {entry.seasons} season
                      {entry.seasons !== 1 ? 's' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleEntry(key)}
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
                {isOpen && (
                  <div className="mb-2 ml-4 space-y-1">
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                      All-time:{' '}
                      {entry.wins === entry.losses ? (
                        <>Series tied {recordLabel(entry.wins, entry.losses)}</>
                      ) : (
                        <>
                          <Link
                            href={`/league/${slug}/history/owner/${encodeURIComponent(entry.wins > entry.losses ? entry.ownerA : entry.ownerB)}/`}
                            className="font-medium text-gray-700 hover:underline dark:text-zinc-300"
                          >
                            {entry.wins > entry.losses ? entry.ownerA : entry.ownerB}
                          </Link>{' '}
                          leads{' '}
                          {entry.wins > entry.losses
                            ? recordLabel(entry.wins, entry.losses)
                            : recordLabel(entry.losses, entry.wins)}
                        </>
                      )}
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
