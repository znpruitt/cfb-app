import { NextResponse } from 'next/server';

import { getLeague } from '@/lib/leagueRegistry';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { getSeasonArchive, resolveArchiveYearParam } from '@/lib/seasonArchive';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const { slug, year: yearParam } = await params;

  // Password-gate: blend unauthorized access into the same 404 shape unknown
  // leagues return, so API callers can't distinguish "passworded" from "missing".
  // Pass req so the gate honors ADMIN_API_TOKEN in addition to Clerk session.
  if (!(await isAuthorizedForLeague(slug, req))) {
    return new Response(null, { status: 404 });
  }

  // AHEAD OF THE YEAR CHECK — #774. The bound is relative to the league (its
  // operating year, and the seasons it has archived), so it cannot be applied
  // before the record is in hand. Free and behaviour-preserving: the gate above
  // already returns false for an unknown league (its first check, before the
  // numbered conditions), so an unknown slug still 404s there and never reaches
  // a 400 that would confirm the league exists — and `getLeague`
  // is `React.cache`-wrapped, so this is the same read the gate just did.
  const league = await getLeague(slug);
  if (!league) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  // #774 — the year segment had a floor and NO ceiling, and used `Number()`, so
  // `2026.5`, `2026.0000001`, `2e10` and `0x7E0` all passed and each became a
  // distinct `revalidate: false` cache entry keyed on `String(year)`. Measured:
  // 11 requests produced 8 entries on disk. The per-year tag such an entry
  // carries can never fire — no writer can emit `archive:<slug>:2026.5` — so it
  // survives until the league's next archive write fires the slug tag, which is
  // once a season.
  const resolved = await resolveArchiveYearParam(slug, yearParam, league);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, field: 'year' }, { status: 400 });
  }
  const year = resolved.year;

  const archive = await getSeasonArchive(slug, year);
  if (!archive) {
    // PLAIN TEXT, deliberately, beside a JSON 400. Only the refusal shape is in
    // #774's scope, and it matches #770 so AGENTS.md invariant 4 describes one
    // rule rather than two. Converting the 404s would be a second, unreviewed
    // behaviour change, and the route has no in-app callers to keep consistent.
    // Recorded as residue on #774 rather than filed.
    return new Response(`No archive found for ${slug} season ${year}`, { status: 404 });
  }

  return Response.json(archive);
}
