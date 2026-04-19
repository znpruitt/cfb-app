import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { buildSeasonArchive } from '@/lib/seasonRollover';
import { getAppState } from '@/lib/server/appStateStore';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import {
  selectAllTimeStandings,
  selectChampionshipHistory,
  selectAllTimeHeadToHead,
  selectTopRivalries,
  selectDynastyAndDrought,
  selectMostImprovedSeasonOverSeason,
  type StandingsRow,
} from '@/lib/selectors/historySelectors';
import ChampionshipsBanner from '@/components/history/ChampionshipsBanner';
import AllTimeStandingsTable from '@/components/history/AllTimeStandingsTable';
import AllTimeHeadToHeadPanel from '@/components/history/AllTimeHeadToHeadPanel';
import DynastyDroughtPanel from '@/components/history/DynastyDroughtPanel';
import MostImprovedPanel from '@/components/history/MostImprovedPanel';
import SeasonListPanel from '@/components/history/SeasonListPanel';
import LeaguePageShell from '@/components/LeaguePageShell';
import type { SeasonArchive } from '@/lib/seasonArchive';

export const dynamic = 'force-dynamic';

export default async function LeagueHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const [{ sessionClaims }, league] = await Promise.all([auth(), getLeague(slug)]);
  if (!league) notFound();

  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';

  const years = await listSeasonArchives(slug);

  if (years.length === 0) {
    return (
      <main>
        <LeaguePageShell
          leagueSlug={slug}
          leagueDisplayName={league.displayName}
          leagueYear={league.year}
          foundedYear={league.foundedYear}
          isAdmin={isAdmin}
          activeTab="history"
        >
          <div className="mx-auto max-w-3xl">
            <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
              <p className="text-lg font-semibold text-gray-800 dark:text-zinc-100">
                League history isn&apos;t available yet. Check back next offseason.
              </p>
            </div>
          </div>
        </LeaguePageShell>
      </main>
    );
  }

  // Fetch all archives in parallel
  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  // Attempt to fetch live season standings for active year if not yet archived
  const activeYear = league.year;
  let liveStandings: StandingsRow[] | undefined;
  if (!years.includes(activeYear)) {
    try {
      const liveArchive = await buildSeasonArchive(slug, activeYear);
      liveStandings = liveArchive.finalStandings.map((row, idx) => ({
        rank: idx + 1,
        owner: row.owner,
        wins: row.wins,
        losses: row.losses,
        gamesBack: row.gamesBack,
        pointDifferential: row.pointDifferential,
      }));
    } catch {
      // Live season data unavailable — show only archived data
    }
  }

  // Derive active owners from current season's owners CSV
  const ownersRecord = await getAppState<string>(`owners:${slug}:${activeYear}`, 'csv');
  const ownersCsv = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';
  const activeOwnersList = parseOwnersCsv(ownersCsv)
    .map((r) => r.owner)
    .filter((o) => o !== 'NoClaim');

  const allTimeStandings = selectAllTimeStandings(archives, liveStandings);
  const championshipHistory = selectChampionshipHistory(archives);
  const allTimeH2H = selectAllTimeHeadToHead(archives);
  const topRivalries = selectTopRivalries(archives);
  const dynastyDrought = selectDynastyAndDrought(archives);
  const mostImproved = selectMostImprovedSeasonOverSeason(archives);

  return (
    <main>
      <LeaguePageShell
        leagueSlug={slug}
        leagueDisplayName={league.displayName}
        leagueYear={league.year}
        foundedYear={league.foundedYear}
        isAdmin={isAdmin}
        activeTab="history"
      >
        <div className="mx-auto max-w-5xl">
          <section id="championships" className="scroll-mt-4">
            <ChampionshipsBanner
              history={championshipHistory}
              slug={slug}
              currentSeasonYear={liveStandings !== undefined ? activeYear : undefined}
              currentLeader={liveStandings?.find((r) => r.owner !== 'NoClaim')?.owner}
            />
          </section>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Left column — 60% */}
            <div className="flex flex-col gap-6 lg:col-span-3">
              <AllTimeStandingsTable
                rows={allTimeStandings}
                slug={slug}
                liveSeasonYear={liveStandings !== undefined ? activeYear : undefined}
                activeOwners={activeOwnersList.length > 0 ? activeOwnersList : undefined}
              />
              <SeasonListPanel history={championshipHistory} slug={slug} />
            </div>

            {/* Right column — 40% */}
            <div className="flex flex-col gap-6 lg:col-span-2">
              {topRivalries.length > 0 && (
                <section id="rivalries" className="scroll-mt-4">
                  <AllTimeHeadToHeadPanel
                    rivalries={topRivalries}
                    allH2H={allTimeH2H}
                    slug={slug}
                    activeOwners={activeOwnersList.length > 0 ? activeOwnersList : undefined}
                  />
                </section>
              )}
              {mostImproved.length > 0 && <MostImprovedPanel entries={mostImproved} slug={slug} />}
              {dynastyDrought.rows.length > 0 && (
                <section id="dynasty-drought" className="scroll-mt-4">
                  <DynastyDroughtPanel result={dynastyDrought} slug={slug} />
                </section>
              )}
            </div>
          </div>
        </div>
      </LeaguePageShell>
    </main>
  );
}
