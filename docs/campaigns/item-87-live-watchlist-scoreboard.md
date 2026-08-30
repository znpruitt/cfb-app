# Item 87 — Addendum: Live / Watchlist Scoreboard Treatment

**Status:** Design decided; CLI-validated; corrections applied. Ready to commit pending the two open decisions below.
**Reference mockup:** `mockups/live-scoreboard-mockup.html`
**Related:** `INSIGHTS-026b-RECAP-LAYOUT-v1` (dispatched). Shares the scoreboard micro-component — see Sequencing.

---

## Problem

Shipped Live and Upcoming watchlist cards state each matchup three times (title line, owner line, then again in a score sentence), leave the score unattributed to either side, and omit the owner→team mapping — "Whited vs Chamness" does not say who holds which team. Live games additionally render in **both** sections simultaneously: `overview.ts:1009` filters `!== 'final'`, admitting `inprogress` by omission. Incidental, not intentional; Item 82 already records it as a defect.

---

## Decisions

### Scoreboard micro-component

Replaces sentence-style game rows in all three states. Shared with the recap's notable results. Would be the **first** such component documented in DESIGN.md.

- Team primary, owner as tertiary suffix, value right-anchored, rank as a prefix (absorbs the separate `#14` / `#24 vs #9` chips). Rank is nullable and simply omitted for unranked sides.
- Line-start slot reserved for future team logos; markup orders team first so the insertion point is structural. **Logos out of scope.**
- **Row order is always away → home** in every state including Final. Ordering and emphasis are separable: position is fixed by home/away, weight marks the leader (live) or winner (final).
- Unowned opponents render team-only. An owner holding both sides renders correctly with no special handling.

### Promotion model

