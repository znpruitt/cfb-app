# PLATFORM-669 — Overview's watchlist never received the shared-row decisions

```text
PROMPT_ID: PLATFORM-669-OVERVIEW-SHARED-ROW-CODEX-v1
PURPOSE: Six row decisions were taken during the Schedule and Matchups work, recorded as Schedule
         decisions, and never applied back to Overview's watchlist — though every one is a property
         of the SHARED row. The visible consequence: every watchlist card reserves a 22px band the
         design does not have, and a tagged card renders TWO header bands where it has one.
SCOPE:   src/components/OverviewPanel.tsx — `WatchlistScoreboardList` (`:909`) and its
         `contextSlot` (`:969-999`) — plus its tests and a browser measurement. DO NOT change
         `CompactGameScoreboard`, the tag selector, `EYEBROW_TAG_CLASSES`, any other Overview
         section, or DESIGN.md (planning owns it).
CARRIES: **The `margin-left: auto` trap — CARRY row 25.**
         `item-87-followon-presentation-decisions.md` → *"Implementation note — `margin-left: auto` is
         not sufficient"*. Read that section before writing the layout. **Its amplifier on THIS
         surface is withdrawn:** planning claimed tag-only rows with no metadata to hold the left
         group open, and the receipt established that kickoff formatting always returns text
         (including `TBD`), so such a row is synthetic. Get the right-pin correct; do not build a
         fixture for a row that cannot occur.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over.
```

---

## RECEIPT ADJUDICATED 2026-09-25 — proceed, and the PAYOFF IS A DIFFERENT SHAPE THAN THIS PROMPT SAID

**All six corrections accepted, verified by planning. Three change what this slice delivers.**

### The headline symptom does not reproduce, and the real win is bigger than it

**The tag-wrap misalignment is gone.** Measured across fifteen viewport widths: every card kept a 22px
reason band and a 62px offset to its first team row, and at 260px the content **clipped rather than
wrapping** — `OverviewPanel.tsx:971` carries `overflow-hidden`. The 2026-09-08 observation has been
overtaken.

**But the band is UNCONDITIONAL** (`:967-971`, and its comment says so deliberately): **an untagged
card reserves the same 22px as a tagged one.** So moving the chips into `tagSlot` and removing the
band does not "fix a misalignment" — **it takes 22px off EVERY watchlist card**, plus brings the
surface onto the same structure as every other one. That is a denser, more honest payoff than the one
this prompt described, and it is the one to report.

**Two header bands, not three.** Team rows are not headers; this prompt miscounted by calling them
that. The change is two bands → one.

### Three claims in this prompt are withdrawn

1. **"reason label plus two tags" is NOT an ordinary reachable shape.** The landed Close guard
   (`fa0c6573`) rejects scheduled score packs, so `deriveGameHighlightTags` yields `top25` and `close`
   and `close` cannot fire on a scheduled row. The widest ordinary watchlist slot is **a reason label
   plus one tag — two pills**. Keep the three-pill case only as an **explicitly synthetic** stress
   fixture, labelled as such.
2. **The CARRY is relieved for this surface.** CARRY row 25's `margin-left: auto` trap is real, but
   its amplifier here is not: **metadata-free watchlist rows are synthetic**, because kickoff
   formatting always returns text, including `TBD`. The left group is always held open. **Planning
   asserted the tag-only case without checking it.** Keep the right-pin correct; do not build a
   fixture for a row that cannot occur.
3. **"One header line" keeps the phone exception.** #797 is landed and applies to every tagged state
   below 640px viewport. The single-line contract was already scoped, and this slice does not narrow
   it.

### Accepted as answered, and carried into acceptance

- **All six decisions are unblocked; three are already satisfied** — one tag vocabulary/treatment
  (`3e2385e6`, `0f2ec105`), team identity slot (Item 119's bars retired, 28px logos at `ec4bc95c`),
  and the third-column tier (now 1341px container on Overview; **preserve it** — and note
  [#873](https://github.com/znpruitt/cfb-app/issues/873) asks whether that number's premise survived,
  which is planning's, not yours). **The three that remain are one change**: chips into the status
  row, pinned right, sharing the header.
- **The watchlist is the ONLY `contextSlot` consumer on Overview.** Removing the band once the chips
  leave is approved as proposed, with a test. The odds-footer reservation stays.
- **`tagSlot` is a 16px-high container and the existing wrapper is 22px.** New risk, not previously
  named: **measure vertical clipping** before assuming the chips carry across.

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

So a tagged watchlist card renders **chips band → date/broadcast band → team rows**: two header
bands where the mockup puts state, date, broadcast and the tag on **one**.

**And the band is reserved even when empty**, so an untagged card pays the same 22px. **That is the
measurable result of this slice and it applies to every card.**

**The grid misalignment in this issue's title text DOES NOT REPRODUCE** — see the adjudication above.
Fifteen viewport widths, every card level, content clipping rather than wrapping at 260px. Do not
spend the slice chasing it.

### Moving the chips into `tagSlot` is a NEW interaction, and nothing has measured it

**The watchlist has never had a `tagSlot`, so #797's phone-width header wrap has never applied to
it.** The #726/#797 lane established this explicitly while measuring: *"Overview's scheduled Watchlist
puts its tags in the context slot, so that particular header has no tag slot to wrap."*

The moment the chips move, that card comes under the wrap rule for the first time. **Measure it at
phone width; do not assume #797's fix covers a case it was never shown.** The ordinary widest slot is
a reason label plus ONE tag — the three-pill case is synthetic, per the adjudication.

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

1. **A watchlist card renders ONE header band, not two**, pinned by a test that fails against today's
   code. **And the 22px reservation is gone from EVERY card, tagged or not** — that is the measurable
   result, since the band is unconditional today. Report the card height before and after, for both a
   tagged and an untagged card.
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
