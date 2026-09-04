# Item 87 — Follow-on input: decisions that existed only in mockup markup

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

Records six decisions that existed only in mockup markup, never in any document. Filed in response to a CLI report that Live's placement above the watchlist was never dictated by the plan; an audit of both mockups against the doc set found five more.

---

## Two things called "promotion"

These were conflated, and only the first was specified.

**Game promotion between sections** — a game occupies exactly one section and moves as its state changes: scheduled → live on kickoff → recent finals on completion. **Specified** in the base addendum, implemented, not in question here.

**Section ordering on the page** — where Live, Recent finals and the watchlist sit relative to one another. **Never specified.** The mockups render Live above the watchlist; the shipped page had the watchlist above Live. The mockup was treated as authoritative on a point no document had decided.

---

## Proposed order

**Featured → Live → Recent finals → Upcoming watchlist.**

Ordered by temporal distance from now: happening, just happened, coming up. That matches what a member is looking for at the moment they open the page during a slate.

**Why Live above the watchlist.** Live games are the most time-sensitive content on the surface — they change while you are reading and stop existing after a few hours. Upcoming games are stable and remain useful all week. Placing stable content above volatile content buries the only thing with a deadline.

**Why this is self-managing rather than a fixed hierarchy.** Empty sections hide. Outside a slate Live is empty and disappears, so the watchlist rises to the top without any conditional ordering logic. The order only asserts itself when Live has content, which is exactly when it should. No reordering by day of week, no state machine — one static order whose behaviour changes because its inputs do.

**Why Recent finals above the watchlist.** Same reasoning, weaker. A result an hour old is closer to now than a game three days out. Recent finals also empties under the displacement rule, so it too withdraws on its own.

---

## The other five, now decided

### Live section is ordered by kickoff time

Earliest kickoff first. **Game progress is explicitly not a sort input** — quarter and clock describe where a game is, not when it started, and sorting by them would reshuffle the section continuously as games advance.

This makes one rule across every surface: Schedule sorts by kickoff, Live sorts by kickoff. Previously the mockup rendered live games in no order at all (Q2 2:46, Q1 2:37, Q3 11:02, Q4 6:18…), which was an absence of a decision rather than a decision.

### Section counts are totals, not visible counts

"Live · 10" means ten live games exist, of which some may be hidden behind the expand control. The count answers *how much is there*; the expand control answers *how much is hidden*. Seven shown plus "Show 3 more" reconciles to the heading.

A visible-count would restate what is already on screen and leave the total expressible only inside the expand label. Same rule for the Schedule filter chips: per-state totals.

### No "Why these →" link on the Featured tile

Removed. It appeared in the mockup with no destination and no mention in any document — an affordance invented while arranging a page. If Featured's selection ever needs explaining, that is a decision to make deliberately, not one to inherit from a placeholder.

### Relative date labels: "Today" only

"Today" is the sole relative label. No "Yesterday" or "Tomorrow"; every other group heading is absolute ("Saturday, Aug 29"). Mixing more than one relative label makes a schedule harder to scan, not easier, because the reader has to hold two frames of reference at once.

### Final rows show no date or time

A final row displays "Final" and the score. No kickoff time, no date.

**Consequence, accepted:** the kickoff sort becomes invisible on final rows, since the value it sorts by is not displayed. An earlier draft argued the opposite — that hiding the sort key makes the order look arbitrary. Overridden: for a completed game the result is the information, and nobody audits sort order. Date-group headings still carry the date, so the day is never ambiguous.

On Overview the shipped surface carrying a time on a final row is **Featured**, not Recent finals. `FeaturedGamesList` renders `state="final"` with `clock={formatExpandedKickoff(...)}` (`OverviewPanel.tsx`); that is the "Final · 4:47 PM" row. Recent finals already passes `clock: undefined` through `GameCardList` and is compliant today. The rule therefore removes the Featured time and leaves Recent finals unchanged, with its recency ordering likewise implicit.

