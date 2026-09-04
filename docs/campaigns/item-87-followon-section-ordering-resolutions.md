# Item 87 — Follow-on input: section ordering, resolutions

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

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

## Scope

Items 1, 2 and 4 change sorting; item 3 confirms a decision already recorded; item 5 defers to Item 115. None requires new derivation — kickoff, score availability and date are all present in the row data already.

## Mockup

`mockups/matchups-schedule-mockup.html` — BHooper's slate renders live → Fri Sep 4 → Sun Sep 6 → final, demonstrating rule 4. No final row carries a date.
