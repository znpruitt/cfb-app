import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../../lib/leagueRegistry';
import { resolveLeagueSeason } from '../../../../lib/leagueSeason';
import { listSeasonArchives } from '../../../../lib/seasonArchive';
import { canonicalStandingsClientProps } from '../../../../lib/selectors/canonicalStandingsClient';
import { getCanonicalStandings } from '../../../../lib/selectors/leagueStandings';
import { resolveDisplayLeagueStatus } from '../../../../lib/selectors/leagueLifecycle';
import { isPlatformAdminSession } from '../../../../lib/server/adminAuth';
import {
  EMPTY_TEAM_RECORDS_CLIENT_PROPS,
  loadTeamRecordsClientProps,
} from '../../../../lib/server/teamRecordsClient';
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
  const teamRecordPropsPromise = leaguePromise.then(async (league) => {
    if (!league) return EMPTY_TEAM_RECORDS_CLIENT_PROPS;
    const enrichmentYear = resolveLeagueSeason({
      leagueStatus: resolveDisplayLeagueStatus(league),
      leagueYear: league.year,
      defaultSeason: league.year,
    });
    return loadTeamRecordsClientProps({ leagueSlug: slug, year: enrichmentYear });
  });
  const [league, archiveYears, canonicalStandings, isAdmin, teamRecordProps] = await Promise.all([
    leaguePromise,
    listSeasonArchives(slug),
    getCanonicalStandings({ slug }),
    isPlatformAdminSession(),
    teamRecordPropsPromise,
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
        {...teamRecordProps}
        initialWeekViewMode="matchups"
        isAdmin={isAdmin}
      />
    </main>
  );
}
