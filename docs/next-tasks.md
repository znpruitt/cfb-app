# Next Tasks (Active Queue)

Status: Current
Last verified: 2026-07-30
Owner: Project documentation
Canonical for: current execution order, planned/parked work, blockers, and the one canonical list of
unresolved decisions and known deferrals
Supersedes: (none)

## Purpose / How to use this document

- This file is the **active execution queue** for current campaigns, and the ONLY document that may
  designate an item `NEXT` or `CURRENT`. Roadmap, registry, and completed-work entries may link here,
  but their status text is point-in-time history, never current planning authority.
- Keep tasks small and scoped to a **single implementation PR** where practical.
- Move completed work summaries to `docs/completed-work.md`; per-prompt execution records live in
  `docs/prompt-registry.md`. Do not accumulate shipped-implementation narrative here.
- Keep broader context and later-phase ideas in `docs/roadmap.md`.
- Reference implementation prompts by explicit `PROMPT_ID` and follow the header convention documented
  in `docs/prompt-registry.md`.
- **Backlog slugs are provisional planning labels, not formal prompt IDs.** A
  `Backlog slug (provisional)` is just a working name for a not-yet-activated task. The formal
  `PROMPT_ID` — `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` per `AGENTS.md` (prompt governance) — is
  assigned only when the task is activated, and its `<###>` sequence is checked against
  `docs/prompt-registry.md` at that point.
- `Last verified` here means the **current-authority content** of this file (execution order, statuses,
  deferrals) was audited for present-state accuracy on that date.

## Current execution order

