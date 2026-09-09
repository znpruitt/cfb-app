PROMPT_ID: PLATFORM-173A-FEATURED-TAG-SLOT-CODEX-v2
PURPOSE: Item 173a — Featured already HAS its tags and never passes them, and its badge sits above the status row. Wiring only. Live and Recent finals are split out as 173b, a selector slice.
SCOPE: `src/components/OverviewPanel.tsx` and tests. **NOT `overviewGameSections.ts`** — that is 173b. NOT the shared scoreboard's contract. NOT tag SELECTION or precedence.
CARRIES: `item-87-INDEX.md` CARRY rows 7 and 8, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`**. Nothing in either is restated.

## What Item 143 just built, and why this is now cheap

**Merged 2026-09-08, PR #587 (`ac965a19`).** The shared scoreboard now has a **status-row tag seam** —
tags render inside the header row, right-aligned, without adding a line. Matchups already uses it.

**Overview does not, and three of its four sections pass no tags at all.**

## The findings, from the Item 167 audit

**Evidence:** [`docs/archive/audits/codebase-audit-existing-plans-2026-09-08.md`](../archive/audits/codebase-audit-existing-plans-2026-09-08.md)
for the campaign context, and Item 173 in `docs/next-tasks.md` for these two specifically.

**R3 — three sections render no tags.** Probed during the audit: a Live game that is **both** a Top 25
Matchup and Close rendered `[]`. `Upset` exists in the league family and has never reached Recent
finals. The mockup carries `Top matchup` eyebrows on Live cards.

**R4 — Featured's badge is above the status row.** Its CFP/conference badge goes through `contextSlot`,
which renders in its own `div` **above** `data-scoreboard-header` — so it adds a line, which is the
defect the presentation work exists to remove. `reference-game-row.md` §15: **the bowl name is a
per-game eyebrow, in the tag slot.**

## RULINGS ON YOUR RECEIPT — the gate fired correctly and this slice is now half the size

**Both findings accepted, and the scope error was mine.**

### RULING 1 — split. Featured only. Live and Recent finals become 173b.

**Your characterisation is exactly right and I verified it.** `selectOverviewGameSections`
(`overviewGameSections.ts:188`) takes `sectionItems: OverviewGameItem[]` — **unprioritized** — and
`routesByKey` (`:196-198`) carries them through unchanged. `prioritizeOverviewItems` needs
`highlightSignals` and `rankingsByTeamId`; **`topOwnerNames` is NOT among them, having been retired
with Item 162** (`overview.ts:312-314`). Giving Live and Recent finals tags is a
**signature change on the section builder**, touching ordering and section composition, which is Item
115's neighbourhood.

**My own gate said a selector change is "a selector slice with its own review", so it gets one.** Widening
this prompt's scope to reach it would be me stepping over a boundary I wrote three hours ago.

**What you build now is Featured, and it is genuinely wiring:** `PrioritizedOverviewItem` carries
`highlightTags` (`overview.ts:42`), Featured receives prioritized items (`OverviewPanel.tsx:1730`), and
it simply never passes them to `tagSlot`.

### RULING 2 — the scope line was wrong, and you were right to name it

The prompt named `src/lib/selectors/overview.ts`. **The data is lost in `overviewGameSections.ts`**,
which was not in scope. Corrected above by removing the file rather than adding it — 173b owns it.

### RULING 3 — the badge's line-height. Your point 4 is the sharpest thing in the receipt.

**Preserving the class string is NOT sufficient**, exactly as you say: the tag-slot wrapper applies
`leading-none`, so a literal move changes inherited metrics while every class stays identical. **That is
a silent visual change that would pass a class-name assertion.**

**Assert the rendered metrics, not the classes** — slate colour, border, fill, typography, padding and
line-height preserved, position changed. If the only way to keep the line-height is an explicit override
on the badge, that is acceptable and should be commented with this reason.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the tag seam as Item 143 built it**, with current line numbers re-derived, and say exactly
   what a caller passes to use it.
3. **Say whether the three sections already RECEIVE tags and merely fail to pass them, or never
   compute them.** Those are different slices — the first is wiring, the second needs the selector.
   **Say which this is before building either.**
4. **Featured's badge: say whether moving it into the tag seam changes what it looks like**, not only
   where it sits. It is slate, not bronze — `deriveFeaturedGameBadge` has two branches and the sibling
   is already slate. **Moving a badge must not restyle it.**
5. Anything that CONTRADICTS what you were handed.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/173-overview-tags` from current `origin/main`, in `/Users/zach/cfb-app-codex`.
A `pre-push` hook runs `npm run lint:all`.

**`preview` is yours** — it holds `2f802d96`, Item 143's merged branch, now stale. **But the Vercel
free-tier deployment quota was exhausted on 2026-09-08** (100/day, and a skipped docs build still burns
one), so deployments may be refused for up to 24 hours. **That is not a build failure and not something
you broke** — see `docs/deployment-runbook.md`. Push anyway; the ref matters even when the deploy is
refused.

<task>
1. **Pass Featured's existing `highlightTags` to `tagSlot`.**
2. **Move Featured's badge off `contextSlot` into the tag seam**, unchanged in RENDERED APPEARANCE —
   see RULING 3; the class string is not the test.
3. **Report what a member sees on Featured, before and after.**

**CARRIED OBLIGATIONS — verbatim:**

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — five direct renderers, and the recap is not one;
> `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation**.
</task>

<gate>
**Do NOT change which tags are selected or their precedence** — selector-owned (row 8). This slice
changes which surfaces RENDER them.

**Do NOT restyle the Featured badge.** Slate stays slate; the CFP sibling is already slate and splitting
one badge family by hue gives a reader nothing to decode.

**Do NOT widen the shared scoreboard.** 143 built the seam; use it.

**Do NOT re-cap.** `TOP_BADGE_LIMIT = 2` applies in the selector already.

**Do NOT touch the watchlist.** Its tags already render; its remaining divergences are Items 160, 186
and 187.

**Do NOT touch `overviewGameSections.ts` or Live/Recent finals.** That is **Item 173b**, filed, and it
needs the prioritized inputs threaded into `selectOverviewGameSections` — a signature change with its own
review.

STOP and report if passing Featured's tags requires any selector change at all.
</gate>

<completeness_contract>
- **A Featured game carrying a highlight tag renders it in the status row.** Mutation-prove it.
- **Featured's badge renders IN the status row with its RENDERED METRICS unchanged** — colour, border,
  fill, typography, padding and line-height. **A class-string assertion does not satisfy this**; the
  slot's `leading-none` is why.
- **Featured gains no line.** A badged row and an unbadged row are the same height.
- **Live, Recent finals and the watchlist are byte-identical.** Prove by mutation.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving a Featured tag now renders;
the mutation proving the watchlist is untouched; and anything you deliberately did not do.

**Say what a member sees per section, before and after.**

**Report whether this was wiring or a selector change**, per receipt item 3.

**Report new findings; do not file them.**

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 173 status, and
Item 167's residue count annotated with what this slice removed from it.

Merge is delegated to this lane under `CLAUDE.md`, including the four conditions. Promotion is not.
