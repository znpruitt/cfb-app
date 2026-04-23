import { notFound } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive } from '@/lib/seasonArchive';
import {
  selectFinalStandings,
  selectOwnerRoster,
  selectSeasonSuperlatives,
  selectHeadToHead,
} from '@/lib/selectors/historySelectors';
import ArchiveBanner from '@/components/history/ArchiveBanner';
import FinalStandingsTable from '@/components/history/FinalStandingsTable';
import SeasonArcChart from '@/components/history/SeasonArcChart';
import SuperlativesPanel from '@/components/history/SuperlativesPanel';
import HeadToHeadPanel from '@/components/history/HeadToHeadPanel';
import HistoryBackLink from '@/components/history/HistoryBackLink';

export const dynamic = 'force-dynamic';
import OwnerRosterCard from '@/components/history/OwnerRosterCard';
import { renderLeagueGateIfBlocked } from '../../leagueGate';

export default async function SeasonDetailPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}): Promise<React.ReactElement> {
  const { slug, year: yearStr } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const year = Number(yearStr);

  if (!Number.isFinite(year) || year < 2000) {
    notFound();
  }

  const league = await getLeague(slug);
  if (!league) notFound();

  const archive = await getSeasonArchive(slug, year);

  if (!archive) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <HistoryBackLink fallbackHref={`/league/${slug}/history/`} className="mb-6 inline-block" />
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-lg font-semibold text-gray-800 dark:text-zinc-100">
            No archived data found for the {year} season.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
            Historical data is available from the 2025 season onward.
          </p>
        </div>
      </main>
    );
  }

  const finalStandings = selectFinalStandings(archive);
  const ownerRoster = selectOwnerRoster(archive);
  const superlatives = selectSeasonSuperlatives(archive);
  const headToHead = selectHeadToHead(archive);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <HistoryBackLink fallbackHref={`/league/${slug}/history/`} />
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {year} Season — {league.displayName}
        </h1>
      </div>

      <ArchiveBanner year={year} />
      <FinalStandingsTable rows={finalStandings} year={year} />
      <SeasonArcChart standingsHistory={archive.standingsHistory} year={year} />
      <SuperlativesPanel superlatives={superlatives} />
      <HeadToHeadPanel headToHead={headToHead} />
      <OwnerRosterCard roster={ownerRoster} year={year} />
    </main>
  );
}
