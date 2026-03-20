import React from 'react';

export type WeekViewMode = 'overview' | 'schedule' | 'matchups' | 'standings' | 'owner';

type WeekViewTabsProps = {
  value: WeekViewMode;
  onChange: (value: WeekViewMode) => void;
};

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'matchups', label: 'Matchups' },
  { key: 'standings', label: 'Standings' },
  { key: 'owner', label: 'Owner' },
] as const;

export default function WeekViewTabs({ value, onChange }: WeekViewTabsProps): React.ReactElement {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:inline-flex lg:w-auto lg:flex-wrap lg:gap-0 lg:rounded lg:border lg:border-gray-300 lg:bg-white dark:lg:border-zinc-700 dark:lg:bg-zinc-800">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`rounded border px-3 py-2 text-sm font-medium transition-colors lg:rounded-none lg:border-0 lg:px-3 lg:py-1.5 ${
            value === tab.key
              ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
              : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 lg:bg-transparent'
          }`}
          aria-pressed={value === tab.key}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
