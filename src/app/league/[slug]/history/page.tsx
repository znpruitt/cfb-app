import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { getAppState } from '@/lib/server/appStateStore';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import {
  selectAllTimeStandings,
  selectChampionshipHistory,
  selectDynastyAndDrought,
  selectMostImprovedSeasonOverSeason,
  selectTopRivalries,
} from '@/lib/selectors/historySelectors';
import { selectAllRecords } from '@/lib/selectors/leagueRecords';
import {
  computeChampionshipSummary,
  groupChampionsByOwner,
  selectMarqueeRecords,
  selectMovers,
  selectRecentPodiums,
  selectSeasonArchiveStrip,
  selectTitleStreaks,
} from '@/lib/selectors/historyOverview';
import { HistorySubNav } from '@/components/history/HistorySubNav';
import LeaguePageShell from '@/components/LeaguePageShell';
import ChampionshipsSection from '@/components/history/overview/ChampionshipsSection';
import AllTimeStandingsSummary from '@/components/history/overview/AllTimeStandingsSummary';
import RecentPodiumsColumn from '@/components/history/overview/RecentPodiumsColumn';
import RecordsColumn from '@/components/history/overview/RecordsColumn';
import TopRivalriesList from '@/components/history/overview/TopRivalriesList';
import TitleStreaksTable from '@/components/history/overview/TitleStreaksTable';
import MoversSection from '@/components/history/overview/MoversSection';
import SeasonArchiveStrip from '@/components/history/overview/SeasonArchiveStrip';
import type { SeasonArchive } from '@/lib/seasonArchive';
import { renderLeagueGateIfBlocked } from '../leagueGate';

export const dynamic = 'force-dynamic';

export default async function LeagueHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;

  const [isAdmin, league] = await Promise.all([isPlatformAdminSession(), getLeague(slug)]);
  if (!league) notFound();

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
          <HistorySubNav slug={slug} />
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

  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  const activeYear = league.year;

  const ownersRecord = await getAppState<string>(`owners:${slug}:${activeYear}`, 'csv');
  const ownersCsv = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';
  const currentRosterRows = parseOwnersCsv(ownersCsv);
  const currentRoster = new Map(currentRosterRows.map((r) => [r.team, r.owner]));
  const activeOwners = new Set(currentRoster.values());

  const historicalRosters: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
    historicalRosters[archive.year] = new Map(rows.map((r) => [r.team, r.owner]));
  }

  const championshipHistory = selectChampionshipHistory(archives);
  const championOwnerRows = groupChampionsByOwner(championshipHistory);
  const allTimeStandings = selectAllTimeStandings(archives);
  const championshipSummary = computeChampionshipSummary(
    championOwnerRows,
    championshipHistory,
    allTimeStandings,
    activeOwners
  );
  const recentPodiums = selectRecentPodiums(archives, 3);
  const records = selectAllRecords({
    archives,
    historicalRosters,
    currentYear: activeYear,
    currentRoster,
  });
  const marqueeRecords = selectMarqueeRecords(records);
  const topRivalries = selectTopRivalries(archives, 5);
  const dynastyDrought = selectDynastyAndDrought(archives);
  const titleStreaks = selectTitleStreaks(dynastyDrought.rows);
  const movers = selectMovers(selectMostImprovedSeasonOverSeason(archives), 4);
  const archiveStrip = selectSeasonArchiveStrip(championshipHistory);

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
        <div className="mx-auto max-w-6xl">
          <HistorySubNav slug={slug} />
          <div className="space-y-10">
            <ChampionshipsSection
              rows={championOwnerRows}
              summary={championshipSummary}
              slug={slug}
              activeOwners={activeOwners}
            />

            <section>
              <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[1.05fr_0.95fr_1fr]">
                <AllTimeStandingsSummary
                  rows={allTimeStandings}
                  slug={slug}
                  activeOwners={activeOwners}
                />
                <RecentPodiumsColumn blocks={recentPodiums} slug={slug} />
                <RecordsColumn records={marqueeRecords} slug={slug} />
              </div>
            </section>

            <section>
              <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[1.4fr_1fr]">
                <TopRivalriesList
                  rivalries={topRivalries}
                  slug={slug}
                  activeOwners={activeOwners}
                />
                <TitleStreaksTable streaks={titleStreaks} slug={slug} />
              </div>
            </section>

            <MoversSection buckets={movers} slug={slug} />

            <SeasonArchiveStrip items={archiveStrip} slug={slug} />
          </div>
        </div>
      </LeaguePageShell>
    </main>
  );
}
