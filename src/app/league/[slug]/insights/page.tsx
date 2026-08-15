import { isPlatformAdminSession } from '@/lib/server/adminAuth';

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
  const [isAdmin, league] = await Promise.all([isPlatformAdminSession(), getLeague(slug)]);
  if (!league) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          League &quot;{slug}&quot; not found.
        </p>
      </main>
    );
  }

  // INSIGHTS-029 — this page is titled as the complete list, and it is capped at
  // MAX_INSIGHTS (10) by the loader. Before 029 `applySuppression` filtered
  // BEFORE slicing, so repeat visits rotated ranks 11+ into view; the pure
  // sort-and-cap that replaced it serves the same top 10 forever. Harmless while
  // a league generates fewer than 10, and NOT harmless the moment INSIGHTS-023
  // widens the pool — at which point this surface silently hides the remainder
  // under a heading that claims completeness. Recorded on docs/next-tasks.md
  // item 23; pagination or an explicit count belongs with that work.
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
