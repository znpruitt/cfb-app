import React from 'react';

import { type CanonicalPollEntry, type RankSource, type RankingsWeek } from '../lib/rankings';

type RankDelta = number | 'new' | null;

function deriveRankDeltas(
  current: CanonicalPollEntry[],
  previous: CanonicalPollEntry[]
): Map<string, RankDelta> {
  const prevByTeam = new Map(previous.map((e) => [e.teamId, e.rank]));
  const deltas = new Map<string, RankDelta>();
  for (const entry of current) {
    const prevRank = prevByTeam.get(entry.teamId);
    if (prevRank == null) {
      deltas.set(entry.teamId, 'new');
    } else {
      deltas.set(entry.teamId, prevRank - entry.rank); // positive = moved up
    }
  }
  return deltas;
}

function MovementBadge({ delta }: { delta: RankDelta }): React.ReactElement {
  if (delta === 'new') {
    return (
      <span className="w-8 text-right text-xs font-medium text-zinc-400 dark:text-zinc-500">
        NR
      </span>
    );
  }
  if (delta === null || delta === 0) {
    return (
      <span className="w-8 text-right text-xs text-zinc-400 dark:text-zinc-600" aria-label="No change">
        —
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span
        className="w-8 text-right text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
        aria-label={`Up ${delta}`}
      >
        ↑{delta}
      </span>
    );
  }
  return (
    <span
      className="w-8 text-right text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400"
      aria-label={`Down ${Math.abs(delta)}`}
    >
      ↓{Math.abs(delta)}
    </span>
  );
}

function PollColumn({
  title,
  entries,
  deltas,
}: {
  title: string;
  entries: CanonicalPollEntry[];
  deltas: Map<string, RankDelta>;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-400">
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="py-3 text-xs text-gray-400 dark:text-zinc-600">Not available</p>
      ) : (
        <ol>
          {entries.map((entry, idx) => {
            const delta = deltas.get(entry.teamId) ?? null;
            return (
              <li
                key={`${entry.rankSource}:${entry.teamId}`}
                className={`flex items-center gap-2 px-1 py-1.5 text-sm ${
                  idx % 2 === 0
                    ? 'bg-transparent'
                    : 'rounded bg-gray-50/60 dark:bg-zinc-800/40'
                }`}
              >
                <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-500 dark:text-zinc-400">
                  {entry.rank}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-zinc-100">
                  {entry.teamName}
                </span>
                <MovementBadge delta={delta} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const POLL_COLUMNS: { key: RankSource; title: string }[] = [
  { key: 'cfp', title: 'CFP Rankings' },
  { key: 'ap', title: 'AP Top 25' },
  { key: 'coaches', title: 'Coaches Poll' },
];

function WeekPollsView({
  week,
  previousWeek,
}: {
  week: RankingsWeek;
  previousWeek: RankingsWeek | null;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {POLL_COLUMNS.map(({ key, title }) => {
          const current = week.polls[key] ?? [];
          const previous = previousWeek?.polls[key] ?? [];
          const deltas = deriveRankDeltas(current, previous);
          return (
            <PollColumn key={key} title={title} entries={current} deltas={deltas} />
          );
        })}
      </div>
    </section>
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

  const resolvedIndex =
    selectedWeekIndex !== null && selectedWeekIndex < weeks.length
      ? selectedWeekIndex
      : weeks.length > 0
        ? weeks.length - 1
        : null;

  const displayWeek = resolvedIndex !== null ? weeks[resolvedIndex] : null;
  const previousWeek =
    resolvedIndex !== null && resolvedIndex > 0 ? (weeks[resolvedIndex - 1] ?? null) : null;

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
                  {week.label ?? `W${week.week}`}
                </button>
              ))}
            </div>
          ) : null}

          {displayWeek ? (
            <WeekPollsView week={displayWeek} previousWeek={previousWeek} />
          ) : null}
        </>
      )}
    </div>
  );
}
