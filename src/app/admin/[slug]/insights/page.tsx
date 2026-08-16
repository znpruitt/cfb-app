import { notFound } from 'next/navigation';
import React from 'react';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import InsightsDiagnosticsView from '@/components/admin/InsightsDiagnostics';
import { getLeague } from '@/lib/leagueRegistry';
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

  // Use the SAME year the loader uses, deliberately.
  //
  // The first version resolved `resolveLeagueOperatingYear` (which reads
  // `status.year`) while `loadInsightsForLeague` defaults to `league.year`, and
  // `buildInsightContext` sets `context.currentYear` from `league.year`
  // regardless. On a legacy record where those disagree this page would have
  // labelled the model with one year while parts of it were generated from
  // another — and reported a different year than the public insights page for
  // the same league.
  //
  // A diagnostic explains what production DOES; it does not get to pick a
  // different input. The underlying issue — that the resolved year is not
  // propagated through the context — is recorded in docs/next-tasks.md as its
  // own item, because fixing it changes production insight generation and is not
  // a diagnostic page's business.
  const year = definedLeague.year;
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
