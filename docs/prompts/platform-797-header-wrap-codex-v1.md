# PLATFORM-797 — the compact header wraps on every state at phone width, not on scheduled alone

```text
PROMPT_ID: PLATFORM-797-HEADER-WRAP-CODEX-v1
PURPOSE: At phone width the compact scoreboard header may wrap only on `scheduled` rows. On `live`,
         `awaiting` and `unavailable` it stays one non-wrapping line, and because the tag slot is
         `flex-none` while the metadata span is `flex-auto min-w-0 overflow-clip`, the metadata
         absorbs the whole squeeze — clipping broadcast, which sits last in that line. Extend the
         phone-width exemption to every state.
SCOPE:   src/components/CompactGameScoreboard.tsx — the three `state === 'scheduled'` conditions at
         `:258`, `:266` and `:274` — plus its tests and a browser measurement. DO NOT touch the tag
         selector, `LeagueGameTag`, the metadata ORDER, any panel, or DESIGN.md (planning owns it;
         the rule is already written).
CARRIES: NONE from the Item 87 campaign index, having checked — this is the shared scoreboard's
         header wrap policy, already ruled in DESIGN.md, not row anatomy or tag vocabulary.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over. The measurement this
           prompt owed was TAKEN at the read receipt and it refuted the prompt — see the
           correction block below before reading anything else.
```

---

## CORRECTED 2026-09-23 AFTER THE READ RECEIPT — the prompt's central claim was WRONG

**This prompt said widening `:258` alone was "likely a no-op or a partial fix". The lane measured it
and it is false.** At a 390px viewport, on a live row with `Q4 12:34`, `ESPN2` and two selector-produced
tags, mutating only the header condition moved header height 16px -> 36px, metadata width
126.25px -> 338px, and broadcast overflow **14.063px -> 0px**. It fixes the clipping on its own.

**My reasoning failed on one flex property.** I argued the children would keep sharing a line because
neither is told to take a full one. But the metadata span is `flex-auto`: once the tag slot wraps off
its line, `flex-auto` grows into the space the tag vacated, so the metadata reaches full width without
`:266` doing anything. `:266` and `:274` are not what CREATE the split.

**What they actually do is fix the second line's alignment, and that is still why all three must
move.** With `:258` alone the tag slot stays intrinsic-width and sits at the LEFT edge of line two.
With `:274`'s `max-sm:w-full`, it takes the full line and the existing `justify-end` pushes it right —
which is how scheduled rows already render. **So the choice is not "does it work" but "does a wrapped
header look the same on every state".** Per `DESIGN.md`, the exemption follows the layout, so it
should: a member should not be able to tell a live row from a scheduled one by which side the tags
sit on.

**Move all three. The reason is cross-state consistency, not necessity.** Say so in the report rather
than repeating this prompt's original claim.

**The mutation in "Testing requirements" survives and is now better grounded.** Widening `:258` alone
is a REAL discriminator: a test asserting the tag slot takes a full line reddens under it, while a
test asserting only that the container carries `flex-wrap` stays green. The lane's measurement proves
the mutation produces a distinguishable layout.

### What else the receipt established, all accepted

- **Four conditions test `state === 'scheduled'`, not three.** `:371` chooses record-versus-score
  anchors and does **not** participate in the wrap. The wrap set is three; the scheduled set is four.
- **The clipping is reachable at ordinary phone widths** — measured overflow at 360/375/390/414px and
  **zero at 430px**, on both `live` and `awaiting`, with `awaiting` worse. The header-only mutation
  took every one to 0px. **Population stated honestly: controlled reachable fixtures, not observed
  production games.** That is the right claim to make and it discharges the measurement obligation.
- **`unavailable` is not established as a broadcast case** — Matchups suppresses that broadcast. **Include
  `unavailable` anyway**, and justify it from the `DESIGN.md` layout rule rather than from clipping:
  the exemption follows the layout, and carving out one state would reintroduce a status-shaped
  predicate for no stated reason. Do not claim it fixes a broadcast defect there.
