import ViewMoreLink from '@/components/navigation/ViewMoreLink';
import { getLeagues } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';

/**
 * PLATFORM-086F2J — surfaced on `/admin` after existing with no inbound link.
 *
 * Two known limitations, both left as-is and both recorded, because linking a
 * page is not licence to rewrite it:
 *
 * 1. `rolloverNeeded` compares `league.year` against the CALENDAR year, its own
 *    rule rather than the lifecycle authority. Rollover is gated on the CFP
 *    championship plus a seven-day delay, so between January 1 and roughly late
 *    January every league reads "behind" while nothing is wrong. The copy now
 *    says "calendar year" rather than implying the league is late.
 * 2. The demo league is excluded from automatic rollover entirely, so its row
 *    stays red indefinitely.
 *
 * What DID have to change is the instruction. It read "run rollover first",
 * which has been impossible since F2H3A retired manual execution and F2H4
 * deleted the page and route that offered it — surfacing this panel would have
 * made a dead instruction discoverable, which is worse than leaving it hidden.
 */
export default async function DraftSequencingPanel() {
  const leagues = await getLeagues();

  if (leagues.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-zinc-100">
          Draft Initiation Sequencing
        </h2>
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
      <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-zinc-100">
        Draft Initiation Sequencing
      </h2>
      <div className="space-y-4">
        {statuses.map(({ league, rolloverNeeded, hasExistingRoster }) => (
          <div
            key={league.slug}
            className="rounded border border-gray-200 bg-gray-50 p-4 space-y-2 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-gray-900 dark:text-zinc-100">
                  {league.displayName}
                </span>
                <span className="ml-2 font-mono text-xs text-gray-400 dark:text-zinc-500">
                  /{league.slug}
                </span>
              </div>
              <ViewMoreLink href={`/league/${league.slug}/draft/setup`}>Draft setup</ViewMoreLink>
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
                  ? `Active year ${league.year} is behind calendar year ${currentYear}. Rollover is automatic — see System Health for the season-rollover job.`
                  : `Active year ${league.year} matches calendar year`}
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
                <span className="text-gray-500 dark:text-zinc-400">
                  No existing roster for {league.year}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
