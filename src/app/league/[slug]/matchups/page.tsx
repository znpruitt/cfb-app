import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../../lib/seasonArchive';
import { canonicalStandingsClientProps } from '../../../../lib/selectors/canonicalStandingsClient';
import { getCanonicalStandings } from '../../../../lib/selectors/leagueStandings';
import { resolveDisplayLeagueStatus } from '../../../../lib/selectors/leagueLifecycle';
import { teamRecordsClientProps } from '../../../../lib/selectors/teamRecordsClient';
import { isPlatformAdminSession } from '../../../../lib/server/adminAuth';
import { loadCachedScheduleItems } from '../../../../lib/server/canonicalScheduleCache';
import { readTeamRecordsCache } from '../../../../lib/teamRecords/teamRecordsCache';
import { renderLeagueGateIfBlocked } from '../leagueGate';

export const dynamic = 'force-dynamic';

export default async function LeagueMatchupsPage({
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
  // Passing `leagueStatus` made the offseason header branch reachable here, and
  // that branch reads this prop — without it these two routes would render
  // `Offseason` where the other three render `{year} Final Standings`.
  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;
  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        leagueStatus={resolveDisplayLeagueStatus(league)}
        assignmentMethod={league?.assignmentMethod}
        mostRecentArchivedYear={mostRecentArchivedYear}
        {...canonicalStandingsClientProps(canonicalStandings)}
        {...teamRecordsClientProps(scheduleItems, teamRecords)}
        initialWeekViewMode="matchups"
        isAdmin={isAdmin}
      />
    </main>
  );
}
