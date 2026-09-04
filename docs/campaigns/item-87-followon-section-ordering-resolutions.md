# Item 87 — Follow-on input: section ordering, resolutions

> **Status:** §1, §2 and §3 are shipped — POLISH-023, merged via PR #563 (`1546bbc8`), 2026-09-04. §3 is landed on Overview only and
> is now recorded in `DESIGN.md`, which previously said the opposite. §4 (Matchups slate ordering) and
> §5 (counts, deferred to Item 115) remain unbuilt. The sort rules below were added on 2026-09-04.

**Child of `item-87-followon-section-ordering.md`** — that document recorded six decisions found living only in mockup markup and left four items open. This one answers those four, plus the sequencing question on section counts. Read the parent first. Written after CLI verification established that five of the six section-ordering decisions were change requests against shipped behaviour, not documentation.

---

## 1. Live sorts by kickoff alone — no awaiting-score floor

**Rule: pure kickoff order, ascending. No partition of any kind.**

An earlier draft of this resolution proposed keeping awaiting-score rows at the bottom, so a blank row would not interrupt a column of live scores. **That is withdrawn.**

The question that undid it: when a score arrives, does the row jump to its kickoff position? Under a partition, yes — it vanishes from the bottom and reappears mid-list. That is a **reposition on a polling surface**. A member watching a game would see it move without having touched anything, which is considerably worse than the problem the partition solved.

The cost of pure kickoff is a scoreless row sitting among scored ones. Acceptable: the state is rare and brief — the post-kickoff gap, with no observed case of a game finalising without scores — so optimising layout for the exception at the price of repositioning the normal case was the wrong trade.

**Both shipped sort keys are removed.** `compareOverviewLiveItems` (`overviewGameSections.ts:124`) reduces to kickoff ascending.

---

## 2. The owner-count sort key is removed

Quantity of owners does not affect rank.

**What is lost:** games involving more owners currently float, which is a relevance signal — a two-owner game matters more to the league than a one-owner game.

**Why remove it anyway:** relevance-weighting makes the order unreadable. With kickoff, a member can tell *why* one game sits above another; with a hidden relevance key they cannot, and the section appears arbitrarily shuffled. Relevance already has a home — Featured exists to promote games out of chronological order, and that is the mechanism for it. Sorting is a legibility tool here, not a ranking tool.

---

## 3. Final rows show no date or time, on every surface

An earlier draft proposed a contextual rule — omit the date where a container supplies it, carry it otherwise — because Matchups owner cards have no date grouping. **That is withdrawn.** Matchups carries a tab-level week filter, so the card is already scoped to a known week.

**Rule stands as originally decided: no date or time on final rows anywhere.**

**Residual, accepted:** a week spans several game days, so the week tab recovers *which week* but not *which day* a final was played. Judged acceptable — for a completed game inside an owner's slate the result is the information, and the day is partially inferable from position under the rule below.

**One place the scoping argument does not hold — verified, needs a call.** `CFBScheduleApp.tsx:1896` passes `games={selectedTab === 'postseason' ? postseasonGames : filteredWeekGames}`. Only the regular-season path is week-filtered; the **postseason tab is not scoped to a week at all** — one card spans bowls and every CFP round. A postseason final there carries no date, no time, and no week, so nothing on the surface says when it was played. Either accept that too, or let the postseason tab keep a date on final rows.

---

## 4. Matchups slates: kickoff order, finals moved to the end

**Rule: non-final games first in kickoff order, then finals in kickoff order.**

**Why Matchups can reorder and Schedule cannot.** Schedule is grouped by date — games sit under "Saturday, Aug 29" headings — so chronology is structural there. Moving finals to the end would tear games out of their date groups and drop Saturday's results below Thursday's kickoffs. A Matchups owner card has no date grouping: one owner, one week, one list. Nothing structural depends on its order, so it is free to lead with what is still ahead.

The two views never show the same set — Matchups is one owner's subset per card, Schedule is every FBS game in a flat list — so this is not two views ordering one list differently.

**What converges is the rule, not the list.** Matchups applies "kickoff order, unresolved first." Once a week completes there is nothing unresolved, so it reduces to plain kickoff — the same rule Schedule uses throughout. A member learns one idea, *kickoff order with unfinished business pulled forward*, and it collapses to plain kickoff wherever nothing is unfinished. That is why this is not a third ordering paradigm despite appearing to be one mid-week.

---

## 5. Section counts wait for Item 115

**Keep counts visible-only until the expand control ships.**

The current state is already a truth defect: `liveTitle` reads `.length` after `.slice(0, 6)`, so "Live · 6" against ten live games is false. But making it a total *before* Item 115 exists produces a worse failure — the UI would state that ten games exist while four remain unreachable, which is a promise it cannot keep. That is the trend empty-state failure in numeric form: copy telling a member data exists when there is no path to it.