- **The tag slot has NO upper bound.** The widest co-reachable Schedule/Matchups pair measured
  203.75px, but CFP Championship plus both highlights measured 288.438px, and the conference badge
  interpolates an uncapped conference string. **This is why the fix must be a wrap and never a width
  threshold** — any measured cap would be falsified by the next long conference name. Related:
  [#795](https://github.com/znpruitt/cfb-app/issues/795).
- **No surface has a neighbouring scoreboard card at phone width** — Schedule and Overview collapse
  below their 760.01px container threshold, Matchups goes two-column only at `lg`. This CONFIRMS the
  `DESIGN.md` rationale applies to all three surfaces. Overview's scheduled Watchlist puts tags in the
  context slot, so that header has no tag slot to wrap.
- **Broadcast carries its own `truncate`**, so the metadata's `overflow-clip` is not the only clipping
  boundary. Account for it when asserting what is visible.

**Nothing else in this prompt changes.** The ruling, the scope, the trap and the acceptance stand —
acceptance 2 in particular is unchanged and now rests on alignment consistency rather than on the
false no-op claim.

## The ruling, already recorded

**Owner decision 2026-09-22 on [#758](https://github.com/znpruitt/cfb-app/issues/758), folded into
this issue.** `DESIGN.md` now carries it, under the header-wrap amendment:

> **THE WRAP EXEMPTION FOLLOWS THE LAYOUT, NOT THE STATUS. It covers every state at phone width, not
> scheduled rows alone.**

The reasoning is in `DESIGN.md` and is worth reading before you start, because it tells you what the
fix must NOT do: above phone width the single-line contract is unchanged, since there a neighbouring
card is real and a wrapping header would push team rows out of alignment across the grid row.

**#797's body says "This is NOT #758" and "do not fold them together". That warning is now spent, and
you should understand why rather than think the prompt is overriding it.** It was written to stop a
fix being scoped to *scheduled* rows and leaving live rows broken. The fold went the other way: #758
asked the question ("should live/final rows get phone-width relief?"), this issue is its consequence,
and they are **the same condition in the same expression**. Answering yes and fixing here satisfies
both.

---

## The mechanism, re-derived on `main` at `9045ffd4`

**The issue's citations predate #832's merge and are stale. These are current.** More importantly,
**the issue names one condition and there are three.**

| line | element | scheduled-only class |
| --- | --- | --- |
| `:258` | header row | `max-sm:flex-wrap max-sm:gap-y-1` |
| `:266` | metadata span | `max-sm:w-full max-sm:flex-none` |
| `:274` | tag slot | `max-sm:w-full` |

All three read `state === 'scheduled'`. The header row at `:257` is `flex items-center gap-2
overflow-hidden whitespace-nowrap`; the metadata span at `:265` is `flex min-w-0 flex-auto
overflow-clip whitespace-nowrap`; the tag slot at `:273` is `flex h-4 flex-none justify-end`.

**SUPERSEDED BY THE CORRECTION ABOVE — this paragraph was wrong and is kept so the correction has
something to point at.** It read: *"Widening only `:258` is likely to be a no-op or a partial fix...
`flex-wrap` on the container permits wrapping; it does not make either child take a full line."*
**Measured false.** The metadata span is `flex-auto`, so when the tag slot wraps off the first line the
metadata grows into the vacated space and reaches full width by itself.

**What `:266` and `:274` actually decide is the second line's ALIGNMENT** — without them the tag slot
keeps its intrinsic width and sits left; with them it takes the line and `justify-end` pushes it right,
as scheduled rows already do. **Apply all three, for cross-state consistency**: a member should not be
able to tell a live row from a scheduled one by which side the tags sit on.

`hasTagSlot` (`:207`) gates only `:258`; the other two do not test it, because they sit inside the
`hasTagSlot` branch already (`:262`).

## Why the clipping lands on broadcast

The metadata span is the only flexible element in that line and it is `overflow-clip`, so every pixel
the tag slot takes comes out of the metadata. Broadcast sits last in the metadata order (state,
clock, broadcast, neutral site), so it is what disappears. **Do not "fix" this by reordering the
metadata** — that moves which fact is lost, it does not stop losing one.

## The thing not to do

**Do NOT restore the renderer-side `hidden` on secondary tags.** That cap is what
[#671](https://github.com/znpruitt/cfb-app/issues/671) ruled against and
[#725](https://github.com/znpruitt/cfb-app/issues/725) removed. Re-hiding a tag the selector
deliberately chose, to work around a layout bug owned by the component, re-creates the defect
`DESIGN.md` describes as a second invisible cap. Related and out of scope:
[#795](https://github.com/znpruitt/cfb-app/issues/795) — after #725 nothing caps `LeagueGameTag`, so
the tag slot's width is bounded only by the vocabulary's size.

---

## The measurement that is owed, and it is the centre of this slice

**The overflow has never been observed. It was DERIVED from the flex properties.** The #723/#725 lane
said so explicitly rather than claiming it had checked, and that honesty is why the issue is still
open rather than closed by a fix nobody verified.

**So this slice's first obligation is to observe it, before sizing anything.** The repo has a browser
harness for exactly this class — `npm run test:browser:required` drives
`OverviewScoreboardGrid.browser.test.tsx`, `ScheduleScoreboardGrid.browser.test.tsx` and
`ScoreboardTeamNameFallback.browser.test.tsx`, and the last of those was built for #832 to measure
rendered text boxes at set container widths. Use that mechanism.

**State, in the report: the viewport width, the row shape (state, tag count, broadcast present), and
the measured overflow in pixels — before and after.** A claim that broadcast "clips" with no number
is the thing this issue already has and does not need a second copy of.

**If the measurement shows no clipping at the widths that actually ship, say so and stop.** That is a
valid outcome: it would mean the defect is real in the flex properties and unreachable in practice,
and the correct response is a finding, not a fix. Do not manufacture a fixture narrow enough to
produce the overflow and report it as the shipped condition — name the population.

---

## Acceptance

1. **The phone-width wrap applies on `live`, `awaiting` and `unavailable`, not only `scheduled`**,
   proven by a test per state that fails against today's code.
2. **All three conditions move together.** A test pins that the metadata span and the tag slot each
   take a full line at phone width on a non-scheduled state — not merely that the container carries
   `flex-wrap`. A class-presence assertion on `:258` alone would pass while the row still renders on
   one line.
3. **Above phone width nothing changes.** The single-line contract holds on every state at the widths
   where a neighbouring card exists, pinned by a test at a width above the `sm` breakpoint.
4. **Broadcast survives at phone width** on a row with the full tag slot, measured in the browser
   harness with the width and row shape stated. This is the acceptance the issue was filed for.
5. **No renderer-side `hidden` is introduced on any tag**, and the metadata order is unchanged. Both
   pinned.
6. **The measurement is reported with its population** — viewport width, row shape, pixel overflow
   before and after. If no overflow is reachable at shipped widths, that is the finding and
   acceptance 4 is discharged by reporting it, not by a fix.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 2 is the likely false green**, and it is the same shape as the defect: asserting that a
class is present proves the permission, not the layout. Mutate by widening `:258` alone, leaving
`:266` and `:274` scheduled-only — a test that stays green under that mutation is testing the class,
not the wrap.

**Acceptance 3 is the second.** A test that never sets a width above the breakpoint cannot fail when
the exemption leaks upward.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

Answer from the FILES and from the browser, not from this prompt. Enumerate rather than counting.

1. **Every condition in this component that tests `state === 'scheduled'`**, and for each, whether it
   participates in the wrap. This prompt names three; say whether that is the whole set.
2. **Does widening `:258` alone change the rendered layout?** Answer from a browser measurement, not
   from reading the classes. This is the prompt's central claim and it should be the first thing you
   falsify or confirm.
3. **At what viewport width, and with what row shape, does broadcast actually clip today?** Give the
   number. If it does not clip at any width the app ships at, say so.
4. **What else renders in the tag slot besides `LeagueGameTag`?** The slot's width is uncapped after
   #725; say what the widest realistic slot is and how you determined it.
5. **Do the other scoreboard surfaces share this header?** If Schedule, Matchups and Overview render
   the same component, say which of them this change reaches and whether any of them has a
   neighbouring-card layout at phone width that the DESIGN.md rationale would protect.
6. **What in this prompt contradicts what you found in the files or the browser?**

Do not start until the receipt is answered and it has been ruled on.
