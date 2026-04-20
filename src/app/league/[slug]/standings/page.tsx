import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../../../components/StandingsPanel';
import { getLeague } from '../../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../../lib/seasonArchive';
import { renderLeagueGateIfBlocked } from '../leagueGate';

export const revalidate = 60;

function resolveStandingsSubview(view: string | undefined): StandingsSubview {
  return view === 'trends' ? 'trends' : 'table';
}

export default async function LeagueStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const sp = await searchParams;
  const initialStandingsSubview = resolveStandingsSubview(sp.view);
  const [league, archiveYears] = await Promise.all([getLeague(slug), listSeasonArchives(slug)]);

  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;

  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        initialWeekViewMode="standings"
        leagueYear={league?.year}
        leagueStatus={league?.status}
        mostRecentArchivedYear={mostRecentArchivedYear}
        initialStandingsSubview={initialStandingsSubview}
      />
    </main>
  );
}
