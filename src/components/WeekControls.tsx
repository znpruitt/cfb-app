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
  isSeasonViewActive?: boolean;
  activeViewLabel?: string;
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
  isSeasonViewActive = false,
  activeViewLabel = 'Overview',
}: WeekControlsProps): React.ReactElement {
  return (
    <section
      className={`space-y-3 rounded border px-4 py-3 ${
        isSeasonViewActive
          ? 'border-gray-200 bg-gray-50/80 dark:border-zinc-800 dark:bg-zinc-900/70'
          : 'border-gray-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
            Week context
          </p>
          <div className="text-sm text-gray-700 dark:text-zinc-200">
            Browse weeks, postseason, and team filters.
          </div>
          {isSeasonViewActive ? (
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Supporting context while <span className="font-semibold">{activeViewLabel}</span> is
              active.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-600 dark:text-zinc-300">Conference</label>
          <select
            value={selectedConference}
            onChange={(e) => onSelectedConferenceChange(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {conferences.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <input
            placeholder="Filter by team"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            value={teamFilter}
            onChange={(e) => onTeamFilterChange(e.target.value)}
          />
        </div>
      </div>

      <div
        className={`flex flex-wrap gap-2 transition-opacity ${
          isSeasonViewActive ? 'opacity-75' : 'opacity-100'
        }`}
      >
        {weeks.map((w) => {
          const dateLabel = weekDateLabels?.get(w) ?? '';

          return (
            <button
              key={w}
              className={`flex min-w-20 flex-col rounded border px-3 py-1 text-left transition-colors ${
                selectedTab === w
                  ? isSeasonViewActive
                    ? 'border-gray-400 bg-gray-100 text-gray-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    : 'border-gray-900 bg-gray-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
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
            className={`rounded border px-3 py-1 transition-colors ${
              selectedTab === 'postseason'
                ? isSeasonViewActive
                  ? 'border-gray-400 bg-gray-100 text-gray-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  : 'border-gray-900 bg-gray-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
                : 'border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
            }`}
            onClick={onSelectPostseason}
          >
            Postseason
          </button>
        )}
      </div>
    </section>
  );
}
