import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../../lib/seasonArchive';
import { getCanonicalStandings } from '../../../../lib/selectors/leagueStandings';
import { isPlatformAdminSession } from '../../../../lib/server/adminAuth';
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
        initialWeekViewMode="schedule"
        isAdmin={isAdmin}
      />
    </main>
  );
}
