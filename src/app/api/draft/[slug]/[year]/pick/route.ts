import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import { type DraftState, type DraftPick, draftScope, getDraftEligibleTeams } from '@/lib/draft';
import { createTeamIdentityResolver, type TeamCatalogItem } from '@/lib/teamIdentity';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
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

  // Resolve team via canonical teamIdentity resolver (handles aliases, normalization).
  // Use the shared scoped alias source so stored global aliases are honored
  // (precedence: stored global > year > SEED_ALIASES) — the same map canonical
  // runtime resolution sees. Building it locally from year+seed here silently
  // bypassed stored global aliases (PLATFORM-069).
  const { items } = teamsData as TeamsJson;
  const aliasMap = await getScopedAliasMap('', year);
  const resolver = createTeamIdentityResolver({ aliasMap, teams: items });
  const resolution = resolver.resolveName(teamName);

  // The resolved name must be a real draft-eligible catalog team. Checking
  // membership in the eligible school set (not just `!= NoClaim`) keeps pick
  // acceptance consistent with the confirm route — otherwise an alias that
  // resolves to a non-catalog name (e.g. an FCS school) would be accepted here
  // but rejected at confirmation, leaving an unconfirmable draft.
  const eligibleTeamNames = new Set(
    getDraftEligibleTeams(items).map((t) => t.school.toLowerCase())
  );
  if (!resolution.canonicalName || !eligibleTeamNames.has(resolution.canonicalName.toLowerCase())) {
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

  // Round boundary: the advanced index lands exactly on the start of a fresh
  // round (and the draft isn't finished). Pause so the commissioner must
  // explicitly start the next round. This is now server-authoritative — it
  // replaces the old client-side maybeAutoPauseForRound second round-trip.
  const atRoundBoundary = !isComplete && newPickIndex > 0 && newPickIndex % n === 0;

  // Compute phase + timer up front so the value we persist is exactly the value
  // we return (no stamp-after-write divergence — guarded by DRAFT-001 tests).
  let nextPhase: DraftState['phase'];
  let timerState: DraftState['timerState'];
  let timerExpiresAt: string | null;

  if (isComplete) {
    nextPhase = 'complete';
    timerState = 'off';
    timerExpiresAt = null;
  } else if (atRoundBoundary) {
    nextPhase = 'paused';
    timerState = pickTimerSeconds ? 'paused' : 'off';
    timerExpiresAt = null;
  } else {
    nextPhase = 'live';
    timerState = pickTimerSeconds ? 'running' : 'off';
    timerExpiresAt = pickTimerSeconds
      ? new Date(Date.now() + pickTimerSeconds * 1000).toISOString()
      : null;
  }

  const updated: DraftState = {
    ...draft,
    picks: [...draft.picks, pick],
    currentPickIndex: newPickIndex,
    phase: nextPhase,
    timerState,
    timerExpiresAt,
    updatedAt: new Date().toISOString(),
  };

  await setAppState<DraftState>(draftScope(slug), String(year), updated);

  return NextResponse.json({ draft: updated, pick });
}
