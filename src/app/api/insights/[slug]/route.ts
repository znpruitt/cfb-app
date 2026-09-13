import { NextResponse } from 'next/server';

import { loadInsightsForLeague, type InsightsResponse } from '@/lib/insights/loadInsights';
import { MIN_SEASON_YEAR, maxCreatableSeasonYear, type LeagueStatus } from '@/lib/league';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { loadWeeklyRecap } from '@/lib/recap/loadWeeklyRecap';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import {
  resolveDisplayLeagueStatus,
  resolveLeagueOperatingYear,
} from '@/lib/selectors/leagueLifecycle';

export const dynamic = 'force-dynamic';

/**
 * Digits only, deliberately — `Number.parseInt` accepts trailing junk, so the
 * parser this replaced read `?year=2026nonsense` as 2026. Mirrors
 * `parseNonNegativeInt` in `/api/rankings`, whose bound and error shape this
 * route now matches.
 */
function parseYearParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

type YearResolution = { ok: true; year: number | undefined } | { ok: false; error: string };

/**
 * Resolve the season this request is for — #770.
 *
 * THIS IS THE BOUND, and this is the only place it belongs. The parser it
 * replaced had a floor (`n >= 2000`) and NO ceiling, and the value went on to
 * become cache identity verbatim in TWO places: `insightsCacheKeyParts` and —
 * via `getCanonicalStandings({ year })`, where `resolveStandingsYear` lets an
 * explicit override win unconditionally — `canonicalStandingsCacheKeyParts`.
 * So every distinct `?year=` was a guaranteed miss, a full
 * `buildLeagueInsightContext` (measured at 112 ms against a 203 ms populated
 * build; the year-scoped reads all miss, the league-wide fixed cost does not),
 * and two new `unstable_cache` entries. The standings one carries
 * `revalidate: false` — tag-only, no time expiry — and its year tag can never
 * fire, so it survives on `standingsSlugTag(slug)` alone.
 *
 * WHY HERE rather than at either cache key: this is the one place that can tell
 * a CALLER-SUPPLIED year from a SERVER-DERIVED one, and only the former may
 * ever be rejected. A bound at a key could not make that distinction, and would
 * have to treat a league's own operating year as suspect.
 *
 * The range is derived, not invented: `maxCreatableSeasonYear` is what caps a
 * league's year on creation, and rollover advances `status.year` one season at
 * a time, so `currentYear + 1` is the widest year the registry can legitimately
 * hold. It is also what `/api/rankings`, `/api/schedule` and `/api/game-stats`
 * already enforce. Reused rather than recopied so the two cannot drift.
 *
 * THE DISJUNCT IS LOAD-BEARING, and it is not belt-and-braces. A range alone
 * makes rejecting a league's own operating year merely unlikely; matching
 * `resolveLeagueOperatingYear` makes it STRUCTURALLY IMPOSSIBLE, whatever the
 * registry holds and however it got there. A bound that breaks the
 * operating-year path in preseason would be worse than the defect it closes.
 */
function resolveRequestedYear(
  raw: string | null,
  league: { status?: LeagueStatus | null; year: number } | null,
  now: Date
): YearResolution {
  const operatingYear = league ? resolveLeagueOperatingYear(league) : undefined;

  // TRIMMED ONCE, and both decisions below read the trimmed value. The first cut
  // decided EMPTINESS on the trimmed string and VALIDITY on the untrimmed one,
  // so `?year=%20` was absent (200) while `?year=%202026` — the same padding
  // around a perfectly good year — was a hard 400 that `Number.parseInt` had
  // served before this slice. Review finding; the inconsistency was mine, and
  // the padded value is not the defect #770 is about.
  const trimmed = raw?.trim() ?? '';

  // An absent `year` is the DEFAULT request, not a rejected one: it resolves to
  // the server-derived operating year, which is never subjected to the bound.
  // An empty value is treated as absent rather than invalid, preserving what
  // `?year=` did before — the change this slice makes is to absurd years, and
  // widening it to empty ones would be an unreviewed second behaviour change.
  if (trimmed === '') return { ok: true, year: operatingYear };

  const maxYear = maxCreatableSeasonYear(now.getTime());
  const parsed = parseYearParam(trimmed);
  if (parsed !== null) {
    if (parsed >= MIN_SEASON_YEAR && parsed <= maxYear) return { ok: true, year: parsed };
    if (operatingYear !== undefined && parsed === operatingYear) {
      return { ok: true, year: parsed };
    }
  }

  return { ok: false, error: `year must be an integer between ${MIN_SEASON_YEAR} and ${maxYear}` };
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
  const rawYear = url.searchParams.get('year');
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

  // AFTER the `bypassSuppression` guard above, deliberately. #627's refusal is
  // the first thing an anonymous caller passing that parameter must meet, and
  // validating the year ahead of it would answer some of those requests with a
  // 400 instead — a change to the refusal surface that slice's boundary forbids.
  const requestedYear = resolveRequestedYear(rawYear, league, now);
  if (!requestedYear.ok) {
    return NextResponse.json({ error: requestedYear.error, field: 'year' }, { status: 400 });
  }
  const resolvedYear = requestedYear.year;

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
