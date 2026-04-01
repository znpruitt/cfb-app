import CFBScheduleApp from 'components/CFBScheduleApp';

export default async function LeagueSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  return (
    <main>
      <CFBScheduleApp leagueSlug={slug} initialWeekViewMode="schedule" />
    </main>
  );
}
