import { auth } from '@clerk/nextjs/server';
import CFBScheduleApp from 'components/CFBScheduleApp';
import { getLeague } from '../../../lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const [{ sessionClaims }, league] = await Promise.all([auth(), getLeague(slug)]);
  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';
  const leagueStatus = league?.status ?? (league ? { state: 'season' as const, year: league.year } : undefined);
  return (
    <main>
      <CFBScheduleApp leagueSlug={slug} leagueDisplayName={league?.displayName} leagueYear={league?.year} leagueStatus={leagueStatus} isAdmin={isAdmin} />
    </main>
  );
}
