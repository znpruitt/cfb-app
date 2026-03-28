import CFBScheduleApp from 'components/CFBScheduleApp';
import type { StandingsSubview } from '../../components/StandingsPanel';

function resolveStandingsSubview(view: string | undefined): StandingsSubview {
  return view === 'trends' ? 'trends' : 'table';
}

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const initialStandingsSubview = resolveStandingsSubview(params.view);

  return (
    <main>
      <CFBScheduleApp
        initialWeekViewMode="standings"
        initialStandingsSubview={initialStandingsSubview}
      />
    </main>
  );
}
