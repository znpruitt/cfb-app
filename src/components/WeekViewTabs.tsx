import React from 'react';

export type WeekViewMode = 'schedule' | 'matchups';

type WeekViewTabsProps = {
  value: WeekViewMode;
  onChange: (value: WeekViewMode) => void;
};

export default function WeekViewTabs({ value, onChange }: WeekViewTabsProps): React.ReactElement {
  return (
    <div className="inline-flex rounded border border-gray-300 bg-white dark:border-zinc-700 dark:bg-zinc-800">
      {(
        [
          { key: 'schedule', label: 'Schedule' },
          { key: 'matchups', label: 'Matchups' },
        ] as const
      ).map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`px-3 py-1.5 text-sm font-medium ${
            value === tab.key
              ? 'bg-gray-900 text-white dark:bg-zinc-200 dark:text-zinc-900'
              : 'text-gray-900 dark:text-zinc-100'
          }`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
