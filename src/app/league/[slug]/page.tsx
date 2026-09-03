import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../lib/seasonArchive';
import { canonicalStandingsClientProps } from '../../../lib/selectors/canonicalStandingsClient';
import { getCanonicalStandings } from '../../../lib/selectors/leagueStandings';
import { resolveDisplayLeagueStatus } from '../../../lib/selectors/leagueLifecycle';
import { teamRecordsClientProps } from '../../../lib/selectors/teamRecordsClient';
import { isPlatformAdminSession } from '../../../lib/server/adminAuth';
import { loadCachedScheduleItems } from '../../../lib/server/canonicalScheduleCache';
import { readTeamRecordsCache } from '../../../lib/teamRecords/teamRecordsCache';
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
  const leaguePromise = getLeague(slug);
  const [league, archiveYears, canonicalStandings, isAdmin, scheduleItems, teamRecords] =
    await Promise.all([
      leaguePromise,
      listSeasonArchives(slug),
      getCanonicalStandings({ slug }),
      isPlatformAdminSession(),
      leaguePromise.then((league) =>
        league ? loadCachedScheduleItems(league.year) : Promise.resolve([])
      ),
      leaguePromise.then((league) =>
        league ? readTeamRecordsCache(league.year) : Promise.resolve(null)
      ),
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
        {...teamRecordsClientProps(scheduleItems, teamRecords)}
        isAdmin={isAdmin}
      />
    </main>
  );
}
