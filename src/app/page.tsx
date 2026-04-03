import { getAppState } from '@/lib/server/appStateStore';
import { getLeagues } from '@/lib/leagueRegistry';
import RootPageClient from '@/components/RootPageClient';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const leagues = await getLeagues();

  const ownerCountBySlug: Record<string, number | null> = {};
  await Promise.all(
    leagues.map(async (league) => {
      try {
        const record = await getAppState<string>(`owners:${league.slug}:${league.year}`, 'csv');
        if (!record?.value) {
          ownerCountBySlug[league.slug] = 0;
          return;
        }
        const rows = record.value.split('\n').filter((l) => l.trim().length > 0);
        ownerCountBySlug[league.slug] = Math.max(0, rows.length - 1);
      } catch {
        ownerCountBySlug[league.slug] = null;
      }
    })
  );

  return <RootPageClient leagues={leagues} ownerCountBySlug={ownerCountBySlug} />;
}
