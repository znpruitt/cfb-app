PROMPT_ID: PLATFORM-143-MATCHUPS-STATUS-ROW-CODEX-v1
PURPOSE: Item 143 — give the shared scoreboard the seams Matchups needs, so tags sit IN the status row instead of adding a line above it. This unblocks the recap adoption, the Matchups reconciliation, and three of the six Overview back-application items.
SCOPE: `src/components/CompactGameScoreboard.tsx`, `src/lib/gameUi.ts`, `src/components/MatchupsWeekPanel.tsx`, and tests for each. NOT the recap. NOT Overview's or Schedule's rendering. NOT the outcome rail.
CARRIES: `item-87-INDEX.md` CARRY rows 7, 8, 20, 25 and 26, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`** — canonical for UI. Nothing in either is restated.

## The canonical sources, and one is new

- **`docs/campaigns/item-87-reference-game-row.md`** — **read §1, §2, §9 and §11 before anything
  else.** New 2026-09-08. It is a REFERENCE: it consolidates decisions recorded elsewhere and **adds
  nothing new**. Where it and another document disagree, `item-87-INDEX.md` arbitrates and the
  reference yields. **A claim in it that no other document supports is a defect in that file — report
  it, do not build on it.**
- `docs/campaigns/item-87-followon-presentation-decisions.md` → *Status row*. The structural decision.
- `mockups/matchups-schedule-mockup.html` — the reference render.

## THE FILED ITEM IS STALE. Two of its four divergences have moved.

**Re-verified against `main` at `0ab9b76d`, 2026-09-08.** `docs/next-tasks.md` Item 143 lists four
divergences. **Do not build from that table — build from this one.** Item 155 merged in between and
changed the component underneath it.

| divergence | status on `main` TODAY |
| --- | --- |
| **eyebrow tags in the status row** | **LIVE, and it is the item.** `contextSlot` renders in its own `div` ABOVE the header (`CompactGameScoreboard.tsx:124-128`), so tags placed there ADD A LINE — the exact defect the presentation document exists to prevent, caused by the injection point rather than by the markup |
| **odds on live/final** | **RESOLVED by Item 155.** `footerSlot` is no longer gated on `state === 'scheduled'`; it is content-gated at `:245` (`hasFooterSlot`). A caller may pass a footer in any state today. **Nothing to do.** |
| **status pill `SCH`/`LIVE`/`FINAL`** | **LIVE.** `statusLabel` is `null` when scheduled (`:104-107`) and the component owns the text, so Matchups cannot render `SCH` |
| **live indicator** | **PARTLY RESOLVED, and smaller than filed.** `gameUi.ts:118` `gameStatusLabelPresentation` ALREADY accepts `liveHue: 'neutral'` and `liveDot: 'pulse' \| 'static' \| 'none'`. The scoreboard calls it with **no options** (`:107`), so a caller cannot reach them. **This is prop forwarding, not a redesign.** |

**Two of four are already done or nearly so. Scope accordingly, and say in your receipt if you find
this table wrong** — it is mine and it is checkable.

## The structural decision — from `presentation-decisions.md` → *Status row*

**One flexible left group, one fixed tag pinned right.** The left group holds state, then time, then
broadcast, in that fixed order. The tag sits at the right edge.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the `contextSlot` render block and the header `div` that follows it**, with current line
   numbers re-derived. Then say **exactly what a Matchups row renders today** for a game with two
   tags — how many lines, and which element sits on each.
3. **Name every consumer of `CompactGameScoreboard`** and say, for each, what changes and what does
   not under your plan. **Four consumers plus the recap depend on it** (CARRY row 8). A change that
   moves Overview or Schedule is a finding, not a step.
4. **Say whether the four-row table above is correct**, item by item. **Two of its four claims say
   work is already done** — if either is wrong the scope is larger than this prompt says, and that is
   a stop-and-report.
5. Anything that CONTRADICTS what you were handed.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/143-matchups-status-row` from current `origin/main`, in `/Users/zach/cfb-app-codex`.
A `pre-push` hook runs `npm run lint:all`.

**`preview` is GRANTED for this slice** — it currently holds `7c49203b`, which is Item 153's closeout
and now merged, so it is stale. This is a visible change across a surface the owner reviews by
clicking, which is the condition the grant exists for (`AGENTS.md` → **Preview branch**). The grant is
conditional on **one writer**: the Platform lane is on Items 157/162/163 and its kickoff suspends the
push-`preview` instruction for that branch. The grant lapses on merge.

