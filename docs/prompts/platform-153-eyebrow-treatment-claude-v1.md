PROMPT_ID: PLATFORM-153-EYEBROW-TREATMENT-CLAUDE-v1
PURPOSE: Item 153 — one eyebrow treatment across three surfaces. Overview is still the blue `DESIGN.md` violation Item 117 corrected elsewhere, and the two surfaces that were corrected do not match each other.
SCOPE: the eyebrow/tag treatment in `OverviewPanel.tsx`, `GameWeekPanel.tsx` and `MatchupsWeekPanel.tsx`, and wherever the shared constant lands. Tests for each. NOT tag SELECTION, NOT tag PLACEMENT (Item 143), NOT the champion amber token.
CARRIES: `item-87-INDEX.md` CARRY rows 4, 7 and 8, verbatim in the task block. Row 4 is a recording obligation this slice can discharge.

Read `AGENTS.md` first, then **`DESIGN.md`** — canonical for UI, and this slice corrects a live violation of it. Nothing in either is restated.

## The documents are VERIFIED as of 2026-09-08

Item 144 read all sixteen end to end and marked every claim in place. **`item-87-INDEX.md` is the map
and it is trustworthy** — that was not true two days ago. Read it first; where a document contradicts
it, the INDEX wins and that is a finding.

## Three surfaces, three treatments, and one is non-compliant

Measured 2026-09-08:

| surface | treatment | state |
| --- | --- | --- |
| **Overview** | `text-blue-700 dark:text-blue-300` (reason row `:755`), and the chip at `:195` carries `border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300` | **LIVE VIOLATION** |
| Schedule | `border-[#c9a66b]/40 … text-[10px] … text-[#dbc190]` (`GameWeekPanel.tsx:18`) | bronze, one spelling |
| Matchups | `border-[0.5px] border-[rgba(201,166,107,0.40)] … text-xs … text-[#dbc190]` (`MatchupsWeekPanel.tsx:35`) | bronze, another spelling **and a different size** |

**Blue is not a weaker choice — it is non-compliant**, and the campaign document says so directly:
`DESIGN.md` states *"Blue signals interactivity or active state only — never use blue to mean 'featured'
or 'important'."* An eyebrow tag is exactly a featured/important signal. **This is a correction to
shipped, not a preference.** Do not re-argue it.

**Re-derive the `DESIGN.md` line number before citing it** (CARRY row 7). It moved on 2026-09-08 and the
campaign document's own citation is now stale.

## Why ONE item and not three fixes

Fixing Overview alone produces a **third** bronze spelling. Unifying Schedule and Matchups without
Overview leaves the violation standing. **The three are one decision: pick the treatment, put it in one
exported constant, use it in three places.** Two near-identical string literals is how the Schedule and
Matchups treatments drifted in the first place — the same mechanism Item 143 exists to stop one level up.

## What the decision already settles — do not reopen it

From `matchups-schedule-design.md` → *Colour: bronze*, marked CURRENT:

- Bronze ranked above sky, neutral and fuchsia. Decided earlier in the campaign.
- The *"gold is champion-reserved"* objection is **answered by temporal separation**: champion treatment
  does not render until a title is awarded, so bronze is uncontested through the year. At season end the
  two remain distinguishable — bronze is a desaturated tan, champion amber (`#BA7517`) a dark saturated
  gold. **The reservation binds a token to a purpose, not a hue neighbourhood.**
- **The measured weakness, carried forward honestly:** bronze against champion gold is **1.37:1** —
  essentially no luminance contrast, separated by hue and saturation alone. That is the one moment they
  sit adjacent and the case that fails for a viewer with reduced colour discrimination. **If that pairing
  ever needs to survive that viewer, the instrument is a luminance step, not a different hue.** Do not
  solve it here; do not let the treatment you pick foreclose it.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the blue rule from `DESIGN.md` with its CURRENT line number**, re-derived. Then quote all
   four blue spots — `OverviewPanel.tsx:195` and `:755`, plus whatever else a repo-wide search finds —
   and say which are eyebrow tags and which are something else. **Not every blue is this slice's.**
3. **Quote both bronze constants verbatim** and enumerate every way they differ — border syntax, border
   width, text size, anything else. Say which spelling is correct and why, or say they are equivalent
   and the difference is only expression.
4. **Name every surface that renders an eyebrow tag**, not just the three above. **The recap renders one
   too** (`item-87-followon-recap-scoreboard.md`, bronze pill right-aligned). Say whether it is in scope
   or blocked, and on what.
5. Anything that CONTRADICTS what you were handed. The measured contrast figure, the four blue spots and
   the two spellings are all mine and all checkable — check them.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/153-eyebrow-treatment` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** The Codex lane is on Item 155 and may hold it; the standing push-every-commit
instruction in `CLAUDE.md` is suspended for this branch.

<task>
1. **One exported constant**, consumed by all three surfaces. Not three literals that happen to agree.
2. **Convert Overview** — both the reason row and the chip, if the chip is an eyebrow. Receipt item 2
   settles which.
3. **Reconcile the two bronze spellings** to whichever the receipt establishes as correct, including the
   text size.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 4 — LIVE, the recording half.** Slice 5 records the amber `upset` border as **deliberately
> retired**, the eyebrow pill carrying its emphasis forward. The border IS gone (`cardEmphasisClasses`
> deleted, registry records the deletion); **no document states it as a decision** — `DESIGN.md` never
> mentions `upset`. **This slice is the natural place to close it**: you are making the pill the single
> emphasis instrument across three surfaces, which is exactly the sentence `DESIGN.md` is missing.

> **Row 7 — LIVE.** Re-derive every line-number citation before putting it in a prompt or a document.

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard must not be forked.
</task>

<gate>
**Do NOT change tag SELECTION or PLACEMENT.** Which tags appear, and where they sit in the row, are
selector-owned and **Item 143** respectively. This slice changes what a tag looks like and nothing else.

**Do NOT touch the champion amber token** (`#BA7517`). It is reserved by purpose and the 1.37:1 pairing
is a known, recorded, out-of-scope weakness.

**Do NOT convert a blue that is not an eyebrow.** Blue is the correct token for interactivity and active
state. Receipt item 2 separates them; converting a link or a control is a regression.

**Do NOT widen `CompactGameScoreboard`.** The eyebrow is caller-rendered.

STOP and report if the two bronze spellings are not equivalent — if one is measurably different in
rendered output rather than only in expression, that is a decision, not a cleanup.
</gate>

<completeness_contract>
- **No blue eyebrow remains on any surface.** Assert against the rendered element, not a class-name
  string match — a test keyed on a label rather than the element has shipped in this campaign before.
- **All three surfaces render the same treatment.** Assert equality of the rendered result across the
  three, not that each matches a literal — that is the assertion that catches the next drift.
- **Interactive blue is untouched.** Prove by mutation: convert a link's blue and show a named test go
  red.
- **The constant is the single source.** Assert no surface carries its own bronze literal; a future
  fourth consumer must be unable to add one silently.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving interactive blue is
untouched; and anything you deliberately did not do.

**Say plainly that Overview's eyebrow was non-compliant and now is not** — this is a correction to
shipped, and the report should read as one.

**Report whether the recap is in or out**, per receipt item 4, and why.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 153 status,
**`DESIGN.md` gaining the retired-`upset`-border sentence** (CARRY row 4), and `item-87-INDEX.md` moving
rows 4 and 42 to DISCHARGED with where the work landed.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. Promotion is not. **Push the branch only — not `preview`.**
</output_contract>
