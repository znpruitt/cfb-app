import { auth } from '@clerk/nextjs/server';
import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../lib/seasonArchive';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const [{ sessionClaims }, league, archiveYears] = await Promise.all([
    auth(),
    getLeague(slug),
    listSeasonArchives(slug),
  ]);
  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';
  const leagueStatus =
    league?.status ?? (league ? { state: 'season' as const, year: league.year } : undefined);
  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;
  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        leagueStatus={leagueStatus}
        mostRecentArchivedYear={mostRecentArchivedYear}
        isAdmin={isAdmin}
      />
    </main>
  );
}
