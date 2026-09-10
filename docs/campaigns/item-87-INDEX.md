# Item 87 — document index

> **Verified 2026-09-08 (Item 144, PLATFORM-144-ITEM-87-DOC-RECONCILIATION-CLAUDE-v1).** Every mark below comes from
> the file being open, end to end, and every DISCHARGED verdict from the code or `DESIGN.md`. See *Maintenance* at
> the bottom for what the pass covered and what it did not.

## CARRY THIS — copy into any Item 87 prompt before writing it

**This block is first because the failure it fixes is positional.** The sequenced-dependency warning
in row 1 sits in the canonical document, in bold, addressed to the prompt author by name — and in two
other documents besides. All three were ignored. **Prominence is not the variable; position relative to
where prompt-writing actually reads from is.** Anything below the first screen may as well not exist.
The depth column below records where each obligation sat: **68 of the 81 found sit past line 40 of
their file, and 52 sit in the bottom half.**

**Copy the LIVE rows for the surface you are touching verbatim into the prompt. Do not summarise them.**
Rows 1–6 keep the numbers earlier prompts cited; rows 7 onward were promoted by Item 144.

### Standing rules — binding on every Item 87 prompt

| # | state | obligation | source (depth) |
| --- | --- | --- | --- |
| 1 | **LIVE** | A build with records absent or stale **will not match the mockup**, and a reviewer comparing them must read that as a **sequenced dependency, not a defect**. State this in the prompt. **Owner ruling 2026-09-08:** a missing record leaves the anchor **blank**, never the spread — and a **store failure** (transient, no item) is NOT the same condition as **"not wired to this surface"** (a sequencing state that needs a filed item and this sentence in the prompt). Records are wired on Overview and Matchups; Schedule remains in the second state under Item 156. | `live-watchlist-scoreboard.md` → *State this in the implementation prompt* (36%); `records.md:42` (81%); `presentation-decisions.md` → *Not defects* (100%) |
| 2 | **DISCHARGED — standing invariant** | Item 92 refreshes in the **live-scores cron**. Never hook `handleGamesFinalized` — a per-browser client callback, which inverts the cron-spends / client-reads split of PLATFORM-086B2B and PLATFORM-075. **Built as specified** (`cron/live-scores/route.ts:460`, `cron/team-records/route.ts:89`; nothing hooks the callback). Keep it as an invariant for anyone touching that path. | `records.md:51` (98%) |
| 3 | DISCHARGED | Record the `CompactGameScoreboard` contract widenings before any consumer is built — **done** in slice 5a (PR #570) and `DESIGN.md`; the prefix rule, broadcast on scheduled/live/awaiting, neutral site, and the non-reserving tier-2 slot. Reported as a *stale claim* by a reviewer because nothing marked it complete. | `matchups-schedule-design.md` → *Contract widenings* (16%), restated at *Recommended order* (94%) |
| 4 | DISCHARGED | Record the amber `upset` border as **deliberately retired**, the eyebrow pill carrying its emphasis forward — **done** by PLATFORM-153 (`DESIGN.md` → *Color*, the Chips group). The border had been gone since slice 5 (`cardEmphasisClasses` deleted); what was missing was the sentence stating it as a decision, and the cost — a chip is quieter than a border across sixty rows — is recorded with it. `DESIGN.md` mentioned neither `upset` nor `bronze` before this; it now carries both. | `matchups-schedule-design.md` → *This answers the amber `upset` border* (88%); mockup notes (95%) |
| 5 | DISCHARGED | Record the **component-family enforcement clause** — done; `DESIGN.md` → *Color* ("A hue carries exactly one meaning within a component family"). The canonical document itself marks it *Landed*. | `live-watchlist-scoreboard.md` → *DESIGN.md amendment tracking* (70%) |
| 6 | **LIVE** | **Do not "restore" the mockup's tint inset.** The implementation ships `0 -8px` plus squared facing corners; the mockup's former `-1px -8px` produced a darker stripe at the seam. **Anyone reconciling the two changes the MOCKUP, not the code.** *(Applied 2026-09-08: `matchups-schedule-mockup.html` now carries `0 -8px 0 12px` plus squared facing corners.)* | `team-highlight.md` → *Deviation from the mockup* (66%) |
| 7 | **LIVE** | **Do not read campaign status from the canonical document**, and **re-derive every line-number citation** before putting it in a prompt — they have been stale at least twice, and `DESIGN.md` moved again on 2026-09-08. | `live-watchlist-scoreboard.md` → *Existing code — do not fork* (42%), *Sequencing — the recap campaign* (73%) |
| 8 | **LIVE** | Selection and precedence stay selector-owned; the scoreboard **must not be forked**. **CORRECTED 2026-09-08 — "four consumers plus the recap" was wrong on both halves.** There are **five direct renderers**: Overview `GameCardList` (serving Live AND Recent finals), Overview `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`, and Matchups `GameRow` — three importing modules, six rendered contexts. **And the recap is NOT a consumer**: `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`, which is what Item 143 creates the seam for. | `live-watchlist-scoreboard.md` → *Existing code — do not fork* (43%) |
| 9 | **LIVE** | **Never suppress individual finals against recap content**, and do not reintroduce a subtler version. Recent finals is complete; the recap is curated. | `live-watchlist-scoreboard.md` → *No per-game recap deduplication* (16%) |

### LIVE obligations by owning item

| # | owner | obligation | source (depth) |
| --- | --- | --- | --- |
| 10 | Item 113 | An insight surfaced in Featured **must not also appear in the feed** that week. | `live-watchlist-scoreboard.md` → *New rule needed — suppress the feed duplicate* (88%) |
| 11 | Item 113 | **Remove the results-based Featured rather than reworking it**, and **do not ship both** tiles. Route is 113's call. | `featured-intent.md` → *Recommendation* (82–91%) |
| 12 | Item 113 | **Specify what DOES promote** — an unclaimed slot is how owner count got in. | `section-ordering-resolutions.md` → *Sort rules* (71%) |
| 13 | Item 113 / recap | Recap notable-results records: **work in later as an additive change**, uncoupled from the records cache. | `live-watchlist-scoreboard.md` → *Open decisions* 2 (45%) |
| 14 | Item 115 | **Counts become totals in the same change that makes the surplus reachable**; visible-only until then. | `section-ordering-resolutions.md` §5 (46%); `section-ordering.md` → *Resolved* (80%) |
| 15 | Item 115 / 134 | Caps are counts, not rows; decide whether they become tier-dependent or stay ragged. | `three-column-tier.md` → *Caps interact with the tier* (83%) |
| 16 | Item 119 | **DISCHARGED 2026-09-09 — and the measurement authorises the port.** The bar shipped first on the HSL normaliser (Item 119). Measured on the resynced catalog: **only 31 of 135 bars clear 3:1 composited**, median 2.099, min 1.431. It matters. **Ship the bar and the OKLCH port separately**; bar first on the existing HSL normaliser; port only if measured to matter. | `team-colour.md` → *Two separable changes* (11%), §B (23%), *Recommended sequence* (84%) |
| 17 | **LIVE — ANSWERED 2026-09-09, and the code is wrong.** Measured: THREE backgrounds exist, not two. `#0a0a0a` (canvas, `globals.css:29`), `#09090b` (zinc-950, the nearest painted surface) and **`#171718` — the OWNER-ROW tint**, produced by `rgba(255,255,255,0.055)` over zinc-950 (`CompactGameScoreboard.tsx:53`). `teamColors.ts:23` normalises against `#0A0A0A`. **CORRECTED AGAIN 2026-09-09 by the Item 198 lane: `#171718` is THEORETICAL and sits under no bar.** `isCardOwnerTeam` is supplied only by Matchups, whose card is zinc-800. The real underlays are `#09090B` (Overview, Schedule, Postseason), `#27272A` / `#333336` (Matchups scheduled, non-owner / owner) and `#242427` / `#303033` (Matchups outcome). **The worst is `#333336`, and the penalty is 36.2%, not 9.5%** — a colour at 3:1 against the canvas renders at **1.913:1** there. **AND ONE SURFACE CANNOT GOVERN BOTH ENDS:** the LIGHTEST underlay (`#333336`) is worst for visibility, the DARKEST (`#09090B`) worst for excess brightness. **Floor and ceiling take different reference surfaces.** | **Pick one background constant and state it** (`#0A0A0A` vs `#161616`) before either change ships. | `team-colour.md` → *One background constant* (50%) |
| 18 | Item 119 | If OKLCH ships, the reserved-hue guard is **chroma reduction**, not a hue shift. | `team-colour.md` → *Reserved-hue guard is required* (46%) |
| 19 | Item 119 | It is a **restoration on the shared row**, across Overview, Matchups and Schedule — not a widening; there is no incumbent. | `team-colour-regression.md` §1 (30%), *Mockup status* (100%); `matchups-schedule-design.md` → *Recommended order* 6 (96%) |
| 20 | Item 119 | **Retire the outcome rail on Matchups and let the tint carry outcome** — a precondition, not polish; decide it with records (row 1) before anything else on Matchups moves. | `matchups-gap-analysis.md` §2 (49%), *Sequencing note* (98%) |
| 21 | Item 119 (queue) | Record the **slice 5b `isolation: isolate` dependency** against Item 119 — still absent from its queue entry. | `team-colour-regression.md` → *Item 119 depends on slice 5b* (74%) |
| 22 | Item 119 (registry) | Add to the slice 5 closeout that a **rendered team-colour treatment was removed pending Item 119** — the registry entry still does not say so. | `team-colour-regression.md` → *What the closeout should have said* (87%) |
| 23 | Item 134 | **Confirm orphan rows sit on the right**, not centred. | `three-column-tier.md` → *Orphan rows* (79%) |
| 24 | Item 142 | Matchups finals still carry a kickoff, through `metadataEntries` in the `contextSlot`, not `clock`. | `matchups-gap-analysis.md` §3.1 (56%) |
| 25 | **DISCHARGED by PLATFORM-143** | The `margin-left: auto` trap is implemented in the shared status row: the metadata group grows with `flex-auto min-w-0`, while the tag group is `flex-none`. | `presentation-decisions.md` → *Implementation note* (28%); `CompactGameScoreboard.tsx` |
| 26 | **DISCHARGED by PLATFORM-143** | The single-column wrap exception is limited to tagged scheduled rows at phone width; live, awaiting, final, and untagged rows do not inherit it. | `presentation-decisions.md` → *Mobile* (40%); `CompactGameScoreboard.tsx` |
| 27 | Item 143 | At block layout, **adjacent-sibling margins**, because block layout ignores grid `gap`. | `presentation-decisions.md` → *Block layouts need margin* (63%) |
| 28 | Item 143 | `prefers-reduced-motion` drops the sweep; if losing the provisional marker matters, reinstate an opacity step for those users. | `presentation-decisions.md` → *Motion specification* (90%) |
| 29 | **Item 168** | **Odds inline on Matchups — SCHEDULED ROWS ONLY.** **CORRECTED 2026-09-08 by owner ruling.** This row previously read "including live and final rows"; **that phrase is in neither the design document nor the mockup.** The document (`matchups-schedule-design.md:104`) says only *"inline on Matchups, where nine games per card justify them"* and names no state. **The mockup names the states: all six `sb-odds` elements sit in SCHEDULED blocks — zero on live, zero on final** — and gives the empty case an explicit `Line not posted`. The "live and final" phrasing came from the 2026-09-08 discharge note below the widening, which inferred a requirement from a code constraint (the footer was gated to `scheduled`). **A gate is not a requirement.** The live half is scheduled-row odds, which Matchups still does not render although it already receives `oddsByKey` (`MatchupsWeekPanel.tsx:158`). Moved off Item 143 to **Item 168**. | `matchups-schedule-design.md` → widening 4 (26%); `mockups/matchups-schedule-mockup.html` |
| 30 | Item 143 | Decide whether **Matchups rows carry broadcast**: the mockup omits it on every Matchups row while the same games on Schedule carry it; no document decides it. | mockup notes (95%); `postseason-context.md` → *Correction acknowledged* (100%) |
| 31 | Item 152 | Pick the **Schedule three-column breakpoint**; the 1320 arithmetic reproduces nowhere. | `presentation-decisions.md` → *Three-column tier at 1320px* (58%); mockup CSS |
| 32 | round grouping (**UNFILED**) | Postseason round grouping **must carry its own item**. | `postseason-context.md` → *Scope* (92%) |
| 33 | round grouping | Group from `playoffRound` + `postseasonSubtype`, **order from `startDate`, never `week`**; reuse `deriveFeaturedGameBadge`. | `postseason-grouping-notes.md` §1–§2 (21–29%) |
| 34 | round grouping | **CFP group membership is `playoffCompetition === 'cfp'`**; an unparsed round lands in the generic CFP group, never in Bowls. | `postseason-refinements.md` §1 (17%); `postseason-grouping-notes.md` §3 (36%); `postseason-context.md` (71%) |
| 35 | round grouping | **Widen `playoffRound` to include `'first-round'`** (still absent at `schedule.ts:124`) and **test a first-round game** specifically. | `postseason-grouping-notes.md` §4 (45%); `postseason-context.md` → *One typing trap* (74%) |
| 36 | Item 120 | Scope: does any consumer read `completed` / classifications for a historical season? If none, it is a refresh, not an item. | `postseason-refinements.md` → *Correction* (90%) |
| 37 | Item 117 closeout (planning) | Say plainly that the card-owner tint **ships the legibility fix, not the request** ("my teams"). Item 117 shipped without saying it. | `team-highlight.md` → *Residual* (89%) |

### Findings recorded in the set and NOT in the queue — planning to file or decline

| # | finding | source (depth) |
| --- | --- | --- |
| 38 | Viewing-member highlight on every surface, blocked on a user↔owner mapping. | `team-highlight.md` → *The blocked feature, filed* (93%) |
| 39 | Owner header should read `0–0`, not `Scheduled`. | `matchups-gap-analysis.md` §4 (84%) |
| 40 | `displayOwner()` belongs at the data seam; three render-seam reads of the sentinel so far. | `section-ordering-resolutions.md` → *Noted while removing the owner-count keys* (92%) |
| 41 | Schedule **landing position** on a mid-slate visit — scroll question, undecided. | `matchups-schedule-design.md` → *Open — landing position* (58%); mockup notes (98%) |
| 42 | DISCHARGED by PLATFORM-153 — and the row conflated two sections. `:755` is `WatchlistScoreboardList`, not Featured; `:195` is `FeaturedGamesList`, so only the chip was ever Featured. The reason row went plain bronze `#c9a66b`; the chip went neutral **slate**, not bronze, matching the CFP branch of its own two-branch badge family. A **fourth** spelling this row never named — Overview's watchlist chips, neutral gray with a fill — also went bronze. All three surfaces now render one constant. | `matchups-schedule-design.md` → *Colour: bronze* (79%) |
| 43 | Check the data never leaks a classification into the conference field — asked, never recorded as done. | `matchups-schedule-design.md` → *FCS is a classification* (48%) |
| 44 | Governance: when a mockup is committed, anything not stated in a companion document is not a decision. Not in `AGENTS.md`. | `section-ordering.md` → *The pattern worth fixing* (100%) |
| 45 | Reviewer instruction: judge Schedule's doubled scroll against a real slate; the filter that mitigates it is Item 118, unbuilt. | mockup notes (96%); `matchups-schedule-design.md` → *Cost* (41%) |

### DISCHARGED — the work was done; nothing had marked it

| # | obligation | done where | source (depth) |
| --- | --- | --- | --- |
| 46 | Null team id → no anchor, never a name lookup. | `selectors/teamRecordsClient.ts:58-59` (server-side exact-id join) | canonical *Scoreboard micro-component* (4%) |
| 47 | Keep the disruption guard; build no tone around it. | slice 5 left the branches unpatched as unreachable | canonical *Promotion model* (14%) |
| 48 | File spun-off item A, cross-reference both ways. | Item 90 / POLISH-018 | canonical *Live state* (23%) |
| 49 | Emerald/rose exactly once in Matchups; leave champion amber alone. | POLISH-018 (PR #541) | canonical *A → Item 90* (50%) |
| 50 | Resolve the `finalSelf` tint asymmetry and state why. | slice 5, symmetric (`MatchupsWeekPanel.tsx:96-102`) | canonical *Carried over from POLISH-018* (61%) |
| 51 | Slice 5 after slices 3 and 4. | held | canonical *Sequencing* (62%) |
| 52 | Featured double-touch: leave an additive slot. | POLISH-017 `contextSlot` | canonical *Acceptance boundary* (65%) |
| 53 | Consume the renamed labels, not `Top matchup` / `Ranked spotlight`. | slice 4; no literal in `src/` | canonical *Label semantics* (97%) |
| 54 | Row disclosure without the collapsed form changing shape. | `tier2Slot` (slice 5a) | canonical *State variants* (10%) |
| 55 | Apply the records decision into the base document. | 2026-08-31 | `records.md:3` (6%) |
| 56 | Update the blocker list for Item 92. | PLATFORM-117 shipped | `records.md:44` (85%) |
| 57 | `NoClaim` renders no owner suffix, via one `displayOwner()` helper. | POLISH-021 | `matchups-schedule-design.md` §1 (9%) |
| 58 | Lowercase-id fallback → `rawName`. | `selectors/gameWeek.ts:113` | `matchups-schedule-design.md` §3 (13%) |
| 59 | Render the rank on a ranked-FCS row. | `CompactGameScoreboard.tsx:189-193`; `DESIGN.md` | `matchups-schedule-design.md` widening 1 (20%) |
| 60 | Ship the neutral-site marker standalone. | slice 5a | widening 2 (22%) |
| 61 | Odds in Schedule's tier 2 (the Schedule half of widening 4). | `GameWeekPanel.tsx:182` | widening 4 (26%) |
| 62 | Scope the status filter as additive work. | Item 118 filed | `matchups-schedule-design.md` → *The status key* (62%) |
| 63 | Recommended order steps 1–5. | POLISH-021, `DESIGN.md`, PR #570, PR #572, PR #581 | *Recommended order* (94%) |
| 64 | Questions for the CLI 1–6. | answered in-document | *Questions for the CLI* (97–100%) |
| 65 | "Today" as the sole relative label on Schedule. | slice 5, `selectors/gameWeek.ts:211` | `section-ordering.md` decision 5 (78%) |
| 66 | Investigate the `eventKey` collision. | Item 121 | `postseason-grouping-notes.md` (95%); `postseason-refinements.md` §3 (59%) |
| 67 | Guard comment on `teamColors.ts` naming Item 119. | file header | `team-colour-regression.md` §3 (54%) |
| 68 | Grep `DESIGN.md` when a slice deletes a treatment; correct `DESIGN.md:165`. | `AGENTS.md` → *Documentation closeout timing*; `DESIGN.md` → *Cards* | `team-colour-regression.md` (67%) |

### ANSWERED by a later document

| # | question | answered in | source (depth) |
| --- | --- | --- | --- |
| 69 | Does Schedule adopt the three-column tier? | `presentation-decisions.md` → *Three-column tier at 1320px* (number: Item 152) | `three-column-tier.md` → *Open* (100%) |
| 70 | Postseason finals: keep a date, or accept no temporal context? | `postseason-context.md` (group by round) | `section-ordering-resolutions.md` §3 (29%) |
| 71 | **LIVE — durable** | **A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded** — Overview, Matchups, Schedule, recap. Added 2026-09-08 after Overview was found six decisions behind, every one recorded as a "Schedule decision" while being a property of the shared row. **`presentation-decisions.md` reads as a Schedule/Matchups document because that is where the work happened; every decision in it about the status row, the tag slot or row anatomy applies to all four surfaces.** Without the line a later reader must ASSUME rather than CHECK, and the omission surfaces in a screenshot weeks later. | `overview-back-application.md` → *The durable fix* (owner, 2026-09-08) |
| 72 | DISCHARGED | Rename the league label to `Top 25 Matchup` and retire `Ranked Team` — **done** by PLATFORM-157-162-163 (`gameTags.ts`, `LEAGUE_TAG_LABELS`). Schedule and Matchups had shipped the lossy short form while `DESIGN.md` already prescribed the long one, so the code came to the doc rather than the other way round. **Two things the row did not have:** the highlight family's `top25` was gated on `rank != null` with no bound at all, so after the rename ONE label sat behind TWO predicates — now `isRankedTop25` on both sides, bounded 1–25 at both ends; and retiring `ranked` removed a watchlist curation signal nobody had noticed it was carrying, restored as `hasTop25RankedTeam` (owner ruling). `Contender Watch` (Item 162) and the `vs <owner>` pill (Item 163) went in the same slice; the vocabulary is now game facts only, recorded in `DESIGN.md`. | `overview-back-application.md` → *Two label cuts*; verified against `gameTags.ts:705` |

**How the count reconciles.** The Item 144 receipt counted **81 obligation occurrences** across the files; the
tables above hold 70 rows because a restatement of one obligation in a second or third document is collapsed into
one row (rows 1, 4, 7, 11, 14, 16, 20, 34, 35, 41, 49 and 66 each stand for two or three occurrences), and four
rows (24, 29, 31, 42) were promoted from receipt findings rather than counted there as obligations. The depth
figures in the opening paragraph are over the 81 occurrences.

---

> **Read this before any `item-87-*` document.** Sixteen documents accumulated across this campaign, each additive, none editing its predecessors. This index is the only place that records what overrides what.
>
> **Maintenance rule:** a new follow-on updates *this file only*. Per-document headers stay generic so that landing a document does not require editing every other one.

---

## Status legend

| Mark | Meaning |
|---|---|
| **CURRENT** | Authoritative. Nothing overrides it. |
| **PARTLY SUPERSEDED** | Some sections overridden — the entry names which. |
| **SUPERSEDED** | Do not decide from this document. Kept for history. |
| **DISCHARGED** | (claims only) An obligation that was satisfied; the mark says where. |

None of the sixteen is wholly SUPERSEDED. Every claim-level mark is in the document itself, at the claim.

---

## The documents — verified 2026-09-08

### Base

**`item-87-live-watchlist-scoreboard.md`** (651 → 772 lines) — **PARTLY SUPERSEDED**
The campaign addendum. Component contract, promotion model, records placement, slices, colour sequencing.

- **CURRENT and load-bearing:** the scoreboard contract (*Scoreboard micro-component*, the id-namespace note); the
  promotion model and the awaiting-score treatment; *Watchlist card* including the **2026-09-02 owner decision
  (record anchors, empty odds row, blank anchor on a failed read) and the 2026-09-08 ruling (blank governs; store
  failure ≠ not wired)**; *Records across scoreboard states — resolved* for **placement** (`DESIGN.md` is canonical
  for the RULE; neither supersedes the other); *Layout*; the open decisions; the spun-off records; *DESIGN.md
  amendment tracking*; *Featured is a separate axis from state*; the palette input (bronze now adopted).
- **SUPERSEDED, marked in place:** the **status header** ("slices 4–5 remain planned") and the *Related* line;
  the `disrupted` / `placeholder` state variants (rejected as unreachable by slice 5); the `cardEmphasisClasses`
  exemption (deleted); the **spread-fallback wording at four places** — the card spec ("anchored by per-team
  spread"), *Consequence* in the records section, the slice-5 *Sequencing* note, and slice-table row 4; the
  *Existing code* table ("only the watchlist remains bespoke"); "Capped at three" (four); the Schedule green-final
  residual paragraphs.
- **DISCHARGED, marked in place:** the null-id anchor rule; disclosure; the Item 90 asks; the `finalSelf`
  asymmetry; the Featured double-touch slot; the renamed labels; the `stateBadgeClasses` watchlist call.
- It contains **both** readings of Featured — the "neutral-final scoreboard" table entry and the "separate axis
  from state" block. That contradiction is **Item 113**'s; `featured-intent.md` supplies the product intent.
- Line references throughout are stale (`overview.ts` was restructured; `GameScoreboard` is gone). Row 7.
- **Does it say what everyone assumed?** For record PLACEMENT, yes. For record DEGRADATION it said the opposite in
  the three most-read places until this pass; the 2026-09-02 decision at ~28% in was the only correct statement.

### Scoreboard contract

**`item-87-followon-records.md`** (52 → 79 lines) — **PARTLY SUPERSEDED**
Records across scoreboard states; the anchor rule per state.

- **CURRENT:** the decision table, the post-game record, *Carried forward unchanged*. The **records rule** is
  load-bearing: the record is the anchor on scheduled rows (`matchups-gap-analysis.md` §1.1 shows what breaks).
- **SUPERSEDED:** *Consequence* → "scheduled rows anchor on the per-team spread" and "no row loses its
  right-edge anchor" (blank anchor; deliberate exception to `DESIGN.md` → *Right-edge anchor rule*).
- **Voice fixed 2026-09-08:** *Degradation* now reads as the conditional rule it is ("only when a record is
  unavailable"), so `:37` no longer reads as a contradiction of the table.
- Obligations: row 1 LIVE (`:42`), row 2 DISCHARGED in code (`:51`).
- There is no finals-clearing document, and none was deleted — searched `docs/` and git history. The
  **displacement rule** (`section-ordering.md` → *Why Recent finals above the watchlist*) governs the Recent finals
  SECTION emptying on Overview, not records on final rows.

**`item-87-followon-featured-intent.md`** (66 → 72 lines) — **CURRENT**
The two Featured concepts and the product intent. Cross-references Item 113, which owns reconciliation. Cap is
**four**. Rows 11 LIVE.

### Ordering

**`item-87-followon-section-ordering.md`** (112 → 128 lines) — **PARTLY SUPERSEDED — status lines only**
Six decisions found living only in mockup markup. The six decisions stand; both of its status statements were
wrong in opposite directions and are marked: decision 3 (counts as totals) did NOT merge in POLISH-023 (visible
count still, `OverviewPanel.tsx:1475`), while decision 5 ("Today") DID ship in slice 5. Its four open items are
answered by its child.

**`item-87-followon-section-ordering-resolutions.md`** (146 → 161 lines) — **CURRENT**
Live sorts by kickoff alone (confirmed: `overviewGameSections.ts:155-161`); owner-count key removed; no date or
time on final rows; Matchups sorts kickoff with finals last (§4, still unbuilt after Item 117); counts wait for
Item 115. Carries the sort-rules table for all four sections. The §3 postseason call is ANSWERED by
`postseason-context.md`.

### Postseason

**`item-87-followon-postseason-context.md`** (77 → 93 lines) — **CURRENT** *(was marked PARTLY SUPERSEDED from a
second-hand account; corrected after the read)*
Finals carry no date because the container supplies temporal context; the postseason tab gets one by grouping
by round. The disjoint Bowls/CFP grouping was corrected in this document itself, and the container rationale
coexists with the sort-order rationale (`DESIGN.md` records both). The implementer notes are LIVE (rows 32–35);
the item it asks for is unfiled. Its ESPN2 restoration was re-applied to the mockup on 2026-09-08.

**`item-87-followon-postseason-grouping-notes.md`** (132 → 145 lines) — **CURRENT**
Group from `playoffRound` and `postseasonSubtype`, order from `startDate`, never from `week`. Reuse
`deriveFeaturedGameBadge`. The `'first-round'` typing trap (still open at `schedule.ts:124`). §3 refined by its
child (positive key). `eventKey` collision filed as Item 121.

**`item-87-followon-postseason-refinements.md`** (86 → 91 lines) — **CURRENT**
Key the generic CFP group on `playoffCompetition === 'cfp'`. Parser evidence across five seasons. Items 120 and
121 filed from here.

### Colour

**`item-87-followon-team-colour.md`** (98 → 118 lines) — **PARTLY SUPERSEDED**

- The **decision is CURRENT**: solid 8px muted bar at ~72% in the line-start slot; gradient and full-width band
  rejected; ship on the existing HSL normaliser before considering OKLCH. Rows 16–18 LIVE.
- The **framing is SUPERSEDED** (marked): §A describes widening a 2–3px incumbent, and the opening paragraph says
  `GameScoreboard` renders it. There is no incumbent — slice 5 deleted it. See `team-colour-regression.md`.

**`item-87-followon-team-colour-regression.md`** (78 → 100 lines) — **CURRENT**
Item 119 is a restoration, not a widening, across Overview, Matchups and Schedule. Two asks DISCHARGED (guard
comment; `DESIGN.md` correction and the closeout-check rule, now in `AGENTS.md`), two LIVE (rows 21–22).

**`item-87-followon-team-highlight.md`** (90 → 120 lines) — **CURRENT.** *Status corrected 2026-09-08 after the
file was read end to end. It was previously marked SUPERSEDED — by two readers, from second-hand accounts.
Neither had opened it. Reaffirmed by the owner on the same day after Item 144's full read.*

**It does NOT conflict with `presentation-decisions.md`; the two govern different axes.** `:23` rejects
**owner-IDENTITY colour** — *"Neutral rather than owner colour"*, on the legend-reservation reasoning.
`presentation-decisions.md` → *The tint tracks state across the game's whole life* gives the tint **OUTCOME
direction** once one exists. Not owner-coloured, and outcome-coloured once a direction exists: both hold, and
the later document **extends** this one. The one sentence in the set that said "supersedes"
(`matchups-gap-analysis.md` §2) is marked corrected.

It carries two of the set's LATEST decisions, dated 2026-09-06 — squared facing corners at the seam of two
adjacent tints, and the horizontal-bleed / focus-ring constraint — both shipped in slice 5b and recorded in
`DESIGN.md`. Item 117 has since shipped the adoption (PR #581). Row 6 is its LIVE obligation; row 37 and finding
38 are what its closeout and the queue still lack.

**What this corrects downstream.** The rail/tint collision in shipped code is real and unchanged — a coloured
left rail plus a grey tint states outcome twice and spends the slot Item 119 needs (row 20). Its cause is not "a
stale document was read as current"; it is that the tint's outcome-tracking was never implemented and the rail
never retired. **No document was wrong. Two readers asserted the contents of a ninety-line file neither had
opened.**

### Layout and presentation

**`item-87-followon-matchups-schedule-design.md`** (246 → 345 lines) — **PARTLY SUPERSEDED, and mostly DISCHARGED**
Structural design for both views, the three unowned states, the defect list. The queue counted ten stale claims
here; read against the code, **most were obligations that had been met**:

- **DISCHARGED (marked):** all three defects (POLISH-021, slice 5); the four contract widenings (slice 5a) —
  including "no precedence rule is needed", which is NOT stale (its own guard paragraph is the rank-wins rule
  `DESIGN.md` records); the Schedule tier/sort/disclosure/conference decisions (slice 5); the bronze pills on
  Schedule and Matchups; the recommended order, steps 1–5; the CLI questions.
- **SUPERSEDED (marked):** *Open — card-owner treatment* and its dimming option (→ `team-highlight.md` tint);
  *Same component, different consumption* — both "suppressed on Schedule" (odds sit in tier 2; only the footer is
  suppressed) and "identical across the three surfaces" (→ Item 143's four divergences).
- **CURRENT but its premise is unbuilt:** "the filter cuts it to the live handful" — Item 118.
- **LIVE:** the Matchups half of widening 4 (row 29); the border-retirement recording (row 4); step 6 (Item 119);
  landing position (finding 41); the Overview eyebrow (finding 42).
- **The "Matchups keeps its two-column owner-card grid" line was never in this document.** It was in the mockup's
  notes block, and the owner replaced it with the 1372 arithmetic on 2026-09-08.

**`item-87-followon-three-column-tier.md`** (47 → 62 lines) — **CURRENT for Overview** (Item 134)
Overview grid tiers: 1 / 2 / 3 columns, third above 1300px, derived (1280 + 20px headroom). Two marks: its
"Matchups uses a two-column owner-card grid" is superseded by the mockup's 1372px tier (recorded only there,
`mockup:218-220`, the `.owner-grid` container query), and its *Open* question is answered by `presentation-decisions.md`. Its citation of the 760px
breakpoint to the Matchups/Schedule document is wrong — that decision is the canonical document's *Layout*.

**`item-87-followon-presentation-decisions.md`** (121 → 149 lines) — **CURRENT**
Status-row structure with right-aligned tags; Schedule as discrete blocks; date dividers; **the lifecycle tint
table**; weight emphasis suppressed on live. Three implementation traps (rows 25–27). Two marks: the **mobile
wrapping rule is RECONCILED** — owner ruling recorded as an amendment in `DESIGN.md` on 2026-09-08, narrowed to
tagged scheduled rows at phone width — and the **1320px arithmetic does not reproduce** (Item 152; no number chosen
here). Everything decided here is unbuilt on Matchups (Item 143).

**`item-87-reference-overview-composition.md`** (112 lines, new 2026-09-08) — **CURRENT — REFERENCE, not input;
§7 is PROPOSED SCOPE, NOT FINDINGS**
Overview at the PAGE level only: section order and why it is static rather than conditional, one-game-one-place with
Featured as the exception that proves it, the elevated timely-content zone, progressive disclosure and its two
controls, the recap tile's two states.

**Deliberately not an element-by-element Overview reference.** Those elements are the game row, already covered by
`reference-game-row.md`; duplicating them would produce two documents saying the same thing and drifting apart —
**the exact failure this INDEX exists to prevent.** Standings and the insights feed are named as out of scope so a
reader knows they were EXCLUDED rather than forgotten.

**§7 is an audit brief that has NOT been run.** Eleven checks, seven at row level and four at page level. Do not
read it as a defect list. **Its stated value is the residue:** most divergences will map to Items 115, 119, 134,
143, 157 or 162 and belong recorded against those, so what matters is anything mapping to NOTHING — that is a
back-application gap of unknown size, and the reason to run it rather than assume the watchlist was the only
casualty. Filed as **Item 167**.

**Verified on intake, 2026-09-08.** §6's recap cutoffs reproduce in code: `weeklyRecapFacts.ts:327` states the
window as `[next-day 06:00 ET, Thursday 06:00 ET)` and `:155` identifies the daily 06:00 ET boundary — calendar-only,
as described.

**`item-87-reference-game-row.md`** (374 lines, new 2026-09-08) — **CURRENT — REFERENCE, not input**
The shared game row consolidated element by element: sixteen sections across all four consumers, plus Featured
and postseason. **It adds nothing new and is not a source of decisions.** Everything in it is recorded elsewhere
in this set; where it and another document disagree, **this INDEX arbitrates and the reference yields.** A claim
in it that no other document supports is a DEFECT in that file — report it, do not build on it.

**Read §11 and §16 first.** §11 is the consumer matrix, and its rule that *a slot a surface does not pass renders
nothing* is what would have settled the Item 155 footer-band contradiction before it blocked a slice. Three of its
rows explain most per-surface variation: the owner tint is Matchups-only, date grouping is Schedule-only (hence
Schedule cannot reorder finals to the end), and the recap renders no records (hence its status rows are frequently
tag-only, a case no other consumer exercises). §16 collects seven defects that **produce no error** — a missing
`min-width: 0` clips the wrong element, block layout drops separation at one breakpoint only, a negated state
condition silently admits states nobody named.

**It also preserves superseded reasoning where the current reason is stronger** — the finals-no-date rationale,
the tint's opacity-versus-motion distinction, the mixed-pill rejection — so a reader meeting the old argument in
an earlier document does not read it as a contradiction.

**Verified on intake, 2026-09-08.** §13's account of Featured is **accurate**: Item 113 is unresolved, and
`selectFeaturedGames` is finals-only as described (`overview.ts:470`, `hasUsableFinalScore`). Two claims were
corrected in place — a stale `DESIGN.md:147` citation (now `:153`) and a contrast figure of 1.32:1, which is the
pill border against the pill text rather than bronze against champion amber (**2.13:1**). **One conflict it
surfaced is genuine and stays open:** the two-tag cap, where `recap-scoreboard.md:29`, `DESIGN.md:293` and the
code all disagree — **Item 165**.

**`item-87-followon-overview-back-application.md`** (new 2026-09-08) — **CURRENT, unapplied input**
Overview's watchlist against the mockup: **six divergences that are one omission.** Every one was decided during
the Schedule and Matchups work, recorded in `presentation-decisions.md`, and never applied back — **the decisions
were recorded as Schedule decisions because that is where the work happened, though each is a property of the
SHARED row.** Also carries two agreed label cuts (retire `Ranked Team`; `Streaming · ACC Extra` → `ACC Extra`) and
the `margin-left: auto` trap, which bites harder here because some watchlist rows are tag-only and have no
metadata to hold the left group open.

**This is the discharge problem inverted, and the INDEX had no row for it.** Discharge is work COMPLETED and
unmarked; this is a decision RECORDED and unapplied. Same gap underneath: **nothing tracked whether a
cross-surface decision reached every surface it governs.** Row 71 is the durable fix.

Sequencing: items 1–3 need the tag-in-status-row seam (**Item 143**), item 4 is **Item 157**, item 5 is **Item
119**. Order it after 143.

**`item-87-followon-matchups-gap-analysis.md`** (98 → 126 lines) — **CURRENT, two corrections marked**
Shipped Matchups against the mockup, ordered by member impact. §1.1 (records as the scheduled anchor) is answered
by the 2026-09-08 ruling. §2's "supersedes" sentence is corrected by the owner. §3.1 is Item 142 (mechanism:
`contextSlot`, not `clock`). §3.4's "recorded in the tier document" is corrected (the mockup). §4 (`0–0`) is not in
the queue (finding 39).

### Mockup

**`mockups/matchups-schedule-mockup.html`** — **RECONCILED 2026-09-08**, owner and Item 144 together. Owner: the
mid-file `</body></html>`, Chamness's untinted final row, the tint comment contradicting its own CSS, the
two-column prose replaced with the 1372 arithmetic. Item 144: tint inset to `0 -8px 0 12px` with squared facing
corners (row 6); the missing `Scheduled` state label on the neutral-site row; `ESPN2` restored on the owner-card
live row; four stale notes marked (widening count, broadcast state set, kickoff on finals, spread fallback); the
1320 comment annotated for Item 152. **Still open there:** broadcast on Matchups rows (row 30), the 1320 number
(row 31). Interim authority ruling of 2026-09-07 stands: the mockup for layout and structure, the documents for
values.

**`item-87-followon-recap-scoreboard.md`** (landed 2026-09-08 with Item 143's second-consumer ruling) — **its row
belongs to its own landing**, not to the Item 144 pass, which read it only to keep the canonical document's recap
pointers accurate.

---

## Per-document header

One line at the top of every `item-87-*` document — **added to all fifteen on 2026-09-08**. Generic by design — it
does not name what supersedes it, so landing a new document never requires editing this line anywhere.

```text
> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
```

---

## What went wrong, recorded once

Every document here was written additively, on the reasoning that editing a committed document loses history. That reasoning is sound and the conclusion drawn from it was not: history is preserved by *marking* what a document no longer governs, not by leaving it silent.

The cost was not abstract. Three wrong statements came out of this set in two days — a records/broadcast/odds list, the card-owner treatment, and the column count — and the second of those reached shipped code.

**What the full read added (2026-09-08).** The rot was smaller and differently shaped than the sample suggested:
of 81 obligations found, 24 were **discharged and unmarked**, 2 were answered by a later document, and 55 are
live — most of them owned by items already in the queue. The dangerous claims were not the stale ones in the
"most stale" document; they were the **four restatements of a superseded degradation rule inside the canonical
document itself**, in the places a prompt author reads first, contradicting the owner decision recorded 28% of the
way in. Staleness in a follow-on is caught by an index; staleness in the base document's own status header and
slice table is not, because the index pointed readers there.

---

## Why the block at the top exists — the three failure modes

**Why these are here.** Owner diagnosis 2026-09-08: a document can fail two ways, and supersession
marks only fix one. **STALENESS** is a claim that stopped being true — marks fix it. **DEPTH** is a
claim that is true and that nobody reads far enough to find — marks do nothing, because the entry
reads CURRENT and the reader still never reaches the line. **Anything a PROMPT AUTHOR must carry
belongs here, not only in the document that reasoned it out.** The reasoning stays where it belongs;
the obligation moves to where it gets seen.

**A third mode found while cataloguing these: DISCHARGE.** An obligation that was satisfied and never
marked reads to the next reader as a stale claim — `matchups-schedule-design.md` → *Contract widenings* was
reported as stale by a reviewer when in fact the work had been done. Mark obligations complete, or they are
re-litigated. The full read found 24 of these.

**Obligation 1 is the one with a cost already paid.** It is not obscure — it sits in the campaign's
canonical document, in bold, addressed to the prompt author by name. Depth is not about obscurity; it
is about the fact that prompts get written from the top of a file. The CARRY block above is the single
obligations table; an earlier version of this file carried two with their row numbers swapped.

---

## Maintenance

**Verified as of 2026-09-08**, Item 144 (`PLATFORM-144-ITEM-87-DOC-RECONCILIATION-CLAUDE-v1`), against `main`
at the commit the branch merged from. What the pass covered:

- All sixteen documents read end to end, in the order: canonical document, this index, `team-highlight.md`,
  `presentation-decisions.md`, `records.md`, `matchups-schedule-design.md`, `three-column-tier.md`,
  `matchups-gap-analysis.md`, `featured-intent.md`, `section-ordering.md`, `section-ordering-resolutions.md`,
  `postseason-context.md`, `postseason-grouping-notes.md`, `postseason-refinements.md`, `team-colour.md`,
  `team-colour-regression.md`, then the mockup in full.
- Every DISCHARGED verdict checked against `src/`, `DESIGN.md`, `AGENTS.md` or the registry — none from another
  document's account.
- Every claim-level mark placed in the document that makes the claim; nothing deleted.
- Not covered: `item-87-followon-recap-scoreboard.md` (indexed on its own landing), `DESIGN.md` and the queue
  (planning's; the owner applied the `DESIGN.md` half of the 2026-09-08 rulings), and the Schedule breakpoint
  number (Item 152).

**Keeping it verified:** a new follow-on adds its row here and, if it overrides an earlier claim, a mark at that
claim. A slice that discharges a row moves it to the DISCHARGED table with where the work landed. A mark without
the file open is how this index was wrong twice before this pass.
