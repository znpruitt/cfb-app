# Item 87 — Follow-on input: recap adopts the shared scoreboard

> **Status:** input for review, not applied. Check `item-87-INDEX.md` before deciding from this document.

The weekly recap's results section renders its own scoreboard, built before Item 87's component existed. Bringing it onto the shared contract, plus one selection defect the component does not fix.

---

## 1. "Head-to-head" as a section title and as a per-row tag — drop both

Shipped titles the section **HEAD-TO-HEAD RESULTS** and then tags every entry **HEAD-TO-HEAD**. The same fact is stated twice on every row, and neither statement distinguishes anything.

**A tag says why *this* game is notable relative to its neighbours.** When every game in the section shares the reason, the tag carries no information — and the fact that actually distinguishes them, the margin, is demoted to prose in the metadata.

**The mockup does not have this problem and never did.** It titles the section **Notable results** — naming what it contains rather than why the games were selected — and tags each row with its own reason: `Upset`, `Blowout`, `Shutout`, `Shootout`, `Nailbiter`. The shipped implementation diverged.

**Rule: a tag that restates its container is suppressed.** On the multi-tag row this turns `ODDS UPSET · CLOSEST GAME · HEAD-TO-HEAD` into `ODDS UPSET · CLOSEST GAME`, which is what a reader needs.

That rule generalises past the recap: any surface that scopes a section by a selection reason must not repeat that reason on each row inside it.

---

## 2. Multi-tag rows must not wrap

`ODDS UPSET · CLOSEST GAME · HEAD-TO-HEAD Beat a 6.5-point favorite · 1-point margin` wraps to two lines, pushing that column out of alignment with its neighbour for every row below it.

The shared contract fixes the mechanism — status metadata in a growing left group, tag pinned right, `flex: none` so the tag never clips and `min-width: 0` so the metadata ellipses instead.

**But cap the tag count.** Three pills on one line will crowd the metadata out entirely at column width even when nothing wraps. Suppressing container-restating tags (§1) removes one; a hard cap of two is the safe ceiling, with `prioritizeGameTags` choosing which survive.

---

## 3. The recap adopts the shared row anatomy

Now in `mockups/weekly-recap-mockup.html`:

- **Bronze pill, right-aligned**, replacing the per-category tag hues. Those hues were placeholders pending `INSIGHTS-017-PALETTE`; the pill decision supersedes them, and one treatment across every surface beats five category colours competing with a crowded palette.
- **Team identity slot** at line start. The earlier colour-bar forecast is superseded by the
  2026-09-10 owner decision for 28px CFBD logos; recap adoption remains blocked behind Item 143.
- **Status row structure** — metadata left in a growing group, tag pinned right.

**Implementation note:** the recap mockup generates most rows from a JS template rather than static markup. A change applied to the visible markup alone reaches only the handful of hardcoded rows. Worth knowing before anyone edits that file.

---

## 4. Metadata carries only what the row cannot state itself

`38-point margin` beside scores of 48 and 10 restates arithmetic the reader already has. The scoreboard supplies the numbers; the pill names the category; metadata is for facts neither of them provides.

**Dropped as derivable:** margin, combined points, "zero points allowed". Each is visible in the two scores.

**Kept:** an upset's spread (`+9.5 underdog`). The line is not on screen, so it is the only part of that row a reader cannot reconstruct.

The test is not whether a fact is interesting — margin is interesting — but whether the row already states it. Restating a visible fact in words costs a line of metadata and teaches the reader that the metadata slot is decorative.

Most rows now carry no metadata at all, and the status row is the pill alone. The left group still holds open so the pill stays right-aligned.
