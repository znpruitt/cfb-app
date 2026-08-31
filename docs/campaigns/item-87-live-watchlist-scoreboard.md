# Item 87 — Addendum: Live / Watchlist Scoreboard Treatment

**Status:** Slices 1–2 shipped via POLISH-016 / PR #535 and POLISH-017 / PR #537; Item 91 shipped via
PLATFORM-116 / PR #539; the pre-agreed reassessment point has been reached, and slices 3–4 remain
planned.
**Reference mockup:** `mockups/live-scoreboard-mockup.html`
**Related:** `INSIGHTS-026b-RECAP-LAYOUT-v1` (dispatched). Shares the scoreboard micro-component — see Sequencing.

---

## Problem

Shipped Live and Upcoming watchlist cards state each matchup three times (title line, owner line, then again in a score sentence), leave the score unattributed to either side, and omit the owner→team mapping — "Whited vs Chamness" does not say who holds which team. POLISH-015 removed the interim Live/watchlist duplication and made the watchlist chronological; Item 87 still replaces the separate renderers with one scoreboard and a structural promotion model.

---

## Decisions

### Scoreboard micro-component

Replaces sentence-style game rows in all three states. Shared with the recap's notable results. Would be the **first** such component documented in DESIGN.md.

- Team primary, owner as tertiary suffix, value right-anchored, rank as a prefix (absorbs the separate `#14` / `#24 vs #9` chips). Rank is nullable and simply omitted for unranked sides.
- Line-start slot reserved for future team logos; markup orders team first so the insertion point is structural. **Logos out of scope.**
- **Row order is always away → home** in every state including Final. Ordering and emphasis are separable: position is fixed by home/away, weight marks the leader (live) or winner (final).
- Unowned opponents render team-only. An owner holding both sides renders correctly with no special handling.

#### State variants — widened for Schedule (slice 5), 2026-08-30

Slice 5 makes Schedule the component's third consumer. Its surface carries states Overview never shows, so the contract is widened **now**, before slice 3 implements against it, rather than being re-widened later — the failure *Adjacent surface* warned about.

- **`disrupted`** — postponed / canceled / suspended / delayed. Currently `GameScoreboard:54-78` matches these by regex on `score.status` ahead of the state switch. Rose.
- **`placeholder`** — an unfilled bracket slot with no resolved teams. Violet.
- **Disclosure.** Schedule rows are `<details>`/`<summary>` with a collapsed summary and an expanded body (`GameWeekPanel:268` uses `group-open:hidden`). The row must support an optional expanded region without the collapsed form changing shape. Overview and recap pass no expanded content and render exactly as they do today.
- **Slot passthrough.** Schedule attaches odds, a debug affordance, byes, postseason grouping, and an admin postseason-override control. These are Schedule's, not the row's: the row exposes slots, and does not learn about any of them.

`disrupted` and `placeholder` are **states, not emphasis** — distinct from `cardEmphasisClasses` (`GameWeekPanel:39-50`), where amber means `upset` alongside `upset_watch`→orange and `top_25_matchup`→indigo. That function is emphasis and is out of scope for every slice here.

### Promotion model

