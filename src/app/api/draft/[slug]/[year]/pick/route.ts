import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, type DraftPick, draftScope } from '@/lib/draft';
import { createTeamIdentityResolver, type TeamCatalogItem } from '@/lib/teamIdentity';
import { SEED_ALIASES, type AliasMap } from '@/lib/teamNames';
import teamsData from '@/data/teams.json';

type TeamsJson = { items: TeamCatalogItem[] };

export const dynamic = 'force-dynamic';

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : null;
}

/** Derive which owner picks at a given 0-based pickIndex in a snake draft. */
function getPickOwner(draftOrder: string[], pickIndex: number): string {
  const n = draftOrder.length;
  const round = Math.floor(pickIndex / n);
  const posInRound = pickIndex % n;
  const ownerIdx = round % 2 === 0 ? posInRound : n - 1 - posInRound;
  return draftOrder[ownerIdx]!;
}

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
    return NextResponse.json({ error: `No draft found for ${slug} ${year}` }, { status: 404 });
  }

  const draft = { ...record.value };

  if (draft.phase !== 'live') {
    return NextResponse.json(
      { error: `Draft is not live (phase: ${draft.phase})` },
      { status: 422 }
    );
  }

  const totalPicks = draft.settings.totalRounds * draft.owners.length;
  if (draft.currentPickIndex >= totalPicks) {
    return NextResponse.json({ error: 'Draft is complete — no more picks' }, { status: 422 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { team, owner } = body as { team?: unknown; owner?: unknown };
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

  // Validate team not already picked
  const alreadyPicked = draft.picks.some(
    (p) => p.team.toLowerCase() === canonicalTeam.toLowerCase()
  );
  if (alreadyPicked) {
    return NextResponse.json(
      { error: `"${canonicalTeam}" has already been picked` },
      { status: 422 }
    );
  }

  // Derive current pick owner from snake draft order
  const expectedOwner = getPickOwner(draft.settings.draftOrder, draft.currentPickIndex);

  // If owner provided, validate it matches
  if (typeof owner === 'string' && owner.trim() && owner.trim() !== expectedOwner) {
    return NextResponse.json(
      { error: `Expected pick owner is "${expectedOwner}", not "${owner.trim()}"` },
      { status: 422 }
    );
  }

  const n = draft.owners.length;
  const round = Math.floor(draft.currentPickIndex / n);
  const roundPick = draft.currentPickIndex % n;

  const pick: DraftPick = {
    pickNumber: draft.currentPickIndex + 1,
    round,
    roundPick,
    owner: expectedOwner,
    team: canonicalTeam,
    pickedAt: new Date().toISOString(),
    autoSelected: false,
  };

  const newPickIndex = draft.currentPickIndex + 1;
  const isComplete = newPickIndex >= totalPicks;
  const { pickTimerSeconds } = draft.settings;

  const timerExpiresAt =
    !isComplete && pickTimerSeconds
      ? new Date(Date.now() + pickTimerSeconds * 1000).toISOString()
      : null;
  const timerState = !isComplete && pickTimerSeconds ? 'running' : 'off';

  const updated: DraftState = {
    ...draft,
    picks: [...draft.picks, pick],
    currentPickIndex: newPickIndex,
    phase: isComplete ? 'complete' : 'live',
    timerState,
    timerExpiresAt,
    updatedAt: new Date().toISOString(),
  };

  await setAppState<DraftState>(draftScope(slug), String(year), updated);

  return NextResponse.json({ draft: updated, pick });
}