<task>
1. **Give the status row a tag seam.** Tags must render INSIDE the header row, right-aligned, not in a
   wrapper above it. The mechanism is yours; the constraint is that a tagged row and an untagged row
   are the same height.
2. **Let the caller supply the status label.** Matchups needs `SCH` on scheduled rows, where the
   component currently renders nothing.
3. **Forward the live-indicator options that already exist.** `liveHue` and `liveDot` are implemented
   in `gameUi.ts`; the scoreboard must let a caller reach them. Matchups wants neutral hue and a
   freshness-gated pulse. **The freshness GATE is Matchups' to compute — the component only renders
   what it is told.**
4. **Wire Matchups to all three.** Its tags move off `contextSlot` and into the status row.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 25 — Item 143.** State the `margin-left: auto` trap in the prompt: the left group must grow
> (`flex: 1 1 auto; min-width: 0`), tag `flex: none`.

**Why:** auto margins only absorb FREE space. A tagged status row at two or three columns has none —
it is already overflowing — so the tag lands wherever the metadata ends instead of at the right edge.
And **without `min-width: 0` a flex item will not shrink below its content width**, so the row
overflows and the TAG is what clips, being last in DOM order. That is backwards: the tag is the scarce
signal, the date is recoverable from the heading above.

> **Row 26 — Item 143.** Build the single-column wrap exception as the owner narrowed it: tagged
> scheduled rows at phone width; not a general licence to wrap (`DESIGN.md` amendment 2026-09-08).

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard must not be forked.
> Now four consumers plus the recap.

> **Row 7 — LIVE.** Re-derive every line-number citation before putting it in a prompt or a document.

> **Row 20 — SEQUENCING.** Retire the outcome rail on Matchups and let the tint carry outcome. **NOT
> YOURS** — and it cannot be done alone: the rail exists BECAUSE the tint's outcome states are
> unbuilt, so deleting it today would leave nothing carrying outcome. **Do not add anything that makes
> retiring it harder.**
</task>

<gate>
**Do NOT change what tags are SELECTED or their precedence.** Selector-owned (row 8). This slice
changes where a tag renders and nothing about which one.

**Do NOT touch the outcome rail or the owner tint.** The tint is documented on two axes — identity
(`team-highlight.md`) and outcome (`presentation-decisions.md`) — and **nothing in this campaign
proposes removing it.** Reading "retire the rail" as touching the tint is a misreading of row 20.

**Do NOT move Overview or Schedule.** Both consume the same component. Their rendering is
byte-identical after this slice; prove it by mutation.

**Do NOT re-gate `footerSlot`.** Item 155 made it content-based on purpose, and `DESIGN.md` now says
the consumer that needs peer-card alignment asks for the band. Adding a state back is a regression.

**Do NOT compute freshness in the component.** It renders what it is told.

STOP and report if the tag seam cannot be built without changing Overview's or Schedule's output, or
if giving the caller the status label forces a change to a shared type.
</gate>

<completeness_contract>
- **A tagged row and an untagged row are the same height.** The headline defect; assert it directly on
  rendered output, not on class names.
- **The tag is at the right edge when the row overflows**, not only when it is roomy. **Mutation-prove
  it**: remove `min-width: 0` from the left group and show a named test go red. A test that only
  exercises a roomy row proves nothing — the trap is specific to the overflowing case.
- **Metadata ellipses; the tag never clips.** Assert which element loses, not merely that something did.
- **A scheduled Matchups row renders `SCH`.** Absent today.
- **Overview and Schedule are byte-identical.** Prove by mutation.
- **Generate over the type's contract** (`AGENTS.md`), varying state, tag count 0–2, and metadata
  presence independently. **Two is the cap** (`DESIGN.md`, amended 2026-09-08; `TOP_BADGE_LIMIT`).
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the tag survives an
overflowing row; the mutation proving Overview and Schedule are untouched; and anything you
deliberately did not do.

**Say what a member sees on a tagged Matchups row, before and after**, in lines.

**Report whether the four-row divergence table was correct**, per receipt item 4.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 143 status, and
`item-87-INDEX.md` CARRY rows 25 and 26 moved to DISCHARGED with where the work landed.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the
four conditions. Promotion is not. **Push `preview` with every commit on this branch.**
</output_contract>
