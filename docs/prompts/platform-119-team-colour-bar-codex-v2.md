PROMPT_ID: PLATFORM-119-TEAM-COLOUR-BAR-CODEX-v2
PURPOSE: Item 119 piece 1 — render the 8px team-colour bar at the line-start slot, on the existing normaliser, and render NO accent for a team with no catalog colour. That second half is a bug fix, not a rule.
SCOPE: `src/components/CompactGameScoreboard.tsx`, wherever the colour is computed and threaded, and tests. NOT the OKLCH port. NOT the outcome rail. NOT the owner tint.
CARRIES: `item-87-INDEX.md` CARRY rows 7, 8 and 20, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`**. Nothing in either is restated.

## The sources, and they agree

- **`docs/campaigns/item-87-followon-team-colour.md`** — the decision. **CURRENT** for the 8px bar.
- **`docs/campaigns/item-87-reference-game-row.md` §3** — *Line-start slot: the team colour bar*.
- **`mockups/live-scoreboard-mockup.html`** — the reference render, **rebuilt 2026-09-08**.

**`teamColors.ts` has been orphaned since slice 5 and retained explicitly for this item.** It finally
gets a consumer.

## What to build

**The bar.** From the mockup (`:102-105`), which is the spec:

```css
.sb-line .tc {
  display: block; position: absolute; left: 0; top: 2px; bottom: 2px;
  width: 8px; border-radius: 2px; background: var(--tcol); opacity: 0.72;
}
```

**8px, 2px radius, ~72% opacity, at the line-start slot** — the position reserved for future logos,
immediately before the identity group. `CompactGameScoreboard.tsx:240` already carries a comment
marking that spot.

**Use `getSafeScoreboardTeamColor` (`teamColors.ts:274`) as it ships today** — HSL, contrast-lifted to
≥3:1 against `#0A0A0A`. **Do not port it to OKLCH.** That is piece 2 and it is conditional on piece 1
measuring badly.

## THE SECOND HALF IS A BUG FIX, AND IT IS THE EASIER ONE TO GET WRONG

**A team with no catalog colour renders NO BAR.** Not a grey bar, not a muted default — nothing.

**`getSafeScoreboardTeamColor` returns `buildTreatment(FALLBACK_BASE, 'fallback')`** (`teamColors.ts:283`)
when it has nothing. `FALLBACK_BASE` is `#059669` but **the normaliser returns `#139A70`** — corrected
from the receipt. **Still a green, on a surface where green already means LIVE within the scoreboard
family** (`DESIGN.md` → Color). Shipping the bar without handling this paints every FCS row green.
**Gate on `source !== 'fallback'`, not on the colour.**

**And it is not a rare case.** `item-87-followon-team-colour.md:78`: the team-database refresh uses
`/teams/fbs`, so `TeamCatalogItem.color` is **FBS-only by construction**, and the checked-in seed has
**0 of 138**.

**The reasoning, so you do not re-derive it** (`reference-game-row.md` §3): *an absent bar reads as
missing data; a grey bar reads as a team whose colour is grey.* **The mockup already renders this** —
its FCS row (`:367`) carries `<span class="cls">FCS</span>` and **no `.tc` span at all.**

## Where the colour is computed — decided, do not choose

`item-87-followon-team-colour.md:88`: **compute when `teamCatalogById` is memoised**
(`CFBScheduleApp.tsx:651`), **or precompute when the team database is written** and store raw plus
normalised.

**NOT build-time** — the seed carries no colours. **NOT per-request** — this is a per-row lookup on
every row of every surface.

## RULINGS ON YOUR RECEIPT — all five accepted, and three change the work

**Every finding reproduces. Three of them are mine and two are defects in the reference document.**

### RULING 1 — `source: 'fallback'` is the distinction. No sentinel.

Accepted, and it makes receipt item 2 moot: absence is already expressible. **Gate the bar on
`source !== 'fallback'`**, not on the colour value.

**Your `#139A70` correction stands** — `FALLBACK_BASE` is the seed, the normaliser returns `#139A70`.
Still green, so the premise holds and the prompt's colour was the wrong one to cite.

### RULING 2 — introduce the memo. It is in scope.

**`teamCatalogById` does not exist** — verified, zero matches, and `CFBScheduleApp.tsx:651` is
`filteredWeekGames`. The design doc's citation is stale. **"Compute at catalog memoisation" requires
the memo to exist, so creating it is part of this slice, not a scope widening.** Your O(T) + two O(1)
lookups is the right shape.

### RULING 3 — establish the slot. My "reserved space already exists" was wrong.

**Verified: the participant row has no left padding.** The structural insertion point exists; the
physical space does not. **Creating it is in scope**, and so is making the row a containing block —
the source comment already assigns that to this item, and you are right that `relative isolate` is
currently conditional on the Matchups owner tint.

