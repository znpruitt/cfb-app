# Item 87 — Follow-on input: three-column tier

> **Status:** input for review, not applied.

Adds a third column tier to the game-list grid on Overview. Extends the tiering recorded in `item-87-followon-matchups-schedule-design.md`, which established the container-query mechanism and the 760px single-column breakpoint.

---

## Decision

**Three tiers, driven by container width:**

| Container width | Columns |
|---|---|
| under 760px | 1 |
| 760 – 1300px | 2 |
| above 1300px | 3 |

**Where 1300 comes from:** the requirement is **1280** — three 400px columns plus two 40px gaps. The value is **1300**, which is that requirement plus **20px of deliberate headroom**. Page padding is deliberately not a term: `container-type: inline-size` queries the content box, so page padding is already excluded and adding it would double-count. At exactly 1300 the columns are 406.7px; at the page's 1440px max the content box is 1376px, giving 432px columns. 400px is the width the longest row needs without clipping — team name, record, owner suffix and right-anchored score. The stress case is a row like *Middle Tennessee State (3–5) Shambaugh · 13*; the mockup carries one in Live for exactly this reason.

The requirement is arithmetic and the 20px on top is a choice, stated so it is not mistaken for a term. Recomputing gives 1280, not 1300, and the gap is the headroom rather than an error. If the row anatomy changes — a sixth element on the team line, or logos taking the line-start slot — the minimum column width changes and 1300 moves with it.

**Rationale:** at two columns on a wide display, rows occupy roughly a third of their column and the rest is empty. The space is there.

---

## Two costs, accepted

**Row-major flow is less legible across three columns.** A kickoff-sorted section reads 1,2,3 / 4,5,6 rather than 1,2 / 3,4, and the eye resets further on each row, so the order feels less sequential. This is the same concern raised against two columns, amplified. Judged acceptable on inspection — three columns read cleanly at realistic content.

**The row saving is smaller than the column count suggests.** At the current cap of six live games, three columns saves one row over two. The meaningful gain arrives at full slate, which is also when ordering legibility matters most, so the two effects pull against each other.

---

## Consequences to check during implementation

**Orphan rows.** Section counts rarely divide by three. Five live games render as 3 + 2, leaving a gap in the final row. Acceptable, but worth confirming the gap sits on the right rather than centring the remainder — a centred orphan breaks the column alignment the grid exists to provide.

**Caps interact with the tier.** Caps are currently expressed as counts, not rows. Six live games is two full rows at three columns and three at two columns, but seven is 3 + 1 — a nearly-empty final row. If caps are meant to fill rows cleanly they need to be multiples of the column count, which makes them tier-dependent. Simpler alternative: leave caps as counts and accept ragged final rows.

**Matchups and Schedule are separate questions.** This tier is specified for Overview's game lists. Schedule carries far more rows and its own density argument; Matchups uses a two-column owner-card grid whose cards are wider than a scoreboard row. Neither inherits this automatically.

---

## Open

Whether Schedule adopts the same tier. Its rows are the same component, so the 1300px arithmetic holds, but sixty-plus games across three columns is a different reading problem from six — and Schedule's date grouping means each group renders its own partial final row.
