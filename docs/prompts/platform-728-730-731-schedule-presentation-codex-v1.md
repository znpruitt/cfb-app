# PLATFORM-728/730/731 — Schedule presentation

```text
PROMPT_ID: PLATFORM-728-730-731-SCHEDULE-PRESENTATION-CODEX-v1
PURPOSE: Bring Schedule's row presentation to the settled contract in three places: tags move into
         the status row's tag slot (#728), games become discrete neutral blocks with no divider
         rules (#730), and date headings become quiet uppercase chrome (#731).
SCOPE:   src/components/GameWeekPanel.tsx and src/components/__tests__/GameWeekPanel.test.tsx.
         DO NOT modify selectors (src/lib/selectors/gameWeek.ts), gameTags.ts, the column gap or
         any column-tier breakpoint (#726, Item 152), final-row kickoff text (Item 142), or DESIGN.md
         (planning owns it; see "The contradiction" below). CompactGameScoreboard.tsx is OUT of scope
         by default — if removing the divider appears to need it, that is receipt item 3, not a
         decision to take mid-implementation.
CARRIES: Item 87 INDEX, LIVE rows for the Schedule surface, verbatim:

         Row 1: "A build with records absent or stale **will not match the mockup**, and a reviewer
         comparing them must read that as a **sequenced dependency, not a defect**. State this in the
         prompt. **Owner ruling 2026-09-08:** a missing record leaves the anchor **blank**, never the
         spread — and a **store failure** (transient, no item) is NOT the same condition as **"not
         wired to this surface"** (a sequencing state that needs a filed item and this sentence in the
         prompt). Records are wired on Overview and Matchups; Schedule remains in the second state
         under Item 156."

         Row 7: "**Do not read campaign status from the canonical document**, and **re-derive every
         line-number citation** before putting it in a prompt — they have been stale at least twice,
         and `DESIGN.md` moved again on 2026-09-08."

         Row 8: "Selection and precedence stay selector-owned; the scoreboard **must not be forked**.
         [...] There are **five direct renderers**: Overview `GameCardList` (serving Live AND Recent
         finals), Overview `WatchlistScoreboardList`, Overview `FeaturedGamesList`, `GameWeekPanel`,
         and Matchups `GameRow` — three importing modules, six rendered contexts."

         Row 71: "**A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded**
         — Overview, Matchups, Schedule, recap. [...] **every decision in it about the status row, the
         tag slot or row anatomy applies to all four surfaces.**"

         Row 26 (DISCHARGED, carried because this slice makes it newly reachable on Schedule): "The
         single-column wrap exception is limited to tagged scheduled rows at phone width; live,
         awaiting, final, and untagged rows do not inherit it."

         Row 9 (recap deduplication) is LIVE but governs Overview's Recent finals, not Schedule —
         checked, not carried.
```

**Records are absent on Schedule by design (row 1).** A reviewer comparing this build against the
mockup will see blank record anchors. That is Item 156's sequencing state, not a defect of this slice.

---

## What exists, read at `main` `4040b063`

Line numbers below were re-derived at that commit (row 7). **The issues' own line numbers are stale**
— #730 cites `CompactGameScoreboard.tsx:218` for the divider, which is now `:244`.

| issue | where | what ships |
| --- | --- | --- |
| #728 | `GameWeekPanel.tsx:151-173` | Tags render inside `contextSlot`, beside the event name, on their own line above the status row. No `tagSlot` is passed. |
| #730 | `GameWeekPanel.tsx:127-143` (wrapper), `CompactGameScoreboard.tsx:244` (`border-b py-3`) | The per-game wrapper carries only a focus ring. Separation comes from the SHARED scoreboard's own bottom border. |
| #731 | `GameWeekPanel.tsx:92-97` | `border-b-2 border-gray-200 pb-2 text-sm font-semibold text-gray-700` — 14px title-case semibold, no tracking. |

**Existing tests pin today's heading classes**: `GameWeekPanel.test.tsx:178-188` asserts `border-b-2`,
`dark:border-zinc-800/80` and `pb-2` on every date heading. Some of those assertions will change
legitimately; say which, and why each change is not a weakening.

---

## #728 — tags into the tag slot

