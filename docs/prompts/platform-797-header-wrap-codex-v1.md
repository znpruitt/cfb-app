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
         - A measurement claim states the population it was taken over. This slice's central claim
           is a measurement that has never been taken — see "The measurement that is owed".
```

---

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

**Widening only `:258` is likely to be a no-op or a partial fix, and that is the trap in this slice.**
`flex-wrap` on the container permits wrapping; it does not make either child take a full line. The
metadata stays `flex-auto` and the tag slot stays `flex-none`, so they can continue to share one line
and shrink exactly as they do today. `:266` and `:274` are what convert the permission into two
full-width rows. **Derive the predicate once and apply it to all three**, rather than editing the one
the issue happened to cite.

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
