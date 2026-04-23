import { auth } from '@clerk/nextjs/server';

import LeaguePageShell from '@/components/LeaguePageShell';
import { loadInsightsForLeague } from '../../../../lib/insights/loadInsights';
import { getLeague } from '../../../../lib/leagueRegistry';
import { renderLeagueGateIfBlocked } from '../leagueGate';
import AllInsightsRow from './AllInsightsRow';

export const dynamic = 'force-dynamic';

export default async function LeagueInsightsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;
  const [{ sessionClaims }, league] = await Promise.all([auth(), getLeague(slug)]);
  if (!league) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          League &quot;{slug}&quot; not found.
        </p>
      </main>
    );
  }

  const isAdmin =
    (sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> })
      ?.publicMetadata?.role === 'platform_admin';

  const response = await loadInsightsForLeague(slug, league.year);
  const insights = response.insights.slice().sort((a, b) => b.priorityScore - a.priorityScore);

  return (
    <main>
      <LeaguePageShell
        leagueSlug={slug}
        leagueDisplayName={league.displayName}
        leagueYear={league.year}
        foundedYear={league.foundedYear}
        isAdmin={isAdmin}
        activeTab="insights"
      >
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
            All Insights
          </h1>
          {insights.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
              No insights available yet for this league.
            </p>
          ) : (
            <div>
              {insights.map((insight) => (
                <AllInsightsRow
                  key={insight.id}
                  insight={insight}
                  leagueSlug={slug}
                  panelYear={league.year}
                />
              ))}
            </div>
          )}
        </div>
      </LeaguePageShell>
    </main>
  );
}
