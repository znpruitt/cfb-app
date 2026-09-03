import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../../../components/StandingsPanel';
import { getLeague } from '../../../../lib/leagueRegistry';
import { getPreseasonOwners } from '../../../../lib/preseasonOwnerStore';
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
        {...teamRecordsClientProps(scheduleItems, teamRecords)}
        initialPreseasonOwners={preseasonOwners}
        initialStandingsSubview={initialStandingsSubview}
        isAdmin={isAdmin}
      />
    </main>
  );
}
