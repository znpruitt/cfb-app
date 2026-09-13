import { NextResponse } from 'next/server';

import { loadInsightsForLeague, type InsightsResponse } from '@/lib/insights/loadInsights';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { loadWeeklyRecap } from '@/lib/recap/loadWeeklyRecap';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import {
  resolveDisplayLeagueStatus,
  resolveLeagueOperatingYear,
} from '@/lib/selectors/leagueLifecycle';

export const dynamic = 'force-dynamic';

function parseYear(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : undefined;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  // Password-gate: blend unauthorized access into the same 404 shape unknown
  // leagues return, so API callers can't distinguish "passworded" from "missing".
  // Pass req so the gate honors ADMIN_API_TOKEN in addition to Clerk session.
  if (!(await isAuthorizedForLeague(slug, req))) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get('year'));
  const bypassSuppression = url.searchParams.get('bypassSuppression') === '1';

  // #627 — `bypassSuppression` is a PLATFORM-ADMIN capability, and until now its
  // only gate was the league check above. On a passwordless league that check
  // admits anonymous callers (`leagueAuth.ts`, condition 1), so the parameter was
  // effectively public.
  //
  // What it actually reaches, measured rather than assumed: the engine's
  // `shouldSuppressGenerator` filter, and — the live half — the uncached branch at
  // `loadInsights.ts`, which computes a full league insight build per request
  // instead of serving the 300s-cached raw set. An anonymous caller could force
  // that build in a loop.
  //
  // It reached NO withheld content: both `shouldSuppressGenerator` entries carry a
  // non-bypassable copy inside their own generator (`membership.ts`,
  // `career.ts` — `rookieBenchmarkGenerator`), and that defence in depth STAYS.
  // This guard is what stops a FUTURE engine-level rule, which AGENTS.md
  // (Season Launch invariant 4) explicitly permits to live only in the engine,
  // from being liftable by a query string.
  //
  // AFTER the 404 blend-in above, deliberately: an unauthorized caller on a
  // passworded or unknown league must still get 404 rather than a 401 that would
  // confirm the league exists.
  //
  // `requireAdminAuth(req)` — WITH the request. AGENTS.md Auth invariant 4 binds
  // API routes to this helper, and it is what honors the ADMIN_API_TOKEN header an
  // admin saves in the Admin/Debug panel. Invariant 8's no-argument rule is scoped
  // to Server Actions, which have no request to authenticate with. The residue is
  // that helper's own pre-existing no-token branch, which authorizes outside
  // production; invariant 5 forbids narrowing it here, and it is pinned by
  // `__tests__/bypassSuppressionAuthorization.test.ts` so it cannot change silently.
  if (bypassSuppression) {
    const refusal = await requireAdminAuth(req);
    if (refusal) return refusal;
  }

  const now = new Date();
  const league = await getLeague(slug);
  const resolvedYear = year ?? (league ? resolveLeagueOperatingYear(league) : undefined);

  const [feed, weeklyRecap] = await Promise.all([
    loadInsightsForLeague(slug, resolvedYear, { bypassSuppression }),
    league && resolvedYear
      ? loadWeeklyRecap({
          leagueSlug: slug,
          seasonYear: resolvedYear,
          leagueStatus: resolveDisplayLeagueStatus(league),
          now,
        })
      : Promise.resolve({ status: 'inactive' } as const),
  ]);
  const response: InsightsResponse = { ...feed, weeklyRecap };
  return NextResponse.json<InsightsResponse>(response, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