A game occupies exactly one section: **Scheduled → Live on kickoff → Recent finals on completion.** Sections hide when empty. The finals block clears when the week becomes recap-eligible (06:00 ET the day after the week's last game-date), reusing the `INSIGHTS-026b` rule, so the recap hands off cleanly.

`gameStateFromScore` (`gameUi.ts:51`) returns a fourth value, `unknown`. **Decided:** a future kickoff routes to the watchlist. A past kickoff with no usable score **stays in Live and reads "Awaiting score"**, moving to Recent finals only when a final score attaches. DESIGN.md `:51-52` prescribes exactly this copy for the bounded post-kickoff gap and forbids both "Upcoming" and an unsupported "Live" claim; routing to Recent finals would assert the game finished, a stronger misstatement than either forbidden string. The Live badge is unaffected elsewhere — those rows carry attached in-progress scores, and the prohibition is on claiming live *without* score evidence. Shown rather than hidden: a visible game with an absent score is more honest than a silently missing one. *Open detail:* "Awaiting score" sits in the status row rather than a per-team anchor, since it describes the game rather than either side — confirm placement.

### Live state — green, no amber

Slice 1 removed amber and shipped the first consumer with neutral structural status. Slice 2 then
settled the component family on a green dot and green `Live` text after adding a neutral final
variant and removing Overview's last reachable green-final treatment. `DESIGN.md` now records the
governing rule: a hue has one meaning within a component family, while context scopes meaning across
families. Amber remains reserved for champion/podium signals.

The original audit found live-amber drift in **seven locations across five components**, not the two
first catalogued:

| Location | Use |
|---|---|
| `OverviewPanel:677` | `N live` pill — retired by PLATFORM-116 |
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

- **Two-column game grid**, following existing precedent rather than introducing it — `FeaturedGamesList` already ships `grid-cols-1 sm:grid-cols-2` on this surface. Row-major flow, matching `RecapPrimitives.tsx:75`.
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

> Line numbers verified against `main` at `78905c47` (after INSIGHTS-026f, which moved ~550
> lines out of `overview.ts`). Re-derive before citing them in a prompt — they have gone stale
> once already.

| Section | Component | Current layout |
|---|---|---|
| Upcoming watchlist | `GameSummaryList` | Bespoke scheduled/unknown rows; removed by slice 4. |
| Live | `GameCardList` → `CompactGameScoreboard` | Shared live scoreboard in a responsive two-column grid. |
| Featured games | `FeaturedGamesList` → `CompactGameScoreboard` | Shared neutral-final scoreboard in the same grid. |

Live and Featured now share `CompactGameScoreboard`; only the watchlist remains bespoke. Selection
and precedence remain selector-owned. **Must not be forked.**

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

Five bodies of work surfaced during this design that are **not** Item 87's surface. Filing them explicitly so none is lost in a scope note, and so Item 87's boundary stays clean.

### A → Item 90. Shared status label + `final` re-cut — **narrowed 2026-08-30**

**Narrowed when slice 5 was filed.** The original scope covered every surface Item 87 does not replace, Schedule included. Schedule's colour is now absorbed by slice 5, so this item drops `GameScoreboard` and `GameWeekPanel` entirely: converting a pill slice 5 deletes is throwaway work.

**Scope, as narrowed.** Extract Overview's live treatment (`CompactGameScoreboard:66-77` — borderless uppercase text, hue-carrying, `size-1.5` dot for live) into one shared status label in `src/lib/gameUi.ts`, and adopt it on the surfaces with no rework planned:

- `OwnerPanel` — `toneClasses:34-44`, rendered at `:170` and `:198`.
- `MatchupsWeekPanel` — status text `:266` + dot `:271`; `performanceClasses:80-93`; `ownerCardSurfaceClasses:125-129`; and the `inprogress` branch of `ownerOutcomeRowClasses` (`:110-111`) **only**.
- `OverviewPanel` — `stateBadgeClasses:176-182`, rendered at `:816`. Slice 4 replaces this row, but the change is one line through the shared helper and the watchlist is the highest-traffic surface, so it is taken now rather than waiting on Item 92.
- `CompactGameScoreboard:66-77` becomes a consumer of the extracted label. Leaving the canonical copy inline is what let this conversion go partial in the first place.

**Also in scope:** `gameUi.ts:70-87` `statusClasses` is **dead** — exported, called nowhere, referenced by no test, carrying both live-amber and final-emerald. Delete it; the shared label takes its place.

**`MatchupsWeekPanel` keeps a neutral live label with its existing pulse.** Same shape as everywhere else, different hue: that component spends green on `finalWin` (`:113`, against `finalLoss`:115 rose), so an emerald live label would put green on two meanings inside one component (`DESIGN.md:139-141`). Not an exception — `DESIGN.md:321` already scopes green to the *compact-scoreboard* family, and this is an outcome family. Elsewhere the dot does not pulse; the pulse appears only where hue cannot carry live.

**Green must end up meaning one thing per component.** `MatchupsWeekPanel` violates this today: `performanceClasses:84` final→emerald, `ownerCardSurfaceClasses:125` final→emerald, `ownerOutcomeRowClasses:113` finalWin→emerald. Once `final` goes neutral, emerald must appear exactly once in that file and rose exactly once. Assert it.

**Leave alone:** champion amber at `OverviewPanel:423`/`:429`; the standings-direction indicator `:593`; coverage-error text `:1583`; `cardEmphasisClasses:39-50` (`upset`, not live); `recap/RecapPrimitives.tsx:277`, which defines its own local `GameScoreboard` and is not a consumer.

**Correction to the filed item.** `docs/next-tasks.md` Item 90 states POLISH-016/017 removed Overview's live-amber and its `stateBadgeClasses` green-final. They removed them from the Live and Featured sections only — the *Upcoming watchlist* still calls `stateBadgeClasses` at `:816`. The item also omits `gameUi.ts` and miscites `GameWeekPanel:42` as a live site when that line is `upset`.

**Accepted residual:** Schedule keeps green-`final` and amber-live until slice 5 lands.

**Item number: 90.** Cross-reference Item 87 slice 5 (absorbs the Schedule half) and Item 92.

### B → delivered by PLATFORM-116. Standings-panel live-signal derivation

**Delivered:** tied and temporarily scoreless in-progress games now contribute a zero-decision
delta, Overview reads the last-known value behind a current-game-state gate, and the `N live` pill
is gone. `selectFreshOwnerPendingDelta` keeps its fresh-only contract for Standings and Members.
The work remained separate from Item 90's cross-component color sweep and merged via PR #539.

### C → delivered by POLISH-015. Overview watchlist/live duplication

**Delivered:** the interim selector excludes in-progress games from the watchlist and pins that boundary with regression coverage. Item 87 supersedes the predicate with a structural promotion model; do not reimplement the interim fix as a separate slice.

### D → Item 92. CFBD team-records integration

**Scope:** wire `GET /records?year=`, add a year-scoped cache on the existing pattern, set refresh cadence, account for quota. Keyed by `teamId`, carries `classification`.

**Cadence requirement — records must be fresh before finals render.**

A final scoreboard shows the team's *current* record including the game just played, so a weekly refresh would leave Saturday's finals displaying stale records. But the requirement is **not uniform**: a final needs the post-game record; a scheduled watchlist card is fine with a record refreshed hours earlier. So the real constraint is "fresh before finals render," not "refresh on finalisation."

**Refresh in the live-scores cron**, which already observes non-final → final transitions, already spends quota under a reserve check, and fits the existing `weekPartitionScope` refresh-status pattern. Bounded, server-side call count.

**Do not hook `handleGamesFinalized`.** It is a client callback firing per browser — three members watching a slate means three triggers per finalisation, and quota consumption becomes a function of how many people have the page open. It also inverts the cron-spends / client-reads split established by PLATFORM-086B2B (`browserPolling.ts:12-15`: the client "decides only whether a VISIBLE tab should issue a cache-only score read — never a provider call") and preserved by PLATFORM-075, restated in the comment directly above the callback itself (`CFBScheduleApp.tsx:1060-61`).

**Deriving post-game records** by adding the result to a cached pre-game value is rejected — double-count risk, and the quota (341/5,000) does not justify it.

**Record the refresh under a scope the Provider data panel reads**, or records join scores and game-stats as a third dataset showing `No refresh history` while working correctly (Item 88).

### E → Item 87 slice 5. Schedule page rework

**Filed 2026-08-30**, having previously been left unfiled pending something forcing it. What forced it: scoping Item 90 as a narrow colour correction on Schedule required inventing a shared status label, a six-tone vocabulary, and a dot affordance the surface has never had, plus a decision on whether the live ring survives. That is a presentation rework under a colour sweep's name. The scope grew because the surface is dated, not because the colours are.

**Problem statement.** Schedule renders the same content shape this campaign redesigns — a matchup, an owner pair, a status — as three-line cards with status-coloured borders and pill chips. It is space-inefficient, it is the last surface still using the pre-campaign presentation, and it holds the residual green-`final` and most of the residual live-amber.

**Scope.** Schedule (`GameWeekPanel`, `GameScoreboard`) adopts the scoreboard row, two-column and all, against the widened state contract above. Colour settles as part of the rework; Item 90 no longer touches these files.

**Acceptance boundary.** The collapsed row is the scoreboard row. `disrupted` and `placeholder` render as states, not emphasis. Expand/collapse, byes, postseason grouping, odds, debug and the admin postseason override all survive unchanged — the row exposes slots and learns about none of them. No amber remains for live; no green remains for `final`. `PostseasonPanel:78` inherits via `GameWeekPanel` and is a verification surface only.

**Sequencing.** Implement after slices 3 and 4; its *contract requirements* are folded in above so slice 3 does not lock a three-state row. Wants Item 92 for the scheduled-state record anchor, and degrades to the spread anchor without it, same as slice 4.

---

## Implementation slices — Item 87

Ordered so colour settles once rather than shipping neutral live and flipping it later.

| # | Slice | Notes |
|---|---|---|
| ✅ 1 | Scoreboard component + Live section | Merged via POLISH-016 / PR #535 (`5fd59d39`), 2026-08-30. The component shipped with its first live consumer and no speculative state variants. |
| ✅ 2 | Featured conversion + retire its `stateBadgeClasses` call + green-live flip | Merged via POLISH-017 / PR #537 (`e0a7b8ab`), 2026-08-30. Featured now consumes the neutral-final variant, and green-live is unambiguous on Overview. |
| 3 | Recent finals + promotion model | Needs `unknown` routing and the recap-eligibility clear. |
| 4 | Watchlist | Riskiest — anchor depends on Item 92. Falls back to the spread anchor if 92 has not landed. |
| 5 | Schedule rework | Filed 2026-08-30 (was *Not filed*). Schedule adopts the scoreboard row, two-column and all, and its colour settles as part of the rework rather than via Item 90. Needs the widened state variants above. |

**Risk order:** watchlist anchor (external data) > promotion model (state transitions mid-slate, section migration) > two-column grid against the header-nowrap contract. Slices 1–2 are low-risk and independently verifiable.

**Pre-agreed split point:** if Item 87 exceeds sizing signals mid-build, break after slice 2. Agreeing this now rather than discovering it at review.

**Acceptance boundary on the Featured double-touch:** slice 2's conversion must leave a slot the insights work fills, so the second pass is additive rather than a rewrite. State this explicitly in the implementation prompt.

---

## Sequencing across campaigns

| Order | Item | Why |
|---|---|---|
| Done | **POLISH-015** | Interim duplication, chronological ordering, and empty-copy correction merged via PR #531; Item 87 supersedes the implementation. |
| Done | **87 slice 1** | Shared scoreboard contract + Live consumer merged via PR #535. |
| Done | **87 slice 2** | Featured + neutral-final consumer merged via PR #537; green-live settled on Overview. |
| Runnable | **Item 42 wiring pass** | All fact families and the consumed final-row scoreboard variant now exist; no Item 87 dependency remains. |
| Done | **PLATFORM-116 / Item 91** | Tied/stale/scoreless standings signal and pill removal merged via PR #539. |
| Runnable | **Item 90** | Remaining amber sweep and the `final` re-cut elsewhere. |
| 5 | **92** → **87 slice 4** | Records integration, then the watchlist anchor. |
| 6 | **017-PALETTE** | Reason and category hues. |

**Genuine blocker — only one:** Item 92 → watchlist anchor. PLATFORM-116 removed the pill blocker,
and POLISH-017 removed the notable-results scoreboard blocker. Everything else is preference.
Items 87 and 90 are independent.

---

## DESIGN.md amendment tracking through slices 1–2

1. **Landed — §Cards and game results:** scoreboard anatomy, away→home ordering with
   weight-not-position emphasis, and the state variants.
2. **Landed — §Color:** record amber live-clock badges and amber live-card borders as drift, make green the
   compact-scoreboard live treatment, and record the component-family enforcement clause.
3. **Partially landed — §Containerization:** the two-column game grid is documented; per-section
   progressive disclosure remains with the promotion/watchlist slices.
4. **Landed — §Responsive column degradation:** the game grid's container breakpoint is 760px.

### Design-time amendment outcomes

These began as judgment calls rather than conformance failures. Slices 1–2 settled all but the
section-title exception:

- **Still open — Amendment 5 / §Section headers:** decide whether 17px/650 becomes a deliberate
  game-section exception when the remaining stacked sections ship.
- **Landed — Amendment 6 / §Multi-line row pattern:** the scoreboard is documented as its own
  status-row-plus-two-peer-lines pattern.
- **Landed — Amendment 7 / §Cards:** anchors carry the state-relevant value and belong to the team
  line's primary identifier.
- **Landed — Amendment 8 / §Responsive:** the game-grid container breakpoint is 760px.

---

## Sequencing — the recap campaign

**Do not read campaign status from this document.** It has been wrong twice; the recap work moved underneath it both times. Verify against the repo at dispatch time.

026a–026f have all merged, and the request-time recap campaign is complete. **The "enrichment
stage" this document previously referenced does not exist as pending work.**

**What survives is the conclusion, for a different reason than originally given.** Notable-results scoreboards were never built — not in any recap slice, and not in 026b v3, whose scope was a data-seam rebuild rather than notable-results UI. `src/components/recap/` holds only `RecapPrimitives`, `RecapTile` and `WeeklyRecapSection`. So Item 87 still defines the scoreboard component, because nothing else has.

**Notable results home — decided.** The alternatives considered were:

- **Item 42's wiring pass absorbs them**, consuming Item 87's component. Correct on surface
  boundaries — notable results are recap UI, and putting recap UI inside Item 87 would cross
  surfaces the same way the amber sweep would have. POLISH-017 supplied the consumed final-row
  variant and additive context slot, so this portion is now unblocked.
- **Item 87 takes them as a fourth consumer.** Keeps component and consumers in one campaign, but Item 87 is already large enough to carry a pre-agreed split point, and it would own UI on a surface it otherwise does not touch.

**Decision:** the wiring pass absorbs them as its own slice. POLISH-017 removed its final-row
dependency, so every Item 42 portion is now independently runnable. That keeps surface boundaries
clean without blocking the rest of the wiring.

## Palette allocation — input to INSIGHTS-017-PALETTE

Two findings from this design fed the palette work. The component-family rule is now decided and
documented; category hues remain with INSIGHTS-017-PALETTE.

**1. Colour is context-scoped in this app already, and the doc does not say so.** Green appears in at least two shipped meanings, both correct and neither ambiguous in place:

| Surface | Element | Green means | Red counterpart |
|---|---|---|---|
| AP Poll | `↑8` beside a rank | moved up | yes — `↓2` |
| Standings row | `+1–0` beside a record | provisional / in progress | none — `+0–1` is also green |
| Overview compact scoreboard | `● LIVE` beside a clock | in progress | none |

The standings badge is direction-neutral not because valence is ignored but because *"in progress" has no negative counterpart* — the W–L inside the badge carries the valence, the colour carries the status. Red would be wrong there.

Green ships in at least **six** distinct meanings. The sharpest proof is a single file: `deltaTextColor` (`OverviewPanel.tsx:95-99`) greens a *positive* delta, `gbDeltaColor` (`:298-302`) greens a *negative* one — because gaining ground is good. Same token, opposite numeric signs, disambiguated purely by host element. Also shipped: success confirmations (`FeedbackForm.tsx:49`, `AdminAuthPanel.tsx:63`), win cells (`MatchupMatrixView.tsx:14`), positive point differential (`StandingsPanel.tsx:469`), and the provisional badge.

**Rule landed in DESIGN.md:** green reads as *up / active*, its precise meaning fixed by host element
and adjacent content, never by the colour alone. Red is its valenced counterpart only where a
negative state exists. **Enforcement clause:** *a hue carries exactly one meaning within a component
family; context scopes meaning across families, never within one.* That makes the `deltaTextColor` /
`gbDeltaColor` pair legal and a live/final pair inside one scoreboard family illegal.

**Consequence:** green-as-live is not a second claim on a reserved colour — it is the same meaning the standings badge already carries, applied where nothing else can carry it.

**Residual Item 90 work — re-cut the separate `GameScoreboard` family.** `GameScoreboard.tsx:68-71`
still renders `final` emerald and `inprogress` amber. Item 90 moves that family's final/live cases
together; it is not a prerequisite for Overview's distinct compact-scoreboard family.

**Scope correction — the collision was on Item 87's own surface.** `GameScoreboard` still renders on
Matchups and Postseason, but that is a different component family. On Overview, POLISH-016 removed
the Live badge call. POLISH-015 had already made the surviving watchlist call scheduled/unknown-only
by excluding both final and in-progress games. Featured was therefore the only remaining call that
could render green-final, and POLISH-017 retired exactly that call.

**Featured is a separate axis from state — resolved.** State moves games between sections; Featured exempts a game from that movement. A featured game enters when selected and stays through scheduled, live and final, so it appears **only** in the Featured tile, never in the state sections — preserving the promotion model's one-game-one-place rule rather than competing with it.

The tile states the reason with substance ("Whited leads Chamness 44–25"), not a bare label: a game earns promotion out of the weekly slate only if the reason is worth reading. **Capped at three** — at five it is another list with a nicer name, and the fourth competing list this campaign exists to remove. Games that do not make the cut still carry their notoriety tags in the watchlist, so nothing is hidden by the cap.

**This retires the only remaining `stateBadgeClasses` call site reachable by a final game.** The
watchlist call remains until slice 4, but its selector can supply only scheduled/unknown rows.
Overview therefore carries no green-final. The insights work retains ownership of Featured's
*selection and labelling*; Item 87 owns only how its rows render.

**Featured — what belongs in Item 87 and what does not.**

| Work | Owner | Rationale |
|---|---|---|
| Convert Featured's rows to the scoreboard component | **Item 87** | Same component family as Live and the only remaining reachable green-final badge call. Leaving it on old card styling would put two game-rendering treatments side by side on one page. |
| Retire Featured's `stateBadgeClasses` call | **Item 87** | Falls out of the conversion; removes Overview's last reachable green-final and unblocks green-live. |
| Reason label + substance line ("Whited leads Chamness 44–25") | **Insights work** | Requires insight-to-game binding that does not exist. Purely additive to the row, not a rework of it. |
| Selection — which games are featured | **Insights work** | See below. |
| Count, reset cadence, empty-state | **Insights work** | Follows selection. |

POLISH-017 shipped Featured as a converted list with its **current** selection and no reason line.
The mockup shows the **end state**, with out-of-scope elements marked inline in the markup (dashed
rule plus a "Not built in Item 87" tag) rather than only in the notes block — an implementer reads
the markup, not the annotations.

**Featured conversion was load-bearing, not optional.** The unblocked colour story depended on its
badge call dying. POLISH-017 completed that conversion; the surviving watchlist call cannot render
final/live state, so green-live no longer collides on Overview.

The double-touch is acceptable **because it is constrained**: slice 2's conversion must leave a slot the insights work fills, so the second pass is additive rather than a rewrite. This belongs in Item 87's acceptance boundary.

**Featured is the insights system with a game hook — not watchlist curation.** The watchlist asks *which games are worth watching*, on football criteria (rank, spread, matchup quality). Featured asks *which games activate something the league already knows*. The rivalry insight already ships in the feed ("Whited leads BHooper 44–25 — the most lopsided rivalry on record"); Featured is that same fact bound to a game about to be played between those two owners.

That places selection with the **insights pipeline**, not `prioritizeOverviewItems`. Consequences:

- **The criteria are the existing insight taxonomy, not a new one.** Reference frame × positional relationship — last season's standings, the previous week, current standings, all-time head-to-head, crossed with top-two, bottom-two, extremes, movers — maps onto the categories already generating feed items. No parallel criteria system.
- **Over-firing may already be solved.** The insight registry has priority and suppression machinery (`INSIGHTS-018`'s NEW tag and binary suppression gate). Featured should reuse it rather than invent a second calibration, which also removes the `RECORD-NOTEWORTHINESS-THRESHOLDS` parallel I drew earlier.
- **Colour inherits.** Featured reason labels are insight category eyebrows, so they take whatever `INSIGHTS-017-PALETTE` assigns — no separate hue decision for this tile.
- **Copy generates from the insight**, not from a game-specific template. Already the case for feed items.

**Filter — only pair-anchored insights qualify.** "Longest active title drought" has no game to attach to. Featured surfaces only insights whose subject is a pair of owners who happen to be meeting.

**New rule needed — suppress the feed duplicate.** An insight surfaced in Featured should not also appear in the insights feed that week, or the page states the same fact twice. Same one-place principle as the promotion model.

**Green-live shipped in Item 87 — no dependency on Item 90.** With the only Overview badge call
reachable by a final game retired, Overview carries no green-final, so green is unambiguous within
this campaign's surface. The residual green-final on Schedule (`GameScoreboard:68-71`) is a
*different* surface, which is the cross-family case context-scoping explicitly permits — and a
weaker adjacency than the `deltaTextColor` / `gbDeltaColor` pair that already coexists on one page.

**Item 87 owns its game-list surface.** Within Overview, slices 1–2 removed the Live and Featured
badge consumers, the Live section gradient/card-border drift, and shipped green-live. The watchlist
badge consumer remains scheduled/unknown-only until slice 4 removes that renderer.

**Correction resolved by PLATFORM-116.** The former `:677` pill lived in
`CondensedStandingsTable`, not the game lists. PLATFORM-116 fixed the tied/stale badge boundary and
retired that pill; Item 90 now sweeps only the remaining surfaces: `GameScoreboard`,
`GameWeekPanel`, `MatchupsWeekPanel`, `OwnerPanel`, `PostseasonPanel`, plus the `final` re-cut.

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

## Standings-panel correction — delivered by PLATFORM-116

The main record counts *finalised* games; the single green `+W–L` badge carries the provisional
result of in-progress games. Tied or temporarily scoreless live games render `+0–0`, stale reads
retain the last-known delta, and current attached game state controls whether the badge renders.
Final games roll into the canonical record and carry no live badge. The redundant `N live` pill is
retired.

### Not a colour defect

The green badge is direction-neutral by design — "in progress" has no negative counterpart, so the W–L inside the badge carries valence while the colour carries status. Red would be wrong there.

---

## Label semantics — placeholder warning

The mockup renders `Top matchup` and `Ranked spotlight` as eyebrow and title-row strings. **These are placeholders.** Item 87 (committed `dc1b934a`) records `Top matchup` as false: `gameTags.ts:441` fires it from `isTopOwnerGame` — true when *either* owner is top-three — while an identically-worded eyebrow elsewhere means "best game on the slate," and the two contradicted in production. Implementation must consume the renamed labels, not these strings. Hues are deferred to `INSIGHTS-017-PALETTE`; semantics are fixed by the Item 87 rename.

---

## Adjacent surface — Schedule page

Matchups → Schedule renders the same content shape this campaign redesigns: a matchup, an owner pair, and a status, currently as three-line cards with status-coloured borders and chips. Owner review flags it as wanting its own rework.

Two implications:

1. **The scoreboard component would have a third consumer** — recap notable results, Overview live/watchlist, and Schedule. That strengthens the case for defining the row contract generously now (three state variants, rank prefix, anchor slot, odds footer, reserved title row) rather than narrowly, since a third surface would otherwise widen it again.
2. **It is where the `final` green and much of the live amber actually live**, so the colour-correction item and a Schedule rework overlap. Worth deciding whether the colour sweep lands first as a narrow correction, or whether Schedule's rework absorbs it.

**Decided 2026-08-30: the rework absorbs it.** Implication 1 is why the decision could not wait for slice 5 — Schedule as a third consumer adds two state variants and a disclosure model, and slice 3 would otherwise lock a contract that slice 5 has to re-widen. The contract is widened above instead. Implication 2 is settled by narrowing Item 90 off `GameScoreboard` and `GameWeekPanel` entirely.

Filed as spun-off item E → Item 87 slice 5. (An earlier revision of this line pointed at item D, which is the team-records integration; that was a mis-reference.)

---

## Not in scope

Team logos; the upcoming-weekend recap tile view; selection/ordering logic; tag hue assignment (→ `INSIGHTS-017-PALETTE`); any change to `leagueRecords.ts`.