A game occupies exactly one section: **Scheduled → Live on kickoff → Recent finals on completion.** Sections hide when empty. The finals block clears when the week becomes recap-eligible (06:00 ET the day after the week's last game-date), reusing the `INSIGHTS-026b` rule, so the recap hands off cleanly.

`gameStateFromScore` (`gameUi.ts:51`) returns a fourth value, `unknown`. **Decided:** a future kickoff routes to the watchlist. A past kickoff with no usable score **stays in Live and reads "Awaiting score"**, moving to Recent finals only when a final score attaches. DESIGN.md `:51-52` prescribes exactly this copy for the bounded post-kickoff gap and forbids both "Upcoming" and an unsupported "Live" claim; routing to Recent finals would assert the game finished, a stronger misstatement than either forbidden string. The Live badge is unaffected elsewhere — those rows carry attached in-progress scores, and the prohibition is on claiming live *without* score evidence. Shown rather than hidden: a visible game with an absent score is more honest than a silently missing one. *Open detail:* "Awaiting score" sits in the status row rather than a per-team anchor, since it describes the game rather than either side — confirm placement.

### Live state — neutral, no amber

Neutral text plus a neutral dot. The authority is the amber reservation itself — DESIGN.md `:135`, `:215`, `:281`, none of which admit a live exception. (POLISH-007 `:45-52` governs the league-header confidence signal and owned-team-row copy, not game-card badges; it is not the basis for this treatment.)

Live-amber drift reaches **seven locations across five components**, not the two originally catalogued:

| Location | Use |
|---|---|
| `OverviewPanel:677` | `N live` pill |
| `OverviewPanel:253` | SectionCard `tone='live'` gradient |
| `OverviewPanel:734` | live card borders (also collides with `:195`) |
| `GameScoreboard:72` | `inprogress` chip |
| `GameWeekPanel:27, 42, 151, 212` | chip, border, badge, live ring |
| `MatchupsWeekPanel:87, 111, 128, 271` | incl. an `animate-pulse` amber dot |
| `OwnerPanel:36` | status |

Legitimate champion amber is `OverviewPanel:469` (`#BA7517`) and `:475` — leave those.

**Filed as spun-off item A.** Cross-reference in both directions so the app does not sit half-converted.

DESIGN.md states the amber reservation three times (`:135`, `:215`, `:281`) with no live exception anywhere.

Rejected: left accent rail. Its value was distinguishing live from final at a glance, which the promotion model already handles by separating them into sections.

### Watchlist card

Reason title row → date / kickoff / broadcast → team lines anchored by **per-team spread** → O/U on a footer.

- `SCHEDULED` dropped: a kickoff time inside a section titled *Upcoming watchlist* already carries it. The freed line goes to the precedence reason.
- **The anchor holds a record, and the record belongs to the line's primary identifier.** Team-primary line (this scoreboard, any state) → *team* record. Owner-primary line (recap week records, standings, movement) → *owner* record. Position stays constant app-wide; context disambiguates, so no label is needed and the team line stays at three elements plus an anchor, matching live and final rows exactly.
- **Spread and O/U share the odds footer.** Games with no posted line render the reason there instead.

### Layout

- **Two-column game grid**, following existing precedent rather than introducing it — `FeaturedGamesList` already ships `grid-cols-1 sm:grid-cols-2` on this surface. Row-major flow, matching `RecapPrimitives.tsx:70`.
- **Container query at 760px**, per DESIGN.md `:120` preferring container over viewport queries. The doc specifies the mechanism but no value; three disagree in code (640 `FeaturedGamesList`, 821 recap, 760 here). 760 is chosen on content width — below it each card gets under ~350px, which clips team + owner + anchor on the longest rows. See Proposed amendments.
- **Progressive disclosure per section:** bounded default, expands in place. Header link → Matchups tab; footer control expands this week's slate.
- **Header rows single-line by contract** (nowrap + ellipsis). Any wrap desynchronises team rows across a grid row.
- Cards with no precedence reason **reserve the title row and hide it** to keep team lines aligned.
- **Section titles are 17px/650**, a deliberate exception to `:224` (15px/500) — at the documented size the boundary reads weakly against dense two-column content across three stacked sections.

---

## Data availability — corrected

The original addendum inverted the risk. Corrected:

| Item | Status |
|---|---|
| **Broadcast network** | **Free.** `buildCfbdGamesMediaUrl` (`cfbd.ts:31`) already runs via `schedulePresentationRefresh.ts:273`, cached year-wide as `schedule-media/<year>-all`, joined by `enrichScheduleItemsWithPresentation`. CFBD `/scoreboard` also returns `tv` inline. No new call; no fallback needed. |
| **Spread / O/U** | **Free.** Already cached; 114/500 monthly used, 3 credits per refresh. Watchlist odds ride the existing snapshot at zero marginal cost. |
| **Team W–L record** | **Confirmed available.** `GET /records?year=` returns every team in one call — 684 rows across all four divisions, 138 FBS matching `teams.json` exactly — and supports in-season partials. Keyed by numeric `teamId`, so the join needs no name resolution and sidesteps Item 83's collision; also carries `classification`, a second independent source for the division label alongside PLATFORM-114. New integration on the existing year-cache pattern. Do not derive from cached schedule + scores: a partial record is a false statement, not a missing one. |
| **Game state** | Already derivable — `gameStateFromScore` (`gameUi.ts:51`). |
| **AP rank** | Available, nullable; only for currently-ranked teams. |

**Budget correction:** the CFBD limit is **5,000/month**, with **341 used**. The `~1000/month` figure carried earlier is the live-scores *reserve floor* — the threshold below which live scores stop spending — not the ceiling. At weekly schedule cadence the records call is roughly 4/month; even hourly (~720) fits comfortably.

**Consequence:** records ship as the scheduled-state anchor. The spread fallback is not needed.

---

## Existing code — do not fork

| Section | Component | Current layout |
|---|---|---|
| Upcoming watchlist | `GameSummaryList` (`OverviewPanel.tsx:768`) | `space-y-2.5`, single column |
| Live | `GameCardList` (`OverviewPanel.tsx:714`) | `space-y-3`, single column, amber borders |
| Featured games | `FeaturedGamesList` (`OverviewPanel.tsx:864`) | `grid-cols-1 sm:grid-cols-2` |

Three components, no shared code today. Precedence sort is `prioritizeOverviewItems` (`overview.ts:428`), called at `:1019` and `:1025` off `deriveOverviewHighlightSignals` (`gameTags.ts:310`) — one sort, two call sites. **Must not be forked.**

---

## Open decisions

1. **Featured selection — partially decided; the rest belongs with the insights pipeline.**
   - **Cap: three.** Scarcity is the point. Games that miss the cut still carry their notoriety tags in the watchlist, so nothing is hidden by the cap.
   - **Copy tone: resolved.** "Toilet bowl" is established TSC terminology already used by the insights system, not a phrase this design introduces. Constraint that follows: Featured copy should **inherit league vocabulary from the insight generators** rather than invent parallel phrasing for the same concepts, or the app describes one thing two ways on a single page.
   - **Still open:** reset cadence (weekly, or can a game stay featured across weeks); whether zero qualifying games hides the tile or shows an empty state; which insight categories are pair-anchorable, and whether any new generators are needed.
2. **Recap notable results — team records: deferred, not rejected.** Records add flavour on the Item 87 scoreboard, so the same likely holds for the recap, but there is no reason to couple the recap's enrichment stage to the records integration (Item 92). Work it in later as an additive change.

   *Resolved:* the record shown is always the team's **current** record — not "entering" versus "after". A scheduled game shows the current record, which is pre-game by definition; a final shows the current record, which includes the result just read. Standard CFB scoreboard practice, and a stale post-game record is bad data handling. One rule, no state-dependent branching.

### Resolved since validation

- **Team records confirmed** and ship as the scheduled-state anchor (see Data).
- **Section migration is immediate.** A finalising game moves to Recent finals at once, including while a section is expanded. Live surface; staleness is worse than motion. Expansion state itself survives (`useLiveRefresh.ts:443`; `router.refresh()` preserves client state) — only the content changes beneath it.
- **`unknown` state** stays in Live with "Awaiting score", per DESIGN.md `:51-52` (see above).

---

## Spun-off work — items to file

Four bodies of work surfaced during this design that are **not** Item 87's surface. Filing them explicitly so none is lost in a scope note, and so Item 87's boundary stays clean.

### A → Item 90. Live-amber colour sweep + `final` chip re-cut

**Scope:** replace live-amber with the agreed live treatment across the components Item 87 does *not* replace (`GameScoreboard:72`, `GameWeekPanel:27/42/151/212`, `MatchupsWeekPanel:87/111/128/271`, `OwnerPanel:36`, `PostseasonPanel:78`), and re-cut `GameScoreboard:68-71` `final` from emerald to neutral. The `final` and `inprogress` cases share one code block, so they move together.
**Leave alone:** legitimate champion amber at `OverviewPanel:469` (`#BA7517`) and `:475`.
**Why separate:** reaches Matchups, Owner, GameWeek and Postseason; folding in would widen Item 87's scope against `AGENTS.md`. Overview's live-amber (`:253`, `:677`, `:734`) and its `stateBadgeClasses` green-final are *not* here — Item 87 removes both directly as part of replacing those components.
**Blocks nothing.** Item 87 removes the live-amber and green-final on its own surface directly; Item 90 sweeps the remaining components. Cross-reference so they land close together.
**Item number: 90.** Cross-reference Item 87 (blocked by this) and Item 92.

### B → Item 91. Standings-panel live-signal derivation

**Scope:** three linked changes to the pending-delta pipeline —

1. `liveDelta.ts:31-34` — render `+0–0` for tied live games instead of no credit, so the badge does not vanish on a tie.
2. `selectFreshOwnerPendingDelta:215` — on `isStale`, hold the last valid delta and replace on the next clean read, rather than returning `null`. This is a selector policy change; scores are already cached.
3. Gate badge rendering on **game state** (`gameStateFromScore`), not delta freshness, so a prolonged outage cannot leave a finished game showing a live badge.

**Then:** the `N live` pill (`OverviewPanel:677`, `liveCountByOwner:1528`) carries no information the badge lacks and can be removed, leaving one green element per row.
**Confirmed:** `isStale` does not blank. Its own contract (`liveDelta.ts:53-58`) says consumers may *dim or annotate*; the suppression is a consumer choice at `selectFreshOwnerPendingDelta:211`. The 7-minute threshold (`:9-12`) is two missed 3-minute ticks — overlay freshness, not game completion. Preventing post-game live state is game state's job, which change 3 handles directly.

**Acceptance boundary — do not break the `selectFresh…` contract.** Freshness is that function's advertised behaviour; making it return stale data silently misleads every other caller. Add a sibling (`selectOwnerPendingDelta`, last-known) that the badge consumes behind the game-state gate, and leave the original intact. Two accessors with honest names beat one that no longer means what it says.
**Why separate:** derivation logic in one component, different risk profile and test surface from a colour sweep. Should not ride along with A.

### C → already Item 82. Overview watchlist/live duplication

**Scope:** `overview.ts:1009` filters `!== 'final'`, admitting `inprogress` by omission, so live games render in both the watchlist and the Live section. Already recorded as a defect in Item 82.
**Do not file a new item — cite Item 82.** Its promotion-model fix in Item 87 as a consequence of the redesign. Either close Item 82 against Item 87, or fix it standalone if Item 87 is deferred — but do not fix it twice.

### D → Item 92. CFBD team-records integration

**Scope:** wire `GET /records?year=`, add a year-scoped cache on the existing pattern, set refresh cadence, account for quota. Keyed by `teamId`, carries `classification`.

**Cadence requirement — records must be fresh before finals render.**

A final scoreboard shows the team's *current* record including the game just played, so a weekly refresh would leave Saturday's finals displaying stale records. But the requirement is **not uniform**: a final needs the post-game record; a scheduled watchlist card is fine with a record refreshed hours earlier. So the real constraint is "fresh before finals render," not "refresh on finalisation."

**Refresh in the live-scores cron**, which already observes non-final → final transitions, already spends quota under a reserve check, and fits the existing `weekPartitionScope` refresh-status pattern. Bounded, server-side call count.

**Do not hook `handleGamesFinalized`.** It is a client callback firing per browser — three members watching a slate means three triggers per finalisation, and quota consumption becomes a function of how many people have the page open. It also inverts the cron-spends / client-reads split established by PLATFORM-086B2B (`browserPolling.ts:12-15`: the client "decides only whether a VISIBLE tab should issue a cache-only score read — never a provider call") and preserved by PLATFORM-075, restated in the comment directly above the callback itself (`CFBScheduleApp.tsx:1060-61`).

**Deriving post-game records** by adding the result to a cached pre-game value is rejected — double-count risk, and the quota (341/5,000) does not justify it.

**Record the refresh under a scope the Provider data panel reads**, or records join scores and game-stats as a third dataset showing `No refresh history` while working correctly (Item 88).

### Not filed — Schedule page rework

Flagged in *Adjacent surface* below, but **not filed as an item**: no problem statement, no acceptance boundary, no evidence it is needed yet. Left as a note in Item 90, which is where much of its colour work lives. File it when something forces it rather than creating a queue entry that rots.

---

## Implementation slices — Item 87

Ordered so colour settles once rather than shipping neutral live and flipping it later.

| # | Slice | Notes |
|---|---|---|
| 1 | Scoreboard component + Live section | Simplest state; verifiable against live games today. Ship the component with its first consumer — a component with no consumer cannot be verified behaviourally. |
| 2 | Featured conversion + retire `stateBadgeClasses` + green-live flip | Colour settles in one step. **Load-bearing:** if Featured stays on old markup, `:931` survives, green-final survives, and the collision returns. |
| 3 | Recent finals + promotion model | Needs `unknown` routing and the recap-eligibility clear. |
| 4 | Watchlist | Riskiest — anchor depends on Item 92. Falls back to the spread anchor if 92 has not landed. |

**Risk order:** watchlist anchor (external data) > promotion model (state transitions mid-slate, section migration) > two-column grid against the header-nowrap contract. Slices 1–2 are low-risk and independently verifiable.

**Pre-agreed split point:** if Item 87 exceeds sizing signals mid-build, break after slice 2. Agreeing this now rather than discovering it at review.

**Acceptance boundary on the Featured double-touch:** slice 2's conversion must leave a slot the insights work fills, so the second pass is additive rather than a rewrite. State this explicitly in the implementation prompt.

---

## Sequencing across campaigns

| Order | Item | Why |
|---|---|---|
| 1 | **82** | In-season one-line predicate fix for a duplication members are seeing now. Do not wait on a design campaign to fix a live bug. Item 87 later supersedes it. |
| 2 | **87 slices 1–2** | Defines the shared scoreboard component. |
| 3 | **Item 42 wiring pass** (except notable results) | Unblocked — all four fact families shipped. Runs **in parallel** with 87; no dependency. |
| 4 | **91** | Standings derivation — unblocks pill removal. |
| 5 | **90** | Amber sweep, incl. pill removal and the `final` re-cut elsewhere. |
| 6 | **92** → **87 slice 4** | Records integration, then the watchlist anchor. |
| 7 | **017-PALETTE** | Reason and category hues. |

**Genuine blockers — only three:** Item 91 → pill removal; Item 87's component → notable-results scoreboards; Item 92 → watchlist anchor. Everything else is preference. Items 87 and 90 are independent.

---

## DESIGN.md amendments required

1. **§Cards and game results** — add the scoreboard micro-component: row anatomy, away→home ordering with weight-not-position emphasis, three state variants.
2. **§Color** — record that amber live-clock badges and amber live-card borders are drift, and that live state is expressed structurally. Without this, the next reviewer re-flags the neutral treatment.
3. **§Containerization** — the two-column game grid and per-section progressive disclosure.
4. **§Responsive column degradation** — declare the game grid's breakpoint mechanism and reconcile 640 / 821.

### Proposed amendments — judgment calls, not conformance failures

These are cases where the mockup's approach may be better than the documented value. Flagged explicitly as amendment candidates rather than applied silently.

- **Amendment 5 — §Section headers — game-section title size.** Document 17px/650 as a deliberate game-section exception to `:224` (15px/500). Rationale: at the documented size the boundary sits one step above a team line at 14px and reads weakly against dense two-column content across three stacked sections.
- **Amendment 6 — §Multi-line row pattern / §List row width discipline (`:77-97`) — exempt the scoreboard.** That pattern is line 1 primary + right-anchored value, line 2 secondary metadata at 12px. The scoreboard is a different shape: a status row plus **two peer lines, each carrying its own anchor**. Document it as a distinct pattern or explicitly exempt it, or a reviewer will flag the team lines for lacking line-2 metadata.
- **Amendment 7 — §Cards — anchor semantics.** Record the rule that a scoreboard's anchor holds the number relevant to its state (record when scheduled, score when live or final), and that a record always belongs to the line's primary identifier — team-primary lines carry team records, owner-primary lines carry owner records.
- **Amendment 8 — §Responsive — declare the game-grid breakpoint.** The doc specifies container queries but no value, and 640 / 821 / 760 all exist in code. Rather than inheriting a sibling's value, the amendment should declare the game grid's own, chosen on content width (760).

---

## Sequencing — the recap campaign

**Do not read campaign status from this document.** It has been wrong twice; the recap work moved underneath it both times. Verify against the repo at dispatch time.

As of this writing 026a–026e have all merged and the recap campaign is finished apart from its final wiring pass. **The "enrichment stage" this document previously referenced does not exist as pending work.**

**What survives is the conclusion, for a different reason than originally given.** Notable-results scoreboards were never built — not in any recap slice, and not in 026b v3, whose scope was a data-seam rebuild rather than notable-results UI. `src/components/recap/` holds only `RecapPrimitives`, `RecapTile` and `WeeklyRecapSection`. So Item 87 still defines the scoreboard component, because nothing else has.

**Notable results need a home — open decision.** Two options:

- **Item 42's wiring pass absorbs them**, consuming Item 87's component. Correct on surface boundaries — notable results are recap UI, and putting recap UI inside Item 87 would cross surfaces the same way the amber sweep would have. Cost: that part of the wiring pass waits on Item 87 slice 1.
- **Item 87 takes them as a fourth consumer.** Keeps component and consumers in one campaign, but Item 87 is already large enough to carry a pre-agreed split point, and it would own UI on a surface it otherwise does not touch.

**Recommended:** the wiring pass absorbs them, but as its own slice. Everything else in that pass is unblocked and can run in parallel with Item 87; only the notable-results slice waits on slice 1. That keeps surface boundaries clean without blocking the rest of the wiring.

## Palette allocation — input to INSIGHTS-017-PALETTE

Two findings from this design that 017 should weigh, neither decided here.

**1. Colour is context-scoped in this app already, and the doc does not say so.** Green appears in at least two shipped meanings, both correct and neither ambiguous in place:

| Surface | Element | Green means | Red counterpart |
|---|---|---|---|
| AP Poll | `↑8` beside a rank | moved up | yes — `↓2` |
| Standings row | `+1–0` beside a record | provisional / in progress | none — `+0–1` is also green |
| *Proposed:* game scoreboard | `● LIVE` beside a clock | in progress | none |

The standings badge is direction-neutral not because valence is ignored but because *"in progress" has no negative counterpart* — the W–L inside the badge carries the valence, the colour carries the status. Red would be wrong there.

Green ships in at least **six** distinct meanings. The sharpest proof is a single file: `deltaTextColor` (`OverviewPanel.tsx:95-99`) greens a *positive* delta, `gbDeltaColor` (`:298-302`) greens a *negative* one — because gaining ground is good. Same token, opposite numeric signs, disambiguated purely by host element. Also shipped: success confirmations (`FeedbackForm.tsx:49`, `AdminAuthPanel.tsx:63`), win cells (`MatchupMatrixView.tsx:14`), positive point differential (`StandingsPanel.tsx:469`), and the provisional badge.

**Rule for 017 to document:** green reads as *up / active*, its precise meaning fixed by host element and adjacent content, never by the colour alone. Red is its valenced counterpart only where a negative state exists. **Enforcement clause:** *a hue carries exactly one meaning within a component family; context scopes meaning across families, never within one.* That makes the `deltaTextColor` / `gbDeltaColor` pair legal and the live/final pair below illegal — which is the distinction that actually matters, and it is checkable rather than requiring a reviewer to adjudicate whether adjacent text is sufficient.

**Consequence:** green-as-live is not a second claim on a reserved colour — it is the same meaning the standings badge already carries, applied where nothing else can carry it.

**Prerequisite — re-cut the `final` chip to neutral, but not in this campaign.** `GameScoreboard.tsx:68-71` renders `final` emerald and `inprogress` amber. Green-for-live collides with green-for-final inside one component family, which the enforcement clause forbids — and it is the one case context-scoping cannot resolve, since the host element is identical and only adjacent text (a clock versus the word FINAL) differentiates.

**Scope correction — the collision is on Item 87's own surface.** `GameScoreboard` does render on Matchups → Schedule (`CFBScheduleApp.tsx:1861-1883`, plus `PostseasonPanel.tsx:78`), but Overview has its own independent green-final: `stateBadgeClasses` (`OverviewPanel.tsx:181`) maps `final → emerald`, called at `:746` (GameCardList/Live), `:843` (GameSummaryList/Watchlist) and `:931` (FeaturedGamesList). The first two are components this campaign replaces.

**Featured is a separate axis from state — resolved.** State moves games between sections; Featured exempts a game from that movement. A featured game enters when selected and stays through scheduled, live and final, so it appears **only** in the Featured tile, never in the state sections — preserving the promotion model's one-game-one-place rule rather than competing with it.

The tile states the reason with substance ("Whited leads Chamness 44–25"), not a bare label: a game earns promotion out of the weekly slate only if the reason is worth reading. **Capped at three** — at five it is another list with a nicer name, and the fourth competing list this campaign exists to remove. Games that do not make the cut still carry their notoriety tags in the watchlist, so nothing is hidden by the cap.

**This retires the third `stateBadgeClasses` call site.** Converting Featured to the scoreboard component covers `:931` alongside `:746` and `:843`, so Overview carries no green-final and the sequencing question below resolves cleanly. Item 82(b) retains ownership of Featured's *selection and labelling*; Item 87 owns only how its rows render.

**Featured — what belongs in Item 87 and what does not.**

| Work | Owner | Rationale |
|---|---|---|
| Convert Featured's rows to the scoreboard component | **Item 87** | Same component, third call site on the same surface. Leaving it on old card styling while Live and Watchlist convert puts two game-rendering treatments side by side on one page. |
| Retire `stateBadgeClasses` (`:931` with `:746`, `:843`) | **Item 87** | Falls out of the conversion; unblocks green-live. |
| Reason label + substance line ("Whited leads Chamness 44–25") | **Insights work** | Requires insight-to-game binding that does not exist. Purely additive to the row, not a rework of it. |
| Selection — which games are featured | **Insights work** | See below. |
| Count, reset cadence, empty-state | **Insights work** | Follows selection. |

Item 87 therefore ships Featured as a converted list with its **current** selection and no reason line. The mockup shows the **end state**, with out-of-scope elements marked inline in the markup (dashed rule plus a "Not built in Item 87" tag) rather than only in the notes block — an implementer reads the markup, not the annotations. Repeat the boundary in the implementation prompt.

**Featured conversion is load-bearing, not optional.** The unblocked colour story *depends* on `:931` dying. If Featured stays on the old markup, `stateBadgeClasses` survives, green-final survives on Overview, and the collision returns — green-live would wait for Item 90 after all. Converting Featured is what buys the independence.

The double-touch is acceptable **because it is constrained**: slice 2's conversion must leave a slot the insights work fills, so the second pass is additive rather than a rewrite. This belongs in Item 87's acceptance boundary.

**Featured is the insights system with a game hook — not watchlist curation.** The watchlist asks *which games are worth watching*, on football criteria (rank, spread, matchup quality). Featured asks *which games activate something the league already knows*. The rivalry insight already ships in the feed ("Whited leads BHooper 44–25 — the most lopsided rivalry on record"); Featured is that same fact bound to a game about to be played between those two owners.

That places selection with the **insights pipeline**, not `prioritizeOverviewItems`. Consequences:

- **The criteria are the existing insight taxonomy, not a new one.** Reference frame × positional relationship — last season's standings, the previous week, current standings, all-time head-to-head, crossed with top-two, bottom-two, extremes, movers — maps onto the categories already generating feed items. No parallel criteria system.
- **Over-firing may already be solved.** The insight registry has priority and suppression machinery (`INSIGHTS-018`'s NEW tag and binary suppression gate). Featured should reuse it rather than invent a second calibration, which also removes the `RECORD-NOTEWORTHINESS-THRESHOLDS` parallel I drew earlier.
- **Colour inherits.** Featured reason labels are insight category eyebrows, so they take whatever `INSIGHTS-017-PALETTE` assigns — no separate hue decision for this tile.
- **Copy generates from the insight**, not from a game-specific template. Already the case for feed items.

**Filter — only pair-anchored insights qualify.** "Longest active title drought" has no game to attach to. Featured surfaces only insights whose subject is a pair of owners who happen to be meeting.

**New rule needed — suppress the feed duplicate.** An insight surfaced in Featured should not also appear in the insights feed that week, or the page states the same fact twice. Same one-place principle as the promotion model.

**Green-live ships in Item 87 — no dependency on Item 90.** With `stateBadgeClasses` retired, Overview carries no green-final, so green is unambiguous within this campaign's surface. The residual green-final on Schedule (`GameScoreboard:68-71`) is a *different* surface, which is the cross-family case context-scoping explicitly permits — and a weaker adjacency than the `deltaTextColor` / `gbDeltaColor` pair that already coexists on one page. Sequencing them would also mean changing the same element twice: neutral in 87, green in 90.

**Item 87 owns its game-list surface.** Within Overview it retires `stateBadgeClasses` (`:746`, `:843`, `:931` — all in components it replaces), removes the `:253` SectionCard `tone='live'` gradient (single consumer at `:1765`) and the `:734` card borders, and ships green-live.

**Correction — the `:677` pill is not reached.** It lives in `CondensedStandingsTable` (`:566`), the standings rows, not the game lists. Item 87 does not touch it, and its removal is gated on **Item 91**, not Item 90: pulling it before ties render `+0–0` and staleness degrades would reintroduce the blind spot. One constraint survives, in a different place than previously recorded. Item 90 sweeps the remaining surfaces: `GameScoreboard`, `GameWeekPanel`, `MatchupsWeekPanel`, `OwnerPanel`, `PostseasonPanel`, plus the `final` re-cut. Cross-reference so the two land close together, but neither blocks the other.

**Residual risk, accepted:** if Item 90 slips, Schedule keeps green-final while Overview has green-live. That is the status quo plus one improvement, not a regression, and it is confined to different pages.

**Rationale for neutral `final` still holds:** under the promotion model sections carry state, so a Final chip is redundant reinforcement and neutral is the correct resting treatment.

**1b. Proposed treatment for this surface: bronze eyebrow (`#c9a66b`) with green live.** Ranked bronze > sky > neutral > fuchsia. Bronze is not champion amber (`#BA7517`) — desaturated tan against dark saturated gold — and the champion signal is largely an end-of-season artefact, so the two barely co-occur during the season. **Confirmed dormant in-season:** the live league page renders #1–#3 podium cards in neutral chrome with no champion treatment, so amber does not appear until a title is awarded. Bronze is uncontested through the season. Fuchsia is rejected: complementary clash against green live, and it already sits between TRAJECTORY and HISTORICAL. Final assignment belongs to 017; this is a ranked recommendation into it.

**2. Reservations should be re-cut by value, not defended by adjacency.** A reservation binds a token to a purpose; it does not fence off a hue neighbourhood. Bronze (`#c9a66b`) is not champion amber (`#BA7517`); sky (`#7dd3fc`) is not interactive blue (`#60a5fa`). Ranked by how much colour contributes:

| Use | Colour's contribution | Verdict |
|---|---|---|
| Live status | Colour is the whole signal; time-critical | Highest value — claim it |
| Champion | Rare but emotionally weighted; gold irreplaceable | Keep |
| Deltas | Arrow + number already carry it; colour reinforces | Could survive a narrower claim |
| Interactive | Position and underline also carry it | Keep, low pressure |
| Insight category microlabels | Word already states the meaning | **Weakest — reclaim here** |

The category tokens are both the weakest use and the ones already colliding (8 categories over 5 hexes; CAREER's `#5DCAA5` unreachable from the insights path). If 017 needs headroom for live or precedence, that is where it exists — rather than squeezing new signals into gaps between existing tokens.

---

## Existing standings-panel defects — separate from this campaign

Identified by the owner; not this campaign's surface, but they change what the green convention actually is.

**Row anatomy as shipped:** the main record counts *finalised* games; the green `+W–L` badge carries the *provisional* result of in-progress games; the `N live` pill counts them. Jackson renders a clean `1–0` with neither badge nor pill because his game finalised and rolled into the record.

**The badge should render `+0–0` rather than disappear.** `liveDelta.ts:31-34` gives no pending W/L credit for ties, and `selectFreshOwnerPendingDelta:215` returns `null` when `pendingWins + pendingLosses <= 0`. So an owner whose only live game is tied shows nothing. `+0–0` is a true statement — level across live games — and fixes the blind spot at its source, rather than compensating for it downstream. Preferred over keeping a second element alive to cover the gap.

**Staleness — persist last valid rather than blanking.** `selectFreshOwnerPendingDelta:215` also returns `null` when `liveDelta.isStale`, so a failed or timed-out refresh erases the badge even though nothing about the games changed. Preferred behaviour: hold the most recent valid delta and replace it on the next clean read. Note this is a **selector policy change, not a persistence one** — scores are already cached, and the selector is choosing to discard them.

**Guardrail — gate on game state, not on delta freshness.** Persisting a delta unconditionally means a prolonged outage leaves a finished game showing a live badge indefinitely. The two signals have different sources and different failure modes, which is exactly what makes the combination safe:

- **Game state** (`gameStateFromScore`, the same source the pill counts from) decides *whether* a badge renders at all. No games in progress → no badge, regardless of what the delta cache holds.
- **Delta** decides *what* it says. Stale → show last valid; fresh → update.

Under that rule the badge never disappears while games are genuinely live, never persists past a game ending, and `+0–0` covers ties. The pill then carries no information the badge lacks and can be removed, leaving one green element per row.

**Ask the CLI why `isStale` blanks rather than degrades** before overriding it — the flag was presumably added to prevent showing stale in-progress state after games ended, which is precisely what the game-state gate handles more directly.

**Filed as spun-off item B.**

### Not a colour defect

The green badge is direction-neutral by design — "in progress" has no negative counterpart, so the W–L inside the badge carries valence while the colour carries status. Red would be wrong there.

**Edge case for 017 or the standings work:** an owner whose live game is currently tied, or which has kicked off with no score attached, produces no meaningful `+W–L`. If the badge is the only live signal, that owner shows nothing while a game is genuinely in progress. Confirm how the badge renders at `+0–0` before the pill is removed.

---

## Label semantics — placeholder warning

The mockup renders `Top matchup` and `Ranked spotlight` as eyebrow and title-row strings. **These are placeholders.** Item 87 (committed `dc1b934a`) records `Top matchup` as false: `gameTags.ts:441` fires it from `isTopOwnerGame` — true when *either* owner is top-three — while an identically-worded eyebrow elsewhere means "best game on the slate," and the two contradicted in production. Implementation must consume the renamed labels, not these strings. Hues are deferred to `INSIGHTS-017-PALETTE`; semantics are fixed by the Item 87 rename.

---

## Adjacent surface — Schedule page

Matchups → Schedule renders the same content shape this campaign redesigns: a matchup, an owner pair, and a status, currently as three-line cards with status-coloured borders and chips. Owner review flags it as wanting its own rework.

Two implications:

1. **The scoreboard component would have a third consumer** — recap notable results, Overview live/watchlist, and Schedule. That strengthens the case for defining the row contract generously now (three state variants, rank prefix, anchor slot, odds footer, reserved title row) rather than narrowly, since a third surface would otherwise widen it again.
2. **It is where the `final` green and much of the live amber actually live**, so the colour-correction item and a Schedule rework overlap. Worth deciding whether the colour sweep lands first as a narrow correction, or whether Schedule's rework absorbs it.

Not scoped here. Filed as spun-off item D.

---

## Not in scope

Team logos; the upcoming-weekend recap tile view; selection/ordering logic; tag hue assignment (→ `INSIGHTS-017-PALETTE`); any change to `leagueRecords.ts`.
