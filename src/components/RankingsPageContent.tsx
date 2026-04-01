import Link from 'next/link';
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

type RankingsPageContentProps = {
  latestWeek: RankingsWeek | null;
  loading: boolean;
  error: string | null;
  season: number;
  leagueSlug?: string;
};

export default function RankingsPageContent({
  latestWeek,
  loading,
  error,
  season,
  leagueSlug,
}: RankingsPageContentProps): React.ReactElement {
  return (
    <main className="space-y-6 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
            Rankings
          </span>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">National rankings</h1>
            <p className="max-w-3xl text-sm text-gray-600 dark:text-zinc-400">
              Weekly rankings use the same canonical team identities and poll precedence as inline
              team labels across the app.
            </p>
          </div>
        </div>
        <Link
          href={leagueSlug ? `/league/${leagueSlug}` : '/'}
          className="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Back to dashboard
        </Link>
      </header>

      {loading ? (
        <section className="rounded-xl border border-gray-300 bg-white p-4 text-sm text-gray-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          Loading rankings…
        </section>
      ) : error ? (
        <section className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800 shadow-sm dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          Rankings could not be loaded: {error}
        </section>
      ) : latestWeek ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm text-gray-600 dark:text-zinc-300">
              Showing {latestWeek.seasonType} week {latestWeek.week}. Primary inline source:{' '}
              {latestWeek.primarySource ? rankSourceLabel(latestWeek.primarySource) : 'Unavailable'}
              .
            </p>
          </section>
          <PollSection title="CFP rankings" entries={latestWeek.polls.cfp} />
          <PollSection title="AP Top 25" entries={latestWeek.polls.ap} />
          <PollSection title="Coaches Poll" entries={latestWeek.polls.coaches} />
        </div>
      ) : (
        <section className="rounded-xl border border-gray-300 bg-white p-4 text-sm text-gray-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          No rankings are available yet for the {season} season.
        </section>
      )}
    </main>
  );
}
