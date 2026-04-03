import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, draftScope } from '@/lib/draft';

export const dynamic = 'force-dynamic';

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

/**
 * POST /api/draft/[slug]/[year]/confirm
 *
 * Writes the final draft roster to appStateStore as the official owner assignment
 * for the season — equivalent to a CSV upload via /api/owners.
 *
 * Scope: owners:${slug}:${year}, key: 'csv'
 * Format: CSV with header "team,owner" followed by one row per pick.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug, year: yearParam } = await params;
  const year = parseYear(yearParam);
  if (!year) {
    return NextResponse.json({ error: 'year must be an integer >= 2000' }, { status: 400 });
  }

  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json({ error: `League "${slug}" not found` }, { status: 404 });
  }

  const record = await getAppState<DraftState>(draftScope(slug), String(year));
  if (!record?.value) {
    return NextResponse.json(
      { error: `No draft found for ${slug} ${year}` },
      { status: 404 }
    );
  }

  const draft = record.value;

  if (draft.phase !== 'live' && draft.phase !== 'complete') {
    return NextResponse.json(
      {
        error: `Cannot confirm draft in phase: ${draft.phase}. Draft must be live or complete.`,
      },
      { status: 422 }
    );
  }

  if (draft.picks.length === 0) {
    return NextResponse.json({ error: 'Cannot confirm draft with no picks' }, { status: 422 });
  }

  // Build owner assignment CSV — same format as the CSV upload route:
  // header row "team,owner" + one data row per pick.
  // parseOwnersCsv() in the schedule pipeline reads this format.
  const csvLines = ['team,owner'];
  for (const pick of draft.picks) {
    // Escape commas in team/owner names by quoting the field
    const teamField = pick.team.includes(',') ? `"${pick.team}"` : pick.team;
    const ownerField = pick.owner.includes(',') ? `"${pick.owner}"` : pick.owner;
    csvLines.push(`${teamField},${ownerField}`);
  }
  const csvString = csvLines.join('\n');

  // Write to the same scope/key pattern as /api/owners PUT:
  //   scope = owners:${slug}:${year}   key = 'csv'
  await setAppState(`owners:${slug}:${year}`, 'csv', csvString);

  // Advance phase to 'complete' if not already
  if (draft.phase !== 'complete') {
    const updated: DraftState = {
      ...draft,
      phase: 'complete',
      updatedAt: new Date().toISOString(),
    };
    await setAppState<DraftState>(draftScope(slug), String(year), updated);
  }

  const ownerCount = new Set(draft.picks.map((p) => p.owner)).size;
  const confirmedAt = new Date().toISOString();

  return NextResponse.json({
    success: true,
    leagueSlug: slug,
    year,
    ownerCount,
    teamCount: draft.picks.length,
    confirmedAt,
  });
}
