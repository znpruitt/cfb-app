import React from 'react';

type WeekControlsProps = {
  weeks: number[];
  weekDateLabels?: Map<number, string>;
  selectedTab: number | 'postseason' | null;
  hasPostseason: boolean;
  selectedConference: string;
  conferences: string[];
  teamFilter: string;
  onSelectWeek: (week: number) => void;
  onSelectPostseason: () => void;
  onSelectedConferenceChange: (conference: string) => void;
  onTeamFilterChange: (value: string) => void;
};

export default function WeekControls({
  weeks,
  selectedTab,
  weekDateLabels,
  hasPostseason,
  selectedConference,
  conferences,
  teamFilter,
  onSelectWeek,
  onSelectPostseason,
  onSelectedConferenceChange,
  onTeamFilterChange,
}: WeekControlsProps): React.ReactElement {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">Conference:</label>
        <select
          value={selectedConference}
          onChange={(e) => onSelectedConferenceChange(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {conferences.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <input
          placeholder="Filter by team"
          className="border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          value={teamFilter}
          onChange={(e) => onTeamFilterChange(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {weeks.map((w) => {
          const dateLabel = weekDateLabels?.get(w) ?? '';

          return (
            <button
              key={w}
              className={`flex min-w-20 flex-col rounded border px-3 py-1 text-left ${
                selectedTab === w
                  ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
                  : 'border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
              }`}
              onClick={() => onSelectWeek(w)}
            >
              <span className="font-medium">Week {w}</span>
              {dateLabel && (
                <span className="text-xs opacity-80" data-week-date-label={w}>
                  {dateLabel}
                </span>
              )}
            </button>
          );
        })}

        {hasPostseason && (
          <button
            className={`px-3 py-1 rounded border ${
              selectedTab === 'postseason'
                ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
                : 'border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
            }`}
            onClick={onSelectPostseason}
          >
            Postseason
          </button>
        )}
      </div>
    </>
  );
}
