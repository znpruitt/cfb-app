import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { getCanonicalStandings } from '@/lib/selectors/leagueStandings';
import { getAppState } from '@/lib/server/appStateStore';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { selectChampionshipHistory } from '@/lib/selectors/historySelectors';
import { selectAllRecords } from '@/lib/selectors/leagueRecords';
import { loadInsightsForLeague } from '@/lib/insights/loadInsights';
import ChampionshipsBanner from '@/components/history/ChampionshipsBanner';
import { HistorySubNav } from '@/components/history/HistorySubNav';
import StorylinesPanel from '@/components/history/StorylinesPanel';
import SeasonRecapCard from '@/components/history/SeasonRecapCard';
import RecordLeadersGrid from '@/components/history/RecordLeadersGrid';
import LeaguePageShell from '@/components/LeaguePageShell';
import type { SeasonArchive } from '@/lib/seasonArchive';
import type { StandingsRow } from '@/lib/selectors/historySelectors';
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

  // Fetch all archives in parallel
  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  // Attempt to fetch live season standings for active year if not yet archived
  const activeYear = league.year;
  let liveStandings: StandingsRow[] | undefined;
  if (!years.includes(activeYear)) {
    try {
      const canonical = await getCanonicalStandings({ slug, year: activeYear });
      if (canonical && canonical.source !== 'empty') {
        liveStandings = canonical.rows.map((row, idx) => ({
          rank: idx + 1,
          owner: row.owner,
          wins: row.wins,
          losses: row.losses,
          gamesBack: row.gamesBack,
          pointDifferential: row.pointDifferential,
        }));
      }
    } catch {
      // Live season data unavailable — show only archived data
    }
  }

  // Current roster for selectAllRecords
  const ownersRecord = await getAppState<string>(`owners:${slug}:${activeYear}`, 'csv');
  const ownersCsv = typeof ownersRecord?.value === 'string' ? ownersRecord.value : '';
  const currentRosterRows = parseOwnersCsv(ownersCsv);
  const currentRoster = new Map(currentRosterRows.map((r) => [r.team, r.owner]));

  // Build historicalRosters for selectAllRecords
  const historicalRosters: Record<number, Map<string, string>> = {};
  for (const archive of archives) {
    const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
    historicalRosters[archive.year] = new Map(rows.map((r) => [r.team, r.owner]));
  }

  const championshipHistory = selectChampionshipHistory(archives);
  const records = selectAllRecords({
    archives,
    historicalRosters,
    currentYear: activeYear,
    currentRoster,
  });

  // Load storyline insights: historical + rivalry categories, top 5 by priorityScore
  const insightsResponse = await loadInsightsForLeague(slug, activeYear);
  const storylineInsights = insightsResponse.insights
    .filter((i) => i.category === 'historical' || i.category === 'rivalry')
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 5);

  // Most recent archive for season recap (years sorted ascending, last = most recent)
  const mostRecentArchive = archives.length > 0 ? archives[archives.length - 1] : null;

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
            <section id="championships" className="scroll-mt-4">
              <ChampionshipsBanner
                history={championshipHistory}
                slug={slug}
                currentSeasonYear={liveStandings !== undefined ? activeYear : undefined}
                currentLeader={liveStandings?.find((r) => r.owner !== 'NoClaim')?.owner}
              />
            </section>
            <StorylinesPanel insights={storylineInsights} slug={slug} year={activeYear} />
            {mostRecentArchive !== null && (
              <SeasonRecapCard archive={mostRecentArchive} slug={slug} />
            )}
            <RecordLeadersGrid records={records} />
          </div>
        </div>
      </LeaguePageShell>
    </main>
  );
}
