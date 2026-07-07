import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import {
  type DraftState,
  draftScope,
  getDraftEligibleTeams,
  buildConfirmedOwnersCsv,
} from '@/lib/draft';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import teamsData from '@/data/teams.json';

type TeamsJson = { items: TeamCatalogItem[] };

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

  // Derive expected pick count from the draft's CONFIGURED round count — the same
  // value setup/update validate (1 <= totalRounds <= floor(eligibleCount / owners))
  // and the value the live draft completes against (totalRounds * ownerCount). A
  // commissioner may run fewer than the catalog maximum rounds, so confirmation must
  // honor totalRounds rather than recomputing the max from the full catalog; doing
  // the latter 422s every sub-max-round draft. Eligibility (which teams may be
  // drafted at all, and which fill NoClaim) is defined by the shared
  // getDraftEligibleTeams helper so it matches setup/update/auto-pick exactly. Every
  // undrafted eligible team — not just an even-division remainder — is written as
  // NoClaim below.
  const { items: allTeams } = teamsData as TeamsJson;
  const eligibleTeams = getDraftEligibleTeams(allTeams);
  const ownerCount = draft.owners.length;
  const teamsPerOwner = draft.settings.totalRounds;
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

  // Validate all pick.team values resolve to a draft-eligible team in the catalog.
  const eligibleTeamNames = new Set(eligibleTeams.map((t) => t.school.toLowerCase()));
  const unrecognizedTeams = draft.picks
    .filter((p) => !eligibleTeamNames.has(p.team.toLowerCase()))
    .map((p) => p.team);
  if (unrecognizedTeams.length > 0) {
    return NextResponse.json(
      {
        error: `Unrecognized team names found in draft picks: ${unrecognizedTeams.join(', ')}. These do not match any known FBS team. Resolve before confirming.`,
      },
      { status: 422 }
    );
  }

  // Build owner assignment CSV — same format as the CSV upload route (header
  // "team,owner" + one row per pick, then NoClaim for undrafted eligible teams).
  // Shared builder with the post-confirm pick-edit path so the two can't diverge.
  const draftedTeamsLower = new Set(draft.picks.map((p) => p.team.toLowerCase()));
  const undraftedEligibleCount = eligibleTeams.filter(
    (t) => !draftedTeamsLower.has(t.school.toLowerCase())
  ).length;
  const { csv: csvString, rowCount } = buildConfirmedOwnersCsv(draft.picks, eligibleTeams);

  // Belt-and-suspenders: verify the builder's structural row count before writing.
  const expectedTotalRows = totalExpectedPicks + undraftedEligibleCount;
  if (rowCount !== expectedTotalRows) {
    return NextResponse.json(
      {
        error: `CSV generation error — expected ${expectedTotalRows} rows (${totalExpectedPicks} drafted + ${undraftedEligibleCount} unclaimed) but produced ${rowCount}. Do not write partial data.`,
      },
      { status: 422 }
    );
  }

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

  invalidateStandings(slug, year);

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

  // The previously written owner CSV remains in scope (per route doc above);
  // reopening still affects which roster the canonical selector should
  // consider authoritative for downstream renders, so invalidate.
  invalidateStandings(slug, year);

  return NextResponse.json({ draft: updated });
}
