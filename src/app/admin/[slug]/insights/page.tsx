import { notFound } from 'next/navigation';
import React from 'react';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import InsightsDiagnosticsView from '@/components/admin/InsightsDiagnostics';
import { getLeague } from '@/lib/leagueRegistry';
import { resolveLeagueSeason } from '@/lib/leagueSeason';
import { getDefaultRankingsSeason } from '@/lib/rankings';
import { buildInsightsDiagnostics } from '@/lib/server/insightsDiagnostics';

export const dynamic = 'force-dynamic';

/**
 * INSIGHTS-019 — "why is my feed thin, and would rotation have anything to work
 * with?"
 *
 * Follows the `/admin/diagnostics` shape: build ONE view model server-side and
 * render it. No `/api/...` endpoint, no internal HTTP, no client fetch. Admin
 * authentication comes from the existing middleware that covers `/admin`.
 *
 * Season resolution calls `resolveLeagueSeason` — the same function
 * `CFBScheduleApp` calls before requesting `/api/insights?year=` — so the page
 * diagnoses the season the Overview is showing. See the comment at the call site
 * for what does and does not diverge.
 */
export default async function AdminLeagueInsightsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const league = await getLeague(slug);
  if (!league) notFound();
  const definedLeague = league!;

  // Resolve the year by CALLING what the Overview calls, not by reasoning about
  // which year is "right". Two earlier attempts picked it by reasoning and both
  // were wrong in different directions.
  //
  // What is actually true: `LeagueStatus` for offseason is `{ state: 'offseason' }`
  // with NO year, so `resolveLeagueSeason` falls through to `leagueYear` exactly
  // as `resolveLeagueOperatingYear` and a bare `league.year` would. They cannot
  // diverge there. (An earlier version of this comment claimed the opposite and
  // was contradicted by this slice's own test — see
  // `__tests__/insightsPageYear.test.ts`.)
  //
  // Where they CAN diverge is a legacy record whose top-level `year` is
  // desynchronized from `status.year` in preseason or season —
  // `leagueRegistry` explicitly contemplates those. This page follows the
  // Overview, which is the surface it primarily explains.
  //
  // KNOWN GAP, recorded in docs/next-tasks.md: `/league/[slug]/insights` loads
  // `league.year`, so on such a record the two surfaces this page reports on
  // disagree with EACH OTHER. That is an app-level divergence the diagnostic
  // revealed, not one it introduced, and fixing it means aligning that page.
  const year = resolveLeagueSeason({
    leagueStatus: definedLeague.status,
    leagueYear: definedLeague.year,
    defaultSeason: getDefaultRankingsSeason(null),
  });
  const model = await buildInsightsDiagnostics(slug, year);

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-8">
      <Breadcrumbs
        segments={[
          { label: 'Home', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: definedLeague.displayName, href: `/admin/${slug}` },
          { label: 'Insights' },
        ]}
      />
      <h1 className="text-xl font-semibold">Insights diagnostics</h1>
      <InsightsDiagnosticsView model={model} />
    </main>
  );
}
