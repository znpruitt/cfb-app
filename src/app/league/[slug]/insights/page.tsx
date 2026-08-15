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

  // The FULL surface asks for the full set. Rotation selects at the limit it is
  // given, so leaving this at the compact feed default served the same five rows
  // the reader had just left on the Overview.
  const response = await loadInsightsForLeague(slug, league.year, { limit: 10 });
  // INSIGHTS-018 — rotation's order is preserved, NOT re-sorted by priority.
  // Re-sorting here discarded the whole ordering contract: changed insights are
  // meant to come before rotated ones regardless of priority, and a priority sort
  // put a high-scoring fact the reader has seen many times above actual news.
  // Review found the tested contract had no rendered consumer because both
  // callers re-sorted.
  const insights = response.insights;

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
