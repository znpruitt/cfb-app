# Item 87 — Follow-on input: three-column tier

> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
>
> **Status:** implemented by `PLATFORM-678-OVERVIEW-THREE-COLUMN-CODEX-v2`; pre-merge closeout.

Adds a third column tier to the game-list grid on Overview. Extends the tiering recorded in `item-87-followon-matchups-schedule-design.md`, which established the container-query mechanism and the 760px single-column breakpoint.

> **INDEX (verified 2026-09-11): DISCHARGED** for Overview (Item 134), with one mis-citation: the container
> query and the 760px breakpoint were established in `item-87-live-watchlist-scoreboard.md` → *Layout*, not in the
> Matchups/Schedule design document.

---

## Decision

**Three tiers, driven by container width:**

| Container width | Columns |
|---|---|
| `< 760.01px` | 1 |
| `>= 760.01px` and `< 1348px` | 2 |
| `>= 1348px` | 3 |

The lower boundary preserves the existing `@max-[760.01px]` expression. Tailwind emits that maximum
as a strict `< 760.01px` query, so exactly 760.01px belongs to the two-column band; the required
integer checks remain one column at 760px and two at 761px.

**Where 1348 comes from:** the working column width is a **416px target, not a minimum**. Its sources
are not equally strong and must not be collapsed into an unexplained equation: **400px is unmeasured
prose** in `mockups/live-scoreboard-mockup.html`, described there as a comfortable row width and never
measured in production; **16px** is that mockup's historical `.sb-line` left padding; only the
replacement **32px** `pl-8` logo slot comes from shipped code. Thus the inherited target is
`400 - 16 + 32 = 416px`; three targets, two 40px gaps, and 20px deliberate headroom give
`3 × 416 + 2 × 40 + 20 = 1348px`. Page padding is not another term because the container query sees
the content box.

The required browser gate compiles the production `globals.css` and tests the compact scoreboard at
760/761, 1347/1348, and the 1392px reference container using the app's effective
`ui-sans-serif, system-ui, ...` stack. On the verified macOS host the stress row uses 268.094px and
retains 104.844px before the right-anchored score at 1348. Those measurements are host-specific by
design: the gate checks the production stack of the environment that runs it rather than imposing a
test-only typeface. The slack was reported rather than used to silently revise the owner-authorized
target.

**Rationale:** at two columns on a wide display, rows occupy roughly a third of their column and the rest is empty. The space is there.

---

## Two costs, accepted

**Row-major flow is less legible across three columns.** A kickoff-sorted section reads 1,2,3 / 4,5,6 rather than 1,2 / 3,4, and the eye resets further on each row, so the order feels less sequential. This is the same concern raised against two columns, amplified. Judged acceptable on inspection — three columns read cleanly at realistic content.

**The row saving is smaller than the column count suggests.** At the current cap of six live games, three columns saves one row over two. The meaningful gain arrives at full slate, which is also when ordering legibility matters most, so the two effects pull against each other.

---

## Consequences to check during implementation

**Orphan rows.** Section counts rarely divide by three. Five live games render as 3 + 2, leaving a gap in the final row. Acceptable, but worth confirming the gap sits on the right rather than centring the remainder — a centred orphan breaks the column alignment the grid exists to provide.

**Caps interact with the tier.** Caps remain counts, not rows. Six live/recent/watchlist games make
two full rows at three columns; Featured deliberately remains capped at four and therefore renders
`3 + 1`. That last item stays in column one, leaving the two gaps on the right. The ragged row is an
accepted consequence, not an expansion-control requirement.

**Matchups and Schedule are separate questions.** This tier is specified for Overview's game lists. Schedule carries far more rows and its own density argument; Matchups uses a two-column owner-card grid whose cards are wider than a scoreboard row. Neither inherits this automatically.

> **SUPERSEDED for Matchups (verified 2026-09-08):** the mockup ships a three-column owner-card tier at 1372px with
> its arithmetic (`mockups/matchups-schedule-mockup.html:218-220`, the `.owner-grid` container query); shipped code is still `lg:grid-cols-2`
> (`item-87-followon-matchups-gap-analysis.md` §3.4). Schedule's tier is stated at 1320px in
> `item-87-followon-presentation-decisions.md`, with arithmetic that does not reproduce — Item 152.

---

## Scope boundary

Schedule does not inherit this tier. Its sixty-plus games and date-grouped blocks create a different
reading problem even though they share the compact scoreboard row.

> **ANSWERED (verified 2026-09-08):** Schedule adopts a three-column tier of its own, historically described as
> higher than the former 1300px Overview proposal because each
> block carries padding — `item-87-followon-presentation-decisions.md` → *Three-column tier at 1320px*. The exact
> Schedule number remains Item 152's; Overview's 1348px target is independent.
