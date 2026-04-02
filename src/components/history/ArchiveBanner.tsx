import React from 'react';

type Props = {
  year: number;
};

export default function ArchiveBanner({ year }: Props): React.ReactElement {
  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40"
      role="status"
      aria-label={`Archived ${year} Season`}
    >
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
        Archived — {year} Season
      </p>
      <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
        This is a historical record. Live season data is on the main league page.
      </p>
    </div>
  );
}
