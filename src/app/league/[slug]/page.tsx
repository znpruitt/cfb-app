import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../lib/seasonArchive';
import { getCanonicalStandings } from '../../../lib/selectors/leagueStandings';
import { isPlatformAdminSession } from '../../../lib/server/adminAuth';
import { renderLeagueGateIfBlocked } from './leagueGate';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const [league, archiveYears, canonicalStandings, isAdmin] = await Promise.all([
    getLeague(slug),
    listSeasonArchives(slug),
    getCanonicalStandings({ slug }),
    isPlatformAdminSession(),
  ]);
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
        canonicalStandings={canonicalStandings}
        isAdmin={isAdmin}
      />
    </main>
  );
}
