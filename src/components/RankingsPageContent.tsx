import React from 'react';

import { rankSourceLabel, type CanonicalPollEntry, type RankingsWeek } from '../lib/rankings';
import RankedTeamName from './RankedTeamName';

function PollSection({
  title,
  entries,
}: {
  title: string;
  entries: CanonicalPollEntry[];
}): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
        {title}
      </h2>
      <ol className="mt-4 space-y-2">
        {entries.map((entry) => (
          <li
            key={`${entry.rankSource}:${entry.teamId}`}
            className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm text-gray-800 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-100"
          >
            <RankedTeamName
              teamName={entry.teamName}
              ranking={{ rank: entry.rank, rankSource: entry.rankSource }}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function WeekPollsView({ week }: { week: RankingsWeek }): React.ReactElement {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-gray-600 dark:text-zinc-300">
          {week.seasonType} · Week {week.week} · Primary inline source:{' '}
          {week.primarySource ? rankSourceLabel(week.primarySource) : 'Unavailable'}
        </p>
      </section>
      <PollSection title="CFP Rankings" entries={week.polls.cfp} />
      <PollSection title="AP Top 25" entries={week.polls.ap} />
      <PollSection title="Coaches Poll" entries={week.polls.coaches} />
    </div>
  );
}

type RankingsPageContentProps = {
  latestWeek: RankingsWeek | null;
  allWeeks?: RankingsWeek[];
  loading: boolean;
  error: string | null;
  season: number;
  leagueSlug?: string;
};

export default function RankingsPageContent({
  latestWeek,
  allWeeks = [],
  loading,
  error,
  season,
}: RankingsPageContentProps): React.ReactElement {
  const weeks = allWeeks.length > 0 ? allWeeks : latestWeek ? [latestWeek] : [];
  const [selectedWeekIndex, setSelectedWeekIndex] = React.useState<number | null>(null);

  // Default to the latest week when data loads
  const resolvedIndex =
    selectedWeekIndex !== null && selectedWeekIndex < weeks.length
      ? selectedWeekIndex
      : weeks.length > 0
        ? weeks.length - 1
        : null;

  const displayWeek = resolvedIndex !== null ? weeks[resolvedIndex] : null;

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {season} Rankings
        </h2>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-zinc-400">
          AP Top 25 · Coaches Poll · CFP
        </p>
      </header>

      {loading ? (
        <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
          Loading rankings…
        </section>
      ) : error ? (
        <section className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          Rankings could not be loaded: {error}
        </section>
      ) : weeks.length === 0 ? (
        <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
          No rankings are available yet for the {season} season.
        </section>
      ) : (
        <>
          {weeks.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Select rankings week">
              {weeks.map((week, index) => (
                <button
                  key={`${week.seasonType}-${week.week}`}
                  type="button"
                  onClick={() => setSelectedWeekIndex(index)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    index === resolvedIndex
                      ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300'
                  }`}
                  aria-pressed={index === resolvedIndex}
                >
                  W{week.week}
                </button>
              ))}
            </div>
          ) : null}

          {displayWeek ? <WeekPollsView week={displayWeek} /> : null}
        </>
      )}
    </div>
  );
}
