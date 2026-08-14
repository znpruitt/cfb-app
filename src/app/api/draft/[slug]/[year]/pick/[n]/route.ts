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
import { draftPicksSignature, isDraftPublished } from '@/lib/selectors/draftPublication';

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
  // above. Reading outside gave atomicity without isolation against the other
  // TRANSACTIONAL writer: a confirmation committing in between would be
  // overwritten by this write, wiping the publication it had just recorded and
  // leaving a roster the draft no longer claims. THAT race is closed, because
  // `POST /confirm` takes this same lock. The non-transactional writers noted
  // below are not, and no re-read can fix that from here.
  // `confirm-eligibility.test.ts` pins the same rule for the publish path.
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
    //
    // This NARROWS that window; it does not close it. `withAppStateKeyTransaction`
    // serializes only against other transactions on the same key, and `/reset`,
    // `/unpick`, `POST /pick`, the settings `PUT` and the reopen `DELETE` all
    // still write this record with unlocked `setAppState`. One of those
    // committing AFTER this read is still clobbered by the write below. Closing
    // it means putting every draft writer on the same lock — filed in
    // `docs/next-tasks.md` as draft-writer serialization, and pre-existing: no
    // draft route on `main` uses a transaction at all.
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
    // PLATFORM-096 — a held team is MOVED, not refused.
    //
    // This used to 422, which is why a mis-entered draft could not be corrected:
    // giving Alice a team Bob holds was impossible, and nothing could free one.
    // The team now transfers and Bob's slot is left EMPTY for the commissioner
    // to fill. Deliberately not a swap — the owner rejected that, because the
    // fix is often not a clean exchange ("Alice should have Michigan, and
    // Michigan's owner should get something else entirely").
    //
    // Safe because an empty slot cannot be published: `POST /confirm` refuses a
    // draft holding one, and standings read the confirmed roster rather than the
    // draft, so a half-corrected draft never reaches anyone's record.
    //
    // Only while UNPUBLISHED. Once a draft has published, its picks describe the
    // league's live rosters and vacating one would detach a roster from the
    // draft that produced it; post-publication corrections are a roster edit.
    const displacedIndex = current.picks.findIndex(
      (p, idx) => idx !== pickIndex && p.team?.toLowerCase() === canonicalTeam.toLowerCase()
    );
    // The refusal uses the SAME condition as the roster sync below, not
    // `isDraftPublished`. Those are different predicates and the gap between them
    // was reachable: a draft confirmed before `publishedPicks` existed, or one
    // beside a repair-imported CSV, is `complete` with a live roster but reads as
    // unpublished — so the move was permitted AND the CSV was patched, leaving an
    // owner holding nothing in live standings mid-correction. Both reviewers
    // reproduced it against the real routes.
    //
    // The design claim that motivated this feature — "standings never read draft
    // picks, so an empty slot cannot reach anyone's record" — is true of
    // `standings.ts` and false of THIS ROUTE, which is the writer that carries a
    // pick edit into the roster. Vacating is only safe where no roster is being
    // maintained.
    const rosterRecord = await txn.readKey<string>(`owners:${slug}:${year}`, 'csv');
    const liveRoster =
      current.phase === 'complete' &&
      typeof rosterRecord?.value === 'string' &&
      rosterRecord.value.trim() !== '';

    if (displacedIndex !== -1 && liveRoster) {
      const conflicting = current.picks[displacedIndex]!;
      outcome = {
        error: `"${canonicalTeam}" is already pick #${conflicting.pickNumber} by ${conflicting.owner}. This draft's rosters are live — reopen it before moving a team between owners.`,
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
    const nextPicks = current.picks.map((p, idx) => {
      if (idx === pickIndex) return replacement;
      // The displaced holder's slot is vacated, not reassigned.
      if (idx === displacedIndex) return { ...p, team: null };
      return p;
    });

    // Whether the stored roster described THIS DRAFT before the edit. Publication
    // provenance, kept separate from "a roster exists" — see the stamp below.
    const wasPublished = isDraftPublished(current);

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
      const currentCsv = rosterRecord?.value;
      if (typeof currentCsv === 'string' && currentCsv.trim()) {
        await txn.writeKey(
          `owners:${slug}:${year}`,
          'csv',
          patchConfirmedOwnersCsv(currentCsv, {
            // `patchConfirmedOwnersCsv` MOVES ownership: the new team takes the
            // old row's owner, and the old team is released to NoClaim. What
            // each of this route's cases needs:
            //
            //   ordinary edit / taking a held team — move, exactly as above.
            //   FILLING AN EMPTY SLOT — the slot released nothing, so only the
            //     new team's row should change. Passing an `oldTeam` that
            //     matches no row leaves the release branch unreachable and makes
            //     `effectiveOwner` fall through to `fallbackOwner`, which is this
            //     pick's owner. That is exactly the wanted result.
            //
            // Two earlier attempts got this wrong in opposite directions:
            // `?? canonicalTeam` made it a self-move that rewrote the row to the
            // owner it already had, and skipping the patch outright left the
            // draft and the roster silently disagreeing.
            oldTeam: previousTeam ?? '\u0000none',
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

    // Re-stamp ONLY a draft that was ALREADY published, and only when its roster
    // was actually patched. Both halves are load-bearing:
    //
    //   - `rosterPatched` — `PUT /api/owners` can blank the CSV, and this route
    //     would otherwise record a publication of picks no roster describes.
    //   - `wasPublished` — PROVENANCE. A previous cut stamped on "phase complete
    //     plus a non-empty CSV", which is exactly the pair this campaign's own
    //     selector doc calls insufficient: `owners:{slug}:{year}` has writers with
    //     nothing to do with this draft (the repair import, the demo
    //     year-migration). A repair CSV plus a draft that reached `complete`
    //     without publishing meant ONE edited row promoted the whole foreign
    //     roster to "the draft's output" — the checklist ticked and setup
    //     completed on ownership the draft never assigned. A one-row patch cannot
    //     license a whole-roster claim.
    //
    // A draft confirmed before this field existed therefore keeps its roster in
    // step (that sync is what standings depend on) but gains no publication it
    // never performed: it must be confirmed once, deliberately.
    const written: DraftState = {
      ...current,
      picks: nextPicks,
      publishedPicks:
        rosterPatched && wasPublished ? draftPicksSignature(nextPicks) : current.publishedPicks,
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
