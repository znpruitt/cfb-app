# Item 87 — Addendum: Live / Watchlist Scoreboard Treatment

> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.

**Status:** Slices 1–2 shipped via POLISH-016 / PR #535 and POLISH-017 / PR #537; Item 91 shipped via
PLATFORM-116 / PR #539; Item 90 shipped via POLISH-018 / PR #541; the records prerequisite is
implemented by PLATFORM-117. Slice 3 shipped via POLISH-019 / PR #549 (`751a86b4`), 2026-09-01;
slices 4–5 remain planned.

> **STATUS SUPERSEDED (verified 2026-09-08):** "slices 4–5 remain planned" is stale. Slice 4 merged via PR #558
> (`c730b4d0`), slice 5a via PLATFORM-087 / PR #570 (`4caa1a79`, 2026-09-05), slice 5 via
> PLATFORM-087-SLICE-5-ITEM-112 / PR #572 (`f424222a`, 2026-09-05), and slice 5b via PR #575 (`fef083ae`,
> 2026-09-06). The slice table under *Implementation slices* and the *Sequencing across campaigns* table are the
> record; this header is not. Item 119's team-colour work was retired in favor of the 28px shared-row
> logo on 2026-09-10. Item 115 expansion merged in PR #744; Item 134's third-column tier is in
> pre-merge closeout under PLATFORM-678, and only the Item 143 Matchups divergences remain open on
> this surface.

**Reference mockup:** `mockups/live-scoreboard-mockup.html`
**Related:** `INSIGHTS-026b-RECAP-LAYOUT-v1` (dispatched). Shares the scoreboard micro-component — see Sequencing.

> **SUPERSEDED (verified 2026-09-08):** "dispatched" is stale — 026a–026f have all merged; see *Sequencing — the recap
> campaign* below. The recap's adoption of the shared row is now `item-87-followon-recap-scoreboard.md` (2026-09-08).

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
- **The team-record anchor joins on provider team id, never on name.** The row resolves each side's W-L through `ScheduleItem.homeId` / `awayId` (`src/lib/schedule/cfbdSchedule.ts:133`, populated at `:737` and persisted in the durable schedule cache) against the year-scoped records cache, which is keyed by the same `teamId`. **When the id is null, render no anchor** — do not fall back to a name lookup. A name-keyed join would walk straight back into the collision surface PLATFORM-114 closed: `Missouri S&T` normalises onto `Missouri State`, so a D-II school's opponent would render an FBS team's record on an FBS matchup. Absent and `0-0` are different facts and must render differently; a Week 1 scheduled game legitimately shows `0-0`.

