import { getAppState } from '@/lib/server/appStateStore';
import { getLeagues } from '@/lib/leagueRegistry';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import RootPageClient from '@/components/RootPageClient';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const leagues = await getLeagues();

  const activeYear = seasonYearForToday();
  const ownerCountBySlug: Record<string, number | null> = {};
  await Promise.all(
    leagues.map(async (league) => {
      try {
        const record = await getAppState<string>(`owners:${league.slug}:${activeYear}`, 'csv');
        if (!record?.value) {
          ownerCountBySlug[league.slug] = 0;
          return;
        }
        const lines = record.value.split('\n');
        const owners = new Set<string>();
        for (const line of lines.slice(1)) {
          const commaIdx = line.indexOf(',');
          if (commaIdx === -1) continue;
          const owner = line.slice(commaIdx + 1).trim();
          if (owner && owner !== 'NoClaim') owners.add(owner);
        }
        ownerCountBySlug[league.slug] = owners.size;
      } catch {
        ownerCountBySlug[league.slug] = null;
      }
    })
  );

  return <RootPageClient leagues={leagues} ownerCountBySlug={ownerCountBySlug} />;
}
