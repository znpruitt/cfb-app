import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { getAppState } from '@/lib/server/appStateStore';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import {
  selectAllTimeStandings,
  selectChampionshipHistory,
} from '@/lib/selectors/historySelectors';
import { selectAllRecords } from '@/lib/selectors/leagueRecords';
import { loadInsightsForLeague } from '@/lib/insights/loadInsights';
import { HistorySubNav } from '@/components/history/HistorySubNav';
import EraSummary from '@/components/history/EraSummary';
import TitleTimeline from '@/components/history/TitleTimeline';
import StorylinesPanel from '@/components/history/StorylinesPanel';
import RecordLeadersGrid from '@/components/history/RecordLeadersGrid';
import LeaguePageShell from '@/components/LeaguePageShell';
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
  const allTimeStandings = selectAllTimeStandings(archives);
  const records = selectAllRecords({
    archives,
    historicalRosters,
    currentYear: activeYear,
    currentRoster,
  });

  const insightsResponse = await loadInsightsForLeague(slug, activeYear);

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
          <HistorySubNav slug={slug} />
          <div className="space-y-8">
            <EraSummary
              archives={archives}
              championshipHistory={championshipHistory}
              allTimeStandings={allTimeStandings}
              activeOwners={activeOwners}
            />
            <TitleTimeline
              championships={championshipHistory}
              slug={slug}
              activeOwners={activeOwners}
            />
            <StorylinesPanel insights={insightsResponse.insights} slug={slug} year={activeYear} />
            <RecordLeadersGrid records={records} />
          </div>
        </div>
      </LeaguePageShell>
    </main>
  );
}