> **DISCHARGED (verified 2026-09-08):** the exact-id join ships at the server boundary, not in the row —
> `src/lib/selectors/teamRecordsClient.ts:58-59` resolves each side through `awayId` / `homeId` against the
> `teamId`-keyed cache, names are never a fallback, and a side whose provider id is absent is omitted (no anchor).
> The browser receives `{ wins, losses }` per provider game id (PLATFORM-139 v3; `DESIGN.md` → *A team record is
> ALWAYS the team's record TODAY*).

#### CFBD id namespaces — verified live 2026-08-31

CFBD uses **one team-id namespace** across endpoints. The field name reflects only what the row is *about*, not a different identifier:

| Endpoint | Field | Why the name differs |
| --- | --- | --- |
| `/records` | `teamId` | one team per row — no role to qualify |
| `/games` | `homeId` / `awayId` | two teams per row — role-qualified |
| `/teams` | `id` | the row *is* the team |

Probe: `/records?year=2025&team=Alabama` → `teamId: 333`; `/games?year=2025&week=1&team=Alabama` → `awayId: 333, awayTeam: "Alabama"`. Same id, both endpoints. So `ScheduleItem.homeId` → records `teamId` is a direct numeric join with no translation layer.

**`/games.id` is the GAME id, not a team id.** One payload carries three namespaces at once:

    { id: 401752665, venueId: 3697, homeId: 52, awayId: 333 }

Team ids are two-to-three digits, venue ids four, game ids nine — so a crossed join fails loudly rather than returning a plausible wrong row. Do not rely on that; the magnitudes are an accident, not a contract.

**All three ids are already load-bearing, and the exact-id-never-name rule is established, not new here:**

- **Game id** — `ScheduleItem.id` is `String(game.id)` (`cfbdSchedule.ts:730`), the row's primary key; `/games/media` joins by it (`schedulePresentationJoin.ts:171`). *Caveat:* it falls back to a name-derived `${week}-${homeTeam}-${awayTeam}` when the provider omits `game.id`, so the row key is provider-id-when-available and name-derived otherwise — latent, and Item 83's territory.
- **Venue id** — persisted conditionally, and venue details attach ONLY through the exact numeric `venueId`, never by name (`schedulePresentation.ts:9`, `schedulePresentationJoin.ts:213`).
- **Team ids** — `scoreboardMatch.ts:45-48` and `gameStats/evidenceAuthority.ts:307-327` already match on exact oriented `homeId`/`awayId`.

The record anchor is the third consumer of this discipline, not the first.

#### State variants — widened for Schedule (slice 5), 2026-08-30

Slice 5 makes Schedule the component's third consumer. Its surface carries states Overview never shows, so the contract is widened **now**, before slice 3 implements against it, rather than being re-widened later — the failure *Adjacent surface* warned about.

- **`disrupted`** — postponed / canceled / suspended / delayed. Currently `GameScoreboard:54-78` matches these by regex on `score.status` ahead of the state switch. Rose.
- **`placeholder`** — an unfilled bracket slot with no resolved teams. Violet.

> **SUPERSEDED (verified 2026-09-08):** neither `disrupted` nor `placeholder` shipped as a scoreboard state. Slice 5
> (PLATFORM-087-SLICE-5-ITEM-112, PR #572) measured 11,311 production schedule rows across 2024–2026, found no
> provider disrupted status, and the owner rejected both branches as unreachable rather than contractual (registry
> entry). The shipped state set is `scheduled | live | final | awaiting` (`src/lib/selectors/gameWeek.ts:18`); a
> placeholder bracket slot renders as `scheduled` with the admin override behind tier 2. `GameScoreboard:54-78`
> no longer exists — that component was deleted wholesale by slice 5.

- **Disclosure.** Schedule rows are `<details>`/`<summary>` with a collapsed summary and an expanded body (`GameWeekPanel:268` uses `group-open:hidden`). The row must support an optional expanded region without the collapsed form changing shape. Overview and recap pass no expanded content and render exactly as they do today.
  > **DISCHARGED (verified 2026-09-08):** shipped as the non-reserving `tier2Slot` (`CompactGameScoreboard.tsx:30`,
  > `:254-255`, slice 5a) consumed by Schedule's More/Less `<details>` (`GameWeekPanel.tsx:182`).
- **Slot passthrough.** Schedule attaches odds, a debug affordance, byes, postseason grouping, and an admin postseason-override control. These are Schedule's, not the row's: the row exposes slots, and does not learn about any of them.

`disrupted` and `placeholder` are **states, not emphasis** — distinct from `cardEmphasisClasses` (`GameWeekPanel:39-50`), where amber means `upset` alongside `upset_watch`→orange and `top_25_matchup`→indigo. That function is emphasis and is out of scope for every slice here.

> **SUPERSEDED (verified 2026-09-08):** the exemption is retired. Slice 5 deleted `cardEmphasisClasses` with the card
> chrome it lived on (zero occurrences in `src/`); the eyebrow pill carries `upset` emphasis forward
> (`item-87-followon-matchups-schedule-design.md` → *This answers the amber `upset` border*). Recording that
> retirement as a decision in `DESIGN.md` or the registry is still open — INDEX CARRY row 4.

### Promotion model

A game occupies exactly one section: **Scheduled → Live on kickoff → Recent finals on completion.**
Sections hide when empty. Two `INSIGHTS-026b` boundaries must not be conflated: recap eligibility
begins at 06:00 ET the day after the week's last game-date, while Recent finals clears only when the
shared `selectWeeklyRecapTileState` flips to `upcoming` at **Thursday 06:00 ET**. Item 101 in
[`docs/next-tasks.md`](../next-tasks.md) tracks the non-blocking season-boundary gap created by that
Thursday expiry; the boundary itself is settled for slice 3.

**Reconstruction decision — abandonment is a gate, not a score-state cell.** `Live` means kickoff
has been established and the game has not been abandoned. Before the router switches on score
state, it derives the authoritative per-game pending shape and calls `hasGameBeenAbandoned`
directly. Any unresolved row whose confirmed kickoff is more than eight hours old is excluded,
including a score pack stranded on an in-progress label. Do not use `selectPendingGameFinality`:
that selector deliberately answers the population-level question "can this whole week be treated as
concluded?", while the Overview router asks where one row belongs. Positive in-progress score
evidence continues to outrank a contradictory future schedule timestamp; the abandonment gate
applies whenever the confirmed kickoff itself has passed.

`gameStateFromScore` (`gameUi.ts:51`) returns a fourth value, `unknown`. **Decided:** a future kickoff routes to the watchlist. A past kickoff with no usable score — **including a score pack labelled `Final` that is missing either numeric team score** — stays in the Live section and reads "Awaiting score" for the bounded eight-hour gap, moving to Recent finals only when a usable final score attaches and becoming excluded if the gap outlives the abandonment gate. This awaiting-score-in-Live-section treatment is accepted and closed. DESIGN.md `:51-52` prescribes exactly this copy for the bounded post-kickoff gap and forbids both "Upcoming" and an unsupported "Live" claim; routing to Recent finals would assert the game finished, a stronger misstatement than either forbidden string. The row therefore uses a neutral `awaiting` scoreboard state with no Live label, green dot, or live DOM state; the Live badge remains reserved for rows carrying attached in-progress scores. The section title and count remain Live because the routing model defines that section as games whose known kickoff has passed and which have not been abandoned. Shown rather than hidden: a visible game with an absent score is more honest than a silently missing one. **Placement confirmed:** "Awaiting score" sits in the game-level status row rather than a per-team anchor, since it describes the game rather than either side.

Provider disruption labels remain an unreachable sub-case of scheduled under the current CFBD-only
production path. Keep the cheap defensive guard, preserve the exact label if one ever appears, and
build no special tone, ordering, or lifecycle around it. The normal provider disruption path is a
deleted schedule id plus a replacement id; Item 63 owns that reconciliation.

**No per-game recap deduplication — settled 2026-09-01.** Recent finals is **complete**: every recent
result. The recap is **curated**: the subset worth narrating. A game in both is listed once and
narrated once — two roles, not duplicated data. The one-place rule governs the three sections of this
surface, not the boundary between a listing and a summary.

The only recap interaction is the section-level, time-based handoff above. The shared
`selectWeeklyRecapTileState` use is a **time predicate**, not recap-data coupling: one Thursday
boundary is intentionally reused so two definitions cannot drift. This is distinct from the deleted
per-game deduplication. **Do not suppress individual finals against recap content, and do not
reintroduce a subtler version.** Item 101 owns the non-blocking season-boundary gap that can follow
expiry; it does not change slice 3's cutoff.

Attempts to do so produced roughly eight findings across four review rounds of POLISH-019, each fix
creating the opposite edge (paint-then-remove → withhold → collapse-on-refresh). The structural
reason: **a selector can only infer what the user sees.** `tileHighlights` sits behind "View full
recap" and is not rendered at all when `ownerLines` is empty, so suppression removed results from
BOTH surfaces. Suppressing a complete list against a selective one necessarily leaves holes, because
the selective one never intended to cover everything.

*If duplication ever proves visually annoying:* surface recap highlights in the collapsed tile so
visibility becomes a fact rather than an inference, then dedup against what is actually rendered.
That is a Featured/recap design change with its own review — not slice work.

**Closeout of two review follow-ups.** Direct visible-markup coverage for the
`renderMatchupLabel` home/away separator (`Texas @ Rice`) was restored in POLISH-019. The proposed
`CFBScheduleApp.initialNowMs` production follow-up was retired after a route audit confirmed that
the only route defaulting to Overview supplies `Date.now()`, sibling routes select non-Overview
modes, and the unconditional mount effect advances the client clock before a later Overview switch.
Making the prop compile-time-required remains possible future hardening, not an open production
defect from this slice.

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

> **SUPERSEDED (verified 2026-09-08):** "team lines anchored by **per-team spread**" in the card spec above is the
> superseded side; the anchor bullet two lines below it and the owner decision of 2026-09-02 (next section) put the
> **record** in the anchor, and the owner ruling of 2026-09-08 (recorded under that decision) leaves the anchor
> **blank** when no record is available. "Games with no posted line render the reason there instead" is also
> superseded: the odds footer renders **empty** (2026-09-02, below).

#### Owner decision, 2026-09-02 — the record anchors, and a missing line is simply empty

Settles the slice-4 gating question ("what do the team-line anchors show when both record and spread
are absent?"). **That intersection does not exist**, because the two live on different rows:

- **The team-line anchor is the RECORD, always.** `0-0` is factually accurate for an unplayed team and
  is what renders. Do not substitute the spread, and do not suppress it as uninformative — the mockups
  called for records and they stay.
- **The odds footer is a separate row.** A game with no posted line renders **an empty row** — no
  invented fallback, no `———`, no promotion of another value into the anchor slot.

So there is no third rung and no ladder: the record cannot be absent in practice, and the odds footer
is allowed to be empty because it is not an anchor.

Measured the same day: the record side is complete — **all 138 FBS teams carry a record** (zero
withheld by the cache), and 122 of 138 read `0-0` on opening weekend, which is correct rather than a
gap. The odds side was NOT complete when the question was asked — half of week 1 was missing a line
because of the matching defect in Item 106 — and after PLATFORM-122 shipped, **98 of 99 week-1 games
carry a line**. The empty-odds row is therefore rare, not the common case it appeared to be. The one
remaining gap (UMass @ Rutgers) is aggregator coverage we cannot recover.

**Follow-up decision, 2026-09-02 — if the records read FAILS ENTIRELY, leave the anchor blank.** Not
"this team has no record" (which does not occur; all 138 FBS teams are covered) but the whole durable
read failing or the prop being absent. In that state the team line renders with **no anchor — a blank
hole** — rather than falling back to the spread. This is a deliberate owner exception to
`DESIGN.md:95` ("every row needs a right-edge anchor") for a rare failure state; it is not an
oversight and should not be "fixed" by a later reviewer. Records must degrade, never take a page
down.

The earlier reading of a record → spread → fallback LADDER was a misreading of the card spec above:
the spread substitutes for the anchor only when a record is genuinely unavailable, which the
measurement shows does not occur for FBS teams.

**Owner ruling, 2026-09-08 — blank governs, and it is the settled rule.** Reaffirmed during Item 144 after the
spread fallback was found still stated at four places in this document (the card spec above, *Consequence* in the
next section, the slice-5 *Sequencing* note, and the slice table's row 4). Each is now marked. The reasoning to
carry: **the anchor holds one kind of fact per state**, and a spread sitting in a record's slot misrepresents what
the slot means — a reader cannot tell a record from a line. **Missing data beats wrong data.**

**But the two "unavailable" conditions are NOT the same and must not be collapsed.**

- A **store failure** is transient. It needs no item; the anchor is blank until the next read succeeds.
- **"Not wired to this surface"** is a **sequencing state**. It needs a filed item, and the dependency must be
  stated in the prompt (INDEX CARRY row 1). Collapsing the two licenses shipping a permanently blank column and
  calling it correct degradation.

**What Week 2 forced, recorded so it is not re-derived:** a rule written for occasional failure behaves
differently when it applies to every row on a surface. On Matchups in Week 2 (all scheduled, records unwired) every
anchor was blank, and "correct degradation" and "shipped incomplete" rendered identically — nobody could tell
them apart (`item-87-followon-matchups-gap-analysis.md` §1.1). That argues for **sequencing records before a
surface ships**, not for accepting the blank.

### Records across scoreboard states — resolved

Folded in from `item-87-followon-records.md`; the mockup reflects it.

| State | Anchor | Record position |
| --- | --- | --- |
| Scheduled | **team record** | the anchor itself |
| Live | score | **inline**, parenthetical after the team name |
| Final | score | **inline**, parenthetical after the team name |

Scheduled rows have no score, so the record takes the anchor and spread + O/U sit on the odds
footer. Live and final rows have the anchor occupied by the score, so the record moves inline —
`#14 USC (7–1) · Chamness · 21` — which is standard CFB scoreboard placement. Markup order is
rank → team → record → owner.

**Finals carry the POST-GAME record, including the result being read.** A stale record on a final is
bad data handling, and a post-game record is conventional everywhere in the sport.

**One rule, not two.** The record shown is always the team's *current* record — never "entering"
versus "after". A scheduled row shows the current record, which is pre-game by definition; a final
shows the current record, which includes the result. No state-dependent branching in the data layer.

**The position shift is accepted.** The record sits in the anchor on scheduled rows and inline on
live and final rows, so its position varies by state. Weighed and accepted: the watchlist is
legitimately a different layout, and the anchor consistently holds whatever number matters most in
that state. *Rejected alternative:* record inline in every state with the scheduled anchor given
back to per-team spread. That buys a stable record position at the cost of an anchor that no longer
holds the most relevant number, and it reverses the decision to put spread and O/U together.

**This resolves the apparent tension** between "the anchor holds a record … any state" above and
Amendment 7's "anchors carry the state-relevant value": both are true, because they describe
different slots. The anchor always holds the state-relevant value; the record is always present,
in the anchor or inline.

**Consequence — the records dependency is now campaign-wide, not watchlist-only.** When the CFBD
integration was split out it fed one section; records now appear in every scoreboard state.
PLATFORM-117 (PR #543, `9376521e`) has since landed the data and a cache-only reader, so this is a
wiring dependency rather than a blocker. Degradation — **which applies only when a record is unavailable, never in
the normal case** — stays clean in both directions — live and final
rows omit the inline parenthetical, scheduled rows anchor on per-team spread with O/U alone on the
footer — and no row loses its right-edge anchor.

> **PARTLY SUPERSEDED (verified 2026-09-08):** the live/final half stands (omit the inline parenthetical). The
> scheduled half is overridden by the owner decision of 2026-09-02 and the ruling of 2026-09-08 above: a scheduled
> row with no record renders a **blank anchor**, not the spread, and that row **does** lose its right-edge anchor —
> a deliberate, recorded exception to `DESIGN.md` → *Right-edge anchor rule*. Shipped behaviour agrees: "if the
> team-record store is unavailable, no record renders" (`DESIGN.md` → *A team record is ALWAYS…*).

**State this in the implementation prompt:** a build with records absent or stale will not match the
mockup, and a reviewer comparing them must read that as a sequenced dependency rather than a defect.
PLATFORM-118 closes the two record-freshness gaps that made this dependency concrete; see its v2
entry in `docs/prompt-registry.md`.

> **LIVE OBLIGATION (verified 2026-09-08) — INDEX CARRY row 1.** Records render on Overview only. `DESIGN.md`
> records them intentionally absent from Schedule until that surface adopts the Item 139 projection, and Item 117
> shipped Matchups with records out of scope. Both surfaces are in the "not wired" sequencing state defined by the
> 2026-09-08 ruling above, so every prompt touching them carries this sentence.

### Layout

- **Responsive game grid**, following existing precedent rather than introducing it. Row-major flow
  matches `RecapPrimitives.tsx:75`.
  > **EXTENDED by PLATFORM-678 (pre-merge closeout 2026-09-11):**
  > `item-87-followon-three-column-tier.md` adds a third tier at 1348px on Overview. One column applies
  > below 760.01px, two below 1348px, and the exact 760.01px endpoint belongs to the two-column tier.
- **Container query at 760px**, per DESIGN.md `:120` preferring container over viewport queries. The doc specifies the mechanism but no value; three disagree in code (640 `FeaturedGamesList`, 821 recap, 760 here). 760 is chosen on content width — below it each card gets under ~350px, which clips team + owner + anchor on the longest rows. See Proposed amendments.
- **Progressive disclosure per section:** bounded default, expands in place. Header link → Matchups tab; footer control expands this week's slate.
  > **MERGED via Item 115 / PR #744:** Live, Recent finals, and Watchlist show six items by
  > default and expand independently in place; Live's heading count reads the complete collection.
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

> **SUPERSEDED (verified 2026-09-08):** the table and "only the watchlist remains bespoke" describe the state before
> slice 4. `GameSummaryList` was removed by slice 4 (PR #558); the watchlist, Live, Featured and Recent finals on
> Overview, Schedule (slice 5, PR #572) and Matchups (Item 117, PR #581) all consume `CompactGameScoreboard`. The
> recap's own `RecapPrimitives` scoreboard is the last bespoke game row, and
> `item-87-followon-recap-scoreboard.md` (2026-09-08) brings it onto the shared contract. The **must-not-fork** rule
> is standing and unchanged.

---

## Open decisions

1. **Featured selection — partially decided; the rest belongs with the insights pipeline. Filed as Item 113, not built.**
   - **Cap: settled at FOUR — merged 2026-09-03 via PR #559 (`ce75380b`)**, independently of the rest of this reframe. Scarcity is the point, and Featured is a curated subset rather than a complete list. Four rather than the three argued here because a CFP first round and quarterfinal are four games each; at three, one game of a round is demoted into Recent finals and loses its round badge and kickoff line. Games that miss the cut still carry their notoriety tags in the watchlist.
   - **Copy tone: resolved.** "Toilet bowl" is established TSC terminology already used by the insights system, not a phrase this design introduces. Constraint that follows: Featured copy should **inherit league vocabulary from the insight generators** rather than invent parallel phrasing for the same concepts, or the app describes one thing two ways on a single page.
   - **Still open:** reset cadence (weekly, or can a game stay featured across weeks); whether zero qualifying games hides the tile or shows an empty state; which insight categories are pair-anchorable, and whether any new generators are needed.
2. **Recap notable results — team records: deferred, not rejected.** Records add flavour on the Item 87 scoreboard, so the same likely holds for the recap, but there is no reason to couple the recap's enrichment stage to PLATFORM-117's cache. Work it in later as an additive change.

   *Resolved:* the record shown is always the team's **current** record — not "entering" versus "after". A scheduled game shows the current record, which is pre-game by definition; a final shows the current record, which includes the result just read. Standard CFB scoreboard practice, and a stale post-game record is bad data handling. One rule, no state-dependent branching.

### Resolved since validation

- **Team records confirmed** and ship as the scheduled-state anchor (see Data).
- **Section migration is immediate.** A finalising game moves to Recent finals at once, including while a section is expanded. Live surface; staleness is worse than motion. Expansion state itself survives a refresh — only the content changes beneath it.
  > **CORRECTED 2026-09-11 by the #676 read receipt, on two counts.** (1) The migration claim was
  > unqualified and is not universally true: a final selected by the results-based Featured selector
  > (`selectors/overview.ts:548-565`) is excluded from all three state sections
  > (`selectors/overviewGameSections.ts:207`, pinned by *a Featured game remains outside all three
  > state sections*, `overviewGameSections.test.ts:435`). **The accurate statement is that a
  > finalising NON-FEATURED game moves to Recent finals immediately**; a Featured-selected final
  > moves to Featured and stays out of Recent finals. That one-place partition is deliberate and is
  > preserved. (2) The survival citation read `useLiveRefresh.ts:443`, which does not resolve — the
  > file is `src/components/hooks/useLiveRefresh.ts` and names `router.refresh()` only in a comment.
  > The mechanism was re-verified against the installed Next 15.5.24 refresh reducer, which applies a
  > Flight patch to the current route tree and navigates only if the root layout changes, so an
  > unkeyed client descendant is reconciled rather than remounted. **Two defects in one sentence is
  > why standing rule 7 exists.**
- **`unknown` state** stays in Live with "Awaiting score", per DESIGN.md `:51-52` (see above).

---

## Spun-off work — items to file

Five bodies of work surfaced during this design that are **not** Item 87's surface. Filing them explicitly so none is lost in a scope note, and so Item 87's boundary stays clean.

### A → Item 90. Shared status label + `final` re-cut — **delivered by POLISH-018 / PR #541**

**Narrowed when slice 5 was filed.** The original scope covered every surface Item 87 does not replace, Schedule included. Schedule's colour is now absorbed by slice 5, so this item drops `GameScoreboard` and `GameWeekPanel` entirely: converting a pill slice 5 deletes is throwaway work.

**Scope, as narrowed.** Extract Overview's live treatment (`CompactGameScoreboard:66-77` — borderless uppercase text, hue-carrying, `size-1.5` dot for live) into one shared status label in `src/lib/gameUi.ts`, and adopt it on the surfaces with no rework planned:

- `OwnerPanel` — `toneClasses:34-44`, rendered at `:170` and `:198`.
- `MatchupsWeekPanel` — status text `:266` + dot `:271`; `performanceClasses:80-93`; `ownerCardSurfaceClasses:125-129`; and the `inprogress` branch of `ownerOutcomeRowClasses` (`:110-111`) **only**.
- `OverviewPanel` — `stateBadgeClasses:176-182`, rendered at `:816`. Slice 4 replaces this row, but the change is one line through the shared helper and the watchlist is the highest-traffic surface, so it is taken now rather than waiting on the records prerequisite.
- `CompactGameScoreboard:66-77` becomes a consumer of the extracted label. Leaving the canonical copy inline is what let this conversion go partial in the first place.

**Also in scope:** `gameUi.ts:70-87` `statusClasses` is **dead** — exported, called nowhere, referenced by no test, carrying both live-amber and final-emerald. Delete it; the shared label takes its place.

**`MatchupsWeekPanel` keeps a neutral live label with its existing pulse.** Same shape as everywhere else, different hue: that component spends green on `finalWin` (`:113`, against `finalLoss`:115 rose), so an emerald live label would put green on two meanings inside one component (`DESIGN.md:139-141`). Not an exception — `DESIGN.md:321` already scopes green to the *compact-scoreboard* family, and this is an outcome family. Elsewhere the dot does not pulse; the pulse appears only where hue cannot carry live.

**Green must end up meaning one thing per component.** `MatchupsWeekPanel` violates this today: `performanceClasses:84` final→emerald, `ownerCardSurfaceClasses:125` final→emerald, `ownerOutcomeRowClasses:113` finalWin→emerald. Once `final` goes neutral, emerald must appear exactly once in that file and rose exactly once. Assert it.

**Leave alone:** champion amber at `OverviewPanel:423`/`:429`; the standings-direction indicator `:593`; coverage-error text `:1583`; `cardEmphasisClasses:39-50` (`upset`, not live); `recap/RecapPrimitives.tsx:277`, which defines its own local `GameScoreboard` and is not a consumer.

**Correction to the filed item.** `docs/next-tasks.md` Item 90 states POLISH-016/017 removed Overview's live-amber and its `stateBadgeClasses` green-final. They removed them from the Live and Featured sections only — the *Upcoming watchlist* still calls `stateBadgeClasses` at `:816`. The item also omits `gameUi.ts` and miscites `GameWeekPanel:42` as a live site when that line is `upset`.

**Accepted residual:** Schedule keeps green-`final` and amber-live until slice 5 lands.

> **DISCHARGED (verified 2026-09-08):** slice 5 landed (PR #572); Schedule renders the shared neutral-final /
> green-live row and the legacy `GameScoreboard` family is deleted.

**Implemented outcome:** POLISH-018 extracted the four-tone label, converted all four narrowed
consumers, deleted the dead and bespoke status-class helpers, preserved Matchups' neutral
freshness-gated pulse, and restored accessible contrast by pairing zinc-300 final with the dimmer
zinc-400 unknown. Merged via PR #541 (`9a45e1f3`), 2026-08-31.

**Item number: 90.** Cross-reference Item 87 slice 5 (absorbs the Schedule half) and PLATFORM-117.

### B → delivered by PLATFORM-116. Standings-panel live-signal derivation

**Delivered:** tied and temporarily scoreless in-progress games now contribute a zero-decision
delta, Overview reads the last-known value behind a current-game-state gate, and the `N live` pill
is gone. `selectFreshOwnerPendingDelta` keeps its fresh-only contract for Standings and Members.
The work remained separate from Item 90's cross-component color sweep and merged via PR #539.

### C → delivered by POLISH-015. Overview watchlist/live duplication

**Delivered:** the interim selector excludes in-progress games from the watchlist and pins that boundary with regression coverage. Item 87 supersedes the predicate with a structural promotion model; do not reimplement the interim fix as a separate slice.

### D → delivered by PLATFORM-117 and hardened by PLATFORM-118. CFBD team-records integration

**Delivered cache contract:** one normalized year-wide snapshot under `team-records/<year>`, keyed by
provider `teamId` and carrying `classification`, conference, and the total W-L-T record. The
cache-only reader and `refreshTeamRecords({ year })` accept any year directly; neither depends on
canonical game ids, an active season, or the season registry. Slice 4 owns the first render and the
direct numeric-ID join — PLATFORM-117 deliberately shipped no consumer.

**Bounded cadence:** a newly committed final in the existing `live-scores` cron still invokes the
records authority, and an independent hourly QStash heartbeat now invokes it without claiming a
finalisation. The authority owns both inputs: a durable six-hour provider-call floor permits a
finalisation-triggered refresh, while an independent twelve-hour ceiling guarantees clock-based
recovery. The floor bounds a 31-day month to `ceil(31 × 24 / 6) = 124` `/records` calls even though
744 hourly deliveries can arrive; a healthy quiet slate uses about 62. The cache-age diagnostic is
fourteen hours and assumes that hourly job remains unpaused. Item 96 owns generalized diagnostic
applicability and delivery-warning behavior when in-season jobs are paused.

**Reader reliability:** a row is creditable only when `wins + losses + ties == games`. The reader
withholds an uncreditable W-L-T value while preserving its team id as a distinct reliability signal;
it never derives or repairs the provider record from app score data.

**Independent health:** records opens its own `records` + `year` provider-refresh attempt and uses
its own operator toggle. A records failure cannot relabel scores. The hourly job has its own
`team-records` execution receipt and scheduler-health row; the finalisation signal inside
`live-scores` remains valuable and unchanged.

### E → Item 87 slice 5. Schedule page rework

**Filed 2026-08-30**, having previously been left unfiled pending something forcing it. What forced it: scoping Item 90 as a narrow colour correction on Schedule required inventing a shared status label, a six-tone vocabulary, and a dot affordance the surface has never had, plus a decision on whether the live ring survives. That is a presentation rework under a colour sweep's name. The scope grew because the surface is dated, not because the colours are.

**Problem statement.** Schedule renders the same content shape this campaign redesigns — a matchup, an owner pair, a status — as three-line cards with status-coloured borders and pill chips. It is space-inefficient, it is the last surface still using the pre-campaign presentation, and it holds the residual green-`final` and most of the residual live-amber.

**Scope.** Schedule (`GameWeekPanel`, `GameScoreboard`) adopts the scoreboard row, two-column and all, against the widened state contract above. Colour settles as part of the rework; Item 90 no longer touches these files. Scope also reaches `MatchupsWeekPanel` for the carried-over item below — that file is a different week view mode, not the one being reworked, so it is named here deliberately rather than folded in silently.

**Acceptance boundary.** The collapsed row is the scoreboard row. `disrupted` and `placeholder` render as states, not emphasis. Expand/collapse, byes, postseason grouping, odds, debug and the admin postseason override all survive unchanged — the row exposes slots and learns about none of them. No amber remains for live; no green remains for `final`. `PostseasonPanel:78` inherits via `GameWeekPanel` and is a verification surface only.

**Carried over from POLISH-018 — `ownerOutcomeRowClasses` sibling asymmetry.**

POLISH-018 (PR #541, `9a45e1f3`) excluded `MatchupsWeekPanel`'s outcome branches, but its acceptance criterion was written as a raw occurrence count — *"emerald must appear exactly once in that file"* — and `finalWin` carried emerald **twice**, on the border and on the background. The only way to satisfy the count was to drop one, so the background tints went:

| tone | before | after |
| --- | --- | --- |
| `finalWin` | `dark:border-l-emerald-500/70 dark:bg-emerald-950/10` | `dark:bg-zinc-950/10` |
| `finalLoss` | `dark:border-l-rose-500/70 dark:bg-rose-950/10` | `dark:bg-zinc-950/10` |
| `finalSelf` | `dark:border-l-violet-500/70 dark:bg-violet-950/10` | unchanged |

The semantic border hues survived and nothing renders wrongly; the `/10` tint is subtle and its loss is arguably cleaner. **The defect is the asymmetry** — three sibling branches now differ with no stated reason, `finalSelf` keeping a tint its two siblings lost.

**Resolve it either way — restore both tints, or drop `finalSelf`'s for symmetry — but resolve it.** Do not leave the three inconsistent. State the reason for whichever is chosen in the closeout, so the next reader is not left re-deriving it.

> **DISCHARGED (verified 2026-09-08):** resolved for symmetry by slice 5 ("the declared Matchups result-tint
> correction", registry PLATFORM-087-SLICE-5-ITEM-112). All three final tones now carry `dark:bg-zinc-950/10` with
> only the border hue differing (`src/components/MatchupsWeekPanel.tsx:96-102`). The rail itself is the subject of
> `item-87-followon-matchups-gap-analysis.md` §2. Its former dependency on Item 119's left edge was
> superseded by the 2026-09-10 logo decision; the rail/tint duplication itself remains.

**The process note is the more useful half:** the criterion was a proxy for "green means one thing in this component", and optimising the proxy changed the thing the exclusion existed to protect. A count over a file is a proxy — write the invariant, not the count.

**Sequencing.** Implement after slices 3 and 4; its *contract requirements* are folded in above so
slice 3 does not lock a three-state row. PLATFORM-117 now supplies the scheduled-state record cache;
the spread remains the normal fallback when a record is unavailable.

> **PARTLY SUPERSEDED (verified 2026-09-08):** the ordering held (slice 5 shipped after 3 and 4). "The spread remains
> the normal fallback" is overridden by the 2026-09-02 decision and the 2026-09-08 ruling under *Watchlist card*:
> a missing record leaves the anchor blank.

---

## Implementation slices — Item 87

Ordered so colour settles once rather than shipping neutral live and flipping it later.

| # | Slice | Notes |
|---|---|---|
| ✅ 1 | Scoreboard component + Live section | Merged via POLISH-016 / PR #535 (`5fd59d39`), 2026-08-30. The component shipped with its first live consumer and no speculative state variants. |
| ✅ 2 | Featured conversion + retire its `stateBadgeClasses` call + green-live flip | Merged via POLISH-017 / PR #537 (`e0a7b8ab`), 2026-08-30. Featured now consumes the neutral-final variant, and green-live is unambiguous on Overview. |
| ✅ 3 | Recent finals + promotion model | Merged via POLISH-019 / PR #549 (`751a86b4`), 2026-09-01. |
| ✅ 4 | Watchlist | Merged via PR #558 (`c730b4d0`). Consumes PLATFORM-117's cache by exact `teamId`. *(Was: "with the spread fallback when a record is unavailable" — superseded 2026-09-02 / 2026-09-08: a missing record leaves the anchor blank.)* |
| ✅ 5a | Shared-component contract widening | Merged via PLATFORM-087 / PR #570 (`4caa1a79`), 2026-09-05. `CompactGameScoreboard` gained the mutually exclusive rank/FCS prefix, neutral-site metadata, broadcast across its settled state set, and a non-reserving tier-2 slot. Overview stayed structurally identical; the contract is in `DESIGN.md`. |
| ✅ 5 | Schedule rework | Merged via PLATFORM-087-SLICE-5-ITEM-112 / PR #572 (`f424222a`), 2026-09-05. Filed 2026-08-30 (was *Not filed*). Schedule adopts the scoreboard row, two-column and all, and its colour settles as part of the rework rather than via Item 90. Shipped WITHOUT the `disrupted` / `placeholder` state variants (rejected as unreachable, see above). |
| ✅ 5b | Card-owner row modifier | Merged via PLATFORM-087-SLICE-5B-CARD-OWNER-ROW / PR #575 (`fef083ae`), 2026-09-06. `isCardOwnerTeam` neutral tint with squared facing corners; consumed by Item 117 (PR #581). |

**Risk order:** watchlist anchor (external data) > promotion model (state transitions mid-slate, section migration) > two-column grid against the header-nowrap contract. Slices 1–2 are low-risk and independently verifiable.

**Pre-agreed split point:** if Item 87 exceeds sizing signals mid-build, break after slice 2. Agreeing this now rather than discovering it at review.

**Acceptance boundary on the Featured double-touch:** slice 2's conversion must leave a slot the insights work fills, so the second pass is additive rather than a rewrite. State this explicitly in the implementation prompt.

> **DISCHARGED (verified 2026-09-08):** POLISH-017 shipped the conversion with the additive `contextSlot`
> (`DESIGN.md` → *An optional context slot immediately before the status row*). The insights pass is Item 113.

---

## Sequencing across campaigns

| Order | Item | Why |
|---|---|---|
| Done | **POLISH-015** | Interim duplication, chronological ordering, and empty-copy correction merged via PR #531; Item 87 supersedes the implementation. |
| Done | **87 slice 1** | Shared scoreboard contract + Live consumer merged via PR #535. |
| Done | **87 slice 2** | Featured + neutral-final consumer merged via PR #537; green-live settled on Overview. |
| Done | **87 slice 3** | Recent finals, mutually exclusive routing, bounded abandonment, and neutral Awaiting score presentation merged via PR #549 (`751a86b4`). |
| Done | **87 slice 4** | Watchlist converted to the shared scoreboard with server-prop records, one odds footer, single-column mobile, and renamed highlight/chip labels. Merged via PR #558 (`c730b4d0`). Row disclosure is a settled decision that this slice does not implement. |
| Runnable | **Item 42 wiring pass** | All fact families and the consumed final-row scoreboard variant now exist; no Item 87 dependency remains. |
| Done | **PLATFORM-116 / Item 91** | Tied/stale/scoreless standings signal and pill removal merged via PR #539. |
| Done | **Item 90 / POLISH-018** | Shared label and neutral-final re-cut merged via PR #541. Schedule remains with slice 5. |
| Done | **PLATFORM-117** → **87 slice 4** | Records cache implemented; the watchlist owns the first consumer. *("Done → next" corrected 2026-09-08: slice 4 merged via PR #558.)* |
| Done | **87 slice 5a / 5 / 5b** | Contract widening (PR #570), Schedule rework (PR #572), card-owner row (PR #575). Matchups adopted the row as Item 117 (PR #581, 2026-09-07). |
| 6 | **017-PALETTE** | Reason and category hues. |

**The former data blocker is resolved:** PLATFORM-117 supplies the watchlist record anchor.
PLATFORM-116 removed the pill blocker, and POLISH-017 removed the notable-results scoreboard
blocker. Items 87 and 90 are independent.

---

## DESIGN.md amendment tracking through slices 1–2

1. **Landed — §Cards and game results:** scoreboard anatomy, away→home ordering with
   weight-not-position emphasis, and the state variants.
2. **Landed — §Color:** record amber live-clock badges and amber live-card borders as drift, make green the
   compact-scoreboard live treatment, and record the component-family enforcement clause.
3. **Landed — §Containerization:** the two-column game grid is documented;
   Item 115 / PR #744 adds per-section progressive disclosure without changing the grid tiers.
4. **Landed — §Responsive column degradation:** the game grid's container breakpoint is 760px.

### Design-time amendment outcomes

These began as judgment calls rather than conformance failures. Slices 1–2 settled all but the
section-title exception, closed below once slice 4 shipped the remaining stacked sections.

- **Landed — Amendment 5 / §Section headers.** Owner decision 2026-09-03, evaluated against the
  mockups after slice 4 shipped: 17px/650 is the deliberate game-section exception, recorded in
  `DESIGN.md` → Section Headers. This closes the trigger this amendment was waiting on.
  > **THIS MARK BECAME TRUE ON 2026-09-08, AND IT HAD BEEN ASSERTING IT SINCE 2026-09-03.**
  > "Landed" recorded that the DOCUMENT amendment landed; no code ever implemented it, and
  > `git log -S'text-[17px]' -- src` returned **zero commits** for the five days in between. Item 178
  > built it (`SectionHeader`'s opt-in `gameSection` prop, Overview's four game-section headers).
  > Recorded rather than quietly corrected because this is the campaign's third instance of a
  > canonical claim that was never true — after `DESIGN.md`'s uncapped-chips line and
  > `tailwind.config.ts`'s inert `darkMode: 'media'` (Item 159) — and a document that was never true
  > is worse than one that drifted: nothing in its history marks a moment of change, so no reader has
  > cause to distrust it. **The owner ruled BUILD IT, not retract it: a rule is retired when the RULE
  > is wrong, never because the code disagrees.** The discharge lesson is the one to carry — an
  > obligation marked complete is a claim about the CODE, and marking it from the document side is
  > how it went unnoticed.
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

> **See also (2026-09-08):** `item-87-followon-recap-scoreboard.md` records the owner ruling that the recap's results
> section adopts the shared row anatomy. That document is indexed on its own landing, not here.

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

**Schedule residual after POLISH-018.** `GameScoreboard.tsx:68-71` still renders `final` emerald and
`inprogress` amber. Item 90 was narrowed away from that family before implementation; Item 87 slice
5 owns both colors as part of the Schedule rework.

> **DISCHARGED (verified 2026-09-08):** slice 5 deleted `GameScoreboard.tsx`; no green-final or amber-live remains
> on Schedule. The same applies to the two *residual* paragraphs later in this section.

**Scope correction — the collision was on Item 87's own surface.** `GameScoreboard` still renders on
Matchups and Postseason, but that is a different component family. On Overview, POLISH-016 removed
the Live badge call. POLISH-015 had already made the surviving watchlist call scheduled/unknown-only
by excluding both final and in-progress games. Featured was therefore the only remaining call that
could render green-final, and POLISH-017 retired exactly that call.

**Featured is a separate axis from state — resolved.** State moves games between sections; Featured exempts a game from that movement. A featured game enters when selected and stays through scheduled, live and final, so it appears **only** in the Featured tile, never in the state sections — preserving the promotion model's one-game-one-place rule rather than competing with it.

**"Resolved" names the decision, not the delivery.** Nothing below this point is built: today's Featured is a plain finals-only selector with no insight involvement. Filed as **Item 113** in `docs/next-tasks.md`, 2026-09-03.

The tile states the reason with substance ("Whited leads Chamness 44–25"), not a bare label: a game earns promotion out of the weekly slate only if the reason is worth reading. **Capped at three** — at five it is another list with a nicer name, and the fourth competing list this campaign exists to remove. Games that do not make the cut still carry their notoriety tags in the watchlist, so nothing is hidden by the cap.

> **SUPERSEDED (verified 2026-09-08):** the cap is **four**, settled 2026-09-03 via PR #559 (`ce75380b`) on the
> CFP-round argument — see *Open decisions* item 1 above and `item-87-followon-featured-intent.md`.

**This retires the only remaining `stateBadgeClasses` call site reachable by a final game.** The
watchlist call remains until slice 4, but its selector can supply only scheduled/unknown rows.
Overview therefore carries no green-final.

> **DISCHARGED (verified 2026-09-08):** slice 4 removed the watchlist call; `stateBadgeClasses` has zero
> occurrences in `src/`. The insights work retains ownership of Featured's
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
retired that pill. POLISH-018 then swept the narrowed shared-label consumers: Compact scoreboard,
Matchups, Members, and Overview. It deliberately left Schedule to slice 5 and recap to its local
primitive.

**Residual risk, accepted:** Schedule keeps green-final while the shared label uses green-live until
slice 5 replaces that separate family. The mismatch is confined to different pages and remains
explicitly owned by the filed rework.

**Rationale for neutral `final` still holds:** under the promotion model sections carry state, so a Final chip is redundant reinforcement and neutral is the correct resting treatment.

> **ADOPTED (verified 2026-09-08):** bronze is the settled eyebrow treatment, as pills — decided in
> `item-87-followon-matchups-schedule-design.md` → *Eyebrow tags — bronze, rendered as pills*, shipped on Schedule
> (`GameWeekPanel.tsx:17-18`, `#c9a66b` / `#dbc190`) and Matchups (Item 117). **Overview's eyebrow is still
> `text-blue-300`** (`OverviewPanel.tsx:755`, chip `:195`) and no item owns that conversion — a queue finding from
> Item 144. Final hue assignment for insight categories remains with 017-PALETTE.

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

> **DISCHARGED (verified 2026-09-08):** slice 4 shipped the renamed highlight/chip labels (PR #558); neither
> `Top matchup` nor `Ranked spotlight` appears as a literal anywhere in `src/`. The mockups still carry the
> placeholder strings, as this warning says they would.

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
