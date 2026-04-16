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

const tabBase = 'pb-2.5 -mb-px text-sm font-medium transition-colors whitespace-nowrap border-b-2';
const tabActive = `${tabBase} border-gray-900 text-gray-900 dark:border-white dark:text-white`;
const tabInactive = `${tabBase} border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200`;

export default function WeekViewTabs({
  value,
  onChange,
  leagueSlug,
}: WeekViewTabsProps): React.ReactElement {
  const current = canonicalTab(value);

  return (
    <div
      style={
        {
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-6 border-b border-gray-200 dark:border-zinc-700">
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
          <>
            <div
              className="self-center bg-gray-300 dark:bg-zinc-600"
              style={{ width: '0.5px', height: 16 }}
              aria-hidden="true"
            />
            <Link href={`/league/${leagueSlug}/history/`} className={tabInactive}>
              History
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
