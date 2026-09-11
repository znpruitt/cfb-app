PROMPT_ID: PLATFORM-179-AWAITING-ANCHOR-CODEX-v2
PURPOSE: Item 179 — the awaiting anchor renders an em dash where the contract specifies an en dash. **Item 170 is CLOSED, not built** — your receipt is what closed it.
SCOPE: `src/components/CompactGameScoreboard.tsx` and tests. NOT the tag seam. NOT tag selection or placement. NOT the outcome rail or the owner tint.
CARRIES: `item-87-INDEX.md` CARRY rows 7 and 8, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`**. Nothing in either is restated.

## Two small items, paired because they share one file

**Neither is worth its own branch, and two branches against one file would cost more than the work.**
Both were found by audits and deliberately not fixed at the time — 170 because the lane that found it
was gated out of this file, 179 because folding it in would have quietly shrunk a residue count that
was the deliverable.

## 170 — the owner name has no fallback

**Item 163 retired the `vs <owner>` pill on Matchups.** That was right: it duplicated a name already on
the team row. **But it was also the fallback.**

The owner now renders only here (`CompactGameScoreboard.tsx:264-271`):

```tsx
{owner ? (
  <span className="ml-1.5 text-[12.5px] font-normal dark:text-zinc-400" data-scoreboard-owner={side}>
    {owner}
  </span>
) : null}
```

…inside `<span className="min-w-0 truncate">` (`:255`), which itself sits in a
`overflow-hidden whitespace-nowrap` row (`:241`). **So on a narrow card the owner is the first thing to
ellipsize, and there is nothing else carrying it.**

**The ask: decide what protects it, and the decision is yours to propose.** The obvious candidates each
have a cost — `shrink-0` on the owner moves the clipping onto the team name, which is worse; a
`title` attribute helps a mouse and not a phone. **Say what you are trading before you build it.**

## 179 — the awaiting anchor renders an em dash

`:290` renders `{participant.score ?? '—'}` — an **em dash**. `reference-game-row.md` §4 and §11 both
specify **`–`, an en dash**, and so does the mockup.

**Trivial, and that is the point:** it was filed rather than folded so the Item 167 audit's residue
count stayed honest. Fix it as itself.

**Check whether anything asserts the current glyph** before changing it — a test pinning `—` would go
red, and that is the correct outcome, not a reason to leave it.

## RULING — Item 170 is CLOSED. Your receipt closed it. Build 179 only.

**Your premise check held and your trade statement is what settled the item — in the opposite direction
from the one it was filed in.**

You proposed protecting the owner by letting the team name clip on rows without an inline record, and
**you named that cost rather than burying it.** That is what made the question visible.

**`reference-game-row.md` §3: team name is Primary, owner is a Tertiary suffix. There is no degradation
rule for the team line at all** — the only one in the document governs the status row, where the tag is
protected because it is the scarce signal. Nothing makes the owner scarce; it is recoverable from the
standings.

**So the owner clipping first is the documented hierarchy working, and Item 170 is not a defect.**
Owner ruling: **team name stays primary.** `Georgia Sou… Chamness` names who owns something a reader
can no longer identify.

**Item 170 is closed without code. Do not build the protection. Do not restore the pill.**

**Everything below about 179 stands unchanged.** Two tests pin the em dash — `MatchupsWeekPanel.test.tsx:531`
and `:861` — and both going red is the correct outcome, not a reason to hedge the fix.

**One correction accepted:** my `:255` citation was one line stale; the `min-w-0 truncate` element opens
at `:254`.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the owner span and every enclosing element that constrains its width**, with re-derived line
   numbers. Say **which element actually ellipsizes first** at narrow width — team name, record, or
   owner. **The premise of 170 is that it is the owner; check it rather than accept it.**
3. **Propose the protection and name its cost.** What gets clipped instead, and on which surfaces. **A
   proposal with no trade named has not been thought through** — every option here moves the problem
   rather than removing it.
4. **Name every consumer whose rendering changes**, for both items. Five direct renderers consume this
   component; the recap does not (`RecapPrimitives.tsx:277` still has its own).
5. Anything that CONTRADICTS what you were handed — including the claim that the owner is the element
   that clips, which is mine and is checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/170-179-scoreboard-row` from current `origin/main`, in `/Users/zach/cfb-app-codex`.
A `pre-push` hook runs `npm run lint:all`.

**`preview` is yours.** Four merges are sitting on `main` unpromoted and the last preview push was two
slices ago, so this is the first chance in a while for the owner to click through. **Push it with every
commit.**

<task>
1. **Protect the owner name from being the first thing lost**, per your proposal in receipt item 3.
2. **Render `–` on the awaiting anchor.**

**CARRIED OBLIGATIONS — verbatim:**

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — five direct renderers, and the recap is not one;
> `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation**.
</task>

<gate>
**Do NOT restore the `vs <owner>` pill.** Item 163 retired it deliberately and it duplicated the name.
The fix is protecting the surviving instance, not bringing the duplicate back.

**Do NOT touch the tag seam.** Item 143 built it and Item 173a just consumed it.

**Do NOT change what the anchor HOLDS**, only the glyph it falls back to. Scheduled holds the record,
live and final hold the score, awaiting holds the dash — `reference-game-row.md` §4.

**Do NOT solve 170 by widening the row or shrinking the team name's priority** without saying so in the
report. Moving the clip is legitimate; moving it silently is not.

STOP and report if the element that ellipsizes first turns out not to be the owner — that would mean
Item 170's premise is wrong and the item needs re-filing, not building.
</gate>

<completeness_contract>
- **The owner survives a narrow render that previously lost it.** Assert on rendered output, and
  **mutation-prove it** — revert the protection and show a named test go red.
- **Whatever now clips instead is asserted too.** A test that proves the owner survives without proving
  what took its place has documented half the change.
- **The awaiting anchor renders `–`.** Assert the exact character; `—` and `–` are one codepoint apart
  and a loose match will pass on either.
- **The other four consumers are byte-identical** where they do not render an awaiting row. Prove by
  mutation.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the owner survives; the
mutation proving the other consumers are untouched; and anything you deliberately did not do.

**Say what a member sees at narrow width, before and after** — which element is lost now, and which is
lost instead.

**Say plainly whether Item 170's premise held**, per receipt item 2.

**Report new findings; do not file them.**

Closeout is a separate pre-merge commit after review convergence: registry entry, Items 170 and 179
status, and **Item 167's residue count annotated** — 179 was one of its eight, and the count should say
so rather than silently shrinking.

Merge is delegated to this lane under `CLAUDE.md`, including the four conditions. Promotion is not.
**Push `preview` with every commit.**
