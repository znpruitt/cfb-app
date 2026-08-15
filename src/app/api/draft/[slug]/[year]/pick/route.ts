import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';
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

/**
 * A refusal decided INSIDE the transaction. Returned rather than thrown so the
 * transaction commits nothing and finishes cleanly — the same shape
 * `confirm/route.ts` uses. Early `NextResponse` returns cannot be used inside
 * the callback, so every validation returns one of these and the caller maps it.
 */
type Refusal = { error: string; status: number };
type PickOutcome = Refusal | { ok: true; draft: DraftState; pick: DraftPick };

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

  // PLATFORM-102 — the draft record is read AND written inside one key
  // transaction. Previously this handler read at the top, derived for ~130
  // lines, then wrote the whole record back, so a concurrent writer's commit
  // landing in that window was silently erased by this write.
  //
  // The concrete loss this closes: `PUT { timerAction: 'expire' }` also appends
  // a pick, and `DraftBoardClient` fires it automatically when the countdown
  // reaches zero. A pick submitted as the clock ran out raced the auto-pick —
  // both read the same state, both appended, and the loser vanished while its
  // caller got a 200. Reading under the lock means the second writer sees the
  // first one's pick and refuses it (already-picked / wrong expected owner)
  // instead of overwriting it.
  //
  // Validation ORDER is unchanged from the pre-transaction version, deliberately:
  // several tests pin which error wins when a request is invalid in more than one
  // way, and reordering (e.g. parsing the body before checking the phase) would
  // change the response for an invalid-JSON POST to a non-live draft.
  const outcome = await withAppStateKeyTransaction<PickOutcome>(
    draftScope(slug),
    String(year),
    async (txn): Promise<PickOutcome> => {
      const record = await txn.read<DraftState>();
      if (!record?.value) {
        return { error: `No draft found for ${slug} ${year}`, status: 404 };
      }

      const draft = { ...record.value };

      if (draft.phase !== 'live') {
        return { error: `Draft is not live (phase: ${draft.phase})`, status: 422 };
      }

      const totalPicks = draft.settings.totalRounds * draft.owners.length;
      if (draft.currentPickIndex >= totalPicks) {
        return { error: 'Draft is complete — no more picks', status: 422 };
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return { error: 'request body must be valid JSON', status: 400 };
      }

      const { team, owner } = body as { team?: unknown; owner?: unknown };
      if (typeof team !== 'string' || !team.trim()) {
        return { error: 'team is required', status: 400 };
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
      if (
        !resolution.canonicalName ||
        !eligibleTeamNames.has(resolution.canonicalName.toLowerCase())
      ) {
        return { error: `Team "${teamName}" not found in FBS catalog`, status: 400 };
      }

      const canonicalTeam = resolution.canonicalName;

      // Validate team not already picked. This now reads the list UNDER the lock,
      // which is what makes it a real guard: previously it checked a snapshot a
      // concurrent writer could already have added to.
      const alreadyPicked = draft.picks.some(
        (p) => p.team?.toLowerCase() === canonicalTeam.toLowerCase()
      );
      if (alreadyPicked) {
        return { error: `"${canonicalTeam}" has already been picked`, status: 422 };
      }

      // Derive current pick owner from snake draft order
      const expectedOwner = getPickOwner(draft.settings.draftOrder, draft.currentPickIndex);

      // If owner provided, validate it matches
      if (typeof owner === 'string' && owner.trim() && owner.trim() !== expectedOwner) {
        return {
          error: `Expected pick owner is "${expectedOwner}", not "${owner.trim()}"`,
          status: 422,
        };
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

      await txn.write<DraftState>(updated);

      return { ok: true, draft: updated, pick };
    }
  );

  if (!('ok' in outcome)) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({ draft: outcome.draft, pick: outcome.pick });
}
