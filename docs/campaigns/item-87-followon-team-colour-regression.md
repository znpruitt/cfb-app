# Item 87 — Follow-on input: team colour is now unrendered — Item 119 reframed

> **Check `item-87-INDEX.md` before deciding from this document.** Parts of it may be superseded.
>
> **Status:** input for review, not applied.
>
> **INDEX (verified 2026-09-08): CURRENT.** Two of its four asks are discharged (the guard comment, the `DESIGN.md`
> correction and the closeout check it proposed) and two are still open (recording the 5b dependency against Item
> 119, and the retrospective closeout note). Marks below.

Corrects `item-87-followon-team-colour.md`, whose framing is stale as of slice 5. Read that document with this one; section A in particular now describes work that no longer applies.

---

## What changed

Slice 5 deleted **both** shipped team-colour treatments, and only one of them was the card chrome it set out to remove.

| Treatment | Where | Shape | Correctly removed? |
|---|---|---|---|
| Card-edge insets | `GameWeekPanel` — `inset 0 2px 0 <away>`, `inset 0 -2px 0 <home>` | card chrome | **Yes.** Two colours on a card's edges is not a per-line accent, and deleting card chrome was slice 5's job. |
| Line-start accent | `GameScoreboard.tsx` — `border-l-[3px]` winner / `border-l-2` otherwise, via `winnerAccentColor` / `rowAccentColor` | per-line, 2–3px | **No.** This *was* the incumbent the colour doc described. It went out with `GameScoreboard`, a legacy component removed wholesale. |

**`teamColors.ts` now has zero production consumers.** Team colour renders nowhere on any surface.

---

## Three consequences

### 1. Item 119 is a restoration, not a widening

`item-87-followon-team-colour.md` §A frames the work as *"the incumbent renders 2–3px; the proposal is a solid 8px bar"* and recommends *"widen the bar to 8px on the existing normaliser — visual change only."*

**There is no bar to widen.** It is now build-from-nothing on the shared row component. The "visual, cheap" framing is stale and a prompt written from §A would go looking for something to modify.

The **decision** in §A stands unchanged — solid 8px muted bar at ~72% opacity in the line-start slot, with gradient and full-width band rejected. Only the framing of the work is wrong.

### 2. The sequencing recommendation still holds, with one adjustment

§A recommends shipping on the **existing HSL normaliser** first and porting to OKLCH only if measured to matter. That remains right — the reasoning was to decouple a visual decision from a colour-science one, which is unaffected.

The adjustment: "measure whether HSL produces bad output at that width" no longer has a rendered baseline to compare against. It becomes an evaluation after 119 ships rather than a comparison against something live.

### 3. `teamColors.ts` is now orphaned and at risk

A module with zero production consumers is exactly what a dead-code sweep removes. Codex flagged it as test-only during review and correctly declined to delete it — but that was judgment, not process, and the next sweep may not repeat it.

**Recommend a guard comment at the top of the file** naming Item 119 as its pending consumer, so the orphaning reads as scheduled rather than as rot.

> **DISCHARGED (verified 2026-09-08):** `src/lib/teamColors.ts` opens with "NO PRODUCTION CONSUMER TODAY — this
> is SCHEDULED, not dead" and names Item 119; `AGENTS.md` → *Documentation closeout timing* cites it as the live
> example of the rule.

---

## `DESIGN.md:165` is false

It states that game cards carry a per-line team-colour accent via `teamColors.ts`. Nothing renders it on any surface.

**This is the second false team-colour claim in `DESIGN.md`.** The previous one described the treatment as top-and-bottom card borders, which was corrected earlier in this campaign — and which I inherited and built a whole comparison on before it was caught.

The pattern is worth naming, since `DESIGN.md` is canonical for current UI: **a removal that leaves a doc claim standing produces a false canonical statement, and the doc's own diagnosis of that failure is what this repeats.** Worth a closeout check — when a slice deletes a rendered treatment, grep `DESIGN.md` for it before merging.

> **DISCHARGED, both halves (verified 2026-09-08):** `DESIGN.md` → *Cards and game results* now states that game
> cards do not currently render a team-colour accent, pending Item 119; and the closeout check is a binding rule in
> `AGENTS.md` → *Documentation closeout timing* ("When a slice DELETES a rendered treatment, grep `DESIGN.md` for it
> before merging"), citing this very case.

---

## Item 119 depends on slice 5b

5b lands `isolation: isolate` on the row specifically so the bar can coexist with the card-owner tint without the tint painting over it. That dependency is in 5b's prompt but not recorded against 119.

> **LIVE (verified 2026-09-08):** 5b merged (PR #575) and `DESIGN.md` records the isolated negative-z tint, but the
> Item 119 queue entry still does not name the 5b dependency. INDEX CARRY block; reported to planning.

Without it, the tint's `::after` at `z-index: -1` paints behind the *card* rather than behind the row, and the bar is affected. This was a real bug during mockup development and cost time to trace.

---

## What the closeout should have said

The slice 5 closeout records that records were removed pending Item 139. **It does not record that a rendered team-colour treatment was removed pending Item 119.** Codex's review flagged the orphaned module; the consequence for the surface was not drawn.

Worth adding to the closeout retrospectively, so the queue reflects that 119 closes a regression rather than adding a feature.

> **LIVE (verified 2026-09-08):** the PLATFORM-087-SLICE-5-ITEM-112 registry entry records the records removal
> (Item 139) and the deleted scoreboard family, but not the team-colour treatment removed pending Item 119. INDEX
> CARRY block; the registry is planning's to amend.

---

## Mockup status

`mockups/matchups-schedule-mockup.html` renders the bar as the settled treatment — no toggle, no alternatives. A dead `.tc { display: none; }` rule that made it *look* toggle-gated has been removed.

**`mockups/live-scoreboard-mockup.html` now carries the bar too.** The Overview mockup predated the treatment and has been updated — 51 of 52 rows, with the FCS row correctly excluded since FCS teams have no colour in the CFBD data.

**Item 119 therefore covers Overview as well as Matchups and Schedule.** Every surface that renders the scoreboard gets the bar; the treatment is a property of the shared row, not of one consumer.
