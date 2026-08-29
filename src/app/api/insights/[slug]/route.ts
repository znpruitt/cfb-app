import { NextResponse } from 'next/server';

import { loadInsightsForLeague, type InsightsResponse } from '@/lib/insights/loadInsights';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { loadWeeklyRecap } from '@/lib/recap/loadWeeklyRecap';
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