**The precedent is Featured (Item 173a, PR #588) and Matchups (`MatchupsWeekPanel.tsx:334`).** Tags
go in `tagSlot`; the event name STAYS in `contextSlot`. Only the tags move.

**Moving them changes more than position, and each consequence is a requirement:**

1. **The two-chip cap becomes load-bearing on Schedule.** `DESIGN.md` → *Chips are capped at two*:
   the tag slot is `flex: none` inside the status row, so a third chip ellipses the metadata to
   nothing — and **the selector applies the cap, not the renderer.** In `contextSlot` an uncapped
   list merely wrapped. Establish what Schedule actually receives (receipt item 1). Do NOT add a
   render-time `slice`.
2. **Row 26's wrap exception switches on for Schedule.** `CompactGameScoreboard.tsx:256` wraps
   the header only when `hasTagSlot && state === 'scheduled'` at phone width. Schedule rows gain it
   the moment tags reach `tagSlot`. It must apply to tagged scheduled rows and to nothing else —
   test both sides.
3. **`contextSlot` must not render an empty wrapper** when a row has tags and no event name. Today
   the wrapper is gated on `contextEventName || tags.length > 0`; after the move, tags no longer
   justify it.
4. **Matchups renders its tag slot only when a primary tag exists.** Schedule today renders secondary
   tags without a primary. Say whether that state is reachable (the selector returns `primary: null`
   only for an empty list — `gameTags.ts:787`) and gate on what is true, not on what Matchups does.

## #730 — discrete blocks

**The settled treatment** (`item-87-followon-presentation-decisions.md` → *Games are discrete blocks*;
mockup `.grow`, `matchups-schedule-mockup.html:287-291`): neutral fill `rgba(255,255,255,0.022)`, 5px
radius, 7px vertical / 10px horizontal padding, **no divider rules**. The mockup removes the scoreboard's
own border inside the block (`.grow-head .scoreboard { padding: 0; border-bottom: none; }`).

**The divider is not in your file.** It is `CompactGameScoreboard`'s `border-b`, shared by all five
direct renderers (row 8). **Overview and Matchups must render byte-identically after this slice**, and
the scoreboard must not be forked. How to remove it on Schedule only is receipt item 3.

**Blocks need vertical separation that the border used to imply.** The grid is `gap-x-10` with no row
gap. The mockup uses a 6px row gap in two columns and an 8px adjacent-sibling margin at one column,
because its single-column layout is `display: block`, which ignores `gap` (*Block layouts need margin,
not gap*). Shipped single-column is `grid-cols-1`, still a grid — so `gap` may be enough here. Say which
applies, from the code.

**The focus ring** sits on the same wrapper. With a radius, confirm the ring follows it.

## #731 — date headings

**The settled treatment** (`presentation-decisions.md` → *Date headings*, points 1-2; mockup `.date-head`,
`:313-319`): uppercase, letterspaced, secondary text colour — chrome, not content. Mockup values: 11px,
weight 600, `letter-spacing: 0.10em`, uppercase; asymmetric spacing (roughly double above, tighter
below) so the heading binds to the group it introduces; first group carries no top padding.

**Map these to existing project tokens from `DESIGN.md`, not to raw mockup values**, and report the
mapping in the receipt. Uppercase is CSS (`uppercase`), never a string transform — the label text,
including the relative `Today` (INDEX row 65), must stay as the selector produced it.

**The heading's rule stays exactly as shipped** — full-width, 2px, below the heading. It is in no issue.

---

## The contradiction — planning's, stated before you find it

**`DESIGN.md:272-275` says:** *"Every date heading carries a full-width 2px bottom rule — one step
heavier than the 1px separator below each game."* **#730 removes the separator below each game.** The
sentence was written against the shipped divider list; the design documents and the mockup all
specify blocks.

The documents disagree in two further places this slice does not act on:

- `presentation-decisions.md` → *Date headings* point 3 still places a 1px rule **above** the heading.
  `item-87-reference-game-row.md:417` corrected that to **below** on 2026-09-11, in line with `DESIGN.md`;
  the decisions document was not updated. **Below is canonical.**
- The mockup's heading rule is **1px** (`:317`); `DESIGN.md` and the shipped code say **2px**.
  **`DESIGN.md` is canonical; keep 2px.**

**Do not edit `DESIGN.md`.** Planning owns it and amends the sentence's justification clause after the
owner rules — the rule under the heading survives; only its comparison to a separator stops being true.
Your closeout records the conflict as found and leaves the wording to planning.

---

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**Negative assertions need a proven observer.** "No divider on Schedule" needs a positive control
showing the same harness sees the divider on a surface that keeps it. "No tags in `contextSlot`"
needs a fixture that has tags, proven by the same test finding them in `tagSlot`.

**The Overview/Matchups invariance claim needs its own evidence** — a test or a rendered-markup
comparison that would fail if the shared scoreboard's border changed for them. "I didn't touch those
files" is not evidence if the mechanism is CSS inheritance or a new prop default.

**Pair every mechanism comment with the test that asserts the same behaviour.** If no test asserts
it, the comment must say less.

---

## STOP — read receipt before writing any code

1. **What does Schedule's tag list contain, at most?** Trace `tagPrimary`/`tagSecondary` from
   `selectors/gameWeek.ts:317` back to the cap. Give the maximum count a Schedule row can receive
   and the line that enforces it. If nothing caps it on this path, stop — that is a selector
   defect and out of this SCOPE.
2. **Is "secondary tags with no primary" reachable?** Answer from `prioritizeGameTags`, not from
   the component.
3. **How will the divider be removed on Schedule only?** Name the mechanism: a caller-side
   descendant override, a new `CompactGameScoreboard` prop, or something else. If it touches
   `CompactGameScoreboard.tsx`, state its default and prove the other four renderers get the
   default. If it is a descendant override, say what couples it to the scoreboard's class name and
   what test breaks when that coupling breaks. **This one is ruled on before implementation.**
4. **Does the scoreboard's own `py-3` stack with the block's 7px padding?** The mockup zeroes it.
   Say what renders vertically inside a block, in pixels, before and after.
5. **Row separation:** is Schedule's single-column layout a grid or `display: block` at every
   width the container query produces? Say whether `gap` or sibling margins apply.
6. **Which existing assertions change**, by file and line, and why each change is not a weakening.
7. **Row 26:** show from `CompactGameScoreboard.tsx` which Schedule rows gain the wrap exception
   after the move, and which must not.
8. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
