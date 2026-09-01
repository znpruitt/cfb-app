import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../../../components/StandingsPanel';
import { getLeague } from '../../../../lib/leagueRegistry';
import { getPreseasonOwners } from '../../../../lib/preseasonOwnerStore';
import { listSeasonArchives } from '../../../../lib/seasonArchive';
import { canonicalStandingsClientProps } from '../../../../lib/selectors/canonicalStandingsClient';
import { getCanonicalStandings } from '../../../../lib/selectors/leagueStandings';
import { resolveDisplayLeagueStatus } from '../../../../lib/selectors/leagueLifecycle';
import { isPlatformAdminSession } from '../../../../lib/server/adminAuth';
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
  const initialNowMs = Date.now();
  const sp = await searchParams;
  const initialStandingsSubview = resolveStandingsSubview(sp.view);
  const [league, archiveYears, canonicalStandings, isAdmin] = await Promise.all([
    getLeague(slug),
    listSeasonArchives(slug),
    getCanonicalStandings({ slug }),
    isPlatformAdminSession(),
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
        initialNowMs={initialNowMs}
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        initialWeekViewMode="standings"
        leagueYear={league?.year}
        leagueStatus={resolveDisplayLeagueStatus(league)}
        assignmentMethod={league?.assignmentMethod}
        mostRecentArchivedYear={mostRecentArchivedYear}
        {...canonicalStandingsClientProps(canonicalStandings)}
        initialPreseasonOwners={preseasonOwners}
        initialStandingsSubview={initialStandingsSubview}
        isAdmin={isAdmin}
      />
    </main>
  );
}
