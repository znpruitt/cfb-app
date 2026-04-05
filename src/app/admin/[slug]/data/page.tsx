import { auth } from '@clerk/nextjs/server';
import CFBScheduleApp from '@/components/CFBScheduleApp';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import { getLeague } from '@/lib/leagueRegistry';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminLeagueDataPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  const { sessionClaims } = await auth();
  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';

  return (
    <div>
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        <h1 className="text-xl font-bold text-zinc-100">{league.displayName} — Data</h1>
        <HistoricalCachePanel leagues={[league]} />
      </div>
      <CFBScheduleApp surface="admin" leagueSlug={slug} isAdmin={isAdmin} />
    </div>
  );
}
