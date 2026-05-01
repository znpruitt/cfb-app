import { notFound } from 'next/navigation';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { HistorySubNav } from '@/components/history/HistorySubNav';
import LeaguePageShell from '@/components/LeaguePageShell';
import { renderLeagueGateIfBlocked } from '../../leagueGate';

export const dynamic = 'force-dynamic';

export default async function HistoryStatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;

  const [isAdmin, league] = await Promise.all([isPlatformAdminSession(), getLeague(slug)]);
  if (!league) notFound();

  return (
    <main>
      <LeaguePageShell
        leagueSlug={slug}
        leagueDisplayName={league.displayName}
        leagueYear={league.year}
        foundedYear={league.foundedYear}
        isAdmin={isAdmin}
        activeTab="history"
      >
        <div className="mx-auto max-w-5xl">
          <HistorySubNav slug={slug} />
          <div className="py-12 text-center text-gray-500 dark:text-zinc-400">
            <p className="text-sm">Coming in Phase 3</p>
          </div>
        </div>
      </LeaguePageShell>
    </main>
  );
}
