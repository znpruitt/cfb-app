import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../../lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function LeagueSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const league = await getLeague(slug);
  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        leagueDisplayName={league?.displayName}
        leagueYear={league?.year}
        initialWeekViewMode="schedule"
      />
    </main>
  );
}
