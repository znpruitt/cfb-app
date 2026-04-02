import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import {
  selectAllTimeStandings,
  selectChampionshipHistory,
  selectAllTimeHeadToHead,
  selectTopRivalries,
  selectDynastyAndDrought,
  selectMostImprovedSeasonOverSeason,
} from '@/lib/selectors/historySelectors';
import ChampionshipsBanner from '@/components/history/ChampionshipsBanner';
import AllTimeStandingsTable from '@/components/history/AllTimeStandingsTable';
import AllTimeHeadToHeadPanel from '@/components/history/AllTimeHeadToHeadPanel';
import DynastyDroughtPanel from '@/components/history/DynastyDroughtPanel';
import MostImprovedPanel from '@/components/history/MostImprovedPanel';
import SeasonListPanel from '@/components/history/SeasonListPanel';
import type { SeasonArchive } from '@/lib/seasonArchive';

export default async function LeagueHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const league = await getLeague(slug);
  if (!league) notFound();

  const years = await listSeasonArchives(slug);

  if (years.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href={`/league/${slug}/`}
          className="mb-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to {league.displayName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {league.displayName} — League History
        </h1>
        <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-lg font-semibold text-gray-800 dark:text-zinc-100">
            League history isn&apos;t available yet. Check back next offseason.
          </p>
        </div>
      </main>
    );
  }

  // Fetch all archives in parallel
  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  const allTimeStandings = selectAllTimeStandings(archives);
  const championshipHistory = selectChampionshipHistory(archives);
  const allTimeH2H = selectAllTimeHeadToHead(archives);
  const topRivalries = selectTopRivalries(archives);
  const dynastyDrought = selectDynastyAndDrought(archives);
  const mostImproved = selectMostImprovedSeasonOverSeason(archives);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <Link
          href={`/league/${slug}/`}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to {league.displayName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {league.displayName} — League History
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          {archives.length} archived season{archives.length !== 1 ? 's' : ''}
        </p>
      </div>

      <ChampionshipsBanner history={championshipHistory} slug={slug} />
      <AllTimeStandingsTable rows={allTimeStandings} slug={slug} />
      <SeasonListPanel history={championshipHistory} slug={slug} />
      {mostImproved.length > 0 && <MostImprovedPanel entries={mostImproved} slug={slug} />}
      {dynastyDrought.rows.length > 0 && (
        <DynastyDroughtPanel result={dynastyDrought} slug={slug} />
      )}
      {topRivalries.length > 0 && (
        <AllTimeHeadToHeadPanel rivalries={topRivalries} allH2H={allTimeH2H} slug={slug} />
      )}
    </main>
  );
}
