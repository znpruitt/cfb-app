import React from 'react';
import type { OwnerRosterEntry } from '@/lib/selectors/historySelectors';

type Props = {
  roster: OwnerRosterEntry[];
  year: number;
};

export default function OwnerRosterCard({ roster, year }: Props): React.ReactElement {
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-1 text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        {year} Owner Roster
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-zinc-400">
        Teams assigned to each owner as of season archive. Reflects the roster at time of archival.
      </p>
      {roster.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No roster data available.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {roster.map((entry) => (
            <div
              key={`${entry.ownerName}::${entry.teamName}`}
              className="flex items-baseline justify-between gap-2 border-b border-gray-100 py-1 last:border-b-0 dark:border-zinc-800"
            >
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-zinc-50">
                {entry.ownerName}
              </span>
              <span className="shrink-0 text-sm text-gray-500 dark:text-zinc-400">
                {entry.teamName}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
