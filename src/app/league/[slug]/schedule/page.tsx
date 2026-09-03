import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../../lib/leagueRegistry';
import { resolveLeagueSeason } from '../../../../lib/leagueSeason';
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
  const teamRecordInputsPromise = leaguePromise.then(async (league) => {
    if (!league) return { scheduleItems: [], teamRecords: null };
    const enrichmentYear = resolveLeagueSeason({
      leagueStatus: resolveDisplayLeagueStatus(league),
      leagueYear: league.year,
      defaultSeason: league.year,
    });
    const [scheduleItems, teamRecords] = await Promise.allSettled([
      loadCachedScheduleItems(enrichmentYear),
      readTeamRecordsCache(enrichmentYear),
    ]);
    return {
      scheduleItems: scheduleItems.status === 'fulfilled' ? scheduleItems.value : [],
      teamRecords: teamRecords.status === 'fulfilled' ? teamRecords.value : null,
    };
  });
  const [league, archiveYears, canonicalStandings, isAdmin, teamRecordInputs] = await Promise.all([
    leaguePromise,
    listSeasonArchives(slug),
    getCanonicalStandings({ slug }),
    isPlatformAdminSession(),
    teamRecordInputsPromise,
  ]);
  const { scheduleItems, teamRecords } = teamRecordInputs;
  const leagueStatus = resolveDisplayLeagueStatus(league);
  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;
  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        leagueStatus={leagueStatus}
        assignmentMethod={league?.assignmentMethod}
        mostRecentArchivedYear={mostRecentArchivedYear}
        {...canonicalStandingsClientProps(canonicalStandings)}
        {...teamRecordsClientProps(scheduleItems, teamRecords)}
        initialWeekViewMode="schedule"
        isAdmin={isAdmin}
      />
    </main>
  );
}
