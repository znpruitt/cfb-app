import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../../../components/StandingsPanel';

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
  const sp = await searchParams;
  const initialStandingsSubview = resolveStandingsSubview(sp.view);

  return (
    <main>
      <CFBScheduleApp
        leagueSlug={slug}
        initialWeekViewMode="standings"
        initialStandingsSubview={initialStandingsSubview}
      />
    </main>
  );
}
