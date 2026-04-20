import { auth } from '@clerk/nextjs/server';
import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../../../components/StandingsPanel';
import { getLeague } from '../../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../../lib/seasonArchive';

export const dynamic = 'force-dynamic';

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
  const sp = await searchParams;
  const initialStandingsSubview = resolveStandingsSubview(sp.view);
  const [{ sessionClaims }, league, archiveYears] = await Promise.all([
    auth(),
    getLeague(slug),
    listSeasonArchives(slug),
  ]);
  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';

  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;

  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        isAdmin={isAdmin}
        initialWeekViewMode="standings"
        leagueYear={league?.year}
        leagueStatus={league?.status}
        mostRecentArchivedYear={mostRecentArchivedYear}
        initialStandingsSubview={initialStandingsSubview}
      />
    </main>
  );
}
