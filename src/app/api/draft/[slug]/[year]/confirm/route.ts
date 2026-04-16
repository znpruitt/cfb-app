import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, draftScope } from '@/lib/draft';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import teamsData from '@/data/teams.json';

type TeamsJson = { items: TeamCatalogItem[] };

export const dynamic = 'force-dynamic';

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

/** RFC 4180 CSV field serialization. */
function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
  const authFailure = await requireAdminRequest(req);
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
    return NextResponse.json({ error: `No draft found for ${slug} ${year}` }, { status: 404 });
  }

  const draft = record.value;

  // Derive expected pick count from FBS team catalog at runtime — never hardcoded.
  // teamsPerOwner = floor(fbsTeamCount / ownerCount); totalExpectedPicks = teamsPerOwner * ownerCount.
  // NoClaim teams fill the remainder and are not assigned to any owner.
  const { items: allTeams } = teamsData as TeamsJson;
  const fbsTeamCount = allTeams.filter((t) => t.classification?.toLowerCase() === 'fbs').length;
  const ownerCount = draft.owners.length;
  const teamsPerOwner = Math.floor(fbsTeamCount / ownerCount);
  const totalExpectedPicks = teamsPerOwner * ownerCount;

  if (draft.picks.length !== totalExpectedPicks) {
    return NextResponse.json(
      {
        error: `Draft is not complete — ${draft.picks.length} of ${totalExpectedPicks} picks have been made (${teamsPerOwner} teams per owner × ${ownerCount} owners)`,
      },
      { status: 422 }
    );
  }

  // Validate that every owner has exactly teamsPerOwner picks — no skew allowed.
  const pickCountByOwner = new Map<string, number>();
  for (const pick of draft.picks) {
    pickCountByOwner.set(pick.owner, (pickCountByOwner.get(pick.owner) ?? 0) + 1);
  }
  const uneven = Array.from(pickCountByOwner.values()).some((n) => n !== teamsPerOwner);
  if (uneven) {
    return NextResponse.json(
      {
        error: `Pick counts are uneven — all owners must have exactly ${teamsPerOwner} teams before confirming`,
      },
      { status: 422 }
    );
  }

  // Validate no team appears in more than one pick.
  const teamToPicks = new Map<string, number[]>();
  for (const pick of draft.picks) {
    const key = pick.team.toLowerCase();
    const existing = teamToPicks.get(key) ?? [];
    existing.push(pick.pickNumber);
    teamToPicks.set(key, existing);
  }
  const duplicateTeams = Array.from(teamToPicks.entries())
    .filter(([, picks]) => picks.length > 1)
    .map(([team]) => draft.picks.find((p) => p.team.toLowerCase() === team)?.team ?? team);
  if (duplicateTeams.length > 0) {
    return NextResponse.json(
      {
        error: `Duplicate team assignments found — the following teams have been picked more than once: ${duplicateTeams.join(', ')}. Resolve before confirming.`,
      },
      { status: 422 }
    );
  }

  // Validate all pick.team values resolve to a known FBS team in the catalog.
  const fbsTeamNames = new Set(
    allTeams
      .filter((t) => t.classification?.toLowerCase() === 'fbs')
      .map((t) => t.school.toLowerCase())
  );
  const unrecognizedTeams = draft.picks
    .filter((p) => !fbsTeamNames.has(p.team.toLowerCase()))
    .map((p) => p.team);
  if (unrecognizedTeams.length > 0) {
    return NextResponse.json(
      {
        error: `Unrecognized team names found in draft picks: ${unrecognizedTeams.join(', ')}. These do not match any known FBS team. Resolve before confirming.`,
      },
      { status: 422 }
    );
  }

  // Build owner assignment CSV — same format as the CSV upload route:
  // header row "team,owner" + one data row per pick.
  // parseOwnersCsv() in the schedule pipeline reads this format.
  const csvLines = ['team,owner'];
  for (const pick of draft.picks) {
    csvLines.push(`${csvField(pick.team)},${csvField(pick.owner)}`);
  }

  // Append NoClaim rows for undrafted FBS teams (remainder after even division).
  const draftedTeamsLower = new Set(draft.picks.map((p) => p.team.toLowerCase()));
  const undraftedFbsTeams = allTeams
    .filter(
      (t) =>
        t.classification?.toLowerCase() === 'fbs' && !draftedTeamsLower.has(t.school.toLowerCase())
    )
    .map((t) => t.school);
  for (const teamName of undraftedFbsTeams) {
    csvLines.push(`${csvField(teamName)},NoClaim`);
  }

  // Belt-and-suspenders: verify CSV row count before writing.
  const expectedTotalRows = totalExpectedPicks + undraftedFbsTeams.length;
  const rowCount = csvLines.length - 1; // exclude header
  if (rowCount !== expectedTotalRows) {
    return NextResponse.json(
      {
        error: `CSV generation error — expected ${expectedTotalRows} rows (${totalExpectedPicks} drafted + ${undraftedFbsTeams.length} unclaimed) but produced ${rowCount}. Do not write partial data.`,
      },
      { status: 422 }
    );
  }

  const csvString = csvLines.join('\n');

  // Write to the same scope/key pattern as /api/owners PUT:
  //   scope = owners:${slug}:${year}   key = 'csv'
  await setAppState(`owners:${slug}:${year}`, 'csv', csvString);

  // Advance phase to 'complete' if not already.
  if (draft.phase !== 'complete') {
    const updated: DraftState = {
      ...draft,
      phase: 'complete',
      updatedAt: new Date().toISOString(),
    };
    await setAppState<DraftState>(draftScope(slug), String(year), updated);
  }

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

/**
 * DELETE /api/draft/[slug]/[year]/confirm
 *
 * Reopens a confirmed draft by setting phase back to 'live'.
 * Picks are preserved. The previously written owner assignment in appStateStore
 * is NOT cleared — it remains in effect until the commissioner confirms again.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
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
    return NextResponse.json({ error: `No draft found for ${slug} ${year}` }, { status: 404 });
  }

  const draft = record.value;

  if (draft.phase !== 'complete') {
    return NextResponse.json(
      {
        error: `Cannot reopen draft in phase: ${draft.phase}. Only a confirmed (complete) draft can be reopened.`,
      },
      { status: 422 }
    );
  }

  const updated: DraftState = {
    ...draft,
    phase: 'live',
    updatedAt: new Date().toISOString(),
  };

  await setAppState<DraftState>(draftScope(slug), String(year), updated);

  return NextResponse.json({ draft: updated });
}
