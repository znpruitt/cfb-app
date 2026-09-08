PROMPT_ID: PLATFORM-155-MATCHUPS-SCHEDULED-ROW-CODEX-v2
PURPOSE: Item 155 — give Matchups rows their records, and stop reserving an empty odds footer. Every row on that surface is scheduled right now, and every one has no right-edge anchor and a ~40px hole under it.
SCOPE: `src/components/MatchupsWeekPanel.tsx`, whatever threads props from `CFBScheduleApp`, and the odds-footer condition in `src/components/CompactGameScoreboard.tsx`. Tests for each. NOT the records selector, NOT the Matchups page's data loading — both already work.
CARRIES: `item-87-INDEX.md` CARRY rows 1, 7 and 8, verbatim in the task block. Row 20 is a sequencing constraint on this slice and is quoted too.

Read `AGENTS.md` first, then **`DESIGN.md`** — canonical for UI. Nothing in either is restated.

## The documents are VERIFIED as of 2026-09-08

Item 144 read all sixteen end to end and marked every claim in place. **`item-87-INDEX.md` is the map
and it is trustworthy** — that was not true two days ago, and three wrong prompts came out of the set
before it was. Read the INDEX first. Where a document contradicts it, the INDEX wins and that is a
finding.

## CARRIED OBLIGATIONS — verbatim, and row 1 is this slice's entire premise

> **Row 1 — LIVE.** A build with records absent or stale **will not match the mockup**, and a reviewer
> comparing them must read that as a **sequenced dependency, not a defect**. **Owner ruling
> 2026-09-08:** a missing record leaves the anchor **blank**, never the spread — and a **store
> failure** (transient, no item) is NOT the same condition as **"not wired to this surface"** (a
> sequencing state that needs a filed item and this sentence in the prompt). Records are wired on
> Overview only; Matchups and Schedule are in the second state.

**This item is that filed item, and this slice moves Matchups out of the second state.**

> **Row 7 — LIVE.** Do not read campaign status from the canonical document, and **re-derive every
> line-number citation** before putting it in a prompt — they have been stale at least twice, and
> `DESIGN.md` moved again on 2026-09-08.

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. Now four consumers plus the recap.

> **Row 20 — SEQUENCING.** Retire the outcome rail on Matchups and let the tint carry outcome — a
> precondition for Item 119, not polish; **decide it with records (row 1) before anything else on
> Matchups moves.** The records half is decided by this slice. **The rail is NOT yours** — but do not
> add anything that makes retiring it harder.

## What is already true — verified against the code 2026-09-08, do not re-derive

**The data already reaches the surface.** `matchups/page.tsx:33` calls `loadTeamRecordsClientProps`
and `:57` spreads `{...teamRecordProps}` — **identical to Overview's `:33` and `:56`.** The Matchups
page loads records and passes them into the shell today. **`MatchupsWeekPanel` simply never accepts
them** — no `record` prop, no reference. This is a threading job, not a wiring job.

**The component already implements both placements.** `CompactGameScoreboard` takes
`record?: TeamRecordClient | null` per participant and renders it two ways: an **inline parenthetical**
next to the team name, and the **right-edge anchor**. Both paths exist and are exercised by Overview.
**You are passing a prop, not building placement.**

## The records rule — from `item-87-followon-records.md`, marked CURRENT

| State | Anchor | Record position |
| --- | --- | --- |
| Scheduled | **team record** | the anchor itself |
| Live | score | **inline**, parenthetical after the team name |
| Final | score | **inline**, parenthetical after the team name |

**"One rule, not two."** The record shown is always the team's *current* record — never "entering"
versus "after". **No state-dependent branching in the data layer.**

**The position shift is accepted and the alternative was rejected**: record inline in every state with
the scheduled anchor given back to the spread was weighed and turned down, because the anchor must
hold the most relevant number in each state.

**Degradation — only when a record is unavailable, never in the normal case.** Live and final omit the
parenthetical. **A scheduled row with no record leaves the anchor BLANK** — a deliberate, recorded
exception to `DESIGN.md` → *Right-edge anchor rule*. The spread fallback that document once described
is **superseded**; a spread in a record's slot misrepresents what the slot means. Missing data beats
wrong data.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Name every prop `MatchupsWeekPanel` accepts today**, and say which one carries records. Then name
   what `OverviewPanel` receives that it does not. **The gap is the slice**; if it is larger than a
   prop, say so now.
3. **Already answered by your blocking report and accepted — skip it.** Your finding that the
   reservation is deliberate, documented, and asserted by an Overview test is confirmed and is now the
   ruling above. Do not re-derive it. Instead: **quote the AMENDED `DESIGN.md` band rule with its
   current line number**, and name every consumer whose rendered output moves under the ruling.
4. **A scheduled row with no record renders a blank anchor, by ruling.** Say what a reader sees, and
   whether anything on the row distinguishes *this record is unavailable* from *this surface has no
   records wired*. **If nothing does, that is a finding** — the two conditions were ruled distinct on
   2026-09-08 and a reader cannot currently tell them apart.
