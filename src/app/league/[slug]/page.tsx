import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';
import { listSeasonArchives } from '../../../lib/seasonArchive';
import { renderLeagueGateIfBlocked } from './leagueGate';

export const revalidate = 60;

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const [league, archiveYears] = await Promise.all([getLeague(slug), listSeasonArchives(slug)]);
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
      />
    </main>
  );
}
