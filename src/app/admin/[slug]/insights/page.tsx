import { notFound } from 'next/navigation';
import React from 'react';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import InsightsDiagnosticsView from '@/components/admin/InsightsDiagnostics';
import { getLeague } from '@/lib/leagueRegistry';
import { resolveLeagueOperatingYear } from '@/lib/selectors/leagueLifecycle';
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
 * Season resolution matches every other lifecycle-aware admin surface
 * (`resolveLeagueOperatingYear`) rather than reading the top-level `year`, which
 * `leagueRegistry` explicitly contemplates being desynchronized on legacy
 * records — the same correction PLATFORM-099 made to the roster page.
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

  const year = resolveLeagueOperatingYear(definedLeague);
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
      <InsightsDiagnosticsView model={model} />
    </main>
  );
}
