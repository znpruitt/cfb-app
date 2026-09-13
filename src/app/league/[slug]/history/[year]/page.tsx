import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, resolveArchiveYearParam } from '@/lib/seasonArchive';
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
import OwnerRosterCard from '@/components/history/OwnerRosterCard';
import LeaguePageShell from '@/components/LeaguePageShell';
import { renderLeagueGateIfBlocked } from '../../leagueGate';

export const dynamic = 'force-dynamic';

export default async function SeasonDetailPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}): Promise<React.ReactElement> {
  const { slug, year: yearStr } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;

  // HOISTED ABOVE THE YEAR CHECK — #774. The bound is relative to the league, so
  // the record has to be in hand first. Both reads are `React.cache`-wrapped and
  // the gate above has already done them, so this costs nothing and changes no
  // outcome: an unknown league still reaches the same `notFound()`.
  const [isAdmin, league] = await Promise.all([isPlatformAdminSession(), getLeague(slug)]);
  if (!league) notFound();

  // #774 — this page carried its OWN copy of the API route's broken parser
  // (`Number(yearStr)`, a floor, no ceiling, no integer test) and so shared the
  // defect without sharing a line of code. Measured before the fix:
  // `/history/<slug>/2029.25` and `/2029.75` each rendered 200 and each minted
  // its own `revalidate: false` archive cache entry. One resolver now serves both
  // callers; only the refusal differs, and this one stays `notFound()`.
  //
  // The empty state below is why the ceiling is the operating year rather than
  // the archive list: an in-range season the league simply has no archive for —
  // `tsc` genuinely has gaps at 2019 and 2020 — must still render it. Bounding on
  // the archive list alone would turn that designed surface into a `notFound()`.
  const resolved = await resolveArchiveYearParam(slug, yearStr, league);
  if (!resolved.ok) notFound();
  const year = resolved.year;

  const archive = await getSeasonArchive(slug, year);

  if (!archive) {
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
                No archived data found for the {year} season.
              </p>
              <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                Historical data is available from the 2025 season onward.
              </p>
            </div>
          </div>
        </LeaguePageShell>
      </main>
    );
  }

  const finalStandings = selectFinalStandings(archive);
  const ownerRoster = selectOwnerRoster(archive);
  const superlatives = selectSeasonSuperlatives(archive);
  const headToHead = selectHeadToHead(archive);

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
              {year} Season
            </h1>
          </div>

          <ArchiveBanner year={year} />
          <FinalStandingsTable rows={finalStandings} year={year} />
          <SeasonArcChart standingsHistory={archive.standingsHistory} year={year} />
          <SuperlativesPanel superlatives={superlatives} />
          <HeadToHeadPanel headToHead={headToHead} slug={slug} />
          <OwnerRosterCard roster={ownerRoster} year={year} />
        </div>
      </LeaguePageShell>
    </main>
  );
}
