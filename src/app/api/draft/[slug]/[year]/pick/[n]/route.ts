import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, withAppStateKeyTransaction } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import {
  type DraftState,
  draftScope,
  getDraftEligibleTeams,
  draftPicksDigest,
  isDraftPublished,
  patchConfirmedOwnersCsv,
} from '@/lib/draft';
import { createTeamIdentityResolver, type TeamCatalogItem } from '@/lib/teamIdentity';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
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

  const previousTeam = draft.picks[pickIndex]!.team;

  const newPicks = draft.picks.map((p, idx) =>
    idx === pickIndex
      ? { ...p, team: canonicalTeam, pickedAt: new Date().toISOString(), autoSelected: false }
      : p
  );

  // PLATFORM-072: a PUBLISHED draft's persisted owner assignment
  // (owners:${slug}:${year} / 'csv') is the authoritative ownership source that
  // standings / gameOwnership consume, so editing a pick in draft state alone
  // would leave it crediting the old team→owner. Patch that CSV so the change
  // follows the edit, then bust the cached standings snapshot.
  //
  // Patch rather than rebuild-from-picks: the store is shared with
  // PUT /api/owners (admin repair/override), and a rebuild would silently
  // discard unrelated manual reassignments.
  //
  // PLATFORM-094 — gated on PUBLICATION, which requires `phase: 'complete'`.
  // A reopened draft is `live`, and the reopen contract is that the previously
  // confirmed roster stays in effect until the commissioner confirms again —
  // so an edit mid-reopen must NOT rewrite live ownership. A
  // complete-but-never-confirmed draft has no authoritative roster to follow at
  // all, and must not have one minted for it here: this route is not the
  // publication authority.
  const editedAt = new Date().toISOString();
  const wasPublished = isDraftPublished(draft);

  // One transaction over both records — the picks and the roster describing them
  // cannot be left disagreeing by a failure in between, and the re-stamped digest
  // has to land with the roster it re-describes.
  await withAppStateKeyTransaction(draftScope(slug), String(year), async (txn) => {
    await txn.lockKey(`owners:${slug}:${year}`, 'csv');

    if (wasPublished) {
      const ownersRecord = await txn.readKey<string>(`owners:${slug}:${year}`, 'csv');
      const currentCsv = ownersRecord?.value;
      if (typeof currentCsv === 'string' && currentCsv.trim()) {
        await txn.writeKey(
          `owners:${slug}:${year}`,
          'csv',
          patchConfirmedOwnersCsv(currentCsv, {
            oldTeam: previousTeam,
            newTeam: canonicalTeam,
            fallbackOwner: newPicks[pickIndex]!.owner,
            // Match persisted rows through the same canonical resolver used to
            // validate the incoming team, so an alias/alt label stored via
            // /api/owners resolves to the same slot (no stale duplicate row).
            resolveTeam: (label: string) => resolver.resolveName(label).canonicalName ?? label,
          })
        );
      }
    }

    // The roster was carried along, so it still describes the picks — re-stamp
    // the digest over the NEW picks. This is the one place a writer opts back
    // into publication, and only because it just made the roster match.
    await txn.write<DraftState>({
      ...draft,
      picks: newPicks,
      publishedPicks: wasPublished ? draftPicksDigest(newPicks) : draft.publishedPicks,
      updatedAt: editedAt,
    });
  });

  if (wasPublished) invalidateStandings(slug, year);

  const updated: DraftState = {
    ...draft,
    picks: newPicks,
    publishedPicks: wasPublished ? draftPicksDigest(newPicks) : draft.publishedPicks,
    updatedAt: editedAt,
  };

  return NextResponse.json({ draft: updated, pick: newPicks[pickIndex] });
}