**The real defect is upstream of the label.** Sections hard-cap at six and drop the surplus silently — that is silent data loss, and the count is only how it becomes visible. Fixing the count without fixing the cap fixes nothing.

**Recommend:** counts become totals as part of Item 115, in the same change that makes the surplus reachable.

---

## Sort rules, all three sections

Added 2026-09-04. None of these directions were written down anywhere before — they existed only in
code and in how the mockups happened to render, which is the same gap that produced the
section-ordering findings in the first place.

| Section | Order | Tiebreak |
| --- | --- | --- |
| **Live** | kickoff **ascending** | game key |
| **Upcoming watchlist** | `watchlistPriority` (curation), then kickoff **ascending** | game key |
| **Recent finals** | kickoff **descending** — newest first | game key |
| **Featured** | kickoff **descending** — newest first | game key |

**Live is unselected, so time is the only legible order.** It holds every in-progress game with no
curation applied; ordering by anything else leaves a member unable to tell why one row sits above
another. No awaiting-score partition (§1) and no owner count (§2).

**One place §2 does not reach, and it is not a sort key.** The watchlist keeps `watchlistPriority`
above kickoff. Every owner-count key is gone: Live, Recent finals, the watchlist's `item.priority`
tiebreak, and **Featured** — `compareRecentResultItems` (`selectors/overview.ts`), removed by owner
ruling 2026-09-04.

**Why Featured lost it too, after being argued for.** The case for keeping it was that Featured is
the relevance surface, so a relevance key belongs there. That holds only for signals someone *chose*
as relevance. Owner count was never chosen — it is the same tiebreak that had leaked into three other
sections, arriving in Featured by inheritance. It was also worse than a sort key: `selectFeaturedGames`
slices the order without re-sorting, so at the cap a two-owner game displaced a one-owner game sharing
its kickoff, letting an unchosen signal decide what appears at all rather than merely where. And with
`NoClaim` truthy, a NoClaim-vs-real-owner final scored `priority: 2`, indistinguishable from a genuine
two-owner game — the signal was not measuring what it claimed to. Featured's real selection is
Item 113's insight-anchored work; leaving owner count until then meant a placeholder quietly doing
that job with nobody's endorsement.

**Carry into Item 113:** specify what *does* promote rather than leaving a vacuum. An unclaimed slot
in a selection pipeline is how owner count got there in the first place.

**Why the watchlist keeps its score.** The
watchlist is already a selected list — something decided those games were worth showing — so
ordering by the reason they were chosen is the visible logic of the section rather than a hidden key.
It also matters structurally: with Featured capped at four, the watchlist is where notable games that
miss the cut land. Going chronological would let *Upset watch* and *Game of the Week* mark a game
without surfacing it, and the near-misses would sit wherever their kickoff put them, defeating the
tags. What was removed is the `item.priority` tiebreak BELOW kickoff — `awayOwner && homeOwner ? 2 : 1`
(`overview.ts:77`), an owner-count key by another name.

**Recent finals sorts by kickoff, not completion time — deliberately.** Completion is more literally
accurate about "recent": an overtime noon game genuinely finishes after a 3:30 game. But completion
reintroduces movement — rows reshuffle as games end, and an overtime game can jump above a row a
member is reading. Kickoff fixes a game's position the moment it starts, which is the same reasoning
that rejected the awaiting-score partition on Live. **Accepted cost:** a long noon game stays below a
3:30 game despite finishing later.

**Direction is pinned by test.** An ascending/descending flip is the entire behaviour of a section,
trivial to introduce, and invisible in review — nothing else distinguishes correct from exactly
backwards.

---

## Noted while removing the owner-count keys — `NoClaim` counts as an owner

`item.priority` was `awayOwner && homeOwner ? 2 : 1`, and `NoClaim` is a truthy string, so an unowned
FBS team counted as an owner for that key. Deleting the key removes the symptom, not the pattern:
this is the **third** place the sentinel is read as a real owner, after `showOwnerMatchup`
(`gameWeek.ts:152`) and the render seams POLISH-021 fixed. Three instances argue that `displayOwner()`
— or an equivalent guard — belongs at the data seam rather than only at render seams. Not built here;
recorded so the next occurrence is the fourth data point rather than a fresh discovery.

---

## Scope

Items 1, 2 and 4 change sorting; item 3 confirms a decision already recorded; item 5 defers to Item 115. None requires new derivation — kickoff, score availability and date are all present in the row data already.

## Mockup

`mockups/matchups-schedule-mockup.html` — BHooper's slate renders live → Fri Sep 4 → Sun Sep 6 → final, demonstrating rule 4. No final row carries a date.
