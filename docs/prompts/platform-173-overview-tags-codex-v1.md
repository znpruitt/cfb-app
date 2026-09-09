PROMPT_ID: PLATFORM-173-OVERVIEW-TAGS-CODEX-v1
PURPOSE: Item 173 — Live, Recent finals and Featured render no tags at all, and Featured's badge sits above the status row. Item 143 built the seam; this converts it.
SCOPE: `src/components/OverviewPanel.tsx`, `src/lib/selectors/overview.ts` if the tags are not already reaching the sections, and tests. NOT the shared scoreboard's contract. NOT tag SELECTION or precedence.
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
1. **Give Live, Recent finals and Featured their tags**, through 143's status-row seam.
2. **Move Featured's badge off `contextSlot` into the tag seam**, unchanged in appearance.
3. **Report what a member sees per section, before and after.**

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

STOP and report if the three sections never compute tags at all — that is a selector slice with its own
review, not a wiring change.
</gate>

<completeness_contract>
- **A Live game that qualifies for a tag renders it.** The audit's probe rendered `[]` for a game that
  was both Top 25 Matchup and Close; that exact case must now render. **Mutation-prove it.**
- **A final row renders an outcome tag.** `Upset` has never reached Recent finals.
- **Featured's badge renders IN the status row and is unchanged in appearance.** Assert both halves —
  position and treatment — or the test proves half the rule.
- **No section gains a line.** A tagged row and an untagged row are the same height.
- **The watchlist is byte-identical.** Prove by mutation.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the Live case now renders;
the mutation proving the watchlist is untouched; and anything you deliberately did not do.

**Say what a member sees per section, before and after.**

**Report whether this was wiring or a selector change**, per receipt item 3.

**Report new findings; do not file them.**

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 173 status, and
Item 167's residue count annotated with what this slice removed from it.

Merge is delegated to this lane under `CLAUDE.md`, including the four conditions. Promotion is not.