**Where the date-group mitigation does not reach.** Schedule groups by date (`date-head`), so the day survives there. Matchups owner slates and Overview Recent finals are flat lists with no date grouping, and the matchups mockup removes `Sat, Aug 29` from a final row inside an ungrouped owner card — that game's day becomes unrecoverable on the surface. Carried to Open.

---

## Resolved: this is a change request, not documentation

The CLI report was about **shipped behaviour**, read from `OverviewPanel.tsx` rather than from any plan. Implementation did not follow the mockup. Verified against `main` at `1d593654`:

| # | Decision | Shipped today | Handling |
| --- | --- | --- | --- |
| 1 | Featured → Live → Recent finals → Upcoming watchlist | Featured `:1644` → Upcoming watchlist `:1671` → Live `:1702` → Recent finals `:1731`, static JSX with no reordering logic | Change request — two moves, not one |
| 2 | Live sorts by kickoff; progress not a sort input | `compareOverviewLiveItems` (`overviewGameSections.ts:124`) sorts in-progress before awaiting-score FIRST, then real-owner count DESC, then kickoff | Change request; deletes two existing sort keys |
| 3 | Counts are totals | `liveTitle` reads `gameSections.live.length` AFTER `.slice(0, OVERVIEW_LIVE_LIMIT)`, so it is a visible count | Change request, and see below |
| 4 | No "Why these →" link | Never shipped; the string appears nowhere in `src/` | Documentation only |
| 5 | "Today" is the only relative label | No relative label ships at all; every date is absolute | Additive; constrains Item 87 slice 5 |
| 6 | Final rows show no date or time | Recent finals already compliant (`clock: undefined`); Featured is not | Change request scoped to Featured |

**Decision 3 is also a live truth defect, not only a labelling preference.** There is no expand control on Overview today — Item 115 is unbuilt — so each section hard-caps at six and the surplus is dropped silently. "Live · 6" with ten live games is currently a false count with no affordance that reveals the other four. Making the count a total before the expand control exists states the truth but leaves four games unreachable; the honest pairing is decision 3 landing with Item 115, or the count staying visible-only until it does.

---

## Open

**Does the awaiting-score row keep a floor in Live?** Decision 2 deletes the in-progress-before-awaiting key that puts awaiting-score rows at the bottom of Live today. Under a pure kickoff sort an awaiting-score game with an early kickoff sorts to the TOP of the section, above games with live scores. The base addendum (`:86`) settled that awaiting-score rows stay in Live and read "Awaiting score"; it did not settle where in Live. The live mockup places the awaiting row last, which is consistent with kickoff order only because its kickoff happens to be the latest. Decide: pure kickoff, or kickoff within a scored-first partition.

**Is dropping owner-count ordering from Live intended?** The second shipped key ranks games by how many real owners they involve, floating league-relevant games. Decision 2 removes it without naming it. That may be correct — the section is a scoreboard, not a curation surface, and Featured already carries relevance — but it should be an explicit trade rather than a side effect.

**How is a final's day recovered where there is no date grouping?** Decision 6 leans on date-group headings, which exist on Schedule and not on Matchups owner slates or Overview Recent finals. Options: accept that a completed game's day does not matter on those surfaces; or keep the date and drop only the time where grouping is absent.

**What orders a Matchups owner slate?** Decision 2 claims one rule with Schedule, but the matchups mockup runs an owner card Live → Final → Sun Sep 6 → Fri Sep 4 — state-grouped, not chronological. Either that is a seventh decision to record, or the owner slate should sort by kickoff like everything else.

---

## The pattern worth fixing

This is now six decisions found living only in mockup markup — one reported by the CLI, five more surfaced by auditing the mockups against the doc set afterwards. It follows the Featured contradiction and the contract widenings that referenced a document never committed. A mockup is a visual reference, and readers reasonably treat everything in it as decided, including choices made by default while arranging a page.

**Suggested check:** when a mockup is committed, anything in it that is not stated in a companion document is not a decision. Either write it down or mark it in the markup as unresolved, the way the Featured reason lines were tagged out-of-scope. The cost of missing one is a plan and an implementation that disagree without either side being wrong.
