import { NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/server/adminAuth';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';
import { getLeague } from '@/lib/leagueRegistry';
import {
  type DraftState,
  type DraftPick,
  draftScope,
  getDraftEligibleTeams,
  patchConfirmedOwnersCsv,
} from '@/lib/draft';
import { createTeamIdentityResolver, type TeamCatalogItem } from '@/lib/teamIdentity';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import teamsData from '@/data/teams.json';
import { draftPicksSignature } from '@/lib/selectors/draftPublication';

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

  // PLATFORM-094 remediation — everything derived from the DRAFT is derived
  // inside the transaction below. Only request-shaped work happens out here:
  // parsing the body and resolving the submitted team against the catalog, both
  // of which depend on the request and the static catalog, not on stored state.
  //
  // The previous shape read the draft here, computed `previousTeam`, the
  // replacement pick and the duplicate-team check from that snapshot, and then
  // wrote from a SECOND read taken inside the transaction — mixing two
  // snapshots. Two edits to the same pick in succession then patched the roster
  // with an `oldTeam` that had already been replaced, so
  // `patchConfirmedOwnersCsv` released a row that was already released and the
  // first edit's team kept its owner: the stored roster silently credited
  // someone a team the draft did not show.
  const pickIndex = pickNumber - 1;

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

  // One transaction over both records — the picks and the roster describing them
  // cannot be left disagreeing by a failure in between, and a re-stamped
  // signature has to land with the roster it re-describes.
  //
  // The draft is re-read INSIDE the transaction rather than reusing the snapshot
  // above. Reading outside gave atomicity without isolation: a confirmation
  // committing in between would be overwritten by this write, wiping the
  // publication it had just recorded and leaving a roster the draft no longer
  // claims. `confirm-eligibility.test.ts` pins the same rule for the publish
  // path; this route holds itself to it.
  type Refusal = { error: string; status: number };
  let outcome: Refusal | { ok: true; draft: DraftState; pick: DraftPick } | null = null;
  let rosterPatched = false;

  await withAppStateKeyTransaction(draftScope(slug), String(year), async (txn) => {
    await txn.lockKey(`owners:${slug}:${year}`, 'csv');

    const current = (await txn.read<DraftState>())?.value;
    if (!current) {
      outcome = { error: `No draft found for ${slug} ${year}`, status: 404 };
      return;
    }

    // The phase and index guards run HERE, against the record actually being
    // written. Held outside, a `/reset` or `/unpick` landing in between left the
    // edit silently dropped — the mapped picks never reached `pickIndex` — while
    // the route still returned 200 with a pick it had not persisted, and wrote
    // back a draft in a phase it refuses to edit.
    if (current.phase !== 'live' && current.phase !== 'paused' && current.phase !== 'complete') {
      outcome = { error: `Cannot edit picks in phase: ${current.phase}`, status: 422 };
      return;
    }
    if (pickIndex >= current.picks.length) {
      outcome = { error: `Pick ${pickNumber} has not been made yet`, status: 404 };
      return;
    }

    // Duplicate-team validation against the CURRENT picks. Held outside, two
    // concurrent edits naming the same unclaimed team both passed their
    // pre-lock checks and serialized into a draft holding that team twice —
    // which `POST /confirm` then refuses permanently.
    const conflicting = current.picks.find(
      (p, idx) => idx !== pickIndex && p.team.toLowerCase() === canonicalTeam.toLowerCase()
    );
    if (conflicting) {
      outcome = {
        error: `"${canonicalTeam}" is already pick #${conflicting.pickNumber} by ${conflicting.owner}`,
        status: 422,
      };
      return;
    }

    const target = current.picks[pickIndex]!;
    const previousTeam = target.team;
    const replacement: DraftPick = {
      ...target,
      team: canonicalTeam,
      pickedAt: editedAt,
      autoSelected: false,
    };
    const nextPicks = current.picks.map((p, idx) => (idx === pickIndex ? replacement : p));

    // Sync the stored roster whenever the draft is COMPLETE and a roster exists
    // — not when it is "published".
    //
    // Gating on publication dropped every draft confirmed before `publishedPicks`
    // existed: no signature, so no patch, so a pick edit returned 200 while
    // standings kept crediting the old team→owner, silently. That is the
    // PLATFORM-072 defect returning through the new field.
    //
    // `phase === 'complete'` is what keeps a REOPENED draft out — reopen sets
    // `live`, and its contract is that the previous roster stands until the
    // commissioner confirms again — and requiring an existing CSV is what stops
    // this route minting one, since it is not the publication authority.
    if (current.phase === 'complete') {
      const ownersRecord = await txn.readKey<string>(`owners:${slug}:${year}`, 'csv');
      const currentCsv = ownersRecord?.value;
      if (typeof currentCsv === 'string' && currentCsv.trim()) {
        await txn.writeKey(
          `owners:${slug}:${year}`,
          'csv',
          patchConfirmedOwnersCsv(currentCsv, {
            oldTeam: previousTeam,
            newTeam: canonicalTeam,
            fallbackOwner: replacement.owner,
            // Match persisted rows through the same canonical resolver used to
            // validate the incoming team, so an alias/alt label stored via
            // /api/owners resolves to the same slot (no stale duplicate row).
            resolveTeam: (label: string) => resolver.resolveName(label).canonicalName ?? label,
          })
        );
        rosterPatched = true;
      }
    }

    // Re-stamp ONLY when a roster was actually patched. Nothing else may claim
    // publication: `PUT /api/owners` can blank the CSV, and this route would
    // otherwise record a publication of picks no roster describes.
    //
    // For a draft confirmed before this field existed, the patch above just made
    // the stored roster describe these picks — so stamping here BACKFILLS the
    // signature truthfully, instead of needing a migration.
    const written: DraftState = {
      ...current,
      picks: nextPicks,
      publishedPicks: rosterPatched ? draftPicksSignature(nextPicks) : current.publishedPicks,
      updatedAt: editedAt,
    };
    await txn.write<DraftState>(written);
    outcome = { ok: true, draft: written, pick: replacement };
  });

  const settled = outcome as Refusal | { ok: true; draft: DraftState; pick: DraftPick } | null;
  if (!settled) {
    return NextResponse.json({ error: 'edit did not complete' }, { status: 500 });
  }
  if (!('ok' in settled)) {
    return NextResponse.json({ error: settled.error }, { status: settled.status });
  }

  if (rosterPatched) invalidateStandings(slug, year);

  return NextResponse.json({ draft: settled.draft, pick: settled.pick });
}
