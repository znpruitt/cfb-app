# Item 87 — Follow-on input: back-applying the shared-row decisions to Overview

> **Status:** input for review, not applied. Check `item-87-INDEX.md` before deciding from this document.
>
> **Reference mockups:** `mockups/live-scoreboard-mockup.html` (Overview), `mockups/matchups-schedule-mockup.html`.

---

## The finding is one omission, not six divergences

Overview's watchlist diverges from the mockup in six ways. All six were decided during the Schedule and Matchups work, recorded in `item-87-followon-presentation-decisions.md`, and **never applied back to Overview**.

The mechanism is understandable and worth naming, because it will recur: the decisions were made *while working on* Schedule, so they were recorded as Schedule decisions even though every one is a property of the **shared row**. Overview had already shipped, and nothing prompted a revisit.

**This is the discharge problem inverted.** That one was work completed and unmarked. This is a decision recorded and unapplied. Both come from the same gap — nothing tracks whether a cross-surface decision reached all the surfaces it governs.

---

## The six, ordered by effect on reading

### 1. Tags stack above the row instead of sitting in the status row

**The one that changes how the page reads.** A card with two tags is a line taller than a card with one, so the two columns fall out of alignment with each other. Visible at a glance in the current build: the Oklahoma/Michigan card sits at a different height from Ohio State/Texas beside it.

Everything else here is a difference you notice on inspection. This one you notice immediately.

### 2. Metadata occupies its own line rather than sitting beside the state

`Sat, Sep 12, 11:00 AM · FOX` takes a full line. The decision puts state, kickoff and broadcast together in the status row with the tag right-aligned, so the entire header is one line.

### 3. Tags are not right-aligned

They sit left, so their position shifts with tag count and label length instead of forming a column down the right edge.

**Carry the implementation note:** `margin-left: auto` silently fails at column width, because auto margins only absorb free space and a tagged row at two or three columns has none. The working approach is a left group that grows (`flex: 1 1 auto; min-width: 0`) with the tag `flex: none`. This behaves the same whether the row is roomy or overflowing, and whether or not metadata is present — which matters on Overview, where some rows are tag-only.

### 4. Two tag vocabularies in one row

`GAME OF THE WEEK` renders as plain blue uppercase text; `Top 25 Matchup` renders as a title-case chip. Same slot, same row. **Filed as Item 157** — the watchlist is its clearest instance.

### 5. Team identity slot

**SUPERSEDED 2026-09-10.** Item 119's colour bars were retired after the owner walkthrough. The
shared row instead renders 28px CFBD logos across Overview, Matchups, Schedule and Postseason.

### 6. No third column tier

Two columns at a width the mockup renders three.

---

## Two things that are not gaps, because the mockup does not cover them either

**`Contender Watch` appears on four of six games.** A tag carried by most rows in a section distinguishes nothing — the same problem the recap's `HEAD-TO-HEAD` tag has, and the same rule applies: *a tag that restates its container is suppressed*. Whether the container here is the watchlist itself or the selection criterion needs deciding.

**Vertical spacing between cards is looser than the mockup uses.** Schedule tightened this when games became discrete blocks; Overview never did.

---

---

## Two label cuts, agreed and unfiled

### Retire `Ranked Team`; keep `Top 25 Matchup`

`Ranked Team` beside `#25 Missouri` restates what the row shows. A single rank is visible; the tag adds nothing.

**`Top 25 Matchup` stays.** An earlier draft proposed shortening it to `Top 25`, which is wrong: the two tags encode different facts — `Top 25 Matchup` means *both* teams are ranked, `Ranked Team` means *one* is. "Top 25" alone reads as a property of the game and would fire equally on `#1 Ohio State` against an unranked opponent, collapsing the distinction. "Both ranked" is not derivable at a glance the way one visible rank is, so that tag is carrying real information and the word "Matchup" is what carries it.

*Recorded because the shortening looked obviously right and is not.*

### `Streaming · ACC Extra` → `ACC Extra`

The prefix does not help a reader who does not recognise the name, and is redundant for one who does. It is also inconsistent: FOX and ESPN2 carry no equivalent qualifier, so the label appears only when the answer is less familiar — backwards.

Practical benefit: it is the longest metadata string on the surface and the first thing that truncates once metadata moves into the status row. Cutting the prefix removes about half of it.

**Verify first** that no broadcast value is genuinely ambiguous without the qualifier — a regional network name that reads like something else. If none are, the prefix has no case.

## The durable fix — record surfaces when a shared-row decision is made

The back-application item closes this instance. It does not stop the next one.

**A decision about the shared row should name the surfaces it governs at the point it is recorded** — Overview, Matchups, Schedule, recap — so a later reader can check whether it reached them rather than assuming. That is cheap to add and it is what would have caught this.

Concretely: `item-87-followon-presentation-decisions.md` currently reads as a Schedule and Matchups document because that is where the work happened. Every decision in it about the status row, the tag slot, or row anatomy applies to all four surfaces. Adding a surfaces line to each section costs a few minutes and makes the omission visible next time.

---

## Scope

Mostly mechanical, and it overlaps Item 143 — the tag-in-status-row seam does not exist yet, so items 1, 2 and 3 above are blocked behind the same component work Matchups and the recap are waiting on. Item 157 owns item 4; the shared-row logo decision supersedes item 5.

**Sequence it after 143.** Filing it now so the omission is recorded rather than rediscovered from a third screenshot.
