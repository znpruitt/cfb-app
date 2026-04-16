import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, draftScope } from '@/lib/draft';
import { createTeamIdentityResolver, type TeamCatalogItem } from '@/lib/teamIdentity';
import { SEED_ALIASES, type AliasMap } from '@/lib/teamNames';
import teamsData from '@/data/teams.json';

type TeamsJson = { items: TeamCatalogItem[] };

export const dynamic = 'force-dynamic';

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

/** PUT /api/draft/[slug]/[year]/pick/[n] — edit pick n (1-indexed pickNumber) */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string; n: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug, year: yearParam, n: nParam } = await params;
  const year = parseYear(yearParam);
  if (!year) {
    return NextResponse.json({ error: 'year must be an integer >= 2000' }, { status: 400 });
  }

  const pickNumber = Number.parseInt(nParam, 10);
  if (!Number.isFinite(pickNumber) || pickNumber < 1) {
    return NextResponse.json(
      { error: 'n must be a positive integer pick number' },
      { status: 400 }
    );
  }

  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json({ error: `League "${slug}" not found` }, { status: 404 });
  }

  const record = await getAppState<DraftState>(draftScope(slug), String(year));
  if (!record?.value) {
    return NextResponse.json({ error: `No draft found for ${slug} ${year}` }, { status: 404 });
  }

  const draft = { ...record.value };

  if (draft.phase !== 'live' && draft.phase !== 'paused' && draft.phase !== 'complete') {
    return NextResponse.json(
      { error: `Cannot edit picks in phase: ${draft.phase}` },
      { status: 422 }
    );
  }

  const pickIndex = pickNumber - 1;
  if (pickIndex >= draft.picks.length) {
    return NextResponse.json(
      { error: `Pick ${pickNumber} has not been made yet` },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { team } = body as { team?: unknown };
  if (typeof team !== 'string' || !team.trim()) {
    return NextResponse.json({ error: 'team is required' }, { status: 400 });
  }

  const teamName = team.trim();

  // Resolve team via canonical teamIdentity resolver (handles aliases, normalization)
  const { items } = teamsData as TeamsJson;
  const aliasRecord = await getAppState<AliasMap>(`aliases:${year}`, 'map');
  const aliasMap: AliasMap =
    aliasRecord?.value && typeof aliasRecord.value === 'object' && !Array.isArray(aliasRecord.value)
      ? { ...SEED_ALIASES, ...aliasRecord.value }
      : { ...SEED_ALIASES };
  const resolver = createTeamIdentityResolver({ aliasMap, teams: items });
  const resolution = resolver.resolveName(teamName);

  if (!resolution.canonicalName || resolution.canonicalName === 'NoClaim') {
    return NextResponse.json(
      { error: `Team "${teamName}" not found in FBS catalog` },
      { status: 400 }
    );
  }

  const canonicalTeam = resolution.canonicalName;

  // Validate team not already picked at another position
  const conflicting = draft.picks.find(
    (p, idx) => idx !== pickIndex && p.team.toLowerCase() === canonicalTeam.toLowerCase()
  );
  if (conflicting) {
    return NextResponse.json(
      {
        error: `"${canonicalTeam}" is already pick #${conflicting.pickNumber} by ${conflicting.owner}`,
      },
      { status: 422 }
    );
  }

  const newPicks = draft.picks.map((p, idx) =>
    idx === pickIndex
      ? { ...p, team: canonicalTeam, pickedAt: new Date().toISOString(), autoSelected: false }
      : p
  );

  const updated: DraftState = {
    ...draft,
    picks: newPicks,
    updatedAt: new Date().toISOString(),
  };

  await setAppState<DraftState>(draftScope(slug), String(year), updated);

  return NextResponse.json({ draft: updated, pick: newPicks[pickIndex] });
}
