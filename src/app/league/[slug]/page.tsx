import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../lib/seasonArchive';
import { canonicalStandingsClientProps } from '../../../lib/selectors/canonicalStandingsClient';
import { getCanonicalStandings } from '../../../lib/selectors/leagueStandings';
import { resolveDisplayLeagueStatus } from '../../../lib/selectors/leagueLifecycle';
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
  const leagueStatus = resolveDisplayLeagueStatus(league);
  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;
  return (
    <main>
      <CFBScheduleApp
        initialNowMs={Date.now()}
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        leagueStatus={leagueStatus}
        assignmentMethod={league?.assignmentMethod}
        mostRecentArchivedYear={mostRecentArchivedYear}
        {...canonicalStandingsClientProps(canonicalStandings)}
        isAdmin={isAdmin}
      />
    </main>
  );
}
