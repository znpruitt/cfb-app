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

export default async function LeagueSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  // Load the same canonical inputs as the root league route so entering directly
  // through /schedule is a route-specific entry point into the same canonical app
  // state — not a lighter fallback-only entry — when WeekViewTabs switches locally
  // to Standings/Overview/Matchups/Members. Component fallbacks remain intact.
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
        {...teamRecordProps}
        initialWeekViewMode="schedule"
        isAdmin={isAdmin}
      />
    </main>
  );
}
