import Link from 'next/link';

import { getLeagues } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';

export default async function DraftSequencingPanel() {
  const leagues = await getLeagues();

  if (leagues.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-zinc-100">Draft Initiation Sequencing</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">No leagues configured.</p>
      </section>
    );
  }

  const currentYear = new Date().getUTCFullYear();

  const statuses = await Promise.all(
    leagues.map(async (league) => {
      const rosterRecord = await getAppState(`owners:${league.slug}:${league.year}`, 'csv');
      return {
        league,
        rolloverNeeded: league.year < currentYear,
        hasExistingRoster: rosterRecord !== null,
      };
    })
  );

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-zinc-100">Draft Initiation Sequencing</h2>
      <div className="space-y-4">
        {statuses.map(({ league, rolloverNeeded, hasExistingRoster }) => (
          <div
            key={league.slug}
            className="rounded border border-gray-200 bg-gray-50 p-4 space-y-2 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-gray-900 dark:text-zinc-100">{league.displayName}</span>
                <span className="ml-2 font-mono text-xs text-gray-400 dark:text-zinc-500">/{league.slug}</span>
              </div>
              <Link
                href={`/league/${league.slug}/draft/setup`}
                className="text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Draft setup →
              </Link>
            </div>

            {/* Rollover guard */}
            <div className="flex items-center gap-2 text-sm">
              <span
                className={
                  rolloverNeeded
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-green-600 dark:text-green-400'
                }
              >
                {rolloverNeeded ? '✗' : '✓'} Rollover guard
              </span>
              <span className="text-gray-500 dark:text-zinc-400">
                {rolloverNeeded
                  ? `Active year ${league.year} is behind current year ${currentYear} — run rollover first`
                  : `Active year ${league.year} matches current year`}
              </span>
            </div>

            {/* Active roster guard */}
            {hasExistingRoster ? (
              <div className="rounded border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-300">
                An owner roster already exists for {league.year}. Confirming a new draft will
                overwrite it.
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600 dark:text-green-400">✓ Active roster guard</span>
                <span className="text-gray-500 dark:text-zinc-400">No existing roster for {league.year}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
