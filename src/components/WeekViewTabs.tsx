import React from 'react';
import Link from 'next/link';

export type WeekViewMode =
  | 'overview'
  | 'schedule'
  | 'matchups'
  | 'matrix'
  | 'standings'
  | 'owner'
  | 'rankings';

type WeekViewTabsProps = {
  value: WeekViewMode;
  onChange: (value: WeekViewMode) => void;
  leagueSlug?: string;
};

/**
 * Map secondary modes to the canonical top-level tab they live under.
 * Schedule and Matrix are sub-views of Matchups.
 * Rankings is a sub-view of Standings.
 */
function canonicalTab(mode: WeekViewMode): 'overview' | 'matchups' | 'standings' | 'owner' {
  if (mode === 'schedule' || mode === 'matrix') return 'matchups';
  if (mode === 'rankings') return 'standings';
  if (mode === 'standings') return 'standings';
  if (mode === 'matchups') return 'matchups';
  if (mode === 'owner') return 'owner';
  return 'overview';
}

const tabBase = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap';
const tabActive = `${tabBase} bg-white shadow-sm text-gray-900 dark:bg-zinc-600 dark:text-zinc-100`;
const tabInactive = `${tabBase} text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100`;

export default function WeekViewTabs({
  value,
  onChange,
  leagueSlug,
}: WeekViewTabsProps): React.ReactElement {
  const current = canonicalTab(value);

  return (
    <div style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
    <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-700">
      {(
        [
          { key: 'overview', label: 'Overview' },
          { key: 'standings', label: 'Standings' },
          { key: 'matchups', label: 'Matchups' },
          { key: 'owner', label: 'Members' },
        ] as const
      ).map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={current === tab.key ? tabActive : tabInactive}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
      {leagueSlug && (
        <Link href={`/league/${leagueSlug}/history/`} className={tabInactive}>
          History
        </Link>
      )}
    </div>
    </div>
  );
}