**Do not let the row get wider overall.** The slot comes out of existing space, not added to it.

### RULING 4 — §11's recap row was a FORECAST. Marked on `main`.

You caught a table describing a surface that does not consume the component at all. **Corrected** — the
recap cell now carries a footnote saying its `yes` is post-adoption and blocked behind Item 143.
**Item 119 does not give the recap a bar.**

### RULING 5 — §3 said "Work in OKLCH, not HSL". That was the document overreaching, and it is corrected.

**This is the sharpest finding in the receipt.** §3 stated the endpoint as an instruction while the
settled decision is **staged**: piece 1 on the existing HSL normaliser, piece 2 conditional on piece 1
measuring badly. **A reference document is meant to consolidate settled decisions, and what is settled
is the staging.** Corrected on `main`, with the reason.

**Follow the prompt: HSL first. The OKLCH shape and its reserved-hue guard are preserved in §3 for
piece 2, if piece 2 happens — and your report is what decides that.**

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote `getSafeScoreboardTeamColor`'s return for a team with no colour**, and say how a caller
   currently distinguishes that from a real colour. **If it cannot, say so** — the no-bar rule needs a
   distinguishable absence, and manufacturing one may be part of this slice.
3. **Say where you will compute it**, of the two sanctioned places, and why. **Name what it costs on a
   full-slate render.**
4. **Name every consumer that gains a bar.** Five direct renderers; `reference-game-row.md` §11 gives
   the bar to all four surfaces. **Say whether any of them positions the line-start slot differently**,
   because an absolutely-positioned element needs its container to establish the containing block.
5. Anything that CONTRADICTS what you were handed — including the 0-of-138 seed claim and the
   `#059669` fallback, both of which are checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/119-team-colour-bar` from current `origin/main`, in `/Users/zach/cfb-app-codex`.
A `pre-push` hook runs `npm run lint:all`.

**`preview` is yours.** Five merges were promoted on 2026-09-09, so preview and production are level —
**push it with every commit** so the owner can see this one against a known-good baseline.

<task>
1. **Render the 8px bar** at the line-start slot, per team, on the existing normaliser.
2. **Render nothing when the team has no catalog colour.**
3. **Compute it once**, in one of the two sanctioned places.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 20 — SEQUENCING.** Retire the outcome rail on Matchups and let the tint carry outcome. **NOT
> YOURS**, and it cannot be done alone — the rail exists BECAUSE the tint's outcome states are
> unbuilt. **Do not add anything that makes retiring it harder.**

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — five direct renderers, and the recap is not one;
> `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation**.
</task>

<gate>
**Do NOT port to OKLCH.** Piece 2, conditional on piece 1 measuring badly, and not a dependency.

**Do NOT render a fallback colour.** No colour means no bar. **If `getSafeScoreboardTeamColor` cannot
express "nothing", changing that is in scope — quietly accepting its green is not.**

**Do NOT touch the outcome rail or the owner tint.** Row 20; the rail cannot be retired alone and the
tint is not in question on either axis.

**Do NOT compute per-request or at build time.** Both are ruled out, for stated reasons.

**Do NOT widen the row overall.** The slot must be ESTABLISHED — the participant row has no left
padding today, corrected from the receipt — but it comes out of existing space rather than adding to it.

STOP and report if the line-start slot cannot be positioned without changing a container that another
item owns.
</gate>

<completeness_contract>
- **A team with a catalog colour renders an 8px bar** at the line start, on every consumer that renders
  a team line.
- **A team with NO catalog colour renders no bar at all.** Assert the absence of the element, not a
  transparent one — and **mutation-prove it** by restoring the fallback and showing a named test go red.
  **This is the half that ships wrong.**
- **An FCS row renders no bar**, specifically. It is the reachable instance and the seed guarantees it.
- **The colour is computed once per team, not once per row.** Assert it — a per-row lookup is the
  failure mode the compute-location ruling exists to prevent.
- **Nothing else about the row moves.** Prove by mutation that team name, record, owner and anchor are
  byte-identical.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the no-colour case renders
nothing; the mutation proving the rest of the row is untouched; and anything you deliberately did not do.

**Say what a member sees, per surface, before and after.**

**Say whether the bar measured well at 8px** — piece 2 exists only if it did not, and this report is
where that is decided.

**Report new findings; do not file them.**

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 119 status, and
**`teamColors.ts`'s no-consumer comment retired** — it has named this item as its future consumer since
slice 5 and that is no longer future.

Merge is delegated to this lane under `CLAUDE.md`, including the four conditions. Promotion is not.
**Push `preview` with every commit.**
