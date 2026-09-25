# PLATFORM-669 — Overview's watchlist never received the shared-row decisions

```text
PROMPT_ID: PLATFORM-669-OVERVIEW-SHARED-ROW-CODEX-v1
PURPOSE: Six row decisions were taken during the Schedule and Matchups work, recorded as Schedule
         decisions, and never applied back to Overview's watchlist — though every one is a property
         of the SHARED row. The visible consequence: a tagged watchlist card renders THREE header
         lines where the design has one.
SCOPE:   src/components/OverviewPanel.tsx — `WatchlistScoreboardList` (`:909`) and its
         `contextSlot` (`:969-999`) — plus its tests and a browser measurement. DO NOT change
         `CompactGameScoreboard`, the tag selector, `EYEBROW_TAG_CLASSES`, any other Overview
         section, or DESIGN.md (planning owns it).
CARRIES: **The `margin-left: auto` trap — CARRY row 25, and it bites HARDER here than anywhere it has
         bitten before.** `item-87-followon-presentation-decisions.md` → *"Implementation note —
         `margin-left: auto` is not sufficient"*. Some watchlist rows are **tag-only**, with no
         metadata to hold the left group open, so a right-pin that relies on a sibling's width has
         nothing to push against. Read that section before writing the layout.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over.
```

---

## The framing to keep: ONE omission, not six divergences

All six were decided once, for the shared row, and recorded under a Schedule heading. Overview had
already shipped and nothing prompted a revisit. **`item-87-followon-presentation-decisions.md:21` even
says so in its own header — "Surfaces governed: Overview, Matchups, Schedule, recap — all four"** —
which is why this is a back-application, not six separate design questions.

**Do not re-litigate the decisions. Apply them.** If one appears wrong for Overview, that is a
stop-and-report, not a variation.

## Finding 1 is the concrete one, and it is a slot choice

`OverviewPanel.tsx:969-999`: the watchlist puts the reason label **and** the highlight tags into
`CompactGameScoreboard`'s **`contextSlot`** — a row of its own, above the header. It does not use
**`tagSlot`**, which is the slot that sits inside the status row beside the metadata.

So a tagged watchlist card renders **chips line → date/broadcast line → team lines**: three header
lines where the mockup puts state, date, broadcast and the tag on **one**. An untagged card already
reads correctly at one line, which is why the gap only shows on cards that carry a tag.

**The grid misalignment in this issue's title text is the SMALLER symptom and its trigger is narrow.**
Recorded 2026-09-08: it is invisible at desktop width, because a one-tag and a two-tag card both fit
on one line; it appears only when a card's tags **wrap**, which is narrower than the two-column tier.
**The line count is what is visible at every width.** Fix the slot and the alignment follows; chase
the alignment alone and you will fix the narrow case and leave the broad one.

### Moving the chips into `tagSlot` is a NEW interaction, and nothing has measured it

**The watchlist has never had a `tagSlot`, so #797's phone-width header wrap has never applied to
it.** The #726/#797 lane established this explicitly while measuring: *"Overview's scheduled Watchlist
puts its tags in the context slot, so that particular header has no tag slot to wrap."*

The moment the chips move, that card comes under the wrap rule for the first time — and the watchlist
can carry a reason label **plus** two tags, which is a wider slot than the rows #797 measured.
**Measure it at phone width. Do not assume #797's fix covers a case it was never shown.**

### The `min-h-[22px]` reservation is deliberate and its comment says so

`OverviewPanel.tsx:967-968` warns that passing `undefined` silently drops the 22px reason-row band. If
the chips leave `contextSlot`, that band either has a remaining job or it does not. **Decide it
explicitly and say which** — do not let it survive as an empty reserved strip because nothing removed
it, and do not drop it because the wrapper became falsy.

## Sequencing — this slice must come BEFORE #673 and #718

Both operate on the chips this slice may relocate:

- [#673](https://github.com/znpruitt/cfb-app/issues/673) — the reason label is not counted by the
  two-tag cap, so three chips can render in a slot budgeted for two.
- [#718](https://github.com/znpruitt/cfb-app/issues/718) — the reason row has no overflow valve.

**Neither is in scope here**, and doing them first would tune a row that is about to move. Say in the
report whether relocation changes what either issue means.

## Acceptance

1. **A tagged watchlist card renders ONE header line, not three**, pinned by a test that fails against
   today's code. This is the acceptance the issue exists for.
2. **The remaining five decisions are each applied or explicitly deferred with a reason**, enumerated
   from `presentation-decisions.md`. **Do not report a count** — name each decision and its
   disposition. A decision deferred because its enabling work has not shipped is a valid outcome and
   names the blocker.
3. **The tag-only row holds its right-pin.** A watchlist row with chips and no metadata must not
   collapse the left group — CARRY row 25's failure mode, and the case this surface has that the
   others do not. Pin it.
4. **Phone width is measured, not assumed.** If the chips move into `tagSlot`, report the rendered
   widths and whether #797's wrap fires correctly for a reason-label-plus-two-tags slot. State the
   viewport and the row shape.
5. **The `min-h-[22px]` band's fate is stated and tested**, either way.
6. **No other Overview section changes.** The podium, standings, polls, Insights, Movement and the
   scoreboard grids are untouched, each pinned.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 1 is the likely false green.** A test asserting "the tag is present" passes in both
layouts — the chip exists either way. Assert the **line count** or the chips' position relative to the
metadata, and show it red against current code.

**Acceptance 3's control matters.** A tag-only row test that renders a row WITH metadata proves
nothing; construct the row that has no metadata to push against.

---

## STOP — read receipt before writing any code

Answer from the FILES and the browser. Enumerate rather than counting.

1. **The six decisions, named, from `presentation-decisions.md`** — and for each, whether it is
   already satisfied on Overview, applicable and unbuilt, or blocked on work that has not shipped.
   This issue's own text says items 1–3 needed Item 143's seam, item 4 was Item 157 and item 5 was
   Item 119. **Check whether each of those has since landed** rather than inheriting the blockers.
2. **What else consumes `contextSlot` on Overview**, and would moving the watchlist's chips out of it
   change any of them?
3. **What is the widest realistic watchlist chip slot** — reason label plus how many tags — and how
   did you determine it?
4. **Does `CompactGameScoreboard`'s `tagSlot` impose anything the `contextSlot` did not?** Ordering,
   truncation, the two-tag cap, the phone-width wrap. Name each.
5. **Is the grid misalignment reproducible today**, and at what width? The 2026-09-08 note says it
   needs tags to wrap. Confirm or correct that.
6. **What in this prompt contradicts what you found in the files or the browser?**

Do not start until the receipt is answered and it has been ruled on.