1. ✅ **PLATFORM-086F2 — COMPLETE** (F2A–F2J, closed 2026-08-08 by F2J / PR #463). The last
   provider-campaign implementation item; the whole campaign is merged and, where applicable,
   active in production. Its exit condition is discharged item by item in Active priority 1 below.
2. ✅ **INSIGHTS-022 — COMPLETE** (PR #464, `0f48b87`, 2026-08-08). Closed
   INSIGHTS-OFFSEASON-ROSTER-CONTENT: the rookie benchmark now runs through ordinary offseason, and
   the four unsupportable "Returning owner" claims are gone. Amended binding AGENTS.md invariant 5
   in the same change, since removing that framing contradicted it.
3. ✅ **PLATFORM-088 — COMPLETE** (PR #465, `f578f22`, 2026-08-08). The public homepage is
   server-rendered, reads no league data for anyone who is not a platform admin, and owner counts
   resolve per league. The **entry contract** is recorded in `docs/vision.md` and `DESIGN.md` gained
   a landing section it never had.
4. ✅ **POLISH-004 — COMPLETE** (PR #466, `38f5719`, 2026-08-09). The public landing is an
   always-dark stadium composition on a licensed Adobe Stock photograph, with the `TurfWar` wordmark
   extracted to a shared component and adopted on `/login` and the `/` admin dashboard. `DESIGN.md`
   gained a durable, app-wide "Decorative raster backgrounds" rule superseding the earlier blanket
   raster prohibition. The deferred HOMEPAGE-BRAND-IDENTITY item below is NOT absorbed by it —
   POLISH-004 was landing art direction, not a logo or an app-wide branding system.
5. ✅ **TURFWAR-WORDMARK-KERNING-CLEANUP-v1 — COMPLETE** (PR #468, `fc77420`, 2026-08-10). One
   shared-wordmark typography pass: tracking is now `normal` and the `f`/`W` join `0.02em`.
   Execution record, review, and verification live in `docs/prompt-registry.md`.
6. ✅ **PLATFORM-089 — COMPLETE** (PR #469, `ff5aa0c`, 2026-08-10). Odds polling moves from a 7-day
   cliff to a staged 45-day horizon (24 h early / 6 h baseline / 2 h pregame), the Odds health card
   stops warning when nothing is pollable, and a book withdrawing a far-out line is recorded as a
   no-op rather than escalated as a provider fault. Execution record in `docs/prompt-registry.md`.
7. ✅ **PLATFORM-090 — COMPLETE** (PR #470, `ee39e09`, 2026-08-11). System Health tells an expected
   absence from a real gap: `game-stats` publishes a canonical applicability state, so an absent
   cache no evidence is yet owed for renders a neutral `None expected` row instead of a yellow
   warning that degraded Provider data and Overall. Genuine missing evidence still warns. Execution
   record in `docs/prompt-registry.md`; two deferrals recorded below.
8. ✅ **PLATFORM-091 — COMPLETE** (PR #471, `75d32b7b`, 2026-08-11). The league banner states
   actual preseason readiness instead of claiming `{year} Draft scheduled · Date TBD` from the
   lifecycle state. `Draft scheduled` now requires a parseable `scheduledAt`, `Roster confirmed`
   requires a current-season roster source paired with a real owner count, a stale draft record no
   longer speaks for a league that switched to manual assignment, and the banner carries no
   readiness claim at all — the fact that would license one is unwritten. Execution record in
   `docs/prompt-registry.md`; three follow-ups recorded below.
9. ✅ **PLATFORM-092 — COMPLETE** (v2 via PR #472, `4b301296`, 2026-08-11). Owners must be
   confirmed before a draft can occur. A draft now TAKES its owners from the confirmed roster
   rather than accepting them from the request, so a draft holding names nothing else agrees with
   is unrepresentable rather than merely detected; the draft-setup page seeds from the current
   roster instead of the prior season's archive. v1 was abandoned unimplemented after two
   remediation rounds whose fixes generated the next round's findings — its post-mortem, and the
   product decisions that came out of it, are in `docs/prompt-registry.md`. Closes follow-up (b)
   recorded under PLATFORM-091.
10. ✅ **PLATFORM-093 — COMPLETE** (PR #473, `7deafdb3`, 2026-08-12). A new league is born
    `{ state: 'preseason', year }` with the season DERIVED rather than entered, so it can reach
    owner confirmation and a draft at all. The `season` default was never a product decision —
    PLATFORM-086F2B carried forward an inference about MISSING status. Adoption keeps its `season`
    seed deliberately; execution record in `docs/prompt-registry.md`.
11. ✅ **PLATFORM-094 — COMPLETE** (PR #474, `263a48b0`, 2026-08-13). A draft's PUBLICATION is a fact the app can ask
    about: `DraftState.publishedPicks` digests the picks that were written to the league, and the
    preseason checklist and Complete Setup share one derivation that requires it. `phase: 'complete'`
    is set by the final pick and says only that every selection was taken — treating it as
    "published" ticked the checklist for a league whose teams were never assigned, accepted a
    pre-draft repair roster as the draft's output, and HID the app's only publish button at the exact
    moment a draft became publishable. v1 was abandoned after two remediation rounds and rebuilt from
    clean `main`; both post-mortems are in `docs/prompt-registry.md`.
12. **Draft-writer serialization** (follow-up, pre-existing). On `main` no draft route uses a
    transaction — every one is a plain whole-record read-then-write — so two concurrent draft writers
    clobber each other, and a confirmation overlapping a `/reset` can republish the pre-reset picks.
    PLATFORM-094 put the confirm and pick-edit paths on transactions; `/reset`, `/unpick`, the
    settings PUT and reopen are still unserialized. `PUT /api/owners` likewise writes the roster
    outside any transaction. Two specifics found in review and left in place: `autoCompleteDraft`
    commits in a transaction but derives its payload from a read taken before it (demo league only),
    and a settings PUT whose read predates a `POST /confirm` commit writes back a draft WITHOUT
    `publishedPicks`, silently retracting a valid publication — recovery is re-Confirming.
13. ✅ **CLOSED 2026-08-13 — preview now gets its own database.** The owner configured the
    Vercel/Neon integration to create a CHILD BRANCH per preview deployment, so each preview runs
    against its own isolated copy rather than production. Stronger than the preview-scoped
    `DATABASE_URL` originally proposed, which would still have had concurrent WIP branches sharing
    one store. Original finding, kept for the reasoning: There is a single `DATABASE_URL`, and Vercel shares environment variables across
    Preview and Production unless preview-scoped values are set, so a preview deployment reads and
    writes the SAME durable store as production. This matters more than it looks because
    `CLAUDE.md` documents force-pushing every work-in-progress branch to `preview`: unreviewed code
    runs against real data as the normal workflow, and anything touching a `tsc`-scoped key or the
    shared `leagues/registry` record writes for real. The demo league is isolated by KEY
    (`draft:test`, `owners:test:{year}`, `preseason-owners:test`) and excluded from rollover and the
    season-transition cron, so demo walkthroughs are safe today — that is isolation by convention,
    not by environment. Fix is a preview-scoped `DATABASE_URL` (or a separate database) in the
    Vercel project's Preview environment; no application change required. Until then, treat preview
    as production for any surface outside the `test` slug.
    **Residual worth knowing:** a Neon child branch is a copy-on-write clone of production at the
    branch point, so preview databases still CONTAIN production data — they just cannot write back
    to it. That is the right trade for write safety, and it is a different question from the
    data-retention item below.
14. ✅ **PLATFORM-095 — COMPLETE** (PR #475, `7d7b4c62`, 2026-08-13). Owner decisions taken during the preview
    walkthrough, to apply before the PR:
    - Draft-board banner copy: **"Draft complete — confirm the results to assign teams"** replaces
      "Draft complete — all N picks made · not yet confirmed". The qualifier bolted a second thought
      onto a completion claim — the same tell as PLATFORM-091's `· Date TBD` — and the pick count
      was redundant beside a board showing every pick.
    - Checklist: **option A** — the row keeps its stable item and the action hangs off it
      (`○ Teams assigned — Confirm draft results →`), and the bottom blocker note is REMOVED. That
      note was one line trying to speak for several unsatisfied rows, sitting far from the row it
      described; per-row actions dissolve it. Rejected option B (relabelling the row itself) so the
      commissioner sees the same three items every visit.
    - **BUG, pre-existing and live: confirming a draft 404s.** `handleConfirm` redirects to
      `/league/{slug}/overview`, and that route does not exist — the league root is
      `/league/{slug}`, with no `overview` segment. Present on `main` and on the merge base, so the
      final step of publishing has always landed on a 404; nobody hit it because until
      PLATFORM-094 the Confirm button was unreachable, so the dead end hid it. **Both reviewers read
      that line and reasoned about what the overview page shows without checking it exists, and the
      end-to-end test drives the route handlers so it stops exactly where the browser continues.**
      Found by the owner in ~90 seconds of clicking. Owner's ruling: redirect to
      `/admin/{slug}/preseason` for a preseason league — the checklist that now ticks and offers
      Complete Setup — and `/league/{slug}` otherwise. This also closes the review finding that the
      newly-gated `Continue Setup` prompt is unreachable: it is not needed if confirming lands where
      it pointed.
    - Checklist row stays LINKED after publication (owner, found walking preview). Today
      `teamsHref` renders only while `!teamsAssigned`, so the row goes inert the moment the draft
      publishes and the preseason page offers no route to the draft at all. A link exists on the
      league overview — the owner found it — but not on the admin side, which is where a
      commissioner mid-setup looks: he first guessed `/admin/{slug}/preseason/draft`, because during
      preseason the draft IS a setup step even though it lives under `/league/{slug}`. Keep the row
      linked, labelled for what it then is (`View draft results →`).
    - Published state gets the SAME banner shape (owner). Confirm moved to the top while Reopen
      stayed at the bottom, so the page's main action jumps position with state. A published draft
      gets a top banner too — "Draft confirmed — these are the league's {year} rosters" — with
      Reopen beside it and the bottom section removed. Reopen's current muted grey reads as
      DISABLED; it should be visibly secondary without looking inactive.
    - Pick editing renders INLINE on the row (owner). The editor is a block section near the page
      bottom, below the whole roster table and the facts panel, so clicking Edit on a pick near the
      top produces a response off-screen — indistinguishable from a dead button, and the owner
      reported it as "the edit button does nothing". Pre-existing (same arrangement on `main`), and
      the same defect class as the rest of this slice: the app responds correctly somewhere the
      commissioner is not looking. Scroll-to was the cheap alternative; inline was chosen because
      this page's layout is being reworked anyway.
    - Confirm-draft box: **no explanatory text at all** (owner). The current copy is verbose AND
      inaccurate — "This cannot be undone without starting a new draft or uploading a CSV override"
      is false now that Reopen exists and keeps the roster live until re-confirmation, and "CSV
      override" is internal plumbing. It becomes an armed confirm (`Confirm draft?` + Confirm /
      Cancel), matching `DraftControls`' Reset.
    - The destructive confirmation must NOT be amber: `DESIGN.md:79` reserves amber/gold for
      champion and podium signals. Use a red/error palette. (The existing Confirm-draft box appears
      to break the same rule pre-existing.)
    Reviews on `fc299a9f` found the assignment-method work carries a P1 and two P2s while the
    wayfinding carries none — see the discussion pending after the walkthrough. Split out of PLATFORM-094 rather than folded
    in: it is information-architecture work, and `AGENTS.md` keeps that out of correctness PRs.
    Found by the owner walking a two-round draft on preview — the flow WORKS, but every surface
    still treats "all picks made" as "done" and offers the after-you-are-finished action before the
    commissioner has finished.

    **Prompt:** `PLATFORM-095-PUBLICATION-WAYFINDING-v1`. The rule: before publication every surface
    points at Confirm; after publication `Continue Setup` is correct and is the only place it
    appears. Today `Continue Setup` renders on `phase === 'complete'` regardless, so following it
    lands on a checklist that cannot move forward.

    Scope, from the owner's walkthrough:
    - `DraftHeaderArea` (draft board, complete state) — drop `Continue Setup` while unpublished;
      `View Draft Summary` is the way forward. Restore `Continue Setup` once published.
    - `DraftSummaryClient` — the Confirm control sits at the bottom of the pick table; move it to
      the header/banner area so it is the visible next action. **Label stays `Confirm draft`** — the
      review IS the page, so the button must not say "review". The `Continue Setup` prompt below it
      should appear only once published.
    - `/admin/[slug]/preseason` checklist — the blocker text is generated from a generic list
      (`Complete team assignment before finishing setup.`) and reads identically whether the draft
      has not started, has finished without confirming, or has lost its roster. `assignmentBlocker`
      is already on the page and distinguishes all four cases; say the true thing and name the next
      action, keeping `View draft summary` as the destination label:
      `draft-not-published` → "Your draft is complete. Confirm the results to assign teams.";
      `draft-incomplete` → "Finish the draft to assign teams.";
      `published-roster-missing` → "The published roster is missing. Confirm the draft again.";
      `no-assignment-method` → "Choose how teams are assigned."
    - Owner ruling: do NOT put the Confirm control on the checklist. Publishing must happen where
      the picks are visible; a write button on the checklist lets a commissioner publish every
      roster without seeing one.

    - **NOT in this slice** (owner-agreed split): the `publishedPicks` payload size below is a
      STORAGE-FORMAT change, not information architecture. Folding it in repeats the mistake
      PLATFORM-094/095 were split to avoid. Its own slice, after 095.

    - Deferred to that slice (review, LOW): `publishedPicks` stores a full JSON encoding of every
      `[pickNumber, owner, team]` triple inside `DraftState`, which `GET /api/draft/[slug]/[year]`
      returns and the board polls every 5s (30s once complete) — roughly 10 KB of redundancy per
      poll per viewer on a 12-owner × 10-round draft. The injectivity requirement is settled and
      must not regress to the colliding 32-bit hash; a 128-bit multi-basis digest would hold
      collisions negligible at ~32 characters, or the signature could live outside the polled
      record.

    - **Assignment-method switching — CORRECTNESS, not just IA, and owner-ruled 2026-08-13.**
      `AssignmentMethodCard` renders while `!teamsAssigned`, so it now stays visible through the
      whole finished-but-unpublished window — the very screen the commissioner is on to go and
      publish. One click on "Change → Assign Manually" reaches `manual-assignment-incomplete`, a
      blocker with **no writer anywhere in the app**, blocking Complete Setup until they switch
      back. **`setAssignmentMethod` has no guard of any kind** — no draft check, no picks check — so
      the card is the only thing preventing it. That is the "a disabled control is not a guard"
      defect this campaign already fixed for `completeSetup`: the Server Action is reachable without
      the form.

      Owner's ruling: switching to manual is ALLOWED while a draft is in progress, behind a
      confirmation dialog stating plainly that it discards the in-progress draft. Once the draft is
      complete it is NOT an option.

      Implementation reading of "complete": **every pick is in**, i.e. `draftPicksAreComplete` —
      not `phase === 'complete'`. That covers a published draft (necessarily complete) and a
      REOPENED one, which sets the phase back to `live` while keeping every pick and leaving a
      published roster live in standings. Treating a reopened draft as "in progress" would let one
      click discard a finished draft AND strand its rosters. Using the existing predicate keeps the
      phase-vs-published distinction out of it entirely.

      The refusal belongs in the ACTION; the dialog is the UI half and does not replace it.

    Read `DESIGN.md` first. Every touched surface carries its own tests, and the acceptance check is
    a walkthrough on the demo league — the two most valuable findings of PLATFORM-094 came from the
    owner clicking through, not from review.
15. **PLATFORM-097 — assignment-method and draft-recovery states.** Split out of PLATFORM-095 after
    four remediation rounds, each finding real defects in this area and each round's fix producing
    the next round's finding. Recommended as a split at round 1 and again at round 4; taken at round
    4. These want designing together, not patching individually:
    - **Re-selecting the CURRENT method is refused as if it were a change.** `setAssignmentMethod`
      keys on `method !== 'draft'` plus draft completeness, never on whether the write changes
      anything — so a `manual` league with a finished draft (the recovery state 095 added) clicking
      the already-selected "Assign Manually" gets the refusal, and the card is left stuck in editing
      mode under a red error because `setEditing(false)` only runs on success.
    - **The dialog and the server disagree about the threshold.** The confirmation arms on
      `draftHasPicks` (any picks); the action refuses on `draftPicksAreComplete` (every pick). A
      league with no method chosen and a finished draft therefore sees a dialog promising "its picks
      are kept, and switching back to a draft restores them", and the red confirm returns "Reset it
      first". The dialog states the opposite of what happens.
    - **Draft creation has no assignment-method gate**, which is what makes the null-method states
      reachable at all. Fixing that upstream may dissolve several of these.
    - **`draft-incomplete` covers a `complete` draft with too few picks** — the authorized PUT
      permits `live`/`paused` → `complete` without validating counts. The checklist routes it to the
      board, which renders its complete-state header and no picking controls, so "Finish the draft"
      lands somewhere that cannot finish it. Either route that combination to setup or refuse the
      premature transition.
    - **The board header's `Continue Setup` gate omits the roster fact.** `DraftSummaryClient` uses
      `canReopen` (publication AND `publishedRosterExists`); `DraftHeaderArea` uses publication
      alone and is passed no roster flag. A confirmed draft whose CSV was blanked still offers
      Continue Setup into a checklist that cannot proceed.
    - **The summary banner re-derives publication state inline** from `draft.publishedPicks`
      truthiness, which `/reset` does not clear — so confirm → reopen → reset → re-run labels a
      brand-new draft "Draft reopened", and a confirmed draft whose roster went missing is labelled
      the same. `AGENTS.md` invariant 9 says the selector should expose the recovery REASON and the
      component should render it.
    - **The preseason page reads the draft record twice per render** (once inside
      `getTeamAssignment`, once directly for `draftPicksComplete`/`draftHasPicks`), unsynchronized,
      and the second read sits after the first assignments inside the same `try` — so a flake on it
      silently un-hides the method card for a league whose draft is complete. One selector fed from
      one read closes both.
16. ✅ **PLATFORM-096 — COMPLETE** (PR #476, `6b0b8eca`, 2026-08-14). Owner-designed 2026-08-13,
    during the 095 walkthrough. The summary page IS the editing surface before confirmation, and it
    could not express the corrections a commissioner actually needs. Shipped as designed below;
    execution record, including the reviewer-proven correction to the safety claim, is in
    `docs/prompt-registry.md`.

    - **List every team, including ones other owners hold**, each labelled with its holder. The
      picker had filtered out every already-picked team, so a mix-up between two owners could not be
      fixed at all.
    - **Taking a held team leaves the previous holder's pick UNASSIGNED** — deliberately not a swap.
      The owner rejected swapping: "what if the issue isn't just a direct swap of picks?" A swap
      cannot express "Alice should have Michigan, and Michigan's owner should get something else
      entirely."
    - **Confirmation is DISALLOWED while any pick is unassigned** (owner, explicit). That is what
      makes an empty pick safe: it is a transient editing state that can never be published. The
      publish control stays away and the banner says the draft is unfinished.
    - **Search by conference**, matching `DraftBoardClient`, which already matches team name OR
      conference. The summary editor had matched the name only while already receiving
      `conferenceMap`.

    Model note, as shipped: `draftPicksAreComplete` now requires every pick to HOLD a team, and
    `draftPickCountIsComplete` was split off to keep answering "has this draft been run" — the
    stricter predicate alone re-opened the `setAssignmentMethod` hole PLATFORM-095 closed. The
    confirm route reports its own unfinished reason BEFORE the count check, since a hole leaves the
    count unchanged and would otherwise surface as a confusing "unrecognized team".

    **Scope boundary, from the owner's earlier ruling:** this is for corrections BEFORE publication.
    Arbitrary reassignment afterwards belongs to the roster, not the draft — "we're not going to
    rehold a draft if we change owners or reassign teams down the line". **The claim previously
    recorded here — "there is no roster editing surface today beyond the repair import" — was WRONG,
    and the PLATFORM-098 audit disproved it:** `/admin/{slug}/roster` has carried an inline
    team-owner editor with a bulk owner-rename box the whole time. It is unreachable by any generated
    link after publication, which is why it read as absent. See item 17.
17. **PLATFORM-098 — the owner roster is the membership authority after publication.** Owner
    decision, 2026-08-14, from a preview test: after confirming a draft he opened **Edit owners**,
    changed the list, and "as far as I can tell, it does nothing."

    **It is not inert — it silently diverges.** Two durable records answer "who is in this league",
    and the two readers disagree about which one wins:
    - `owners:{slug}:{year}` / `csv` — **the owner roster**. A stored `team,owner` string, written by
      the app. Not a user-uploaded file; the repair-import panel is a separate path onto the same
      record.
    - `preseason-owners:{slug}:{year}` — **the preseason owner list**. Names only.

    `selectConfirmedRoster` prefers the preseason list; `deriveStandings`' preseason path prefers the
    owner roster (`leagueStandings.ts:527`, "Prefer CSV (draft complete)"). So editing owners after
    publication changes league MEMBERSHIP while every visible surface keeps showing the draft's
    output — and editing the roster editor changes the visible surfaces while membership stays stale.
    Same defect, both directions. This is the PLATFORM-092 defect class (two copies of one fact, one
    screen writing only one of them) between two different records.

    **Owner's decision: after publication the OWNER ROSTER is the authority.** The preseason list is
    a pre-assignment input only.

    **Seam audit (run 2026-08-14, before any implementation):**
    - **Writers of the owner roster — seven.** `POST /confirm`; `POST /pick/{n}` (the edit sync);
      `PUT /api/owners` (roster editor AND repair import); `DELETE /api/owners` (writes null);
      test-league reset; the demo year-migration; demo autocomplete.
    - **Writer of the preseason owner list — one.** `confirmPreseasonOwners`. (Plus two deleters:
      test-league reset, league-deletion residual cleanup.)
    - **Readers of `getConfirmedRoster` and what they MEAN** — all three mean "who may participate":
      the preseason checklist, `/league/{slug}/draft/setup`, and `POST /api/draft` (which builds the
      draft's owner list from it). The third is why precedence must be conditional on publication and
      not merely on the roster EXISTING: **`/reset` clears picks and phase but leaves the owner roster
      in place**, so an unconditional flip would build a re-run draft from a stale roster and ignore
      the list the commissioner just edited. Gate on `isDraftPublished`, which reset already falsifies.
    - **Controls live per state.** Pre-assignment: preseason owners screen writes, roster editor
      reachable only from the pre-draft gate. Published: BOTH screens write, disagreeing. Reopened:
      both write, roster still serving standings. Reset-after-publication: the roster editor still
      edits a roster no draft produced.

    **Scope as understood:** flip `selectConfirmedRoster`'s precedence when the draft is published;
    make the preseason owners screen read-only in that state with a link to the roster editor; give
    the roster editor a generated entry point after publication — today `draftSetupGate.ts:67` is the
    only link to it in the app, and it renders only BEFORE a draft. **No new editing capability is
    needed** — the inline editor and its bulk owner-rename already cover typo fixes and transfers.

    **⛔ STOPPED 2026-08-14 — branch `platform/098-membership-authority-after-publication`
    abandoned at `e83ae718`, NOT merged.** Three remediation rounds; the fourth still produced
    credible P1s from both reviewers. `AGENTS.md` → Review and remediation limits rule 7 and the
    reconstruction rule both apply. The draft-night safety subset was re-derived from clean `main`
    as **PLATFORM-099**; everything below remains unimplemented.

    **The membership predicate failed THREE times, each on a different edge — which is the signal
    that its INPUT is wrong, not its clauses:**
    - `usable roster && draft still holds picks` → broke reopen-then-undo-every-pick: authority
      reverted while the roster was still serving standings.
    - `usable roster && publishedPicks present` → broke LEGACY rows. The pre-098 reset paths never
      cleared the marker (they relied on the digest ceasing to match, which is enough for
      `isDraftPublished` because it recomputes). Those rows read as standing on deploy.
    - `+ pre-draft phases with no picks` → the legacy row still captured membership at the re-run
      draft's FIRST PICK, and a later reset then wrote the discarded roster's owners into
      `preseason-owners`, durably clobbering the commissioner's list.

    **What a re-derivation must carry (all reviewer-confirmed, none fixed):**
    - **Reopen → Confirm reverts direct roster edits.** `POST /confirm` rebuilds the roster from
      `pick.owner`, which the roster editor never touches. A guard needs checks at BOTH Reopen and
      Confirm — refusing only at Confirm strands a commissioner mid-correction with the old roster
      still live.
    - **The comparison needs CANONICAL TEAM IDENTITY.** `PUT /api/owners` validates aliases but
      stores the submitted text, so `Ohio St.` vs a pick for `Ohio State` reads as an edit and 409s a
      legitimate reopen (`AGENTS.md` requires the shared resolver). It must also compare roster rows
      OUTSIDE the picks: `buildConfirmedOwnersCsv` writes `NoClaim` for every undrafted team, so
      assigning one in the editor is invisible to a picks-only comparison and silently reverted.
    - **`owners:{slug}:{year}` has a writer outside the locking protocol.** `PUT /api/owners` uses
      plain `setAppState`, so it does not participate in the reset transaction's locks. Any authority
      that depends on reading that record transactionally is unsound until this is addressed.
    - **`confirmPreseasonOwners` check-then-write is not atomic** — a confirm landing between them
      writes the superseded list and redirects as success.
    - **A one-owner roster drops authority.** `hasUsableOfficialRoster` requires two distinct owners,
      so moving every team to one owner falls back to stale preseason names while standings keep
      using the roster.
    - **A "Reset the draft" pointer must account for `published-roster-missing`.** The summary's
      `canPublish` is true there while `DraftSetupShell` gates Reset on `isDraftPublished` alone, so
      a naive link points at a page with no Reset control.

    **Sequence this with the owner-ID work (item 15), not before it.** Every failure above is the
    same fact — ownership stored as a display NAME in three records that can disagree.

    Sequencing against PLATFORM-097 is undecided; they are adjacent (both are draft-recovery states)
    but distinct seams, and 097 already carries seven findings.

18. ✅ **PLATFORM-099 — COMPLETE** (PR #477, `9537f7e8`, 2026-08-14). Re-derived from clean `main`
    after PLATFORM-098 stopped, carrying nothing from that branch. Cut to the items that never touch the membership
    predicate, so a commissioner drafting the week of 2026-08-21 is not exposed to the hazard below.

    - **Reset costs a TYPED SLUG.** It was arm-then-confirm on the SAME button, in the same place —
      and that card also carries the pick timer, which is what brings anyone to the page mid-draft.
      One mis-click destroyed a live draft, with no undo. The panel requires the slug typed and the
      handler re-checks it, so a keyboard submit cannot pass a `disabled` attribute; both the trigger
      and the panel carry the published-draft gate. It deliberately states NO pick count — the shell
      does not poll, so a figure it cannot guarantee is worse than none.
    - **The roster editor sorts by OWNER**, on the COMMITTED map — ordering by the unsaved map
      re-sorts on every keystroke and slides the field out from under the cursor. Unowned teams sort
      last in both directions.
    - **The roster page stops contradicting itself.** It headlined "Historical / repair roster CSV
      import" and called current-season ownership a draft-flow concern, while the overwrite prompt
      asked for a "platform-admin repair" override. The confirmation STAYS — the editor sends the
      whole roster on every save — but now reports what is changing, counting rows the save DROPS as
      well as owners it changes.
    - **And it edits the right season.** `resolveLeagueOperatingYear` joins
      `resolveDisplayLeagueStatus` in the lifecycle selector, and the four `/league/[slug]/draft/*`
      routes that inlined the same ternary now call it. The season is in the heading.

    Review record — including the guard regression this introduced and its remediation — is in
    `docs/prompt-registry.md`, which owns it (`AGENTS.md` → documentation ownership: this file must
    not carry review histories).

19. ✅ **PLATFORM-100 — COMPLETE** (PR #478, `c5293a14`, 2026-08-14). A confirmed roster spells
    "unowned" as the literal owner `NoClaim`; the roster editor's owner sort recognised only an empty
    string, so ~120 teams clumped at one end after any confirmed draft. **Found by the owner in one
    click on a demo dry run, on code merged the same day** — the PLATFORM-099 fixture used the
    pre-confirmation shape and its assertion generalised to both.

20. **Findings from the 2026-08-14 demo dry run** (main line held end to end; recorded so they are
    not rediscovered). None blocks a draft; all are wayfinding or stale-claim defects of the class
    PLATFORM-095 exists to close.
    - **Nothing points to draft setup from the summary after a Reopen.** Reset lives on the setup
      page and is hidden while a draft is published, so it reappears on Reopen with nothing saying
      where. PLATFORM-098 built a pointer and it was CUT, correctly — it rendered in
      `published-roster-missing`, where the setup page's `isPublished`-only gate hides Reset and the
      link led nowhere. A replacement must gate on the same fact the destination does.
    - **"Setup Complete ✓" survives a reopen.** `setupComplete` is written once by `completeSetup`,
      which verifies assignment at that moment; nothing revisits it. Reopening retracts publication,
      so the league claims setup is complete while its teams are, by the app's own definition, no
      longer assigned. Not dangerous — reopen leaves the roster serving standings — but it is a claim
      the app stopped verifying.
    - **"Finish the draft →" is shown for a league with NO draft.** `draftPickCountIsComplete(null)`
      is false, so a league that has only chosen a method gets `draft-incomplete`, and the checklist
      routes to the BOARD. The board redirects to setup, so the destination works and the label lies.
      Distinct from the 097 finding of the same blocker, which covers a `complete` draft with too few
      picks.
    - **The owners screen has no RENAME.** Only Add and Remove, so correcting a misspelled owner
      means removing and re-adding — which is what makes the divergence below reachable. The app's
      only rename affordance is the roster editor's bulk-reassign box.
    - **Editing owners after confirmation still diverges silently** — PLATFORM-098's headline defect,
      confirmed live in production: the preseason list changes, standings keep the old name, nothing
      on screen indicates the two disagree.

21. ⏳ **INSIGHTS-029 — stop suppression draining the feed. IMPLEMENTED, PR pending**
    (branch `insights/029-stop-draining-the-feed`). The un-draining, split out of INSIGHTS-018 and
    shipped alone: `applySuppression` is no longer consulted when serving, so the feed is a plain
    priority sort. Two source files. `suppression.ts` is untouched — its records age out under their
    own TTL and the existing rollover clear, and the debug endpoint keeps working.

22. ⛔ **INSIGHTS-018 — rotation and the NEW tag. STOPPED, deferred until after INSIGHTS-023.**
    Branch `insights/018-rotation-and-new-tag` abandoned at `7b4b7664`, not merged. **Four review
    rounds, and the SCOPE was the problem rather than any single defect: rotation does nothing until
    the pool exceeds the feed, and TSC has four insights for five slots.** Building it first meant
    four rounds of findings against machinery with no job to do yet.

    **What is worth reusing when it IS built** — all of it survives in the abandoned branch's
    history:
    - The three-way classification (`event` / `standing` / `standing-moving`) and the owner's rule
      behind it: a single-season extreme is news once and history afterwards; the durable version is
      cumulative. Decide kind PER INSIGHT — `milestone_watch` carries both an approaching watch and a
      crossing, so no per-type value is right for it.
    - **Rotation must not order by anything the write path advances.** Two attempts used "least
      recently shown" and both failed, the second BECAUSE of the first: showing an insight changed
      the next selection's input, so the feed churned within a bucket and then pinned the same set
      forever. Bucket-indexed selection reads nothing the write path touches — but the window must
      advance by the slots CONSUMED, not by the feed limit, or anything sitting in the changed bucket
      permanently starves the tail.
    - The signature must be INJECTIVE (a 32-bit hash collided on real catalog data in PLATFORM-094)
      and must EXCLUDE template wording, or a copy edit lights up a whole league's feed as new.
    - Identity must be compared BEFORE numeric tolerance, or a hook transition — the most newsworthy
      thing a moving type produces, and by nature a tiny delta — reads as unchanged.
    - The stat baseline must hold until a change is RECORDED, or sub-threshold drift never
      accumulates toward its threshold.
    - **A store read failure must be distinguishable from a cold store.** Swallowing it reset every
      baseline and badged the whole feed on the next healthy load.
    - Register any new durable scope with `findResidualLeagueScopes` AND the demo-league cleanup
      (`AGENTS.md` shared-policy consumer rule) — missed on the first attempt.
    - NEW means CHANGED (owner decision): a fact that rotates back into view did not change, it
      resurfaced, and badging it trains a reader to distrust the badge.
    - Weekly rotation boundaries must be CHOSEN. `floor(days / 7)` puts them on Thursday because the
      epoch was a Thursday — ten hours from the Thursday pulse INSIGHTS-026 plans.

    **The process lesson, which cost more than the feature.** Every defect that reached a commit was
    one the tests were structurally incapable of observing: a control comparing arrays where only the
    SET mattered, badge assertions passing on a still-open window rather than on the thing under
    test, a coverage guarantee asserted only under the conditions where it holds. Mutation testing
    caught several — but only because it was run after the tests already passed.

23. **INSIGHTS-018 was reframed 2026-08-14 before being stopped.** Reframed
    2026-08-14 after an audit of the live TSC preseason; the backlog spec below (§2) is superseded on
    one point — freshness alone is not enough, see the standing-fact/event split.

    **The feed is not thin, it is DRAINED.** Suppression policy is per insight TYPE, and almost every
    type carries `{ kind: 'unchanged' }` — suppress while the stat value is identical. **In preseason
    no games are played, so no stat value can ever change**, and every such insight fires once on some
    page load and is suppressed for the rest of the preseason. TSC's Overview currently shows exactly
    two cards, and both are on `NEVER_SUPPRESS_TYPES` (`milestone_watch`, `perfect_against`); the
    third member of that set, `rookie_benchmark`, is separately suppressed by `usingArchivedRoster`.
    **Those three are the only reason anything renders at all.**

    Reset paths exist and neither helps: records are season-scoped and cleared by the rollover cron,
    with a 180-day TTL as a backstop. Both are far coarser than a preseason.

    **The design correction — TWO properties per type, not one.** The existing thresholds
    (`unchanged` / `abs` / `pct` / `snapshot`) all answer "has this CHANGED?". The question the feed
    actually needs is "is this still worth SAYING?", and the two come apart:
    - **Standing facts** — a drought, a dynasty, a 6–0 head-to-head. Still true a month later, still
      interesting, and they should rotate back into the feed. Their stat value never moves, so a
      freshness-only model buries them exactly as permanently as today's does.
    - **Events** — a game result, a milestone crossing. News once; re-showing it in November is noise.

    Owner's acceptance test: _a drought from three seasons ago should come back around; last
    October's week-7 result should not._

    Rotation selects the feed; CHANGE still earns the NEW label, for both kinds. **The NEW-tag half is
    unchanged from the original spec and is NOT superseded** — per-league-global (not per-user),
    **48-hour active-season window, 7-day preseason/offseason window**, signature-based detection so a
    hook/owner/statValue change reads as fresh while a semantically identical re-render does not.
    Retire suppression as a visibility gate without destructively migrating existing records; an
    observation-store failure falls back to stable priority order and never empties the feed.

    **Sequencing is load-bearing: this comes BEFORE the breadth work below.** Switching on the dark
    families first would add ~7 insight types that each fire once and vanish, spending the entire
    breadth gain in one or two page loads — and making the cause harder to see, not easier.

24. **INSIGHTS-023 — preseason breadth.** After rotation, not before.

    **Two generators are dark in preseason and they are the whole gap:** `historicalGenerator`
    (`HISTORICAL_LIFECYCLES`) and `rivalryGenerator` (`RIVALRY_LIFECYCLES`) list every lifecycle state
    EXCEPT `preseason`. Each is one generator producing several insight types — drought, dynasty,
    improvement, consistency; lopsided, even, dominance streak — so the two constants cost roughly
    seven types, not two. Both are archive-backed: their claims are historical facts that stay true
    regardless of who plays this year, which is what makes them safe under AGENTS.md Insights
    invariant 5 via neutral copy or last-season framing.

    **Also extend `toilet_bowl` into preseason** (owner, 2026-08-15). It is the league's name for the
    weekly last-place finisher, and the generator counts how many times an owner won it in a season —
    a season-wrap retrospective currently gated to `['postseason','fresh_offseason']`. Last season's
    toilet-bowl champion is legitimate preseason content; per the owner's rule a single-season extreme
    is news once and history afterwards, so it must NOT rotate indefinitely — see the classification
    in INSIGHTS-018.

    Audit, 2026-08-14: **8 of 21 registered generators are preseason-eligible** — career volatility,
    never-finished-last, title-chaser, rookie-benchmark, trending; stats team-identity; milestone
    watch and perfect-against. Everything else is off, and most of it correctly so (trajectory,
    championship race, season wrap and the live stat leaders all need season evidence).

    Also split loading into `feed` (compact Overview selection, five cards) and `catalog` (every
    eligible insight, priority-sorted, no suppression reads or writes), and point
    `/league/[slug]/insights` at `catalog` so "See all" means all of it. **Measure the real catalog
    size on TSC before deciding whether it needs a bound** — the acceptance bar of ">10" spans a page
    and a wall.

25. **INSIGHTS-024 — active-owner scoping.** After breadth. Correctness, not volume: on its own it
    REDUCES the feed, because it drops departed owners and a brand-new owner has no history to draw on.

    **The gap, visible on the live TSC Overview:** standings and insights disagree on the same page.
    `leagueStandings` synthesizes preseason rows from the confirmed owner list, so Standings shows the
    2026 owners. Insights needs a team→owner MAP, has none until teams are assigned, and so
    `computeRosterFallback` reaches back to the most recent archive — meaning every insight is about
    LAST season's roster. For TSC that means two departed owners are still written about, and a
    returning owner who sat out last season is invisible no matter how many families are switched on.

    **It is far smaller than it looks, and needs no new store read.** `loadInsights` already calls
    `getCanonicalStandings` and passes `canonical.rows` into the context; in preseason those rows ARE
    the confirmed owners. `CanonicalStandings` also already carries **`ownersRosterSource`**
    (`'archive' | 'csv' | 'preseason-owners' | 'none'`) — the exact provenance field this work would
    otherwise invent. So the owner scope and its source are both already in the loader's hands, and
    reusing them means Insights inherits the app's existing precedence instead of creating a second
    answer to "who is in this league".

    **AUDIT FINDING — do NOT conflate `usingArchivedRoster` with `ownersRosterSource`.** They are
    different facts and the conflation is silent: for TSC right now `usingArchivedRoster` is TRUE (the
    team→owner MAP is borrowed) while `ownersRosterSource` is `'preseason-owners'` (the owner NAMES
    are confirmed). Deriving one from the other flips `usingArchivedRoster` to false and **unlocks
    rookie claims as a side effect** — the invariant-5 change happening by accident rather than by
    decision. Keep `activeOwners` (names, from canonical) separate from `usingArchivedRoster` (map
    provenance, unchanged).

    Keep `currentRoster` strictly the team→owner map. **Remaining audit before implementation:** which
    of the 13 `currentRoster` consumers need the MAP and which only need the owner SET, and who else
    reads `usingArchivedRoster`.

26. **INSIGHTS-025 — rookie/returning claims (owner decision required, invariant amendment).**
    Deliberately last, and deliberately separate.

    AGENTS.md Insights invariant 5 currently says naming who is genuinely returning "requires
    comparing a FINALIZED upcoming roster against league history, which no generator has; **until such
    a feature exists** the career generators rely on (b)". INSIGHTS-024 builds that feature, so this
    work must **amend invariant 5 in the same PR** — INSIGHTS-022's recorded lesson was a false premise
    pulling an engine change into scope and breaking two binding invariants because AGENTS.md was not
    opened first.

    **The question the amendment turns on, for the owner:** is a confirmed preseason owner list
    "finalized" enough to license rookie/returning claims? It stays freely editable, and per
    PLATFORM-098 (item 17) editing it after assignment silently diverges from the roster. The stronger
    trigger, if one is wanted, is **Setup Complete** — which means teams are actually assigned.
    For TSC the claim would have a real subject: one brand-new owner, who otherwise gets no content.

27. **INSIGHTS-026 — the pulse: a scheduled digest, and the insights stream's EVENT SOURCE.**
    **ID split out 2026-08-14: this campaign was filed under INSIGHTS-018**, which the backlog also
    used for the NEW-tag mechanism, so a content campaign was hiding behind a mechanical one. Owner
    confirmed it is still wanted — _"it helps make the app feel alive"_. Design detail stays in
    `docs/roadmap.md` → "Insights Engine — Two Weekly In-Season Pulses"; this entry is the queue's
    view and the record of the 2026-08-14 design conversation.

    **ONE artifact, two renderings, and it is also a producer.** The owner's framing: the pulse and a
    "Week X Highlights" card are the same thing, not two products. It renders compactly on the league
    home and in full on its own tab — the relationship Overview already has with "See all" — and its
    findings ALSO seed the insights stream as timely items.

    **This is the missing half of the INSIGHTS-018 rotation model.** The feed has two kinds of item:
    - **Standing facts** — droughts, dynasties, a 6–0 head-to-head. Request-time generators, always
      true, rotate back into view.
    - **Events** — this happened, it decays. **Nothing produces these today**, which is exactly why
      the preseason feed is all standing facts and why suppression drains it.
    The pulse is the event producer. NEW is earned by both kinds.

    **FORWARD-COMPAT NOTE FOR INSIGHTS-018, WHICH SHIPS FIRST.** Every item in the current model is
    produced at request time by a generator carrying `supportedLifecycles`. A pulse item is STORED,
    arrives from a scheduled job, and has no generator behind it. If 018's observation/rotation store
    assumes "every item came from a generator this request just ran", it will need reworking when the
    pulse lands. Cheap to accommodate now, annoying to retrofit.

    **Composes from sources that already exist** — only the composition layer and the cadence are
    missing: `StandingsHistory` (`weeks`/`byWeek`/`byOwner`) for movement, the odds pipeline for
    line-vs-result upsets, `OwnerCareerHeadToHead` for h2h shifts, and `RecordEntry.recentChange` —
    which is DECLARED AND NEVER POPULATED, so **INSIGHTS-020 becomes a contributor to this rather
    than a standalone feature**.

    **What the FRAMEWORK owns, and the open questions it must answer:**
    - **A defined period.** "The prior week" needs a boundary — since the last successful fire, or a
      fixed weekday window? They diverge the moment a run is missed.
    - **Idempotency.** A cron firing twice must not produce two digests. `PLATFORM-086F2E1` receipts
      give the shape.
    - **Catch-up.** If Monday's run fails, does Thursday cover both weeks or is that week lost?
      Silent loss is the failure mode.
    - **A stored artifact.** The card renders what the pulse PRODUCED; recomputing on request means
      "Week 8 Highlights" quietly changes as data backfills.
    - Year validity and demo exclusion, which every scheduled job here carries.

    **Cadence correction:** the roadmap says "Monday 6am ET (11am UTC)". That parenthetical is only
    right in winter. College football runs late August to early January, so most of the season is
    EDT, where 6am ET is **10am UTC** — a cron pinned to 11am UTC drifts to 7am ET for the bulk of the
    season. State the intent in ET and derive the UTC hour.

    Monday **Look Back** (weekend recap, standings movement, owner-vs-owner outcomes, trash-talk
    fodder) and Thursday **Forward Look** (games to watch, collisions ahead, who needs a win). The
    Forward Look is not insights at all — it is a preview built from schedule and rankings, which is
    further reason the pulse is its own thing rather than an insights feature.

    **WEEKLY ACCOLADES ARE A CATEGORY, not a special case** (owner, 2026-08-15). The league already
    calls out two every week in its email: the **toilet bowl** (weekly last-place finisher) and the
    **weekly winner** (most wins that week). Neither exists as an insight — `deriveToiletBowlInsight`
    walks `standingsHistory.byWeek` and takes each week's last row, then aggregates the weekly winners
    away into a season total, so the weekly data is already there and is discarded. Build the pulse's
    accolade slot as an extensible SET seeded with those two; the owner expects to add more. A weekly
    accolade is the archetypal pulse item — recurring, timely, decays, and nobody needs telling twice.

    In-season only, so it does nothing for the preseason feed; sequence after 018/023/024.

28. **INSIGHTS-027 — preseason content generators (NEW content, not re-enabled content).** Also
    recovered from the roadmap entry above, and distinct from INSIGHTS-023: that one switches on
    generators that already exist, this one writes generators that do not.

    - **Draft-based**: conference concentration across an owner's roster, roster diversity, AP poll
      rankings per owner. Depends on a published draft, so it is live for a league only after
      confirmation.
    - **Schedule-strength projections**: ranked-opponent count, aggregate SP+ per owner.
    - **All-time toilet-bowl record** (owner, 2026-08-15): how many times each owner has won the
      league's weekly last-place accolade ACROSS seasons. Nothing counts this — `never_last` is only
      the inverse ("never finished in the bottom three"), and `toilet_bowl` is single-season. Under
      the owner's rule this is the tier worth rotating into a preseason feed, because cumulative
      records stay interesting while a single season's does not.
    - The roadmap's "August onward" data tier — AP poll per owner, preseason projections — is
      available NOW, which makes this the largest genuinely-new preseason content lever.
    - **Standing rule for any generator written here**, carried verbatim from the roadmap because it
      is the whole point of the panel: _"Every insight must tell the user something they couldn't
      figure out just by reading the table. No restating visible data without a compelling angle."_

29. **Then, in order: INSIGHTS-019** (diagnostic endpoint — worth taking straight after 018, since it
    is how rotation and NEW state become observable), INSIGHTS-020 (record-change insights),
    History Records continuation, Slow Draft Mode; commissioner onboarding / multi-tenant signup
    later.
30. **PLATFORM-092 follow-ups** (recorded so they are not rediscovered): (a) ✅ **CLOSED by
    PLATFORM-093** — a brand-new league had no path to confirm owners — new leagues are born `season`, `/admin/[slug]/preseason/owners`
    redirects away unless the league is in `preseason`, and only `beginPreseason` (offseason-only) or
    the rollover cron reach that state, leaving only the historical/repair CSV import, which asks the
    commissioner to hand-produce what the draft exists to produce. This predates 092, which turns a
    soft dead end into a hard refusal. **Owner's rule for the fix: season state + no owners or team
    roster → open the preseason setup flow.** Queued as its own prompt; (b) **STILL OPEN** — `selectors/preseasonBanner`
    accepts a single owner (`ownerCount > 0`) where `selectConfirmedRoster` requires
    `MIN_CONFIRMED_OWNERS = 2`, so a one-owner CSV shows
    "Roster confirmed" on the league banner while the admin checklist shows ○ — reachable only via a
    hand-edited repair import. **PLATFORM-094 did NOT close this**, and a closeout in that PR
    briefly claimed it had: the entry was marked resolved because the readiness EXTRACTION it
    mentions in passing now exists (`selectors/teamAssignment.ts`), but the open item is the owner
    THRESHOLD, which is untouched — the banner does not route through `selectTeamAssignment`.
    Closing a follow-up on the strength of a different fact is the ledger error DOCS-012 exists to
    prevent; (c) `DraftSettingsPanel` is 601 lines against the ~600 extraction
    guideline, and its reorder editor is the natural piece to lift out; (d) the owner-confirmation
    shell pulls `standings.ts`'s dependency graph into the separately-chunked admin route for one
    constant. Severity was overstated when first reported — three client components already import
    that module, so the graph is in the client bundle on every league page anyway.
31. **League deletion does not delete data — data-retention and future multi-tenant privacy.**
    Verified 2026-08-12. `DELETE /api/admin/leagues/[slug]` calls `removeLeague`, which filters the
    slug out of the registry list and nothing else. Every keyed record survives: `owners:{slug}:{year}`
    (team→owner rosters carrying real names), `preseason-owners:{slug}`, `draft:{slug}` (picks and
    order), `standings-archive:{slug}` (full season history), plus scoped aliases and score and
    presentation caches. "Delete" today means "hide from the league list."
    **Adoption is the door back in.** Creating a league on a released slug with
    `adoptExistingData: true` re-attaches all of it. That is platform-admin-only today, so it is
    currently a retention question rather than an exposure one — but **Multi-tenant Commissioner
    Sign-up is a planned campaign**, and once league creation is not exclusively the platform
    operator's, someone claiming a released slug inherits another league's rosters, history and
    owner names.
    Three separable decisions, none of them PLATFORM-093's: (a) should delete PURGE, or is
    hide-and-retain a deliberate soft delete; (b) should adoption exist at all — it was built as a
    safety net against silently overwriting residue, and a real purge would remove most of the
    residue it guards; (c) what either means once leagues are not all one operator's. Belongs with
    the multi-tenant campaign; recorded now because it was found in front of us rather than when an
    external commissioner is involved.
    **(b) now has a concrete argument for "no", found during PLATFORM-093 review and PRE-EXISTING on
    `main`.** Adoption stamps the restored league with the season the operator states, and every
    creation path seeds `status: { state: 'season', year }`. `groupRolloverTargets` selects
    `status.state === 'season'` grouped by `status.year`, and `resolveNationalChampionshipRollover`
    is eligible for any season whose championship is more than a week past — so restoring a league at
    a PAST season enrols that year for rollover on the next nightly run. `saveSeasonArchive` is an
    unconditional write with no already-archived guard, so the cron rebuilds the archive from
    whatever remains cached and saves it OVER the genuine one — `standings-archive:{slug}` being one
    of the very scopes adoption exists to reattach. Within 24h, unprompted, and degraded or empty if
    the score cache has aged out. Not a PLATFORM-093 regression and deliberately not fixed there:
    the honest options are a purge that removes the residue, an already-archived guard in the
    rollover path, or retiring adoption — all of which are this campaign's decisions.
32. **Pre-existing flaky test** (not from any campaign): `insights-suppression.test.ts` → "record at
    exactly TTL boundary is not expired" computes `firedAt` from `Date.now()` and the predicate
    re-reads `Date.now()`, so it passes only when both land in the same millisecond. Observed failing
    once in a full-suite run on 2026-08-11 and passing on re-run. Needs an injected clock, not a
    retry.
33. **PLATFORM-091 follow-ups** (not queued as work; recorded so they are not rediscovered):
    (a) draft facts reach the banner only through a best-effort client fetch whose failures are
    swallowed and never retried, so `null` means both "no draft" and "could not find out" — the
    honest fix is a server-side read passed as a prop like `canonicalStandings`; (b) draft setup can
    advance without confirming owners, because `/league/[slug]/draft/setup` falls back to the most
    recent ARCHIVE when `getPreseasonOwners` returns null, which leaves every preseason surface
    reading `getCanonicalStandings` — not just the banner — seeing no current-season roster;
    (c) a past `scheduledAt` still reads `Draft scheduled`, a forward-looking claim licensed by a
    fact about the past. Reinstating any "ready for kickoff" claim requires extracting the admin
    checklist's `teamsAssigned` derivation into a selector both surfaces consume.
34. Nonblocking operational observation (not implementation work): the passive **PLATFORM-086E1C2
    §8i** schedule-presentation observation checkpoint (`docs/deployment-runbook.md` §8i) records its
    first qualifying automatic presentation refresh from production evidence when it occurs.

The provider campaign's completed execution record (086A → G1 → G2 → H → I → F1 → B → C → E1 → E2,
with activations §8e–§8j) lives in `docs/prompt-registry.md` and `docs/completed-work.md`; the
activation evidence lives in `docs/deployment-runbook.md`.

## Campaign status

All foundational phases are complete. Work is now organized into named workstream campaigns.

| Workstream          | Campaign                                                                                | Status                |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| Data & Intelligence | Game Stats Pipeline                                                                     | ✅ Complete           |
| Data & Intelligence | Insights Engine Foundation                                                              | ✅ Complete           |
| Data & Intelligence | Insights Engine — Generators and Wiring                                                 | ✅ Complete           |
| Data & Intelligence | Insights Engine — Context Extension                                                     | ✅ Complete           |
| Data & Intelligence | Insights Engine — Generator Batch 2                                                     | ✅ Complete           |
| Data & Intelligence | Copy Variation Architecture                                                             | ✅ Complete           |
| Data & Intelligence | Insights Panel UI Redesign + Polish                                                     | ✅ Complete           |
| Platform            | Season Launch Hardening (Draft Auth + Polling, Standings Preseason, Insights Lifecycle) | ✅ Complete           |
| Platform            | Standings Ownership Model Redesign (Phases 0–5)                                         | ✅ Complete           |
| Data & Intelligence | Insights Engine — Weekly In-Season Pulses (INSIGHTS-026)                                | Planned               |
| Data & Intelligence | Insights Diagnostic Endpoint (INSIGHTS-019)                                             | Planned               |
| Data & Intelligence | Insights Panel — Microlabel Palette (INSIGHTS-017-PALETTE)                              | Planned               |
| Data & Intelligence | Insights Ranker — Priority Tuning (INSIGHTS-RANKER-TUNING)                              | Planned               |
| Data & Intelligence | Insights — All Insights Page (ALL-INSIGHTS-PAGE)                                        | ✅ Complete           |
| Data & Intelligence | Pairing Cards                                                                           | Planned               |
| Data & Intelligence | Luck Score + Bounce-Back Generators                                                     | Planned               |
| Platform            | Season Rollover UI and Cron                                                             | ✅ Complete           |
| Platform            | AppStateStore Caching — Egress Optimization (APPSTATESTORE-CACHING)                     | ✅ Complete (082A+082B) |
| Platform            | Server Fetch Architecture (SERVER-FETCH-ARCHITECTURE)                                   | Parked (audit done; fixes unscheduled) |
| Polish              | History Page Polish                                                                     | ✅ Complete           |
| Polish              | History Rework Foundation (HISTORY-REWORK-FOUNDATION)                                   | ✅ Complete           |
| Polish              | History Records (HISTORY-RECORDS)                                                       | In progress           |
| Polish              | Standings Page — Preseason State (STANDINGS-PRESEASON-STATE)                            | ✅ Complete           |
| Polish              | Standings Page — Lifecycle Labeling Sweep (STANDINGS-PAGE-LIFECYCLE-LABELING)           | Planned               |
| Polish              | Link Styling Audit (LINK-STYLING-AUDIT)                                                 | Planned               |
| Draft               | Slow Draft Mode                                                                         | Planned               |
| Draft               | Draft Difficulty Settings                                                               | Planned               |
| Platform            | League State vs Season State separation                                                 | Planned — deliberate fork; see `docs/roadmap.md` |
| Platform            | Multi-tenant Commissioner Sign-up                                                       | Planned — carries the league-deletion/data-retention question (item 13) |
| Platform            | Server Action Auth Hardening                                                            | Planned               |
| Platform            | Provider Refresh Observability (PLATFORM-086A)                                          | ✅ Complete (PR #391) |
| Platform            | Provider Automation & Correctness (PLATFORM-086B–I)                                     | ✅ Complete           |
| Polish              | Design Audit (remaining pages)                                                          | Planned               |
| Polish              | Copy / UX Writing Audit                                                                 | Planned               |
| Polish              | Back Button Audit                                                                       | Planned               |
| Polish              | Aliases Platform Migration                                                              | ✅ Complete           |
| Polish              | History Page — Filter Former Owners                                                     | Planned               |
| Polish              | Test Suite Baseline Cleanup (TEST-SUITE-BASELINE-CLEANUP)                               | ✅ Complete           |

## Active priorities

### 0. INSIGHTS-021 — current-year authority — DROPPED; repaired as data instead

**Not implemented. Decision 2026-08-06: repair the drifted registry row and drop the slice.**
`NEXT` returned to F2H2 (§1 below); F2H2, F2H3, F2I, and F2J have all since completed, closing the
F2 campaign on 2026-08-08. INSIGHTS-OFFSEASON-ROSTER-CONTENT followed and is also complete
(INSIGHTS-022, PR #464); `NEXT` is unassigned pending an owner decision — see the execution order.

**The defect.** `buildLeagueInsightContext` derives `lifecycleState` from `league.status` (correct)
but took `currentYear` from the top-level `league.year` projection, so on the live `tsc` shape
(`league.year=2025`, `preseason(2026)`) the page labelled 2025 and scoped career stats, records, and
suppression to the already-archived season. Owner intent stands and is recorded: **preseason belongs
to the UPCOMING year — it is the first state of the new season, not the final state of the previous
one.**

**Why it was dropped rather than shipped.** An implementation exists (`44f0fab`, unmerged, branch
deleted) and was fully reviewed. Three findings decided it:

1. **It fixes a DATA defect in CODE.** `tsc`'s drift is a single row predating
   `applyLifecycleStatus` synchronizing the two fields. Changing how ONE of ~16 consumers reads it
   leaves the other fifteen on the projection permanently — converting a wrong-but-consistent value
   into a lasting disagreement, and reproducing on the next drifted row.
2. **It made the Insights tab disagree with every sibling tab.** Home, schedule, standings,
   matchups, members, and all nine history pages pass `league.year`; only Insights would pass the
   resolved year, so the header flips 2025 → 2026 → 2025 as a user moves between tabs.
3. **The rookie tri-state was INERT.** Mutation-proven: `indeterminate` requires
   `firstSeason === currentYear`, while the generator also requires `finishHistory.length >= 1`,
   which needs an archive FOR that year — impossible during its own preseason. Treating
   `indeterminate` as `rookie` left all 53 insights tests green. The owner's stated case (an owner
   who completed 2025 is not a rookie in the 2026 preseason) is fixed by the YEAR correction alone.

**The repair instead.** Set the drifted row's top-level `year` to its `status.year`, restoring the
`applyLifecycleStatus` invariant. It also self-heals at the next season transition
(`completeSeasonTransition` has an explicit `healed` path for exactly this), so the manual repair is
an acceleration, not a necessity.

**What remains open.** The durable guarantee — all ~16 surfaces resolving the season the same way —
is NOT delivered by either the slice or the repair. A future drifted row reproduces the defect on
every consumer that reads the projection. Recorded as INSIGHTS-CURRENT-YEAR-AUTHORITY in the planned
backlog, now scoped as a cross-surface convergence rather than a one-page fix. The rookie tri-state
is NOT carried forward: it addressed an unreachable case.

### 1. PLATFORM-086F2 — admin control-plane information-architecture redesign — ✅ COMPLETE

Activated from backlog slug `PLATFORM-086F-ADMIN-DIAGNOSTICS-DASHBOARD-v1`. The read-only audit is
complete and accepted; the canonical inventory, target information architecture, locked decisions,
scheduler-receipt contract, and the slice-by-slice migration map live in
[`docs/architecture/admin-control-plane.md`](architecture/admin-control-plane.md)
(`PLATFORM-086F2A-ADMIN-CONTROL-PLANE-IA-v1`). The original "diagnostics dashboard" goals (compact
system-health summary, severity-ordered actionable issues, a scheduler heartbeat kept distinct from
provider-refresh status, and the H3E scheduler-skip observability gap) are all carried forward by
that plan.

Execution order within F2 (each slice is one independently deployable PR):

1. **F2A — inventory + IA doc** (docs-only) — ✅ merged (PR #430).
2. **F2B — lifecycle authority safety** (manual rollover converged onto the strict automatic
   eligibility gate, per-lifecycle-year rollover, no render-time status seeding, single league-year
   authority; binding rules in `AGENTS.md` → Lifecycle Authority Invariants) — ✅ merged
   (PR #431).
3. **F2C — maintenance action model and page foundation** (Data Maintenance & Recovery rename,
   shared per-action cost/scope disclosure contract, rollover off the maintenance page,
   historical-score repair provider-status instrumentation) — ✅ merged (PR #432).
4. **F2D — operational mutation relocation** — split at its audit into two independently
   reviewable slices:
   - **F2D1 — provider maintenance relocation** (System Health keeps gates + observation;
     Odds/Rankings refreshes, Conferences, and the Team Database sync live on Data Maintenance &
     Recovery with disclosures; drifted co-located team-database test removed) — ✅ merged
     (PR #433).
   - **F2D2 — score-attachment recovery relocation** (the mutating score tool becomes an
     explicitly confirmed emergency-class Data Maintenance action; Diagnostics keeps only
     observation + safety controls) — ✅ merged (PR #434).
5. **F2E1 — external scheduler receipts** (shared receipt authority
   `src/lib/server/schedulerExecutionStatus.ts` + latest-only durable
   `scheduler-execution-status/<job>` receipts written after successful cron auth on all five
   QStash routes; responses, provider behavior, cadence, runtime-event schemas, QStash contracts,
   and `vercel.json` unchanged; no reader/UI) — ✅ **merged (PR #435, `4404ad3`, 2026-07-31)**.
6. **F2E2A — lifecycle scheduler receipts + events** (extend the receipt authority to
   season-transition and season-rollover with `source: 'vercel-cron'`, and add their
   previously-missing secret-safe runtime execution-log events; responses, lifecycle decisions,
   provider behavior, cadence, and `vercel.json` unchanged; no reader/UI) — ✅ **merged (PR #436,
   `fa6e967`, 2026-07-31)**.
7. **F2E2B — scheduler receipt reader + delivery classifier** (cache-only server reader over all
   seven `scheduler-execution-status/<job>` receipts + schedule-slot-aware delivery classifier;
   safe receipt parsing exposed on the authority; server-only — no route, UI, provider call,
   scheduler mutation, settings change, or durable write) — ✅ **merged (PR #437, `f84b676`,
   2026-07-31)**.
8. **F2F — system-health read model** — one server-side view model (`src/lib/server/systemHealth.ts`)
   consuming the F2E2B reader plus automation gates, canonical data health, latest scoped attempts,
   quota, and storage — kept distinct — with stable issue codes, severity, safe static explanation,
   and a **nullable** repair destination (Data Maintenance / Season Management / Team Identity, or
   none). Server-only (no route/UI/mutation). ✅ **Merged (PR #438, `b9a1688`, 2026-08-02);** review
   closed by user evaluation after four Codex rounds (all 13 P2 findings remediated; the confirming
   round's three fixes had no further Codex pass).
9. **F2G — System Health UI** — `/admin/diagnostics` renders the F2F model as a current-status
   dashboard (stoplight overview → prioritized issues → always-visible scheduler/provider/quota-storage
   rows with row-level disclosure → Automation safety controls); server-resolved operational season
   (no `?year=` seam); the three incremental panels are retired; repair links route to owning surfaces.
   ✅ **Merged (PR #439, merge commit `c5e38be`, 2026-08-03);** visual direction user-approved
   (desktop + 390px, light + dark), review closed after three Codex rounds plus one user-authorized
   round (all P2 remediated).
10. **F2G1 — Draft-assistance retirement** — draft-readiness slice inserted between F2G and F2H
    before the in-person draft. Retire SP+ ratings and win totals as draft inputs: stop loading them
    in both draft server entry points, contract `selectDraftTeamInsights` (no SP+/win-total inputs or
    derived fields), make available-team ordering neutral (locale-aware alphabetical + stable team-id
    tie-break, identical for commissioner and spectator boards), delete the `cache-sp-ratings`/
    `win-totals` routes + their two admin panels + two maintenance descriptors + the orphaned CFBD SP+
    URL helper, and remove the dead `autoPickMetric` setting (auto-pick stays random). Existing inert
    `sp-ratings`/`win-totals` durable rows are left untouched (no destructive cleanup). ✅
    **Merged (PR #440, merge commit `9c3b6ce`, 2026-08-03);** full gate green, self-review + Codex
    round 1 clean.
11. **F2H — Season Management consolidation** — split after the lifecycle-authority audit so each
    correctness boundary remains independently reviewable:
    - **F2H1A — lifecycle guards core** — ✅ **Merged (PR #442, merge commit `d800fd6`,
      2026-08-04).** One guarded registry authority now owns
      commissioner offseason→preseason and exact-year setup completion; accepted transitions write
      `status` + the compatibility `year` projection atomically, stale/concurrent submissions write
      nothing, and new-league creation enforces the existing integer
      `2000..currentUTCYear+1` ingress horizon. Cron policy, recovery, rollover, and UI are excluded.
    - **F2H1B — season-transition convergence** — ✅ MERGED (PR #443, `be0c950`, 2026-08-04). The
      daily season-transition cron now commits through the guarded `completeSeasonTransition`; the
      four dispositions (transitioned / already-in-target / removed / refused) are counted
      independently and agree across the HTTP response, runtime event, and durable receipt;
      standings invalidation is pinned by outcome, and a post-commit invalidation throw reports
      `standings-invalidation-failed` — `partial` when the year recorded work, a clean `failure`
      when an untouched idempotent match wrote nothing — without rolling back a committed write;
      and the route declares `maxDuration = 300`. Targeting is UNCHANGED (every `preseason` league,
      including `test`), and `updateLeagueStatus` is retained: a first attempt bundled demo-league
      exclusion plus the weekly schedule cron's ownership rewiring and was reconstructed out for
      breaching the PR-sizing rule and for shipping the second cron without route-level tests.
    - **F2H1T — demo-league automation policy (LOCKED: manual-only)** — the demo league keeps its
      sandbox controls but must not independently trigger automatic lifecycle, schedule, or rankings
      work, and must not select the System Health operational year. A shared production year may
      still supply globally cached data to it. Five reviewed slices:
      - **F2H1T1 — test-control safety** — ✅ MERGED (PR #445, `8e6f122`, 2026-08-04). Slugless
        demo authority deriving and validating the year inside the registry transaction;
        `updateLeagueStatus` retired; the demo reset no longer deletes the SHARED
        `schedule-probe/<year>` record. Lands FIRST because excluding the demo league from automatic
        transition promotes the manual control to its sole preseason→season path. v1 was permanently
        stopped under the DOCS-013 review limits and never reached `main`; v2 was re-derived from
        clean post-DOCS-013 `main`. `TestLeagueControls.tsx` is untouched — operator-readable
        feedback is F2H3's, because Next redacts Server Action rejection messages in production, so
        a message-only surface cannot work there.
    - **F2H1SA — protected-path matcher coverage** — ✅ MERGED (PR #446, `533aed8`, 2026-08-04). Closed a
      DEMONSTRATED bypass, independently reproduced: the middleware matcher's static-file exclusion
      is a substring rule, so `/admin/audit.css` skipped `clerkMiddleware` while still resolving to
      the admin route worker where all nine Server Actions are registered. Fixed by matching
      `/admin/:path*` and `/debug/:path*` explicitly — anchoring the extension group alone does
      NOT work, because those paths genuinely end in the excluded extension; the `$` anchor is
      added alongside to close the root-cause `/foo/bar.css/baz` shape. Matcher entries are OR'd,
      so position in the array carries no meaning — only their existence does.
    - **F2H1SB — admin Server Action authorization** — ✅ MERGED (PR #447, `8021b1f`, 2026-08-05). Still mandatory
      once the matcher is fixed: Next treats an exported Server Action as a public endpoint that
      must authorize internally.
      CORRECTED MECHANISM (the earlier framing was refuted by the F2H1S audit and by an
      independent local reproduction): a POST to a PUBLIC path such as `/` does NOT execute these
      actions — none is registered on a public worker, so Next forwards the request to
      `/admin/[slug]` over real HTTP and that hop re-enters the middleware and is redirected. The
      demonstrated bypass was the matcher gap F2H1SA fixes. What remains after that fix is the
      framework requirement itself: Next treats an exported Server Action as a public endpoint that
      must be authorized INSIDE the action
      ([authentication guide](https://nextjs.org/docs/app/guides/authentication#server-actions)),
      so routing alone is never the authorization boundary.
      All NINE exported actions in `src/app/admin/[slug]/actions.ts` are affected —
      `setTestLeagueStatus`, `resetTestDraft`, `resetTestLeague`, `beginPreseason`,
      `setAssignmentMethod`, `confirmPreseasonOwners`, `completeSetup`, `migrateTestOwnersCsv`,
      `autoCompleteDraft` — and four of them take a slug, so the exposure reaches PRODUCTION
      leagues, not just the demo. Add one shared platform-admin guard invoked inside each action,
      refusing before any read, write, cleanup, or revalidation, and test direct invocation
      independently of the requested pathname. Use `isPlatformAdminSession()` with NO argument;
      do NOT synthesize a `Request` (that inherits the dev-open `ADMIN_API_TOKEN` branch), and keep
      THROWING on refusal — typed outcomes are a type error at the two `<form action>` sites and
      would silently swallow the refusal at the other five. Pre-existing and codebase-wide;
      surfaced during the F2H1T1 v2 review. Deliberately NOT folded into F2H1T1 — bundling a
      security fix into a lifecycle slice is the scope mistake that required v1's reconstruction.
      - **F2H1T2 — season-transition exclusion** — ✅ MERGED (PR #448, `6ab927c`, 2026-08-05).
        **F2H1T3 — weekly-schedule exclusion** — ✅ MERGED (PR #449, `c15413e`, 2026-08-05). Then
        **F2H1T4 — rankings exclusion** — ✅ MERGED (PR #450, `27a6c37`, 2026-08-05). Then
        **F2H1T5 — System Health operational-year isolation** — ✅ MERGED (PR #451, `6e881b5`,
        2026-08-05). **The F2H1T campaign is COMPLETE** — F2H1R is now the queue front. It resolved the operational season from PRODUCTION leagues only, filtering
        `TEST_LEAGUE_SLUG` from the population ONCE before both branches. **The F2H1T3/T4
        `isActive &&` shape must NOT be copied here and is a verified mutation:** the stored-year
        branch reads the top-level `league.year`, which is retained when the demo moves to
        `offseason`, so an active-only exclusion leaves a parked demo still selecting the year.
        T3 established the shape T4 followed: the demo league is filtered PER LEAGUE, before the
        job resolves which year it will act on — never against the resolved target list, which would
        drop a year a production league also occupies. `selectRankingsTargetYears` now resolves
        ownership from PRODUCTION leagues only and returns a closed
        `{ years, excludedDemoCandidate }`, so the years and the exclusion truth that shaped them
        cannot be observed apart; a demo-only active registry reports
        `skipped / no-automatic-ranking-target`. **T3's owner-selector rationale did NOT transfer:**
        `RankingsPublicationContext.lifecycle` is inert — no publication window branches on it, the
        publication key omits it, and it never reaches the durable receipt — so a demo `season(Y)`
        outranking production `preseason(Y)` only mislabelled the REPORTED lifecycle. That direction
        is mutation-pinned as a reporting-truth fix; the preserved production-`season` precedence is
        a CONTRACT PIN, since it passes with the exclusion fully removed.
        Separate because they are separate automation jobs under the binding sizing rule, and each
        needs its own route-level tests. Transition exclusion comes first: it removes the
        higher-frequency (daily) lifecycle and provider exposure without harming production leagues.
        This supersedes the earlier "safe order to avoid an ownership gap" framing — no code path
        expresses cross-cron ownership (`season-transition-owner` is a hardcoded label in the weekly
        route, not a read of the other cron's target set), so the risk is a receipt that misdescribes
        reality, and each slice must keep its own reason strings truthful.
      - **The T2→T3 window is CLOSED as of PR #449; the T5 risk remains.** Between T2 and T3 a
        demo-only preseason year received no automatic schedule maintenance from any job — the weekly
        cron still built `ownerByYear` from every league and classified the year
        `season-transition-owner` on an unarmed probe, deferring to a cron that had already filtered
        the demo out, and nothing armed the probe, so the deferral was permanent and the weekly
        receipt named an owner that did not exist. T3 removed that false deferral at its source: a
        demo-only year is no longer a weekly candidate at all, the run reports
        `skipped / no-automatic-maintenance-target` instead of naming a nonexistent owner, and the
        demo can no longer change which policy a SHARED year runs under. **CLOSED as of PR #451, and T3 had widened it:**
        `resolveOperationalSeasonYear` counted the demo league, so a demo-only year could become the
        System Health operational season. If nothing ever caches its schedule, `schedule-cache-missing`
        is a PERSISTENT critical rather than a transient one. T3 added a second half: a demo-owned
        operational year whose schedule IS already cached was refreshed by the weekly cron before
        that change and no longer is, so `schedule-cache-stale` (`providerDataDiagnostics.ts` — "older than
        the weekly policy", raised whenever the operational season is active and the entry exceeds the
        staleness window) becomes permanently true by design. **T5 removes the SYMPTOM, not the underlying
        gap.** Once the demo can no longer select the operational season, System Health stops
        _reporting on_ demo-owned years, so the three signals below stop reaching the operator that
        way. Nothing automatic maintains a demo-only year — that is unchanged and permanent by
        design — and the same signals remain reachable on a registry with no production league (which
        resolves to the calendar season) or with every production league `offseason` (which resolves
        to the last authoritative production projection). Neither fallback is guaranteed to be a year
        automation services; T5 does not claim otherwise. **T4 adds the rankings half:** a demo-owned
        operational year now also loses automatic rankings publication, so `rankings-cache-missing`
        (severity `info`, but the dataset-freshness fold still turns the Provider-data tile yellow)
        or, once a snapshot exists and ages past the 8-day horizon, `rankings-cache-stale`
        (`warning` → `degraded`) becomes permanently true for that year. All carry a working Data
        Maintenance repair link, but the repair does not stick, because nothing automatic
        re-maintains the year. In the dominant case the missing schedule signal (severity `error`)
        already subsumes them. Three warnings an operator could not
        clear from the automation surface. That is a consequence of shipping the exclusions one job at a
        time, which the binding sizing rule requires. **T5 (PR #451) removed them from
        the operator's surface by no longer REPORTING on demo-owned years — it does not restore
        maintenance to those years, and the same signals stay reachable on the two production
        fallbacks. See the T5 paragraph above for the precise scope.**
      - Also carried: the reset year stays 2025, so the demo's next preseason is the live
        production year — resolved by the exclusions, not by redesigning the reset.
      - **Recorded by the F2H1T3 review, deliberately NOT fixed in that slice.**
        (a) **Unvalidated `status.year` in cron target selection.** `getLeagues()` casts raw durable
        JSON with no per-record validation, so a legacy row with `state` but no `year` makes the
        weekly cron's ownership loop set an `undefined` year, pass the zero-target gate, read
        `schedule/undefined-all-all`, and emit a per-year entry whose `year` key `JSON.stringify`
        drops — which can make the durable receipt fail validation and vanish from System Health.
        Pre-existing and shared by the other target-selecting crons; `isStructurallyValidSeasonYear`
        already exists. Belongs with F2H1R (corrupt/missing lifecycle status), not with a demo-league
        exclusion slice.
        (b) **Declarative vs interleaved target selection.** The season-transition cron expresses this
        policy as two sequential filters with a length comparison; the weekly cron interleaves a
        mutable `excludedDemoCandidate` flag into its ownership loop because that loop also resolves
        the per-year owner. Behaviorally equivalent; the promote direction is mutation-pinned and the preserved production-season precedence is contract-pinned; converge
        the two shapes when T4/T5 touch the same code rather than restructuring reviewed code.
        **T4 re-deferred this deliberately.** It added a THIRD shape — a per-league `continue` inside
        a library selector that returns the exclusion truth in its result — because its ownership
        loop lives in `selectRankingsTargetYears`, not in the route.
        **DECISION, made at T5 closeout and now CLOSED: do not converge. No universal predicate is
        warranted.** The five sites share the canonical slug identity but not lifecycle eligibility
        or ownership semantics — eligibility sets are `{season}` (rollover), `{preseason}` (T2),
        `{season, preseason}` (T3/T4), and EVERY league (T5, including `offseason` and status-less
        records). Any predicate carrying an active-state gate is provably wrong at T5, and the
        largest expression true at all five sites is `slug === TEST_LEAGUE_SLUG` — which
        `TEST_LEAGUE_SLUG` already is. A helper named for POLICY rather than identity would actively
        lie. **Separately and still open:** the weekly-schedule and rankings target selectors are
        token-identical modulo two renames — a genuine two-job duplication with its own eligibility
        set. That is a candidate convergence slice needing its own plan and tests; it is NOT owned by
        T5, which touches neither cron. Do not open it merely because the loops look alike.
        (c) **`TEST_LEAGUE_SLUG` is not in `RESERVED_ADMIN_SLUGS`.** `POST /api/admin/leagues`
        reserves `aliases, season, data, draft, diagnostics, leagues, cache` — not `test`. The demo
        record normally occupies the slug and a duplicate 409s, but the admin delete action can
        remove it, after which a real league may be created at `test` and then silently skipped by
        rollover targeting, season-transition targeting, weekly schedule maintenance, and automatic
        rankings publication — and, as of T5, silently dropped from System Health's operational-year
        selection too, with no
        warning on any surface. The bare slug comparison became load-bearing for a FOURTH automation
        job with T4, and for the operator's primary status surface with T5. **Reserving the slug is
        not as small as it looks:** it also needs a dedicated demo bootstrap/recovery path, because
        `resetTestLeagueLifecycle` refuses an absent league and the general league-creation POST is
        the only production `addLeague` caller — so reserving `test` without one leaves a deleted
        demo record unrecoverable. One-line fix (add the constant to the reserved set) plus
        a test; deliberately NOT folded into a proof-surface round.
        (d) **Five open-coded `slug === TEST_LEAGUE_SLUG` sites exist as of T5** (rollover targeting,
        season-transition, weekly schedule, rankings, and the System Health operational year). The
        fifth is NOT an automation job — `resolveOperationalSeasonYear` is a read-model selector that
        writes nothing, calls no provider, and emits no receipt. Consolidation is CLOSED as
        "not warranted" under (b).
      - **Recorded by the F2H1T5 audit and review, deliberately NOT fixed in that slice.**
        (i) **`resolveOperationalSeasonYear` LAUNDERS an unusable year into a plausible one.** It
        filters candidates with `Number.isInteger`, which accepts integers below 1869 and integers at
        or above `2**53` that `isStructurallyValidSeasonYear` refuses. Such a value can win
        `Math.max`, and the `[2000, currentUTCYear + 1]` clamp then converts it into a year
        `validateYear` accepts — silently DISPLACING a real production year rather than failing.
        Unlike the crons, nothing downstream refuses it, so this is a laundering site, not merely a
        propagation site. Distinct from (a) (the `undefined` variant in cron target selection) and
        (e) (the fractional variant in the rankings cron); note the fractional class does NOT reach
        here, because `Number.isInteger` already drops it. Belongs to F2H1R, which owns year validity.
        T5 deliberately left `Number.isInteger` untouched — tightening it would change PRODUCTION
        resolution, which T5 promised to preserve.
        (k) **T5 makes System Health and Data Maintenance disagree on the default year.**
        `/admin/data/cache` defaults its refresh panels to the FIRST `preseason` league
        (`src/app/admin/data/cache/page.tsx`), demo included, and the System Health repair link
        (`systemHealthIssues.ts`) carries no year parameter. Before T5 both surfaces resolved the
        same demo year — agreeing, though both wrong. After T5 System Health reports the production
        year while the repair surface it links to can still pre-fill the demo's, so an operator
        following the link may bill provider quota against the wrong year while the original issue
        persists. The panel's year input is operator-editable, so this is a defaulting mismatch, not
        a forced misfire. NOT fixed in T5: `/admin/data/cache` is a UI surface this slice explicitly
        scoped out, and aligning the two defaults is a presentation decision (F2H3) or a matter of
        adding a year to the repair link. Surfaced by the T5 review, not by the audit.
        (j) **The season-rollover cron can report a zero-target reason that is false.**
        `GET /api/cron/season-rollover` calls `groupRolloverTargets`, which excludes the demo, then
        reports `skipped / no-season-leagues` with the body "no leagues in season state". When the
        only `season` league IS the demo, that statement is false on the operator's System Health
        row — the exact falsehood F2H1T2, T3, and T4 each explicitly refused to ship, and the only
        one of the five exclusion sites with no exclusion-truth channel. Closing it is a behavioral
        change to an automation job with its own receipt and event contract, so it belongs to F2H2
        (rollover consolidation), not to T5, which touches no cron.
        (e) **The unvalidated-`status.year` note in (a) UNDERSTATES the rankings cron.** (a) describes
        only the `undefined` variant, whose per-year entry `JSON.stringify` drops. A FINITE FRACTIONAL
        year is materially worse: `Date.UTC` applies `ToIntegerOrInfinity` to its year argument, so
        `status.year = 2031.5` satisfies the `cfp-publication` window — which requires NO cached
        schedule, championship, or poll context, only a Wednesday 04:00 UTC slot inside
        `[Nov 1, Dec 11)`. That reaches a durable claim at
        `rankings-publication-window/2031.5:cfp-publication:<date>`, a billed `/info` probe, and
        billed `/rankings?year=2031.5` requests, and — being finite — it PASSES receipt validation
        and renders a nonsense fractional year on System Health. Belongs with F2H1R. T4 was
        constrained not to make it worse: its exclusion flag is derived from `slug` and
        `status.state` only, never `status.year`.
        (f) **Four copies of the `providerUrlLog` fetch observer.** T3 added two (the schedule-refresh
        route and receipt suites) and T4 added two more (the rankings pair), each with its own
        positive control proving the same property. A new `fetch` input shape would have to be
        handled in four places, and a fix applied to one leaves the other three blind.
        `src/lib/server/__tests__/schedulerReceiptTestHarness.ts` is the established home for shared
        cron-test machinery. NOT converged in T4: doing so would edit another automation job's
        reviewed proof surfaces from a rankings slice. **Disposition at T5 closeout: re-deferred, and
        T5 is not its owner.** T5 touches no cron test suite — its only caller is a server-rendered
        page — so it has no standing to converge four cron suites. This belongs with the
        weekly-schedule/rankings selector convergence recorded under (b), or its own slice.
        (g) **A demo year above `currentUTCYear + 1` has NO rankings upkeep path — automatic or
        manual.** `GET /api/rankings` rejects any year above that ceiling with a 400 BEFORE
        authorizing (`src/app/api/rankings/route.ts`), while `decideTestLeagueStatus` increments the
        demo's year on every `Set: Pre-Season` under `isStructurallyValidSeasonYear` alone and states
        outright that "No new arbitrary ceiling is introduced". Before T4 the cron would eventually
        populate such a year — `cfp-publication` needs no cached context, only the calendar — so the
        exclusion converts a reachable-but-slow year into an unreachable one. Surfaced by the T4
        second-round review, which correctly refuted the unqualified "manual refresh is the supported
        upkeep path" claim T4's first remediation round had introduced; the claim is now qualified in
        both `AGENTS.md` and the selector docblock. NOT repaired in T4: closing it means changing
        either the manual route's ceiling or the demo authority's, both explicitly out of that
        slice's scope. Decide with F2H1R (which owns year validity) or T5.
        (h) **A demo-only `season(Y)` year surfaces a STANDING user-visible rankings error.**
        `loadSeasonRankings` throws on a total cache miss, `/api/rankings` maps that to 503, and
        `CFBScheduleApp` records `CFBD rankings load failed: …`; the suppression filter for that
        prefix applies only while the league is in PRESEASON. The draft board and Insights swallow
        the miss, but the league app does not. Pre-existing mechanism, made PERMANENT for demo-only
        years by T4. Recorded, not repaired — suppressing it correctly is a demo-presentation
        decision (F2H3) rather than a targeting one. Consolidation is
        adjudicated under (b) and is CLOSED as "not warranted". **Ledger correction:** the earlier
        claim here that "the coupling a shared predicate would create is what forced F2H1B's
        reconstruction" is FALSE. The binding record states the actual cause — the branch crossed two
        automation jobs and shipped the second surface untested. Do not cite the coupling story as an
        argument for or against consolidation.
    - **F2H1R — missing-lifecycle recovery + lifecycle-year validity** — SPLIT INTO FIVE SLICES.
      One cohesive PR was ruled out: the work crosses FOUR separate automation jobs
      (season-transition, weekly schedule, rankings, rollover), which AGENTS.md names as a mandatory
      planning-split trigger, and `PLATFORM-086F2H1B` v1 was reconstructed for crossing _two_ with
      the second untested. Each slice touches at most one automation job.
      - **F2H1R1 — registry-read truth + season-transition validity** — ✅ MERGED (PR #452,
        `e29bb47`, 2026-08-06). Adds `readLeagueRegistry()` (`ok` / `missing` / `malformed`) with
        `getLeagues()` semantics UNCHANGED, and hardens `GET /api/cron/season-transition`. See the
        ledger entry for the contract; the corrections it made to long-standing claims are recorded
        below.
      - **F2H1R2 — weekly-schedule validity** — ✅ MERGED (PR #453, `3a58767`, 2026-08-06).
        Applies the R1 shape to `GET /api/cron/schedule-refresh`: the container read
        (`registry-malformed`) and `status.year` validation AFTER the demo exclusion, refusing
        before any schedule read, probe, latch, settings read, billed E1A refresh, or presentation
        refresh. HTTP status DIVERGES from R1 on purpose — 200, this route's convention for every
        controlled outcome — which sharpens (o) rather than resolving it. The count is accumulated
        on the run state, not a local published after the loop, because here the loop that counts
        refusals is also the loop a corrupt record can throw from. Closed the `schedule-years` half
        of (r).
      - **F2H1R3 — rankings validity** — ✅ MERGED (PR #454, `10186b2`, 2026-08-06). Same shape as R2,
        with the container read kept BEHIND the automation gate (a paused run never reads the
        registry) and the refusal count published into a REQUIRED sink, because here the counting
        loop lives inside the pure selector where the run state is not in scope. Closed the
        fractional-AND-string CFP hazard: `Date.UTC` coerces, so a string year made the
        context-free publication window due and billed `/info` plus both partitions. Closed the
        `rankings-years` half of (r), and closed (o) and (p) as decisions below.
      - **F2H1R4 — rollover validity** — ✅ MERGED (PR #455, `995c18e`, 2026-08-06). Completes container
        truth on ALL FOUR registry consumers. The cron refuses a malformed container with 500 and
        the shared manual route with 409 (admin API contract: the request is well-formed and no
        dependency is down). `completeSeasonRollover` validates independently inside its
        transaction, on BOTH the stored and requested year and BEFORE the equality check — ordering
        it after makes the stored check dead code and misreports corruption as a stale target.
        Refusal lands before any archive: rollover is the only consumer that WRITES durable data
        keyed on the year. Closed the LAST dangling-colon branch (r) and the
        `guardedLifecycleWrite` false claim (s).
      - **F2H1R5 — RETIRED IN FULL BY DECISION, 2026-08-06.** All three parts are retired; F2H1R
        is COMPLETE through merged R1–R4 plus these recorded decisions. The deciding factor was
        value, not difficulty: every remaining part defends a condition that is **unreachable
        through current application writes** — creation validates the year and writes an explicit
        status, `updateLeague` throws on lifecycle fields, the per-league PATCH rejects `year`, and
        every transition is guarded — in a production registry verified (read-only, 2026-08-06) to
        hold exactly two structurally sound leagues. The condition remains possible through a
        restore from an old backup or a direct data edit, which is why PLATFORM-087 stays documented
        as a response plan rather than deleted.
        - **R5a — RETIRED.** System Health year validity. The clamp silently SUBSTITUTES an
          out-of-range integer (`1800` → 2000, `999999` → 2027) and renders a full health picture
          for a year no league occupies — cache-only, nothing billed, on an admin-only page. An
          implementation exists (`e2c7188`, unmerged) and its review established that the fix cannot
          be both small and correct: stopping the substitution requires either choosing a
          plausibility bound — which recorded item (l) reserves as one decision for all five
          consumers — or adding a refusal signal, which needs a surface this slice deliberately
          excluded. **The existing clamp and the AGENTS.md invariant that binds it are left
          UNCHANGED**; there is no code change to close out.
        - **R5b — RETIRED as a standalone slice; re-planned as PLATFORM-087.** Two attempts were
          built and neither is shippable. v1 (`dd591ca`) DROPPED unusable elements and returned the
          usable subset, which made an all-corrupt registry classify `ok` with zero leagues — every
          cron reporting a benign zero-target reason at HTTP 200, System Health green: the campaign's
          own falsehood class, reintroduced. v2 (`f5d9b65`, on
          `platform/086f2h1r5-registry-integrity-v2`, never merged) classified correctly but its
          consequences at the edges are not deferrable: `DELETE /api/admin/leagues/<slug>` answers
          **404 "League not found"** over a corrupt registry (the prohibited falsehood, on the
          surface an operator reaches for first), the public path empties with ZERO logging, the
          typed `LeagueRegistryIntegrityError` is caught by no boundary so the framework 500 is
          unchanged, and a malformed registry becomes unrepairable from inside the app because every
          mutator refuses and nothing else writes the key. **Reader-level validation is not
          independently shippable while it creates false 404s, silent empty pages, generic 500s, and
          no recovery path.** See PLATFORM-087.
          Both attempts are **unmerged evidence**: `dd591ca` (v1) and `f5d9b65` (v2). Neither
          reached `main`; the local branches are deleted. Each carries a full review record — Codex
          plus `/code-review` gathered on the same commit — and the v2 review is the source of
          PLATFORM-087's edge inventory.
        - **R5c — RETIRED.** The confirmed missing-status recovery has ZERO production targets and
          no current write path can create one (see the audit below). It was also the highest-risk
          item in the campaign, arming three jobs including an archive-producing one. NOT to be
          confused with PLATFORM-087's salvage operation, which repairs a DIFFERENT condition
          (registry corruption) and exists because the writer gating creates the state it repairs.
        The audit that produced this decision follows.
        **AUDITED 2026-08-06 — read-only; the charter's central premise
        does not hold, and the slice should be reduced.** The production registry was queried
        (read-only Neon role) and contains exactly two league records, both structurally sound:
        `tsc` preseason(2026) and `test` preseason(2027), both objects, both with valid integer
        years and explicit lifecycle status.
        - **The confirmed missing-status recovery has ZERO targets.** No record lacks a status, and
          no current write path can produce one: creation validates the year and writes an explicit
          status (F2B), `updateLeague` throws on lifecycle fields, the per-league PATCH rejects
          `year`, and every transition is guarded. Missing-status records are pre-F2B archaeology
          that this registry does not contain. Recommendation: **retire the durable recovery write**
          rather than build it — it is the highest-risk item in the campaign (it ARMS three jobs,
          one archive-producing) against a benefit that does not exist. If any coverage is wanted,
          a detection-only report costs almost nothing and never writes.
        - **Per-record validation (n) survives on its own merits and is the strongest remaining
          item.** Both readers pass corrupt ELEMENTS straight through (`[null]`, `[{}]`, `['str']`
          all classify `ok`), and 25 consumer files receive them typed as `League`. Probed
          consequences: `sanitizeLeagues([null])` THROWS — that is `src/app/page.tsx`, the PUBLIC
          homepage — and `sanitizeLeagues(['str'])` returns a character-indexed object served to
          visitors. This is the last path where corrupt data reaches an unauthenticated surface.
          No live instance today; nothing in the running code can create one; a bad restore or a
          hand-edit could.
        - **System Health year validity (i) is narrower than recorded.** The resolver already drops
          non-integers via `Number.isInteger`, so the fractional/string/null cases never reach the
          clamp. The real defect is silent SUBSTITUTION of out-of-range integers (`1800` → 2000,
          `999999` → 2027), after which the dashboard renders a full health picture for a year no
          league occupies with no signal it substituted one. Cache-only, so nothing is billed. Note
          `buildSystemHealthViewModel` has its own `validateYear` that THROWS outside [2000, 2100],
          so the clamp is partly load-bearing — removing it naively turns a bad record into a 500
          on `/admin/diagnostics`. Marginal at two leagues.
        - **`tsc` carries a projection mismatch** — preseason `status.year=2026` with top-level
          `year=2025`, violating the `applyLifecycleStatus` invariant. It is pre-`f3caa05`
          archaeology (that commit introduced the projection sync). It is NOT a repair target: it
          self-heals when the season transition writes `season(2026)`, and `completeSeasonTransition`
          additionally has an explicit `already-in-target-season` + `healed` path for exactly this.
          The real defect it exposed is on the READ side and is now
          **INSIGHTS-CURRENT-YEAR-AUTHORITY** in the insights backlog.
        Original charter text follows; the arming rationale still holds for whatever recovery, if
        any, is eventually built. It lands last because it is the only slice that ARMS automation: a
        status-less record is inert to every target selector today, and repairing it to `season(Y)`
        makes it a rollover target (archive-producing, and now year-validated by R4), a
        weekly-schedule `season` owner (the pause-exempt branch), and a rankings target within 24h.
        Landing it after R1–R4 means every job it arms already refuses malformed containers and
        unusable years — which was the whole reason the audit inverted the charter's implied order.
        It also owns (i) `resolveOperationalSeasonYear` laundering an unusable year through the
        clamp, and (n) per-RECORD validation inside an `ok` container, the one piece of container
        truth R1–R4 deliberately left open.
      This sequence owns the year-VALIDITY items every F2H1T slice deliberately refused: (a)
      unvalidated `status.year` in cron target selection, (e) a fractional year reaching the rankings
      cron's context-free CFP window and billing provider requests — note the hazard is NOT
      fractional-only, since `Date.UTC('2026', …)` is not NaN, so a string year is equally due — and
      (i) `resolveOperationalSeasonYear` laundering an unusable year through the clamp.
      - **Recorded by the F2H1R1 audit and review, deliberately NOT fixed in that slice.**
        (l) **`isStructurallyValidSeasonYear` is structural, not a plausibility window.** An in-range
        but absurd year (`999999`, or `1900`) passes it, becomes a `byYear` key, and still drives a
        probe read, two billed CFBD partitions, a probe write, and a lifecycle write. R1 used the
        shared predicate because the prompt forbade substituting the tighter creation horizon, and
        because narrowing it changes production behavior. Same class as (i). Decide the bound once,
        for all five consumers.
        (m) ✅ **CLOSED at R4 — the malformed-vs-empty collapse is closed on ALL FOUR registry
        consumers** (R1 season-transition, R2 schedule-refresh, R3 rankings, R4 season-rollover plus
        its shared manual route). No automation job now reports a zero-target reason asserting no
        league exists on a corrupt registry. Per-RECORD validation inside an `ok` container remains
        open and is R5's — see (n).
        (n) **`readLeagueRegistry` classifies the CONTAINER only.** A `[null]` or `[{}, null]`
        registry classifies `ok` and then throws downstream into the generic `unexpected-error` 500.
        Pre-existing and unchanged — `getLeagues()` returned the same array before — and per-record
        validation is R5's, which owns record-level truth. Narrowing the return to `unknown[]` would
        ripple through every consumer and belongs with that slice.
        (o) ✅ **CLOSED at R3 — DECIDED: HTTP status follows the DELIVERY BOUNDARY, not the reason
        literal.** The QStash-delivered routes (`schedule-refresh`, `rankings`) answer every
        controlled outcome with 200 and reserve non-200 for authentication, because an at-least-once
        delivery layer must not read a controlled data-integrity refusal as a transport fault and
        redeliver against it. The Vercel-native lifecycle crons (`season-transition`, and
        `season-rollover` when R4 gives it the reason) keep 500, where no such layer exists. So the
        same `registry-malformed` literal carrying different statuses on different jobs is CORRECT
        and intended, not drift. R4 follows the Vercel-native side of this rule. Operators monitor
        the event `result`/`reason` and `invalidLifecycleTargets`, never the HTTP status.
        (p) ✅ **CLOSED at R3 — DECIDED: a deferral alone never causes failure; an unusable
        PRODUCTION TARGET does.** The refusal, not the deferral, is what degrades the aggregate. The
        valid years' reason is always preserved, so `result` and `reason` answer two different
        questions: `reason` says what the valid years did, `result` says whether the run as a whole
        is trustworthy. Two consequences are ACCEPTED, not overlooked:
        (1) `unusable-lifecycle-year` is unreachable as a REASON whenever any valid year executed,
        so an alert must key on `invalidLifecycleTargets > 0`, never on the reason literal;
        (2) **on rankings the standing-warning effect is severe, and this is the sharpest instance
        in the campaign.** `skipped` is that job's modal outcome — the publication window is due on
        a small minority of in-season deliveries and on NONE from January through July — so a single
        unrepaired record makes nearly every run classify `failure` and shows a continuous
        `scheduler-execution-failed` warning on System Health, even though the valid years did
        nothing wrong and no provider work was due. The same holds on the weekly cron whenever the
        active years are all transition-owned, which is 2026's current shape. This is the intended
        encoding: a corrupt lifecycle record is a standing condition and should read as one until
        repaired. The repair is to fix or remove the offending league record. If operators find the
        noise unacceptable in practice, the correct fix is a dedicated issue code with a repair link
        (item (q)), NOT softening the aggregate — that would hide the condition rather than surface
        it.
        (q) **OWNED FOLLOW-UP — a dedicated lifecycle-integrity issue with a repair link.**
        User decision, 2026-08-06, taken together with closing (p): the continuous `failure` is
        APPROPRIATE and must not be softened. A corrupt league record stays actionable on every
        run, even when rankings publication is not due, and reclassifying the aggregate to
        `skipped` would make the scheduler look healthy while it is repeatedly refusing a
        production target. **The real problem is actionability, not severity.**
        Today the count renders only at the end of the Target string inside the scheduler row's
        collapsed `<details>`, beside a reason that may name something benign, and
        `systemHealthIssues` derives from `result` alone — so there is no issue code, no
        operator-readable statement of what is wrong, and no repair link. The work: derive a
        dedicated issue from `invalidLifecycleTargets > 0` (NOT from `result`), with a stable code,
        a message naming the condition, and a repair link to the lifecycle recovery surface.
        Owner: the System Health / F2H3 presentation work. **Explicitly NOT a reason to reopen
        R3** — the aggregate stays as merged.
        (r) ✅ **CLOSED at R4** — all four receipt summary branches now guard the empty year list
        (R1 `season-transition-years`, R2 `schedule-years`, R3 `rankings-years`, R4
        `season-rollover-years`). Having to fix the same defect four times is itself the argument
        for (t).
        (t) **READY NOW — FOUR summary branches are near-identical** (`schedule-years`,
        `rankings-years`, `season-transition-years`, `season-rollover-years`), each recomputing the
        same unusable-suffix and empty-year-list guard, differing only in the per-entry mapper. The
        deferral window was "once across R3–R5, when all four consumers exist" — they now do, and
        the dangling-colon defect had to be fixed four separate times for exactly this reason. A
        single `formatLifecycleYearsTarget(target, renderEntry)` collapses all four and makes the
        next lifecycle target kind a one-liner. Related: `RolloverRefusalSink` is the THIRD
        structurally identical refusal-sink declaration (`RankingsRefusalSink`, and an open-coded
        one on `schedule-refresh`), each restating the same mid-loop-throw rationale; one exported
        `LifecycleRefusalSink` would carry it once.
        Both are cosmetic convergence, deliberately deferred: doing it once across R3–R5, when all
        four consumers exist, beats doing it twice in slices that each own one job.
        (w) **Two integrity refusals on the season-rollover cron carry different HTTP statuses**:
        `registry-malformed` is 500 while `unusable-lifecycle-year` is 200, though both set
        `result: 'failure'`. R1 has the same asymmetry, so R4 inherited rather than introduced it,
        and the delivery-boundary rule (o) settles QStash-vs-Vercel but not two refusals on ONE
        Vercel-native route. To a cron dashboard the 200 reads as a successful invocation. Decide
        once, across R1 and R4 together.
        (v) **The two rankings cron suites duplicate six fixture helpers verbatim**
        (`makeLeague`, `seedLeague`, `seedSchedule`, `seedUnusableLeague`, `usablePayload`, and the
        provider stub). R3 aligned the two `seedUnusableLeague` signatures so a positional mix-up
        can no longer silently seed a league named `'preseason'`, but the duplication itself
        remains; a shared `__tests__/rankingsCronFixtures.ts` would remove the drift class.
        (u) **`excludedDemoCandidate` is discarded when refusals coexist.** A run whose active
        registry held both a demo league and an unusable-year production league reports only the
        refusal; the demo exclusion becomes invisible. Zero-target reasons are single-valued by
        construction, so surfacing both needs a reporting-shape decision, not a one-line fix.
        (s) ✅ **CLOSED at R4.** The module comment is corrected in place:
        `guardedLifecycleWrite` owns the STATUS-TRANSITION family, and
        `completeSeasonRollover` deliberately does not route through it (its guard is a different
        shape — an exact season+year re-check producing a typed outcome). The consequence the false
        claim was hiding is fixed: rollover now has its own structural year check. Converging the
        two writers remains F2H2's.
    - **F2H2 — rollover/archive consolidation** — ✅ **COMPLETE** (F2H2A PR #456, F2H2B PR #457).
      Audit FIRST was the right call: this surface writes permanent archives. **Audited 2026-08-06**
      (6 dimensions, adversarially verified); the value verdict retired two of the five chartered
      items, rescoped a third, and sent the UI consolidation to F2H3 — so the campaign shipped two
      slices where five were chartered:
      - **F2H2A — admin season backfill RETIRED.** ✅ MERGED (PR #456, `cb40c03`, 2026-08-07). Owner
        decision: backfill was a one-time historical TSC import, not a product feature. Review of a
        hardening attempt (`d27fffb`, `0bc7f4d`, both unmerged and discarded) found two ways to
        trigger an irreversible write unintentionally — the confirmation gate read
        `existing !== null && !confirmed`, so "Preview Backfill" WAS the write whenever no archive
        existed, and the only year bound was `>= 2000`, so the live in-season year was accepted and
        SUCCEEDED because the current season's schedule cache always exists. The surface shipped
        completely untested. Retiring removes the risk class rather than guarding it; the capability
        survives in `buildSeasonArchive`/`saveSeasonArchive`, still exercised by both rollover paths,
        so a future one-off is a few lines against tested code.
      - **Retired as chartered items:** "converge the rollover projection/result contract" (the two
        surfaces have genuinely different jobs; no misleading output found) and "benign duplicate
        delivery reporting" (no path was produced where a redelivery reports as failure — the
        premise appears false).
      - **F2H2B — rollover operator truth.** ✅ MERGED (PR #457, `876d87c`, 2026-08-07). Shipped
        `no-automatic-season-leagues` and separated the standings-invalidation error from the
        lifecycle write. One review finding is carried
        rather than fixed — see the manual-route `catch {}` bullet under F2H3 below. The daily cron
        reported `no-season-leagues` whenever the DEMO league was the only one in season — needing
        no corruption, and the default post-reset demo state. Rollover was the last of five
        demo-exclusion sites without a demo-only reason. No test covered the shape: every existing
        assertion seeds an EMPTY registry where the reason is true, which is why it survived four
        merged R-slices. `invalidateStandings` also shared a `try/catch` with the lifecycle write,
        so a cache-invalidation throw was reported as a status-write failure that did not happen.
        Archive-first retry behavior was DOCUMENTED as intended, not changed.
      - **Rescoped: the "duplicate rollover UI" must NOT be consolidated by deletion.** Neither
        panel is a superset of the other — `RolloverPanel` uniquely shows the overwrite warning,
        which owners' outcomes flip by name, and per-owner standings movement; `SeasonRolloverPanel`
        is structurally broader (all years, all eligibility states, reasons, dates). Deleting either
        loses operator information. Merge capability instead, under F2H3.
      - ✅ **DECIDED 2026-08-07 — manual rollover EXECUTION is retired; PREVIEW is kept.** Owner
        ruling: the button has no unique authority and no unique recovery behavior. It sits behind
        the identical gate as the daily cron (`there is no force/emergency bypass`), which runs
        anyway, so it only advances an already-eligible rollover by less than 24 hours — and that
        convenience does not justify another permanent lifecycle-write surface. Nothing but the two
        panels calls it, and the manual route predates the cron (2026-04-01 vs 2026-04-17), which is
        why it exists at all. The PREVIEW keeps its unique value: it is the only way to see which
        owners' final standings would flip BEFORE anything is written, and the cron has no
        equivalent.
        **Removal lands in F2H3**, not here — it is a panel-consolidation change, and doing it
        during the merge avoids building the merge twice. F2H2B stays focused on operator truth.
    - **F2H3 — Season Management presentation** — ✅ **COMPLETE** (F2H3A PR #458, F2H3B1 PR #459,
      F2H3B2 PR #460). **F2H reopened once for F2H4** (PR #461), which retired the page these slices
      refined — see item 12 below. **F2H is complete.** Closed four deferrals carried from earlier slices: demo UI copy (F2H1T2–T5),
      typed operator feedback in `TestLeagueControls.tsx` (F2H1T1), the lifecycle-integrity issue
      (q) from F2H1R3, and the manual route's bare `catch {}` from F2H2B.
      - **F2H3A — rollover surface consolidation.** ✅ MERGED (PR #458, `6a8b86c`, 2026-08-07). Audited
        read-only first (2026-08-07); the owner settled every product decision before implementation.
        Manual rollover EXECUTION is retired — `POST /api/admin/rollover` is preview-only and
        answers `confirmed: true` with `rollover-execution-retired` (409) rather than ignoring it,
        because a silently-ignored execute request returns a PREVIEW that a stale client reports as
        a failed rollover. `RolloverPanel` is deleted after its unique diff detail (owners whose
        outcomes flip BY NAME, standings movement) was ported into `SeasonRolloverPanel`; it could
        not have been the survivor in any case, since it returns `null` when no year is eligible and
        the empty state must stay visible. Production-year disagreement now warns and stays
        inspectable. No UI-side demo filtering was added — `groupRolloverTargets` already excludes
        the demo upstream. AGENTS.md invariants 4 AND 5 amended (invariant 4's write-time refusal
        count is now cron-only).
      - **F2H3B — remaining Season Management presentation.** Audited read-only 2026-08-07 and split
        into two slices on the owner's ruling.
        - **F2H3B1 — lifecycle presentation + typed test-control feedback.** ✅ MERGED (PR #459,
          `b07f2d6`, 2026-08-07). Lifecycle STATE and OWNERSHIP now render as separate facts, derived from the
          STORED status; the demo league's automation copy is corrected (**demo UI copy**, deferred
          by F2H1T2–T5, is CLOSED); the lifecycle controls return typed results and render
          persistent inline feedback (**typed operator feedback**, deferred by F2H1T1, is CLOSED).
          A second live falsehood surfaced during implementation: a legacy missing-status record
          reaches NO lifecycle job, so the inferred season label must not carry the season's
          automation claim.
        - **F2H3B2 — System Health lifecycle-integrity warning.** ✅ MERGED (PR #460, `5822a16`, 2026-08-07). One combined issue derived
          from `invalidLifecycleTargets > 0` on any scheduler receipt, INDEPENDENT of the aggregate
          job result (deferral (q), from F2H1R3). **Owner rulings: display NO number** — receipts
          carry per-job, per-run counts and never slugs, so four jobs counting the same corrupt
          league cannot be reduced to a league count; the details may name WHICH JOBS reported the
          problem but must not convert those into a league count. Copy: "Automatic processing
          refused production lifecycle data. Some processing may be incomplete." **`repair: null`** —
          verified end to end that no production lifecycle repair exists (`updateLeague` throws on
          `year`/`status`, the admin PATCH refuses both, the settings Season Year input is
          `readOnly`, and `resetTestLeagueLifecycle` is structurally demo-only). Recovery is
          PLATFORM-087's, unscheduled.
      - **Follow-up recorded, outside both slices:** `systemHealthIssues.ts` already gives lifecycle
        jobs a `season-management` repair link on `scheduler-execution-failed`/`-partial`, and
        `/admin/season` has no lifecycle repair either. Same claim class as the decision above;
        deliberately left alone rather than widened into these slices.
      **The two decisions taken during the F2H2 audit, both now discharged by F2H3A:**
      - **Retire manual rollover EXECUTION, keep PREVIEW** (decided 2026-08-07 — see the F2H2 entry
        above for the reasoning). Removes `POST /api/admin/rollover`'s `confirmed: true` path and
        the execute controls from both panels; the GET status/preview path stays. This must amend
        **AGENTS.md Lifecycle Authority invariant 5**, which currently reads "Season rollover —
        manual AND automatic — is per-year, strict, and shared" and describes the manual route's
        group-atomic two-stage execution. Leaving that invariant stale would be the exact
        false-canonical-claim class F2H2A had to sweep four documents for.
      - **Merge the two rollover panels by CAPABILITY, never by deleting one.** Neither is a
        superset of the other: `RolloverPanel` uniquely shows the overwrite warning, which owners'
        outcomes flip by name, and per-owner standings movement; `SeasonRolloverPanel` is
        structurally broader (all years, all eligibility states, reasons, dates). With execution
        retired the merge gets substantially simpler — one status surface carrying the preview, and
        no duplicate execute controls to reconcile.
      - ✅ **CLOSED by F2H3A — the carried F2H2B finding.** The manual route's bare `catch {}` around
        `invalidateStandings` is gone with the execution path that contained it, so the two surfaces
        can no longer disagree about that fault: only the cron invalidates, and F2H2B made its
        reporting truthful. **Reversal condition, recorded per the F2H2B closeout:** if manual
        execution is ever restored, its standings-invalidation handling must be HARDENED AND TESTED,
        never reinstated from the retired bare catch. This is now also stated in AGENTS.md
        invariant 5.
12. **F2H4 — RETIRE `/admin/season`** — ✅ MERGED (PR #461, `8f56835`, 2026-08-07). Owner ruling.
    - **KNOWN GAP recorded at review, deliberately not closed here.** With a single production season
      year — the ordinary shape — the receipt carries the exact `ChampionshipRolloverSkipReason`, so
      System Health answers "why has this not rolled over yet". When production years DISAGREE and
      their gates skip for different reasons, `aggregateLifecycleCronReason` records `year-results`
      and the `season-rollover-years` receipt target has no per-year reason field, so the dashboard
      cannot explain either year. The per-year reasons ARE still on the runtime event (Vercel Runtime
      Logs), so this is a dashboard limitation, not a loss of information. Pinned by a test.
      **Follow-up if it ever matters: persist per-year reasons onto the receipt target.** That is a
      receipt schema change and was kept out of a retirement slice on purpose.
      Note the compounding: F2H3A's year-disagreement WARNING lived on the deleted panel, so this
      abnormal state is now neither flagged nor explained on any surface. Season rollover is
    automation-owned and, since F2H3A, has no operator-reachable execution and **no automation-pause
    gate** — so the preview showed an irreversible write nobody could prevent: unactionable by
    construction. `ArchiveListPanel` renders year badges with no `href` at all, and
    `/league/[slug]/history` already navigates the same `listSeasonArchives` data per league.
    Delete rather than relocate, both panels. Orphan set (the panel is the route's only caller):
    the page, both panels, `/api/admin/rollover`, `src/lib/manualRollover.ts`, and
    `diffSeasonArchives`. Capability survives — `rolloverTargeting`, `completeSeasonRollover`,
    `buildSeasonArchive`, `saveSeasonArchive`, and `listSeasonArchives` all stay.
    **Forces a recorded follow-up closed:** the `season-management` repair surface (emitted from
    exactly one site, the lifecycle branch of `schedulerExecutionIssues`) is removed, so lifecycle
    scheduler faults carry `repair: null` — matching what F2H3B2 established. **Verify before
    deleting:** that a waiting-period skip reason is legible on the System Health scheduler row.
    Filed under F2H rather than F2I because `/admin/season` IS Season Management.
13. **F2I Platform Configuration / Team Identity** — ✅ MERGED (PR #462, `cbd3ed5`, 2026-08-08). Audited
    read-only first: two of the three chartered items were already done or overstated (Team
    Identity's global scope was settled by PLATFORM-064/067; the only real duplication was the
    display name), and the actual finding was an IRREVERSIBLE league delete with ZERO tests.
    Shipped: a slug-typed delete confirmation enforced in the ROUTE (a static `ADMIN_API_TOKEN`
    reaches the endpoint without the UI), refusal of a slug whose previous league's data survives,
    configuration editing moved to the settings page, and the Team Identity rename.
    - **Review changed the reuse guard's design.** It was first written as a flat refusal, and both
      reviewers caught that this created a DEAD END rather than a safeguard: nothing in the app
      deletes league-scoped records, so a refused slug was refused forever. Two consequences made
      that wrong rather than merely strict — re-creating at the same slug is exactly how an
      ACCIDENTAL delete was recovered (restoring a league its OWN rosters), and the demo league's
      slug is a hardcoded constant whose only creation path is this route, so deleting `test` would
      have bricked it permanently. Now refused BY DEFAULT and overridable with an explicit
      `adoptExistingData` acknowledgement — the same standard as the delete confirmation:
      impossible by accident, available when it is what you mean.
    - **NOT done, recorded so it is not a surprise:** `PUT|DELETE /api/admin/leagues/[slug]/password`
      has **no test file at all**. It is auth-adjacent and persists a hash and salt. Out of this
      slice's scope; it should be covered before that path is relied on.
    - **Deferred, by owner decision:** true privacy ERASURE — actually removing the per-league data,
      commissioner-facing, with re-authentication. Not needed before a broader public league, and it
      is a feature with real design questions (immediate vs deferred purge; who may invoke it),
      not a hardening task. The slug-reuse refusal is the stopgap until then. Making it
      commissioner-facing is an AUTHORIZATION change and belongs with F2J's boundaries.
14. **F2J commissioner boundaries + navigation closeout** — ✅ **MERGED** (PR #463, `d9a8e93`,
    2026-08-08). **This slice completed F2.** Audited read-only first, and the audit reversed the framing twice:
    there is NO commissioner identity in code (every league-scoped write requires platform admin;
    the league password gates reads only — verified route by route), so there was no boundary to
    build, only copy implying one; and `foundedYear` is a FOUNDING year, not a first competition
    season. Shipped: `foundedYear` frozen after creation (`league-founded-year-immutable`, 409,
    wholesale), the orphaned `/admin/draft` surfaced as a platform card, first-ever tests for
    `LeagueSettingsForm` and the league-password route, and label associations on a form whose
    fields were all unlabelled.
    - **The standing F2J charter, dispositioned explicitly** — F2 must not be declared complete with
      old promises silently abandoned:
      - _Separate direct roster management from historical CSV repair_ — ✅ **already satisfied** by
        F2C/F2D: roster upload is `/admin/[slug]/roster`; historical repair is `HistoricalCachePanel`
        on Data Maintenance. Verified, not assumed.
      - _Reconcile the orphaned draft page_ — ✅ **done here**, by surfacing it.
      - _Rebuild `/admin` around the agreed hierarchy_ — **RETIRED by owner ruling** during the F2J audit.
        Navigation stays; one card added. "Commissioner Tools" is kept deliberately as the name of
        the intended product.
      - _Accessibility/browser verification_ — **SPLIT, and both halves resolved.**
        - **The mechanical half is DONE.** Every `<label>` across `src/app/admin` and
          `src/components/admin` is now associated with its control — seven fixed here on top of
          those in the two forms F2J already touched, verified by a repo-wide check that now
          reports zero. Previously a screen reader announced those inputs with no name.
        - **The manual half is RETIRED as a charter item, by owner ruling.** Cross-browser
          rendering, keyboard navigation, contrast, and screen-reader flow across everything
          F2A–F2J rebuilt is a real piece of work that deserves scheduling on its own, not a merge
          gate on the final slice. It is not a code deliverable and F2 does not wait on it.
          **Re-planned as a dedicated pass before public launch**, when the surfaces have stopped
          moving and there are real users to serve. The operator performs a short check of what
          F2J itself changed against `preview` before merge — see the PR for the exact list.
    - **RESOLVED in F2J round 2** (was: creation mints `foundedYear` unconditionally and PATCH
      refuses every update, so restoring an accidentally deleted league rewrote its founding year to
      the current year, permanently). The owner ruled this a regression F2J created rather than an
      inherited limitation, and therefore merge-blocking, and directed a **narrow recovery-only**
      value rather than the optional-`foundedYear`-at-creation design previously ruled out ("no
      planned support for legacy leagues; that was a TSC only activity"). Shipped as
      `restoreFoundedYear`: a separate field, accepted only alongside `adoptExistingData: true`,
      REQUIRED when adopting, bounded at the current calendar year, and refused on ordinary
      creation. Review then found the flag was **self-justifying** — it suppressed the very residue
      scan that establishes there is anything to adopt — so the scan now runs unconditionally and
      adopting a slug that holds nothing is itself an error. `null` is accepted as an explicit "no
      recorded founding year", which is what keeps a legacy record from being forced to invent one.
    - **Follow-up recorded:** `DraftSequencingPanel` computes `rolloverNeeded` as
      `league.year < new Date().getUTCFullYear()` — its own calendar rule, independent of the
      lifecycle authority. Read-only display, left alone here.
    - **NOT done, remaining future account-system work:** commissioner roles, invitations,
      membership acceptance/removal, ownership and transfer, commissioner league deletion,
      reauthentication, audit history.
15. **PARKED — owner identity as an ID, not a name** (owner direction, 2026-08-14, during
    PLATFORM-098). Recorded because it is the eventual RESOLUTION of a defect class this project has
    now paid for four times, not a new idea to schedule.

    **Ownership is stored as a display NAME, in three places that can disagree.** For one league-year
    the same person is written independently into `preseason-owners:{slug}:{year}` (the confirmation
    record), `owners:{slug}:{year}` (the roster, `team,owner`), and `DraftState` — both `owners[]`
    and every `pick.owner`. Nothing reconciles them, because the raw string IS the identity:
    `deriveStandings` keys on `row.owner`, and the only comparison in `standings.ts` is
    `=== NO_CLAIM_OWNER`.

    **Every defect below is the same fact wearing different clothes**, and each was found separately:
    - PLATFORM-092 — `DraftState` kept a COPY of the roster and the only screen that edited owners
      never updated it. Fixed by deleting that copy; the picks were left holding theirs.
    - PLATFORM-098 — editing owners after publication changed one record while every visible surface
      read another.
    - PLATFORM-098 review — renaming an owner in the roster editor, then reopening and confirming,
      rebuilds the roster from `pick.owner` and silently reverts the rename. Guarding it needs a
      warning at two separate doors, and the comparison needs canonical team identity to avoid
      firing on aliases.
    - PLATFORM-098 review — a reset carries membership forward by asking the roster "who holds
      teams", which cannot represent an owner holding none, and cannot distinguish "this owner was
      removed" from "this owner was renamed" because both look like a name in one list and not the
      other.

    **The owner's direction:** when user accounts arrive, ownership ties to an internal user ID and
    the display name becomes a presentation component. That does not merely fix these — it makes them
    unrepresentable. A rename stops being a data migration across three records and becomes an edit
    to one field nothing else keys on, and "is this the same person" stops being string equality.

    **Consequence for scheduling:** guards written against name-equality are interim by construction.
    Prefer refusing an ambiguous operation and telling the operator, over reconciling names — a
    reconciliation that guesses is the failure mode this whole class produces. Sequence this with the
    account system (item 14's "remaining future account-system work"), not before it; the identity
    seam already surveyed in `docs/architecture/identity-and-ownership.md` is the starting point, and
    item 16 below is about TEAM identity, which is a different problem with a different answer.

16. **PARKED — CFBD team IDs for provider matching** (question raised 2026-08-07; investigated
    read-only, not scheduled). Framed on the way in as "aliases may be obsolete now that we use CFBD
    IDs". **Both halves of that turned out not to hold**, so it is recorded as what it actually is: a
    correctness improvement to PROVIDER matching, not a simplification.
    - **We do not use CFBD IDs.** `src/data/teams.json` carries `school`, `mascot`, `conference`, and
      an `alts` array — no IDs at all. Schedule items carry OPTIONAL `homeId`/`awayId`, but canonical
      identity through the pipeline is the team NAME.
    - **Aliases are not obsolete.** 20+ runtime consumers outside the admin surface, in the core data
      path: `schedule.ts`, `scores.ts`, `odds.ts`, `seasonBuild.ts`, `scoreAttachment.ts`,
      `reconcileNames.ts`, insights, and the game-stats slate builders. `scoreAttachment` classifies
      every resolution as `alias | canonical | unresolved | ambiguous` — that is reconciling names
      returned by CFBD and ESPN, which no internal ID fixes, because the mismatch arrives from
      outside.
    - **The roster-CSV argument for aliases is WEAKER than first stated** and the correction is worth
      keeping: the draft tool is the primary roster path now and picks from the catalog, so it
      produces canonical names by construction and the owners CSV is its OUTPUT rather than a typed
      input. CSV upload is still mounted at `/admin/[slug]/roster` and `reconcileNames` still exists
      for it (it can even persist learned aliases), but it is no longer the main flow.
    - **What IDs would actually buy:** exact provider-to-provider joins where both providers supply
      one, shrinking the `ambiguous`/`unresolved` outcomes. They would NOT retire the alias layer.
    - **Prior decisions this must not silently reverse:** `docs/roadmap.md` marks the alias-model
      sequence complete (PLATFORM-055 → 067) with the final precedence **stored global → year →
      seed**, and explicitly SUPERSEDED the goal of removing year-scoped alias code — that tier is
      retained on purpose. This queue also lists "new matching systems or changes to schedule-first
      identity rules" as **out of scope**.
    - **Cheap test before any retirement is ever contemplated:** empty the global alias map on
      preview and observe what breaks. Expect roster reconciliation and score attachment to start
      missing matches.

17. **PARKED — cross-league league-setup superview** (owner idea, 2026-08-07). A table of leagues ×
    setup milestones for a chosen year, so an operator can audit **how many created leagues actually
    finish setup** — an activation/funnel measure ahead of going public. It passes the surface test
    deliberately: it represents something a human measures and decides on, not machinery that merely
    exists, and it is **not** a revival of `/admin/season`.
    - **Mostly aggregation, not new derivation.** `LeagueStatusPanel` already reads the per-league
      milestones — owners CSV (`owners:<slug>:<year>`), draft phase (`not started` / `configured` /
      `scheduled` / `live` / `paused` / `complete`) — and `describeLeagueLifecycle` (F2H3B1) is
      already the one lifecycle-ownership authority a row would use.
    - **Two constraints found while scoping it.** (a) Schedule and scores are YEAR-scoped
      (`schedule/<year>-all-all`), not league-scoped, so those columns would read identically for
      every league in a year — they belong in a header, not a column, or the table implies
      per-league progress that does not exist. (b) It is four `getAppState` reads per league per
      year; fine at current scale, worth knowing before it is a public-launch dashboard.
    - **The hard part is the definition, not the rendering:** what "finished setup" means, whether
      it is per-year or all-time, and whether this is an admin page or closer to analytics. Audit and
      settle that before any implementation. Not scheduled.

The legacy diagnostics tools remain available and unmoved until the corresponding slice ships.

**PR sizing, review limits, verification, and reconstruction are binding rules in
[`AGENTS.md`](../AGENTS.md)** — see **Scope and sizing**, **Review and remediation limits**, and
**Verification**. They are not restated here; this file owns campaign sequencing and status only
(DOCS-012 ledger ownership, extended by DOCS-013).

**F2 exit condition.** The 086F2 admin control-plane campaign is complete when ALL of the following
hold, and not before:

1. Every slice F2A–F2J is either merged or explicitly retired with a recorded reason.
2. No admin surface still reads or mutates lifecycle, provider, or scheduler state through a path
   that bypasses its guarded authority.
3. Every automatic job's target selection is covered by route-level tests — deleting a targeting
   guard must fail the suite.
4. The System Health operational season is derived from production lifecycle state alone.
5. Every deferral this campaign opened is either closed or recorded in the canonical deferrals
   section below with an owner slice.

**All five hold as of 2026-08-08 (F2J / PR #463), and F2 is CLOSED.**

1. Every slice is merged or explicitly retired with a recorded reason — including the four retired
   outright (F2H1R5, two of F2H2's five chartered items, the `/admin` rebuild, the manual
   accessibility pass), each with an owner ruling recorded at the point of retirement.
2. No admin surface bypasses a guarded authority: F2H1SA/SB closed the middleware and Server Action
   gaps, F2H3A/F2H4 removed the manual rollover surfaces entirely, and F2J moved the founding-year
   freeze off the route and into `updateLeague` itself.
3. Targeting guards are route-tested across all seven jobs (F2H1T1–T5, F2H1R1–R4).
4. `resolveOperationalSeasonYear` derives from production lifecycle state alone (F2G, F2H1T5).
5. Deferrals are closed or recorded below with an owner slice; the founding-year restoration gap
   was the last one opened and was closed inside F2J itself rather than carried forward.

### Provider campaign (PLATFORM-086) — completed record

The provider correctness & automation campaign is **complete**, 086F2 included (closed 2026-08-08). Live-score polling
(3-minute), Odds polling (hourly), weekly schedule maintenance, and publication-aware rankings
automation are all **active in production**; game-stats polling (15-minute) has been active since
H3E; automatic schedule-presentation enrichment is wired into the active schedulers (its first
qualifying automatic refresh is the pending, passive §8i observation). Every slice's full execution record (scope, review
rounds, verification, PRs, merge commits) lives in `docs/prompt-registry.md`; outcome milestones in
`docs/completed-work.md`; operator activation evidence in `docs/deployment-runbook.md` §8e (game
stats), §8f (live scores), §8g (Odds), §8h (weekly schedule), §8i (presentation observation —
pending, passive), §8j (rankings). Provider descriptor policy strings were corrected in each
family's implementation PR; conferences remain manual by design (no automation task exists).
PLATFORM-086D was absorbed into 086A and retired — do not reuse that ID.

### 2. INSIGHTS-018 — NEW tag + signature system

**Superseded in part — see the execution-order entry, which is canonical for this work.** A
2026-08-14 audit of the live TSC preseason found the NEW tag is the smaller half: the feed is DRAINED
by per-type suppression (`{ kind: 'unchanged' }` cannot release while no games are played), and a
signature/freshness model alone would leave standing facts buried exactly as permanently, since their
stat values never move either. Rotation must key on standing-fact vs event as well as on change.

Per-league global (not per-user) NEW-tag system for the insights panel. 48-hour active-season
window, 7-day offseason window. Signature-based detection so that hook/owner/statValue changes
register as a fresh insight while semantically identical re-renders do not.

- **Backlog slug (provisional):** `INSIGHTS-018-NEW-TAG-v1`

### 3. INSIGHTS-019 — Diagnostic endpoint

Admin-gated `GET /api/debug/insights/[leagueSlug]` that returns: generator pool size, rendered set,
suppressed set, per-insight signatures, and last-change timestamps. Enables at-a-glance verification
of NEW tag behavior and suppression correctness without reading logs.

- **Backlog slug (provisional):** `INSIGHTS-019-DIAGNOSTIC-v1`

### 4. INSIGHTS-020 — Record-change insights

**Reframed 2026-08-14 — becomes a CONTRIBUTOR to the INSIGHTS-026 pulse rather than a standalone
feature.** A record change is an EVENT, not a standing observation, and the pulse is where events
belong. `RecordEntry.recentChange` is still the dormant field to populate; what changes is that its
output feeds the digest rather than being minted as a free-standing insight with its own signature
and suppression.

Surface recently changed records as insights. Wires up the dormant `RecordEntry.recentChange` field
(declared in Phase 1, never populated). Pairs with INSIGHTS-018 (NEW tag) and INSIGHTS-019
(diagnostic endpoint) as part of the insights freshness campaign.

**Scope:**

- Snapshot store for prior `selectAllRecords` output (likely `appStateStore`)
- Diff trigger and cadence (per-week post-scoring, on-demand, or cron — design decision)
- TTL / "recent" window semantics
- New insight generator: `src/lib/insights/generators/recordChange.ts`
- Suppression rule integration with existing insight category logic
- NEW tag interaction: record changes are inherently "new since last visit" — should inherit
  INSIGHTS-018 wiring

**Dependencies:** INSIGHTS-018 (NEW tag) preferred to ship first so record-change insights inherit
the freshness wiring. Estimated: 2–3 PROMPT_IDs end-to-end.

- **Backlog slug (provisional):** `INSIGHTS-020-RECORD-CHANGE-v1`

### 5. DRAFT — Slow Draft Mode

Enable async drafts with configurable per-pick windows. Requires email notification infrastructure
(new). See `docs/roadmap.md` for full scope.

### 6. PLATFORM-087 — Registry integrity (dedicated campaign)

Re-planned 2026-08-06 out of F2H1R5b, after two attempts proved reader-level validation is not
independently shippable. **Not scheduled; sequence within it is binding when it is.**

**The problem.** `readLeagueRegistry` classifies the CONTAINER (R1) but not the elements inside, so
a non-object member flows through typed as `League`. Two harms are proven by probe: a `null`
element THROWS inside `sanitizeLeagues` — that is `src/app/page.tsx`, the PUBLIC homepage — and a
string element is spread into a character-indexed object and served to visitors. Nothing in the
running code can write one; a restore from an old backup or a direct store edit can. Production is
currently clean (verified read-only, 2026-08-06).

**Why it is a campaign and not a slice.** Both shippable-looking designs fail at the edges rather
than at the reader:

- DROPPING unusable elements makes an all-corrupt registry classify `ok` with zero leagues, so every
  cron reports a benign zero-target reason at HTTP 200 — the "no leagues exist over corrupt data"
  falsehood this whole line of work exists to eliminate.
- Classifying the container MALFORMED is correct at the reader and immediately creates four edge
  falsehoods: `getLeague()` → `[]` makes `DELETE /api/admin/leagues/<slug>` answer 404 "League not
  found" for a league that demonstrably exists; the public path empties with no log, event, or
  status record; a typed integrity error reaches no HTTP or Server Action boundary, so the framework
  500 is unchanged; and gating the writers makes a malformed registry unrepairable from inside the
  app, since every mutator refuses and nothing else writes the key.

**Phase 1 — truthful read edges.** Strict classification, plus EXPLICIT handling at every consumer
class: public pages, the admin league list, CRUD preflight, diagnostics, and the crons. The binding
rule is that malformed must never surface as empty or as 404 on any of them.

**Phase 2 — write boundary and recovery.** Typed HTTP and Server Action refusals, plus an explicit,
confirmed salvage operation. **Writer gating and recovery must land ATOMICALLY** — gating alone
creates a state nothing can repair, which is precisely how the v2 attempt failed.

Distinct from the retired F2H1R5c missing-status recovery: that had zero production targets and
armed three automation jobs; this salvages registry corruption and exists because the gating creates
the condition it repairs.

Evidence, not to be merged or patched further: `dd591ca` (v1, branch deleted) and `f5d9b65`
(v2, `platform/086f2h1r5-registry-integrity-v2`). Both carry full review records — Codex plus
`/code-review` on the same commit — and the v2 review is the source of the edge inventory above.

### 7. PLATFORM — Server Action Auth Hardening

Enforce commissioner role on all mutating server actions. Remove `ADMIN_API_TOKEN` fallback from
public routes.

## Unresolved decisions & known deferrals

Explicitly deferred, not scheduled — this is their single canonical home (per `AGENTS.md`). Other
documents may link here but must not maintain duplicate descriptions. Do not mark any complete
unless verified in merged work.

- ~~**CSV current-season guard** vs sanctioned admin override.~~ **Resolved — PLATFORM-083** (audited in PLAN-002). `PUT /api/owners` now guards active-season overwrites: replacing an already-populated active-season roster requires an explicit `?override=1` repair confirmation (surfaced in both the CSV import panel and inline roster editor); historical/backfill and initial-creation writes are unguarded. Route stays platform-admin-only; no new league-admin role. See `docs/architecture/identity-and-ownership.md`.
- **Expected-absence applicability for `scores` / `odds` / `rankings` (deferred at PLATFORM-090, 2026-08-10).** PLATFORM-090 gave only `game-stats` a canonical applicability state, so on a genuinely COLD deployment (no cached data for the year at all) those three datasets still render yellow `No cached data` and re-degrade `Provider data` and `Overall`, exactly as game-stats did. Each is silent for its own reason and none is an actionable gap in that state: the live-scores cron skips `no-polling-target` and the scores diagnostics are gated on a completed slate, while `odds-cache-missing` and `rankings-cache-missing` are `info` severity, which the freshness stoplight does not consult. Extending the concept requires a canonical applicability authority PER DATASET — none may borrow game-stats' slate semantics, and `ProviderCacheAvailability === 'absent'` must not become globally neutral. Not reachable in the state that prompted PLATFORM-090 (that deployment had the other three caches populated, which is why only the Game stats row was yellow). Not scheduled.
- **Provider-data diagnostics build the canonical slate on every call (deferred at PLATFORM-090, 2026-08-10).** Publishing the game-stats expectation requires the canonical slate, so `getProviderDataDiagnostics` now builds it whenever a schedule is cached — previously it was built only when a completed slate existed. In the preseason state the feature targets, each System Health render and each `GET /api/admin/provider-status` therefore pays a team-catalog read, an alias-map read, and a `buildScheduleFromApi` over the season; the provider-status route pays it for a value it never reads. The build is already skipped when the year has no usable cached schedule. Not fixed because both obvious remedies are worse: gating on `completedSlates.length > 0` reinstates the wrong basis PLATFORM-090 re-derived away, and gating on a caller-supplied "do you consume expectations" flag makes the authority's output depend on a caller hint. A lazy/memoized slate seam shared with the coverage pass is the real fix. Correctness is unaffected. Not scheduled.
- **Owner-identity mapping across seasons** (renamed/returning owners; owner display names are raw strings today).
- Whether to schedule **PLATFORM-040** (ownership-key normalization).
- **`conferenceRecords` canonical build** — whether the canonical standings build should pass `conferenceRecords` (PLATFORM-070-adjacent).
- **Historical/archive ownership parity** tied to **PLATFORM-039** — archive/insights surfaces still raw-label match; see the `AGENTS.md` deferral list.
- **`STANDINGS-PAGE-LIFECYCLE-LABELING`** — broader offseason/`{year} Season` label audit beyond the standings page (see the Polish backlog below).
- ~~**Numeric participant-validation prerequisite (PLATFORM-086H3C1).**~~ **Resolved — PLATFORM-086H3C5, MERGED via PR #407 (2026-07-24, dormant).** Schedule persistence now captures CFBD numeric `homeId`/`awayId` through the shared mapper (additive, nullable; old durable rows stay readable and are never rewritten), and the dormant evidence authority validates stored `schoolId`s against them by exact oriented comparison — producing the fail-closed `identity-mismatch` and `participant-validation-unavailable` states that C1 deferred. Full record: `docs/prompt-registry.md` → `PLATFORM-086H3C5-DORMANT-NUMERIC-PARTICIPANT-VALIDATION-v1`. **Operational prerequisite for H3E activation — ✅ DONE (2026-07-26):** the forced full-year schedule refreshes for every H3E target season have been performed (§8d), so canonical games carry the numeric ids; the previously-fail-closed `participant-validation-unavailable` caches are refreshed (see the registry entry's rollout notes and `docs/ai/game-stats-writer-fence.md`). The C1 handoff's "Participant validation (DEFERRED)" section remains the point-in-time record of the original deferral.
- **Accepted — game `401506450` (2022 week 14 Akron @ Buffalo) is an upstream CFBD data-quality limitation; its canonical analytics exclusion is intentional (decided 2026-07-24).** The stored row (`app_state` scope `game-stats`, key `2022:14:regular`; sole occurrence across all 2022 partitions; legacy shape, provider-written) is a **genuine provider capture that is analytics-incomplete at the source**: each side carries only six defensive raw categories (sacks, tackles, qbHurries, defensiveTDs, tacklesForLoss, passesDeflected) while all six required analytics categories (netPassingYards, possessionTime, rushingYards, thirdDownEff, totalYards, turnovers) are missing on both sides — classifying it `legacy-malformed` → historical `manual-only` under the evidence authority. A live diagnostic read of the exact refresh endpoint (`/games/teams?year=2022&week=14&seasonType=regular`, 2026-07-24) returned the identical defense-only partial payload, so **automated CFBD backfill cannot repair it** — a refresh reproduces the same defective evidence. Decision: **do NOT build a manual stat-entry or migration path for this one historical game**; the canonical projection's exclusion stands, and this remains the sole expected H3E parity residual (the legacy points-only baseline counts the 23–22 game; the final-and-complete canonical projection excludes it).
- **Terminology debt — rename the `manual-only` / `stats-manual-only` state names.** The names wrongly imply manually entered data exists; no manual-entry feature exists and no such row was hand-authored. The state actually denotes the `manual-migration-only` recovery disposition — historical defective evidence no automated path can repair (`src/lib/gameStats/evidenceAuthority.ts` / `contract.ts`). Rename the evidence state (and any audit exclusion label derived from it) to a name that says "unrepairable historical evidence" when these modules are next touched; naming-only, no behavior change.
- **Cross-authority indeterminate-commit vocabulary (deferred at PLATFORM-086E2A review, 2026-07-30).** The app-state transaction layer can distinguish a commit whose acknowledgment was lost (`AppStateTxnFinalizeError` `writeAttempted`/`writeAcknowledged` — the write may have durably applied) from a plainly failed one, but BOTH the schedule (E1A) and rankings (E2A) refresh authorities report every transaction fault as `durable-commit-failed` under their closed reason vocabularies. Safe today (memo unpublished, no fabricated success, the next refresh reconciles via observation ordering — the caveat is documented in both result contracts), but the reported "prior-good retained" can be false in the lost-acknowledgment case. If addressed, add a distinct indeterminate outcome to E1A and E2A **uniformly** — never one authority alone. Raised as a P1 by an external E2A review; dispositioned not-taken there because the E2A prompt's closed vocabulary and the merged E1A sibling pin the current semantics. Not scheduled.
- **Synthetic-final-poll partial-postseason replacement window (deferred at PLATFORM-086E2A review, 2026-07-30).** The rankings completeness gate compares the canonical POST-remap representation, in which all postseason weeks collapse to one synthetic final poll (week 999). If a prior entry was built from CFBD postseason weeks 1+2 and a later refresh returns only week 1 with the SAME populated poll sources, the remap re-mints the synthetic final from the earlier poll and neither the week-key nor the source-population check fires — the final poll is silently replaced by the earlier-era poll as `written-clean`. The realistic variant (source sets differing across those weeks) IS caught; detecting the residual window would require persisting pre-remap postseason week identity (a stored-model change). Claude cycle-1 P3; not scheduled.
- **Per-game live-overlay freshness granularity (deferred at PLATFORM-086B2B, owner decision 2026-07-28).** The scores freshness signals are per-partition/global, not per-game: `snapshotAt` (the "Scores updated …" label) is the oldest contributing partition's `meta.generatedAt`, and `isStale` (live-overlay dimming) is a single successful-observation flag for the whole overlay. In a provider-gap scenario — a game that drops out of the scoreboard while still live, so the cron preserves its stale row while other games in the partition keep updating — a fresh sibling can ride over that stale game (the partition's newest-row timestamp), and the global `isStale` cannot dim just that game. This is strictly better than pre-086B2B (which reported every game fresh on any client poll) and does not affect standings/records (server canonical). The true fix is per-game freshness: thread per-game effective timestamps (`itemUpdatedAtById`) to the client and make `selectLiveDelta` compute per-game staleness. Documented in `src/lib/scores.ts` (`noteSnapshot`). Not scheduled.
- **Accepted — synthetic-only empty-usable catalog (PLATFORM-086H3C1), not production-reachable.** A nonempty-but-registry-unusable team catalog (e.g. `[{ school: '' }]`) can bypass `buildCanonicalGameStatsSlate`'s `teams.length === 0` catalog-authority guard **only via a direct synthetic call**: production `getTeamDatabaseItems()` sanitizes every entry through `toTeamCatalogItem` (drops empty-`school` items), so an unusable catalog collapses to `[]` and is already caught as `catalog-load-failed`. Accepted as test-only robustness — the pure builder stays exported for unit tests (not privatized); if ever hardened, tighten the precondition to require ≥1 registry-usable entry.
- **Guarded Server Action refusals can reach the generic error boundary (PLATFORM-086F2H1SB, 2026-08-04).** Six client call sites and the two `<form action>` surfaces do not catch, so after an expired or refused session a guard throw becomes an unhandled rejection inside `startTransition` and replaces the admin page with the root error boundary. Before F2H1SB these actions threw only on data-integrity faults, so the path was effectively unreachable; the guard makes it routine. F2H1SB deliberately adds no partial client catches and no typed action-state UI — **F2H3 owns consistent operator-readable guarded refusal states** and should resolve all of them together rather than piecemeal. Note that Next redacts Server Action rejection messages in production, so a message-only surface cannot work; F2H3 needs a typed channel.
- **Clerk registers four dependency-owned Server Action references (PLATFORM-086F2H1SB, 2026-08-04).** The production build registers 13 server references, not 9: `invalidateCacheAction` plus the three exports of Clerk's keyless-actions module, and unlike the app's own nine these are registered on EVERY route worker including public pages. Two return early behind a development-only flag; `syncKeylessConfigAction` has no such guard. These are dependency surfaces, not repository actions — F2H1SB neither patches `node_modules` nor claims them. Review through dependency upgrade or upstream analysis. Practical consequence for any future test: do NOT assert the build manifest contains exactly nine action ids.
- **`setAssignmentMethod` does not validate `method` at runtime (2026-08-04).** Its `'draft' | 'manual'` annotation is erased at the Server Action boundary, where arguments cross HTTP unvalidated, and `updateLeague` blind-spreads the value. Readers branch on the union and fall through on anything else, so an out-of-union value silently disables both assignment paths in the preseason UI. Pre-existing input-validation debt, deliberately separate from the F2H1SB authorization fix. Not scheduled.
- **Demo standings cache collisions on the non-season lifecycle paths (PLATFORM-086F2H1T2, 2026-08-05).** F2H1T2 wired standings invalidation into the demo's manual season transition, because the cron exclusion made that control its only preseason→season path. The manual `preseason` re-click, `offseason`, and `resetTestLeague` remain un-wired and share the SAME key-collision property that justified wiring season: `resolveStandingsYear` returns the same resolved year across a preseason re-click (while `clearTestLeagueYear` deletes the owner inputs that snapshot was built from), and an offseason write projects `league.year` to the outgoing season year. They are un-wired by SCOPE, not because they are safe — F2H1T2 was authorized to fix only the regression it caused. Pre-existing on `main`; the cron never invalidated on these paths either. Not scheduled.
- **The demo season re-click invalidates unnecessarily (PLATFORM-086F2H1T2, 2026-08-05).** Clicking `Set: Season` when the demo is already in `season(N)` resolves to the same year, still reports `applied`, and busts the umbrella `standings:test` tag — recomputing every cached year for the league plus the Insights output cache that reuses the same tags, for a state that did not change. Performance only; correctness is unaffected. Gating on an actual state change, or passing the year variant, would avoid it. Not scheduled.
- **Middleware matcher residuals carried out of PLATFORM-086F2H1SA (2026-08-04).** Three items,
  none of them a reproduced bypass. (a) The gate answers a non-GET request to a protected path with
  `NextResponse.redirect`, which defaults to **307** — method- and body-preserving — so an
  unauthenticated Server Action POST is replayed, body and `Next-Action` header intact, to `/login`
  (or `/` for a signed-in non-admin). The action never executes, so this is not an authorization
  escape, but a security gate should answer a non-GET with a bodyless refusal rather than a
  navigational redirect. Changing it is a middleware BODY change, which F2H1SA excluded. (b) The
  matcher regression test depends on `unstable_doesMiddlewareMatch`, resolved by raw file path
  because Next 15 declares no `exports` map for it; `package.json` pins `next` with a caret, so a
  routine update can move it. The failure mode is a hard import error, not a silent pass — replace
  the helper when Next stabilizes it. (c) The static-file exclusion is a NEGATIVE heuristic ("a
  dotted path is an asset"), which is false for any dynamic segment that can carry a dot —
  `app/league/[slug]` has the same shape today, harmless only because that route needs no
  middleware. Scoping the exclusion POSITIVELY (`_next` plus the actual `public/` entries) would
  invert the default so new route families are matched unless deliberately excluded, and remove the
  two-place literal sync F2H1SA leaves behind. That is a better design than the one shipped, and it
  changes matching for every route in the app, so it needs its own slice. Not scheduled.
- **A season transition can commit and then miss its standings invalidation, with no durable reconciliation guarantee (PLATFORM-086F2H1B, 2026-08-04).** The durable lifecycle write and the Next cache bust cannot be one atomic operation. An invocation that dies between them leaves the league in `season` with a warm preseason standings snapshot, and later daily transition runs no longer select that league — the target filter is preseason-only, so the `already-in-target-season` path cannot reach it. The snapshot does not expire on its own (`getCanonicalStandings` is tag-only, `revalidate: false`), and preseason and season resolve to the SAME cache key, so nothing rotates it. In practice other schedule/score activity commonly limits the window — `cron/live-scores`, `/api/schedule`, and `/api/scores` all bust the same tag, and the transition gate fires at least a day before the first game — but that is a mitigation, not a guarantee. The window predates F2H1B (the pre-convergence cron had the identical filter and the identical commit-to-invalidate gap); what F2H1B added was the accurate description of it. Any future fix must preserve provider ownership and quota behavior: do NOT simply broaden the cron's target filter to all active-season leagues. Not scheduled.
- **Cron `maxDuration`/latency-envelope hardening — NARROWED to the weekly schedule-refresh route (deferred P3 from the PLATFORM-086E1C2 review, 2026-07-30; season-transition resolved by PLATFORM-086F2H1B, 2026-08-04).** `GET /api/cron/schedule-refresh` still declares no explicit `maxDuration` (nothing in the route or `vercel.json`), so its latency envelope is the platform default; the season-transition route now declares `export const maxDuration = 300` on the default Node.js runtime, with its scheduler configuration and daily cadence unchanged. In a sustained provider-brownout worst case the E1C2 presentation wiring roughly doubles a pre-existing E1A exposure (the qualifying-year presentation calls run after the canonical work in the same invocation). Self-healing (leases/backoff/TTLs recover on a later delivery) and speculative — no observed incident. Harden the remaining `schedule-refresh` route when it is next touched (season-transition is resolved). Full record: `docs/prompt-registry.md` → `PLATFORM-086E1C2-SCHEDULE-PRESENTATION-AUTOMATION-WIRING-v1`. Not scheduled.
- **Unusable persisted lifecycle-year recovery (PLATFORM-086F2H1A review, 2026-08-03).** F2H1A correctly refuses and logs an offseason record whose stored year is not a safe structural season year, rather than deriving and persisting another corrupt value. F2H1R is scoped to genuinely missing status and therefore does not repair this distinct corruption class. Before F2H1R/F2H3 closes, decide whether to add a separately confirmed data-correction operation with an explicit replacement year and the same targeting/invalidation consequence disclosure; until then, the record remains fail-closed with no operator repair surface.
- **Candidate follow-ups recorded in historical entries (pointers only — descriptions live in their
  records):** PLATFORM-045 (league-route canonical-loader dedup), PLATFORM-052 (podium/hero live
  badge; `liveCountByOwner` staleness alignment), PLATFORM-054/055/056 (canonical-layer candidates:
  score cache warming, global alias merge, insights canonical owner sourcing), canonical ownership
  IDs for current-season draft ownership, 086H4 (broader game-stats presentation/copy audit), the
  game-stats legacy-row migration, the co-located `route.test.ts` relocation (four remaining
  files — one admin (`odds-usage`), three non-admin; see
  `docs/architecture/admin-control-plane.md` → operational clarity findings), and the
  `manualRefresh.ts` dead-surface trim (the scores/schedule/game-stats URL branches and
  `manualActionKey`/`isSelectedYear`/`combineOutcomes` have no live caller since F2D1 — the
  module doc marks them). See `docs/prompt-registry.md` and `docs/completed-work.md`.

_Resolved during the audit sequence (no longer open): `AdminDebugSurface` → deleted in
PLATFORM-079b; public odds/scores fetch policy → PLATFORM-075 pure-cache-reader model._

## Provisional backlog — server-fetch architecture (audit complete; fixes unscheduled)

The SERVER-FETCH-ARCHITECTURE read-only audit superseded the earlier generic "routes fetch their own
API endpoints" framing (the original Insights example was fixed by `ALL-INSIGHTS-SCHEME-FIX` and the
Insights loader now builds context in-process). Verified remaining findings — provisional backlog
items, no formal prompt IDs assigned:

- **Manual authorized Odds refresh context loads via internal HTTP.** The manual `/api/odds?refresh=1`
  path still obtains canonical schedule and conference context by fetching `/api/schedule` and
  `/api/conferences` over internal HTTP (`src/app/api/odds/route.ts`), instead of the direct
  server-side context authority (`canonicalOddsContext`) the automatic Odds refresh uses.
- **Admin debug context loaders use internal HTTP and can mask failures.** Several admin debug
  context loaders (`src/app/api/debug/_lib/loadDebugSeasonContext.ts`, consumed by the schedule /
  scores-attachment / postseason-score-attachment debug routes) fetch internal endpoints and may
  collapse non-2xx responses into misleading empty collections (`.catch(() => ({ items: [] }))`
  around body parsing).
- **Score diagnostics' intentional self-call — deferred.** `src/app/api/debug/scores/route.ts`
  deliberately self-calls the scores refresh (forwarding the admin's credentials) so a cold cache
  does not report misleading zeros; removing it safely requires extracting a shared score-refresh
  authority first (the pattern the odds/schedule/rankings families now have).

## Planned backlog (from INSIGHTS-017 campaign)

Items surfaced during the Insights Panel Redesign + Polish campaign and queued for future implementation:

- **INSIGHTS-017-PALETTE** — Category microlabel palette rationalization. Resolves HISTORICAL/STANDINGS/SEASON shared-purple and STATS/LEAGUE/fallback shared-slate token collisions. Includes micro-discovery on why SEASON labels render when no generator appears to set that category. Constrained by `DESIGN.md`'s strict ban on amber/green/red/blue hues for category use.
- **LINK-STYLING-AUDIT** — App-wide standardization of "view more" / "full view" / "see all" cross-links. Current split: blue `↗` on history/Overview column headers vs. muted `→` on Insights "See all". Convention chosen: muted text + horizontal arrow. Removes redundant blue accent on already-interactive links, aligns with `DESIGN.md`'s single-purpose use of blue for interactivity.
- **STANDINGS-PAGE-LIFECYCLE-LABELING** — Broader "Offseason" vs "{year} Season" label inconsistency audit across surfaces beyond the standings page. STANDINGS-SUBHEADER-FIX addressed the standings page itself; other surfaces may still show stale or contradictory year/lifecycle labels during offseason.
- **INSIGHTS-RANKER-TUNING** — Audit base priority weights across all 26 generators. Add sample-depth awareness (e.g. "perfect record at 6 games" should not rank as high as "perfect record at 20 games"). Foundation for eventually restoring row-1 prominence once the ranker earns it. Revisit when priority decay ships — now defined as **INSIGHTS-PRIORITY-DECAY** below. These two are coupled: decay is multiplicative over the base weights, so the weights must be commensurable before decay can be trusted.
- **INSIGHTS-PRIORITY-DECAY** — Time-dependent weighting to replace binary lifecycle gating. Two prior items already referenced "when priority decay ships" without it ever being defined; this is that item.
  **Why.** Eligibility today is a binary `supportedLifecycles` list plus a static `priorityScore`; the engine sorts and takes the top N. There is NO time dimension anywhere, and priority is not lifecycle-aware. So "recently relevant" can only be expressed as an on/off gate, which produces a cliff rather than a fade.
  **What the audit found (2026-08-06).** The `fresh_offseason` → `offseason` boundary is a PURE SUBTRACTION: zero generators are offseason-only, so nothing turns on at the cutoff. Exactly four families turn off (`SEASON_WRAP`, `STATS`, `ROOKIE`, `RETURNING_OWNER_TRENDING`); the other ~10 (historical, evergreen, rivalry, career) run identically on BOTH sides at identical priority. The intended "treat all years more equally in the regular offseason" therefore does not happen — that content was already running at full strength before the cutoff. Whether the cutoff changes anything visible is incidental to the score ordering.
  **Shape.** A recap scores high at rollover, decays over weeks, and settles into rotation rather than vanishing. Roster content stays eligible year-round with a lift approaching preseason. Historical content holds a flat baseline and rises naturally as seasonal content decays — the desired rebalance achieved by NOT special-casing anything.
  **Constraints.** (1) Decay needs an anchor; the only true one is the most recent archive's `archivedAt` (already loaded into the insight context) — a calendar date reintroduces the arbitrariness this replaces. (2) It SUPERSEDES `fresh_offseason` rather than complementing it: if weight is time-derived, that state exists only to approximate "recently", and collapsing it back to one `offseason` state is a breaking change to every generator's lifecycle list and to `deriveLifecycleState`. (3) Existing `priorityScore` values are per-generator constants on no shared scale; making them commensurable is the bulk of the work, not the decay mechanism.
  Precedent worth reusing: `framing.ts` already has `applyLastSeasonFraming` — the system can already reframe an insight for distance, it just cannot re-rank for it.
- **HOMEPAGE-BRAND-IDENTITY — STILL DEFERRED.** Owner-confirmed 2026-08-08 that
  POLISH-004-PUBLIC-HOMEPAGE-STADIUM does NOT absorb this: that slice is the landing-specific
  treatment only, not a logo and not an app-wide branding system. This item remains the app-wide
  work. Turf War has no visual identity: no logo, no brand token in
  `globals.css`, and `public/` still holds the Next.js starter SVGs. PLATFORM-088 gave the landing
  typographic hierarchy and deliberately added NO colour — `DESIGN.md` reserves amber for champion
  signals and blue for interactivity and states that no colour is decorative, so an accent on a
  data-free page would encode nothing and would promise a livelier product than the austere app
  behind it. Recorded as its own work because a brand accent must be a token defined once and
  applied app-wide, amending the colour rules in the same change — not a homepage patch. **Trigger:
  when public launch is close and the surfaces have stopped moving.**
- **ORPHANED `/rankings` ROUTE** — zero inbound links anywhere in `src/`, and it redirects to
  `leagues[0].slug`, i.e. whichever league happens to be first in the registry. A single-tenant
  relic. Deliberately left OUT of PLATFORM-088's scope: deleting a route the owner may have
  bookmarked is not a call to make from a grep. **Trigger: an owner decision on whether it is used.**
- **INSIGHTS-OFFSEASON-ROSTER-CONTENT — ✅ CLOSED by INSIGHTS-022 (PR #464, `0f48b87`).** Kept for the correction it records. **The original statement of this item was WRONG on one of its two halves, and the correction changed the work.** It claimed `ROOKIE` and `RETURNING_OWNER_TRENDING` were both gated to `['fresh_offseason', 'preseason']` and both went dark in ordinary offseason. `RETURNING_OWNER_TRENDING_LIFECYCLES` was never an eligibility gate — `TRENDING_LIFECYCLES` already included `offseason`, and that constant only decided whether a copy PREFIX was applied. Career trends never went dark; they only gained or lost framing.
  - **The rookie benchmark WAS unavailable in ordinary offseason**, and widening its lifecycle list is the whole fix. An earlier draft of this entry claimed a second, engine-level block also had to be removed because the roster is "borrowed from an archive" for that whole stretch. **That was wrong.** `completeSeasonRollover` keeps `league.year` on the COMPLETED season and nothing ever deletes `owners:<slug>:<year>`, so the current roster is present and `usingArchivedRoster` is FALSE throughout `fresh_offseason` and `offseason` — it only becomes true in `preseason`, once `league.year` has advanced past the last archive. The engine guard never fired in the window this item is about, and both reviews caught the removal as unnecessary AND as a violation of binding AGENTS.md invariants 4 and 5. It was reverted.
  - **The real defect the audit surfaced was the "Returning owner" prefix**, applied by four career generators whenever the roster was borrowed. A borrowed roster proves someone PLAYED; it never proves they will play again, so the copy asserted a future fact from past data, and it fired hardest in exactly the window where the upcoming roster is least known. Identifying who is actually returning needs a FINALIZED upcoming roster compared against league history — a separate feature, deliberately not attempted here.
  - Owner decision (2026-08-06): these categories are EVERGREEN even though the eligible owners change. Owner decision (2026-08-08): treat the rookie benchmark as retrospective and remove BOTH blocks. Neither depends on INSIGHTS-PRIORITY-DECAY (unlike `SEASON_WRAP`, which at flat priority would keep a stale recap competing all year — that one waits).
- **INSIGHTS-CURRENT-YEAR-AUTHORITY** — RESCOPED 2026-08-06 to CROSS-SURFACE convergence. The
  one-page fix was built (`44f0fab`), reviewed, and rejected: changing a single consumer makes the
  Insights tab disagree with the ~15 sibling surfaces that still read the projection, and treats a
  repairable data row as a code problem. The live `tsc` row is repaired directly instead. What is
  still owed is the DURABLE guarantee — every surface resolving the season the same way — which is
  the only thing that stops the next drifted row reproducing this. Original finding follows.
  LIVE minor defect at the time of writing. `buildLeagueInsightContext` derives `lifecycleState` from `league.status` (correct) but takes `currentYear` from the top-level `league.year` projection (`context.ts:378/387/393`, and `applySuppression` at `loadInsights.ts:299`). Owner intent (2026-08-06): **preseason belongs to the UPCOMING year — it is the first state of the new season, not the final state of the previous one.** So `currentYear` must read `status.year`. Live effect on `tsc` (preseason 2026, projection 2025): career/records/suppression are scoped to 2025 and the page labels 2025. NOT a data-integrity problem — archives remain the sole source of accumulated totals and there is no double-count (`buildOwnerCareerStats` iterates archives only; `currentYear` is a reference point). The projection self-heals when the season transition runs, but reading the authority fixes it immediately and permanently.
  Paired change: `isRookie: firstSeason === currentYear` always returns a boolean, so during preseason it answers a question it cannot know. Owner intent: **rookie is INDETERMINATE until owners are finalized**, and an owner who completed 2025 is not a rookie in the 2026 preseason. The preseason status already carries `setupComplete` as that signal. Rookie becomes tri-state; this changes a generator's output shape and needs its own care.
  Checked and requiring NO action: the `STATS` lifecycle gate is redundant — those five generators read `context.ownerGameStats`, which the context sets to `null` for preseason and offseason anyway, so they return `[]` regardless of the gate. Turning `STATS` off disables nothing historical (`stats:team_identity` is evergreen and archive-backed).
- **INSIGHTS-FRESH-WINDOW-ANCHOR** — `deriveLifecycleState` cuts `fresh_offseason` → `offseason` at a hardcoded **March 1** (`lifecycle.ts:19`), while rollover is derived from the real world (`ROLLOVER_DELAY_MS` = championship + 7 days). One boundary is an event, the other a calendar constant, so the window LENGTH is uncontrolled: it shrinks as the expanded playoff pushes the championship later, shrinks further if rollover is delayed (roll on Feb 20 → nine days of `fresh_offseason`), and would vanish entirely if rollover ever landed after March 1. Owner notes the date was arbitrary. If `fresh_offseason` survives INSIGHTS-PRIORITY-DECAY at all, anchor it to `archivedAt + N days`; if decay ships, this item is absorbed by it.

## Planned backlog (from Standings Ownership Redesign campaign)

Items surfaced during the Standings Ownership Model Redesign campaign and queued for future implementation:

- **POSTSEASON-START-WEEK-SCHEDULE-DERIVED** — `POSTSEASON_START_WEEK` is currently a hardcoded constant (`= 16`) with a rationale comment (Option B). Option A (derive from schedule data — the week of the earliest `seasonType === 'postseason'` game) is the correct long-term solution. Deferred because the constant works for current seasons; revisit before any season with an unusual CFP bracket structure.
- **INVALIDATE-STANDINGS-PER-LEAGUE** — `invalidateStandings` enumerates all leagues when called for global/year-scope mutations (e.g., global or year alias writes that apply across leagues). Documented limitation in the `invalidateStandings` JSDoc. Note: the original "per-league alias scope would allow targeted invalidation" premise is now moot — **PLATFORM-067 removed league-scoped aliases from runtime resolution** (team aliases are not league-specific). Alias writes are inherently global/year, so the fan-out is correct by construction; any future targeting must be justified on different grounds (e.g., which leagues actually reference a changed alias), not per-league alias scope.
- **HEADER-ARCHITECTURE-UNIFICATION** — `LeaguePageShell` and `CFBScheduleApp` render independent header regions; they should share a single `LeagueHeader` component. Flagged during LEAGUE-HEADER-USER-MENU work but out of scope for this campaign. Separate Polish prompt when header structure stabilizes.

## Planned backlog (from HISTORY-RECORDS campaign)

Items surfaced during the HISTORY-RECORDS Phase 2 Overview revision and queued for Phase 3:

- **RECORDS-SCORING** — Auto-score the records surfaced in the History Overview Records column. Today, `selectMarqueeRecords` (in `src/lib/selectors/historyOverview.ts`) picks 5 records via an implicit rule (one from each of `career` / `season` / `rivalry` / `event`, then one extra by category-priority order). The rule is editorial-by-default and undiscoverable; as new records get added to `selectAllRecords()` the marquee will drift away from "the most narratively interesting records the league has." Replace the implicit rule with an auto-computed score on each `RecordEntry`, mirroring the Insights ranker pattern. Score weights to consider: recency of when the record was set or last changed hands, magnitude of the leader's gap-to-second, volatility (how often the record changes hands across archived seasons), whether the holder changed in the most recent season. Implementation hint: extend `RecordEntry` with a computed `score` (or equivalent) field populated inside `selectAllRecords`; reduce `selectMarqueeRecords` to a sort-by-score-desc + slice. The Records column then renders the top N with no manual curation. Trigger to prioritize: HISTORY-RECORDS Phase 3, alongside the Stats / Rivalries / Archive subtab content wiring.
  - **Backlog slug (provisional):** `RECORDS-SCORING-v1`

- **SPARSE-DATA-LAYOUT** — The History Overview dashboard restructure (P7-HISTORY-RECORDS-PHASE-2-VISUAL-REFINEMENT-v1) achieves visual balance under the assumption that each section fills its column. In current TSC data (6 seasons), some sections render with fewer rows than their peers — Title droughts shows 4 rows vs Top rivalries' 5; Recent podiums shows only the 3 most recent seasons regardless of league age. The page accommodates this via whitespace, but at very sparse data states (a brand-new league with 1–2 seasons, for example) the imbalance becomes more visible. Goal: evaluate whether sections should respond to their own data density — narrowing column width when sparse, or stacking with peer sections in a different layout — vs accepting the imbalance as the cost of designing for the eventual fully-populated state. Implementation hint: this is primarily a layout discipline decision rather than a selector change; the data shape already reflects density via row counts. Possible directions: per-section `lg:col-span-*` adjustments based on row count, a row-count-aware grid utility, or an explicit "compact" rendering mode for sections at certain thresholds. Trigger to prioritize: when a new league is created and onboarded with very few seasons of data, or when the existing layout proves uncomfortable at any point in the league's growth arc.
  - **Backlog slug (provisional):** `SPARSE-DATA-LAYOUT-v1`

- **INSIGHT-ROUTING-PHASE-3-RETARGET** — Re-point insight deep links from Overview anchors to the Stats and Rivalries subtabs once Phase 3 ships their content. `resolveHistoryHref` (in `src/components/OverviewPanel.tsx`) currently routes drought → `/history#dynasty-drought`, dynasty → `/history#championships`, and rivalry types (`perfect_against`, `lopsided_rivalry`, `even_rivalry`, `dominance_streak`) → `/history#rivalries`. These were reverted from the Phase 2 subtab routes (`/history/stats`, `/history/rivalries`) because those subtabs render "Coming in Phase 3" placeholders today and create dead-end navigation. Trigger to prioritize: alongside Phase 3's Stats/Rivalries subtab content wiring; update both the routing and the matching `insightHref-history-routing.test.tsx` assertions.
  - **Backlog slug (provisional):** `INSIGHT-ROUTING-PHASE-3-RETARGET-v1`

- **HISTORY-DYNAMIC-TILING** — The History Overview currently uses a stacked dashboard layout with vertical scroll. During Phase 2, repeated visual iteration surfaced that History's content is structurally sparser than main Overview's, leading to whitespace problems that were ultimately addressed with an `mx-auto max-w-7xl` cap (commit `3e1a977`). An alternative design direction was explored conversationally but deferred: dynamic tiling, where sections rearrange into a packed grid that fills available 2D space rather than stacking vertically. Goal: explore whether History (and possibly other sparse-content pages) should use a dashboard tiling layout instead of vertical stacking. Sections become tiles that pack into available width, eliminating vertical whitespace by using horizontal space efficiently. Reference Pinterest / Trello / Notion as precedent patterns. Implementation hint: evaluate CSS Grid `auto-flow: dense` vs JS-based packing libraries (e.g. Muuri, react-grid-layout) vs hand-tuned per-breakpoint grid placements. Each has tradeoffs around predictability, complexity, and dependency cost. Why it was deferred: committing to tiling would mean re-thinking the page's section composition, visual hierarchy, and breakpoint behavior from scratch. Phase 2 was already a long iteration cycle and shipping a polished stacked-with-cap layout was the higher-priority action; revisit when the campaign has space for fresh design exploration. Trigger to prioritize: if living with the stacked-and-capped History page reveals that its layout still feels structurally wrong, OR when other sparse-content pages (e.g., a future Stats subtab) face the same whitespace problems and a unified solution becomes valuable.
  - **Backlog slug (provisional):** `HISTORY-DYNAMIC-TILING-v1`

## Completed campaigns and shipped platform work

Shipped work is recorded in `docs/completed-work.md` (outcome milestones) and
`docs/prompt-registry.md` (per-prompt execution records) — including the foundational campaigns
(Architecture Stabilization through Season Lifecycle and Launch Prep), the Insights Engine arc, the
Standings Ownership Model Redesign, the PLATFORM-068 audit-driven correctness + docs sequence
(PLATFORM-069→081b, DOCS-001→008, DOCS-010), the canonical-contract sequence (PLATFORM-031→053),
the AppStateStore caching campaign (PLATFORM-082A archive read cache + PLATFORM-082B insights
output cache — ✅ complete), the cache-correctness follow-ups (PLATFORM-084A/084B/085A/085B/085C),
the test-suite baseline cleanup arc, and the full PLATFORM-086 provider campaign (see the completed
record under Active priorities above).

## Hosted deployment runbook

- Use `docs/deployment-runbook.md` for the operator checklist during the real Vercel + Postgres
  setup and first hosted preview validation.

## Out of scope for this queue

- New matching systems or changes to schedule-first identity rules.
- Heavy infrastructure beyond one small managed database plus the hosted app.
- Broad analytics/history work before hosted stability is complete.

## Non-blocking maintenance

- **Flaky clock-boundary test — `insights-suppression.test.ts` ("record at exactly TTL boundary is
  not expired").** The fixture stamps `firedAt` from `Date.now()` and `isSuppressionRecordExpired`
  reads `Date.now()` again, so a millisecond tick between the two calls pushes the age past the TTL
  and the boundary case flips. Fails intermittently under full-suite load only. Fix is to inject the
  clock, not to widen the assertion. No owner slice.
- Revisit TypeScript import/test-runner cleanup separately from active campaign work.
- Keep optional decomposition of `CFBScheduleApp.tsx` and `scoreAttachment.ts` as non-blocking
  technical debt unless explicitly scheduled.
