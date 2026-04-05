import { auth } from '@clerk/nextjs/server';
import CFBScheduleApp from 'components/CFBScheduleApp';

export default async function LeagueSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const { sessionClaims } = await auth();
  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';
  return (
    <main>
      <CFBScheduleApp leagueSlug={slug} isAdmin={isAdmin} initialWeekViewMode="schedule" />
    </main>
  );
}
