import React from 'react';

export type WeekViewMode = 'overview' | 'schedule' | 'matchups' | 'standings' | 'owner';

type WeekViewTabsProps = {
  value: WeekViewMode;
  onChange: (value: WeekViewMode) => void;
};

export default function WeekViewTabs({ value, onChange }: WeekViewTabsProps): React.ReactElement {
  return (
    <div className="grid w-full grid-cols-2 overflow-hidden rounded-xl border border-gray-300 bg-white shadow-sm sm:grid-cols-3 lg:inline-flex lg:w-auto lg:flex-wrap dark:border-zinc-700 dark:bg-zinc-800">
      {(
        [
          { key: 'overview', label: 'Overview' },
          { key: 'schedule', label: 'Schedule' },
          { key: 'matchups', label: 'Matchups' },
          { key: 'standings', label: 'Standings' },
          { key: 'owner', label: 'Teams' },
        ] as const
      ).map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`min-w-0 border-b border-r border-gray-200 px-3 py-2 text-center text-sm font-medium transition last:border-r-0 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r lg:border-b-0 ${
            value === tab.key
              ? 'bg-gray-900 text-white dark:border-zinc-500 dark:bg-zinc-200 dark:text-zinc-900'
              : 'bg-white text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'
          }`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
