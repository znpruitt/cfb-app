import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../../../components/StandingsPanel';
import { getLeague } from '../../../../lib/leagueRegistry';
import { resolveLeagueSeason } from '../../../../lib/leagueSeason';
import { getPreseasonOwners } from '../../../../lib/preseasonOwnerStore';
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

  const mostRecentArchivedYear =
    archiveYears.length > 0 ? [...archiveYears].sort((a, b) => b - a)[0] : undefined;

  const preseasonOwners =
    league?.status?.state === 'preseason'
      ? ((await getPreseasonOwners(slug, league.status.year)) ?? undefined)
      : undefined;

  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        initialWeekViewMode="standings"
        leagueYear={league?.year}
        leagueStatus={resolveDisplayLeagueStatus(league)}
        assignmentMethod={league?.assignmentMethod}
        mostRecentArchivedYear={mostRecentArchivedYear}
        {...canonicalStandingsClientProps(canonicalStandings)}
        {...teamRecordProps}
        initialPreseasonOwners={preseasonOwners}
        initialStandingsSubview={initialStandingsSubview}
        isAdmin={isAdmin}
      />
    </main>
  );
}
