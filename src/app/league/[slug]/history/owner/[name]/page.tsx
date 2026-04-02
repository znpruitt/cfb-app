import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { selectOwnerCareer } from '@/lib/selectors/historySelectors';
import CareerSummaryCard from '@/components/history/CareerSummaryCard';
import SeasonFinishHistory from '@/components/history/SeasonFinishHistory';
import AllTimeOwnerHeadToHeadPanel from '@/components/history/AllTimeOwnerHeadToHeadPanel';
import type { SeasonArchive } from '@/lib/seasonArchive';

export default async function OwnerCareerPage({
  params,
}: {
  params: Promise<{ slug: string; name: string }>;
}): Promise<React.ReactElement> {
  const { slug, name: encodedName } = await params;
  const ownerName = decodeURIComponent(encodedName);

  const league = await getLeague(slug);
  if (!league) notFound();

  const years = await listSeasonArchives(slug);
  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  const career = selectOwnerCareer(archives, ownerName);

  if (career.seasonsPlayed === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href={`/league/${slug}/history/`}
          className="mb-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to League History
        </Link>
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-lg font-semibold text-gray-800 dark:text-zinc-100">
            No archived data found for &ldquo;{ownerName}&rdquo;.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
            This owner may not appear in any archived seasons.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <Link
          href={`/league/${slug}/history/`}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to League History
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {ownerName}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          {league.displayName} — Owner Career
        </p>
      </div>

      <CareerSummaryCard career={career} />
      <SeasonFinishHistory history={career.seasonHistory} slug={slug} />
      {career.headToHead.length > 0 && (
        <AllTimeOwnerHeadToHeadPanel
          ownerName={ownerName}
          headToHead={career.headToHead}
          slug={slug}
        />
      )}
    </main>
  );
}
