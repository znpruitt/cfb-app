import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { selectOwnerCareer, type OwnerCareerExtras } from '@/lib/selectors/historySelectors';
import { loadOwnerSeasonStats } from '@/lib/insights/context';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import CareerSummaryCard from '@/components/history/CareerSummaryCard';
import SeasonFinishHistory from '@/components/history/SeasonFinishHistory';
import AllTimeOwnerHeadToHeadPanel from '@/components/history/AllTimeOwnerHeadToHeadPanel';
import HistoryBackLink from '@/components/history/HistoryBackLink';
import LeaguePageShell from '@/components/LeaguePageShell';
import type { SeasonArchive } from '@/lib/seasonArchive';
import { renderLeagueGateIfBlocked } from '../../../leagueGate';

export const dynamic = 'force-dynamic';

async function loadOwnerCareerExtras(
  slug: string,
  archives: SeasonArchive[]
): Promise<OwnerCareerExtras> {
  const extras: OwnerCareerExtras = new Map();
  for (const archive of archives) {
    const rosterRows = parseOwnersCsv(archive.ownerRosterSnapshot);
    const yearRoster = new Map(rosterRows.map((r) => [r.team, r.owner]));
    const seasonStats = await loadOwnerSeasonStats(slug, archive.year, yearRoster, archive.games);
    if (!seasonStats) continue;
    for (const stats of seasonStats) {
      const prev = extras.get(stats.owner) ?? { totalYards: 0, totalTurnoverMargin: 0 };
      extras.set(stats.owner, {
        totalYards: prev.totalYards + stats.totalYards,
        totalTurnoverMargin: prev.totalTurnoverMargin + stats.turnoverMargin,
      });
    }
  }
  return extras;
}

export default async function OwnerCareerPage({
  params,
}: {
  params: Promise<{ slug: string; name: string }>;
}): Promise<React.ReactElement> {
  const { slug, name: ownerName } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;

  const [isAdmin, league] = await Promise.all([isPlatformAdminSession(), getLeague(slug)]);
  if (!league) notFound();

  const years = await listSeasonArchives(slug);
  const archiveResults = await Promise.all(years.map((year) => getSeasonArchive(slug, year)));
  const archives: SeasonArchive[] = archiveResults.filter((a): a is SeasonArchive => a !== null);

  const extras = await loadOwnerCareerExtras(slug, archives).catch(
    () => new Map() as OwnerCareerExtras
  );
  const career = selectOwnerCareer(archives, ownerName, extras);

  if (career.seasonsPlayed === 0) {
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
            <HistoryBackLink
              fallbackHref={`/league/${slug}/history/`}
              className="mb-6 inline-block"
            />
            <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
              <p className="text-lg font-semibold text-gray-800 dark:text-zinc-100">
                No archived data found for &ldquo;{ownerName}&rdquo;.
              </p>
              <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                This owner may not appear in any archived seasons.
              </p>
            </div>
          </div>
        </LeaguePageShell>
      </main>
    );
  }

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
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <HistoryBackLink fallbackHref={`/league/${slug}/history/`} />
            <h1 className="mt-2 text-[20px] font-medium tracking-tight text-gray-950 dark:text-zinc-50">
              {ownerName}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-zinc-400">Owner Career</p>
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
        </div>
      </LeaguePageShell>
    </main>
  );
}
