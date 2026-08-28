import { isPlatformAdminSession } from '@/lib/server/adminAuth';

import LeaguePageShell from '@/components/LeaguePageShell';
import { loadInsightsForLeague } from '../../../../lib/insights/loadInsights';
import { getLeague } from '../../../../lib/leagueRegistry';
import {
  composeWeeklyRecap,
  type WeeklyRecapViewModel,
} from '../../../../lib/recap/composeWeeklyRecap';
import { loadRecapContextForSeasonScope } from '../../../../lib/recap/loadRecapContext';
import {
  resolveDisplayLeagueStatus,
  resolveLeagueOperatingYear,
} from '../../../../lib/selectors/leagueLifecycle';
import { renderLeagueGateIfBlocked } from '../leagueGate';
import AllInsightsRow from './AllInsightsRow';

export const dynamic = 'force-dynamic';

function WeeklyRecapSection({ recap }: { recap: WeeklyRecapViewModel }): React.ReactElement | null {
  if (recap.status === 'inactive') return null;

  return (
    <section
      aria-labelledby="weekly-recap-heading"
      className="mb-7 border-b border-gray-200 pb-7 dark:border-zinc-800"
    >
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2
          id="weekly-recap-heading"
          className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50"
        >
          Weekly recap
        </h2>
        {recap.status === 'available' ? (
          <p className="shrink-0 text-sm font-medium text-gray-600 dark:text-zinc-400">
            {recap.weekLabel}
          </p>
        ) : null}
      </div>

      {recap.status === 'unavailable' ? (
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          This week&apos;s recap isn&apos;t available right now. Please check back shortly.
        </p>
      ) : recap.status === 'absent' ? (
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          No weekly recap is available yet.
        </p>
      ) : (
        <>
          {recap.ownerLines.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              No completed results were recorded for {recap.weekLabel}.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-zinc-800/80">
              {recap.ownerLines.map((line) => (
                <li key={line.owner} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-950 dark:text-zinc-100">
                      {line.owner}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-zinc-500">{line.pointsLabel}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-800 dark:text-zinc-200">
                    {line.recordLabel}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {recap.unresolvedMessage || recap.abandonedMessage || recap.missingResultMessage ? (
            <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-zinc-500">
              {recap.unresolvedMessage ? <p>{recap.unresolvedMessage}</p> : null}
              {recap.abandonedMessage ? <p>{recap.abandonedMessage}</p> : null}
              {recap.missingResultMessage ? <p>{recap.missingResultMessage}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

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
  // the INSIGHTS-029 item; pagination or an explicit count belongs with that work.
  const now = new Date();
  const leagueStatus = resolveDisplayLeagueStatus(league);
  const seasonYear = resolveLeagueOperatingYear(league);
  const [response, recapContext] = await Promise.all([
    loadInsightsForLeague(slug, seasonYear),
    loadRecapContextForSeasonScope({ leagueSlug: slug, seasonYear, leagueStatus }),
  ]);
  const recap: WeeklyRecapViewModel = recapContext
    ? composeWeeklyRecap(recapContext, now, { leagueStatus, seasonYear })
    : { status: 'inactive' };
  const insights = response.insights.slice().sort((a, b) => b.priorityScore - a.priorityScore);

  return (
    <main>
      <LeaguePageShell
        leagueSlug={slug}
        leagueDisplayName={league.displayName}
        leagueYear={seasonYear}
        foundedYear={league.foundedYear}
        isAdmin={isAdmin}
        activeTab="insights"
      >
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
            All Insights
          </h1>
          <WeeklyRecapSection recap={recap} />
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
                  panelYear={seasonYear}
                />
              ))}
            </div>
          )}
        </div>
      </LeaguePageShell>
    </main>
  );
}
