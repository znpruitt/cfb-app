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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl space-y-1">
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

        <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[28rem]">
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
            <span>Conference</span>
            <select
              value={selectedConference}
              onChange={(e) => onSelectedConferenceChange(e.target.value)}
              className="min-w-0 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-gray-700 dark:text-zinc-300">
            <span>Team filter</span>
            <input
              placeholder="Search team"
              className="min-w-0 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              value={teamFilter}
              onChange={(e) => onTeamFilterChange(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className={`overflow-x-auto pb-1 ${isSeasonViewActive ? 'opacity-75' : 'opacity-100'}`}>
        <div className="flex min-w-max flex-nowrap gap-2 sm:flex-wrap sm:min-w-0">
          {weeks.map((w) => {
            const dateLabel = weekDateLabels?.get(w) ?? '';

            return (
              <button
                key={w}
                className={`flex min-w-[5.75rem] shrink-0 flex-col rounded border px-3 py-2 text-left transition-colors sm:min-w-[6.5rem] sm:shrink ${
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
              className={`min-w-[6.5rem] shrink-0 rounded border px-3 py-2 text-left transition-colors sm:shrink ${
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
      </div>
    </section>
  );
}
