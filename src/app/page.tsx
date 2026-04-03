import { getLeagues } from '@/lib/leagueRegistry';
import RootPageClient from '@/components/RootPageClient';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const leagues = await getLeagues();
  return <RootPageClient leagues={leagues} />;
}
