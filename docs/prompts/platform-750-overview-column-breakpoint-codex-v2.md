# PLATFORM-750 v2 — cap the row, then land the measured breakpoint

```text
PROMPT_ID: PLATFORM-750-OVERVIEW-COLUMN-BREAKPOINT-CODEX-v2
PURPOSE: Stop Overview's scoreboard rows stretching to fill their column — cap the row's content
         width and left-align it — and land the breakpoint the v1 receipt already derived (1341px)
         with its measured 52px headroom.
SCOPE:   src/components/OverviewPanel.tsx (the constants at :78-104 and the grid's card wrapper),
         its component suites, src/components/__tests__/OverviewScoreboardGrid.browser.test.tsx, and
         src/test/browserFixture.ts if the harness needs the capped fixture.
         CompactGameScoreboard.tsx ONLY if receipt item 2 shows the cap cannot live in the Overview
         wrapper — it is shared by five renderers, and widening the cap to all of them is NOT this
         slice. DO NOT change the logo slot, the column gap, the 760.01px boundary, Featured's
         four-item cap, any selector, or DESIGN.md (planning amends it — see below). DO NOT permit
         label truncation: that is #821, an owner decision, and this slice must not pre-empt it.
CARRIES: Item 87 INDEX row 71, verbatim, because the cap is ROW ANATOMY and therefore shared:

         "**A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded** —
         Overview, Matchups, Schedule, recap. [...] **every decision in it about the status row, the
         tag slot or row anatomy applies to all four surfaces.**"

         Applied here: the cap SHIPS on Overview only, and the `DESIGN.md` rule planning writes must
         say so explicitly — naming the other three as not-yet-adopted, with #726 as their route.
         Row 71 exists because six decisions were recorded as Schedule decisions while being
         properties of the shared row; do not repeat it in the other direction by silently applying
         a row rule to one surface with no record of the boundary.

         Row 7, verbatim: "**Do not read campaign status from the canonical document**, and
         **re-derive every line-number citation** before putting it in a prompt — they have been
         stale at least twice, and `DESIGN.md` moved again on 2026-09-08."
```

---

## What v1's receipt established, and what it exposed

**Accepted from the receipt, unchanged:** the worst-case fixture; the **402.469px** measured minimum
column; the **403px** rounded target; the **52px** headroom derived as one observed stack-face spread
(17.250px) per column; the resulting **1341px**. Also accepted: all three corrections to v1's prompt.

**What it exposed:** 1341 against 1348 is a 7px change nobody can see, and the visible waste is
elsewhere. The score is right-anchored inside each row (`CompactGameScoreboard.tsx:296`,
`justify-between`), so above the threshold the row stretches with its column and a short card puts
hundreds of pixels between the name and the score.

**Rejected, with the reason recorded so it is not revisited:** content-sized (unequal) columns. Scores
are live-polled and tags are state-dependent, so a content-sized track would resize while a member
watches — a card going `7` → `13` → `100`, or gaining an `Upset` tag, widens its column and shifts
every card in it. It also breaks `DESIGN.md:63`.

## What to build

1. **A capped row content width** on Overview's scoreboard cards, left-aligned in the column, with the
   surplus falling into the gutter. Derive the cap from the fixture already measured — the worst-case
   row must still fit it exactly, since truncation is out of scope.
2. **The measured breakpoint**, 403 / 52 / 1341 as derived, with each constant carrying its provenance
   in the comment the way `OverviewPanel.tsx:78-100` already does.

## Acceptance

1. At a wide window (measure at 1600px and 1920px container widths), the row's content width equals
   the cap and does not grow with the column. Assert the property, not the pixel value.
2. The worst-case fixture still fits the cap with its 12px pre-score gap intact — **no label
   truncates anywhere in this slice**, and a test proves it (the same fixture, measured, no clipping).
3. The three-column threshold is 1341px, derived in code from the named constants rather than written
   as a literal.
4. **A control that genuinely clips**, proving the gate can fail. v1's receipt reports the required
   browser command dying in Chrome startup three times — that must be resolved before any gate result
   counts. If it cannot be, stop and report; a green suite that never ran is not evidence.
5. Featured still renders `3 + 1`; the six-item caps, remainder alignment and the recap tile's
   full-width exception are unchanged, each pinned.
6. Every assertion carrying `1348` is updated — the receipt lists them at `OverviewPanel.test.tsx:536`,
   `:884-887`, `:1263-1266`, `:1269-1280` and `OverviewScoreboardGrid.browser.test.tsx:20`, `:167-176`,
   `:178-202`, `:209-214`.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**A gate that cannot fail is not a gate** — acceptance 4, and it is the one at risk here because the
browser command is already misbehaving.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## What planning owns

`DESIGN.md:405-423`. Report the cap, the target, the headroom and the threshold in your final message;
planning writes the amendment, including the row-71 sentence naming Overview as the only surface that
has adopted the cap. Do not edit that file.

---

## STOP — read receipt before writing any code

1. **What is the cap's value**, and what does it equal — the fixture's content width, the minimum
   column minus the gap, or something else? Say what a reader should understand it to mean.
2. **Where does the cap live?** Overview's card wrapper, or the shared component. If the wrapper can
   carry it, say what couples the two; if it cannot, say precisely why, because moving it into
   `CompactGameScoreboard` changes four other renderers and is out of scope.
3. **What happens at widths between the cap and the column width** — is the surplus gutter, or does
   something else claim it? Show the box model, not the intent.
4. **Does the cap interact with the phone-width wrap exception** (`hasTagSlot && state === 'scheduled'`)
   or with the one-column tier, where the column is already narrower than the cap?
5. **Is the browser command's Chrome startup failure environmental or a repo defect?** Name which, and
   what makes it green. Acceptance 4 depends on it.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
