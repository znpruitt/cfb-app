# Item 87 — Reference: Overview page composition

> **Status:** reference for the composition rules; the audit in §7 is proposed scope, not performed.
> Check `item-87-INDEX.md` before deciding from this document.
>
> **Scope:** how Overview's sections relate to each other. **Not** an element-by-element description — the game row is covered in `item-87-reference-game-row.md`, and duplicating it here would create two documents saying the same thing and drifting apart. This covers only what that document cannot: the page level.

---

## 1. What composes the page

| Zone | Contents | Governed by |
|---|---|---|
| **Elevated timely content** | draft banner, weekly recap tile | §4 — chrome exception |
| **Featured** | up to four must-watch games, state-agnostic | row reference §13 |
| **State sections** | Live, Recent finals, Upcoming watchlist | §2, §3 |
| **Standings** | GB Race chart, condensed standings table | not covered by this campaign |
| **Insights** | derived-insight feed | INSIGHTS campaigns |

This campaign governs the first three. The last two are named so a reader knows they are out of scope rather than omitted.

---

## 2. Section order, and why it is not conditional

**Featured → Live → Recent finals → Upcoming watchlist.**

Ordered by temporal distance from now: happening, just happened, coming up. That matches what a member is looking for at the moment they open the page during a slate.

**Live sits above the watchlist because live games are the only content with a deadline.** They change while you read and stop existing within hours. Upcoming games are stable and useful all week. Placing stable content above volatile content buries the thing that expires.

**The order is static; its behaviour is not.** Empty sections hide, so outside a slate Live is absent and the watchlist rises to the top on its own. The order asserts itself only when Live has content, which is exactly when it should. No reordering by day of week, no state machine — one static order whose behaviour changes because its inputs do.

Recent finals above the watchlist follows the same reasoning, weaker: a result an hour old is closer to now than a game three days out.

---

## 3. One game, one place

A game appears in exactly one section.

**Featured is the exception that proves it.** A featured game appears *only* in the Featured tile and is excluded from the state sections — it does not appear twice. That is what makes Featured orthogonal to state rather than a fourth section: every other section moves games between partitions as they progress, and Featured exempts a game from that movement entirely.

**Promotion between state sections is by game state**, not by section policy: scheduled → live on kickoff → recent finals on completion. Recent finals then uses **displacement** — it holds the N most recent completed games, pushed out by newer results. No clearing event, no duration to calibrate.

---

## 4. The elevated timely-content zone

The draft banner and the weekly recap tile carry card chrome — background fill, radius, padding — where the rest of the page uses hairlines and whitespace.

**This is a deliberate exception, recorded as one.** These are time-bounded editorial surfaces that appear, matter for a window, and disappear. Chrome marks them as not-part-of-the-steady-state. Applying the page's containerless treatment to them would make a thing that arrives and leaves look like a thing that is always there.

The exception is scoped to that zone. It is not a licence for chrome elsewhere, and the Schedule block fill in the row reference §9 is a different instrument for a different reason — grouping at density, not marking transience.

---

## 5. Progressive disclosure

Each state section renders a **bounded default** and expands in place.

**Two controls, two destinations, and they must not be confused.** The header link (`All matchups →`) navigates to another tab; the footer control (`Show N more`) expands the current section without leaving the page. A member should be able to predict which one keeps them here.

**Counts in section headings are totals, not visible counts** — the count answers *how much is there*, the expand control answers *how much is hidden*, and seven shown plus "Show 3 more" reconciles to ten.

**Not yet, though.** The current implementation reads `.length` after `.slice`, so the count is false. Making it a true total *before* the expand control exists would state that ten games exist while four are unreachable — the trend empty-state failure in numeric form. The real defect is the silent cap; the count is only how it surfaces. **Both land together in Item 115.**

---

## 6. The recap tile

A **two-state persistent slot**, not a section that comes and goes.

- **State 1, recap:** from week eligibility through Wednesday.
- **State 2, upcoming weekend:** from Thursday 06:00 ET. *Not built — future campaign.*

**The Thursday cutoff is fixed and calendar-only**, deliberately. It does not wait on game resolution, and there is no incomplete-week state. Week eligibility is likewise calendar-only: 06:00 ET the day after the week's last game-date, regardless of whether every game resolved. A date check at render, never inside a cached selector.

---

## 7. Proposed audit — Overview against its own decisions

**Not performed. This is scope for an item.**

The watchlist's six divergences from the mockup were found by looking at a screenshot, and all six came from one omission: decisions made during the Schedule and Matchups work were recorded as Schedule decisions and never applied back. See `item-87-followon-overview-back-application.md`.

**If back-application missed the watchlist, it plausibly missed the other sections.** Nobody has checked. That is a different exercise from writing a reference, and it is the one that determines whether more documentation is needed at all.

### What to check, per section

For **Live**, **Recent finals**, **Featured** and the **watchlist**, against `item-87-reference-game-row.md`:

1. **Status row** — is the tag in it, or stacked above? Is metadata beside the state, or on its own line? Is the tag right-aligned?
2. **Ordering** — matches §10 of the row reference?
3. **Anchor** — one per line, correct content for the state?
4. **Owner rendering** — `NoClaim` suppressed?
5. **Tags** — one vocabulary, bronze pills, capped at two, no tag restating its container?
6. **Final rows** — no date or time?
7. **Column tiers** — third tier present above 1300px?

At page level:

- **8. Section order** — matches §2?
- **9. Empty sections** — hidden, not rendered empty?
- **10. Disclosure controls** — header link navigates, footer control expands in place?
- **11. Chrome** — confined to the elevated zone?

### Expected outcome

Most divergences should already be attributable to a filed item — 115 for counts and caps, 119 for colour bars, 134 for the tier, 143 for the tag seam, 157 and 162 for tag vocabulary. **The audit's value is the residue**: anything that maps to no item is a genuine back-application gap, and that is what nobody currently knows the size of.

Findings that map to existing items should be recorded against those items rather than filed again.
