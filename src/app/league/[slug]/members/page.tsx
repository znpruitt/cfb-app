import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../../lib/leagueRegistry';
import { getCanonicalStandings } from '../../../../lib/selectors/leagueStandings';
import { renderLeagueGateIfBlocked } from '../leagueGate';

export const dynamic = 'force-dynamic';

export default async function LeagueMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const [league, canonicalStandings] = await Promise.all([
    getLeague(slug),
    getCanonicalStandings({ slug }),
  ]);
  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        canonicalStandings={canonicalStandings}
        initialWeekViewMode="owner"
      />
    </main>
  );
}