5. Anything that CONTRADICTS what you were handed. **The claims that the page already loads records
   and that the component already implements both placements are mine and are checkable — check
   them.**

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/155-matchups-scheduled-row` from current `origin/main`, in `/Users/zach/cfb-app-codex`.
A `pre-push` hook runs `npm run lint:all`. **`preview` is free** — the Item 117 grant lapsed on merge.
If you want it for this slice, ask; the same one-writer test applies and the Claude lane is on Item 153,
which will not push it.

<task>
1. **Thread records into `MatchupsWeekPanel` and pass them per participant.** The component places
   them per state; you supply them. Both participants, every state.
2. **Move the odds-footer reservation to the consumer that needs it — OWNER RULING 2026-09-08,
   answering your blocking question, and your reading of the contradiction was correct.** The v1
   framing was wrong: the reservation is deliberate and documented, not an accident, and you were
   right to stop rather than proceed.

   **The ruling is caller-specific, and it is structural rather than a preference.** The reservation
   exists so two cards **side by side in a grid** stay equal height when one has odds and the other
   does not — the component's own comment says "reserves peer-card height". **Overview is that grid**
   (`grid grid-cols-2`), and it is **the only `footerSlot` caller in the repo** (`OverviewPanel.tsx:785`),
   so it is the only surface where the band does any work. **Matchups is a vertical list inside one
   owner card** (`<ul>`/`<li>`) — no peer to align with. **Schedule is a grid but never passes
   `footerSlot` at all**, so its band is empty on every card and aligns nothing.

   So: **the component reserves nothing on its own, and a consumer that needs the band asks for it.**
   Overview asks; Matchups and Schedule do not. That removes the `state === 'scheduled'` test rather
   than adding to it, which is what the enumerate-per-state rule requires.

   **`DESIGN.md` has been amended accordingly (`main`, 2026-09-08) — pull before you start.** It no
   longer says the footer "always" reserves the band; it says the consumer that needs peer alignment
   passes it. **Rebase onto that commit and cite the amended text, not the old line.**

   **Mechanism is yours, under two constraints:** no new state test inside the scoreboard, and the
   grid-alignment reason must be legible at Overview's call site rather than implied. **Do not widen
   the scoreboard with a `reserve` flag** — a caller passing what it wants is the point.

   **Overview's existing test is the proof, and it must pass UNCHANGED.**
   `OverviewPanel.test.tsx:537` — *"preserves an empty odds row"* — still holds, because Overview
   still asks for the row. If that test needs editing, the mechanism is wrong.
3. **Say in the report what a member sees** on a scheduled Matchups row before and after.
</task>

<gate>
**Do NOT restore records to Schedule.** Item 87 slice 5 removed them deliberately; Schedule is still in
the not-wired state and getting it out is a separate slice with its own review.

**Do NOT fork the scoreboard, and do NOT widen it** beyond the footer condition — a `reserveFooter`
flag is a widening and is refused by the ruling.

**Do NOT change Overview's rendering or edit its tests.** Overview asks for the band and keeps it. Four consumers plus
the recap depend on it. If records need placement work, that contradicts this prompt — stop and report.

**Do NOT give a recordless scheduled row a spread, an em-dash, or a placeholder.** Blank is the ruling.

**Do NOT touch the outcome rail** (row 20). It is Item 119's precondition and not yours — but do not
entrench it either.

**Do NOT change the records selector or the page's data loading.** Both work.

STOP and report if `MatchupsWeekPanel` cannot reach the records without a change above the panel, or if
threading them forces a change to a shared type.
</gate>

<completeness_contract>
- **A scheduled row renders the record as its right-edge anchor.** The headline; assert it directly.
- **A live and a final row render the record INLINE**, not in the anchor — the anchor holds the score.
  Assert both states; a scheduled-only fixture proves a third of the rule.
- **A scheduled row with NO record renders a blank anchor** — not a spread, not a dash. Assert the
  absence, and mutation-prove it by supplying a spread and showing a named test go red.
- **An empty footer reserves no height.** Assert on the rendered output, not on the prop.
- **A footer WITH content still renders** — the suppression must not remove the slot for consumers
  that use it. Schedule does.
- **Overview is byte-identical.** Prove by mutation; you are changing a shared component, and Overview
  is the one consumer whose rendering must not move.
- **Schedule changes visibly, and that is intended.** Every scheduled Schedule card loses an always-
  empty band. **Do not preserve it, and do not mutation-prove it identical** — the v1 contract said
  byte-identical and was written before the ruling. **Report the change as a visible change**, with what
  a member sees on a scheduled Schedule card before and after. If it looks like more than removed dead
  space, stop and report.
- **Generate over the type's contract** (`AGENTS.md`), varying state, record presence, and both
  participants independently — a self game tints both rows and both carry records.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving a blank anchor stays
blank; the mutation proving Overview and Schedule are untouched; and anything you deliberately did not
do.

**Say what a member sees on a scheduled Matchups row, before and after.** Every row on that surface is
scheduled until Thursday, so this is the whole visible outcome of the slice.

**Report whether a blank anchor is distinguishable from a not-wired surface**, per receipt item 4. If it
is not, say so — that is a finding for the queue, not something to solve here.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 155 status, and
**`item-87-INDEX.md` CARRY row 1 updated** — Matchups leaves the not-wired state, Schedule does not.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. Promotion is not.
</output_contract>
