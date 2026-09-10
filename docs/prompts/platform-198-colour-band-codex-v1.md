PROMPT_ID: PLATFORM-198-COLOUR-BAND-CODEX-v1
PURPOSE: Item 198 — replace the global 72% opacity mute and the partial HSL lift with a per-colour normalisation BAND at full opacity. Only 31 of 135 bars clear 3:1 composited today; a band raises the dark end and lowers the bright end, which a global multiplier cannot do.
SCOPE: `src/lib/teamColors.ts`, the bar's opacity wherever the Item 119 branch sets it, and tests. NOT the fallback rule (settled — no accent, three teams). NOT tag or eyebrow treatment. NOT the stored catalog.
CARRIES: `item-87-INDEX.md` rows 17, 18, 19 and 71, verbatim in the task block. Row 16 is DISCHARGED by the measurement that authorises this item.

Read `AGENTS.md` first, then **`DESIGN.md`** — canonical for UI, and updated 2026-09-09 to record this
item's ruling. Nothing in either is restated here.

## The measurement that authorises this, and the number that decided it

**Measured 2026-09-09 by the Item 119 lane against the resynced production catalog** (138 items, 138
primaries, 138 alternates, `updatedAt 2026-09-10T03:51:30Z`, verified through `DATABASE_URL_RO`):

135 bars render — 125 primary, 10 alternate; Georgia Southern, Penn State and UConn omitted.
**Only 31 of 135 (23.0%) clear 3:1 composited.** Min **1.431**, median **2.099**, mean 2.452, p75
2.937, max **5.789**. 52 sit below 2.00.

**The median is why this is a band and not a lift.** Compositing 72% over `#0A0A0A`, a raw **3.00:1**
colour lands at **2.086:1** — and the measured median is **2.099**, back-solving to raw **3.025:1**.
**The normaliser is already hitting its target. The opacity is what breaks it**, costing 0.93 of ratio
at the median and 1.82 at the level that would clear 3:1.

**So three goals cannot all hold: 72% opacity, 3:1 composited, muted colour. Pick two.** Reaching 3:1
composited at 72% requires every colour at **4.815:1 raw** — pale enough that the mute is defeated by
the thing it was added to prevent.

**Owner ruling: band + full opacity.** A band beats the mute at the mute's own job. Today's brightest
bar is 5.789 composited; a band at full opacity puts every bar inside its bounds, **raising the dark
end AND lowering the bright end below where it sits now.** A global multiplier moves every colour the
same direction and cannot.

## Two things this item must fix that are NOT contrast

**1. A near-neutral is being assigned a hue — mechanism confirmed, MY ATTRIBUTION WAS WRONG.**
Nevada's `#8a8d8f` is HSL 204° / 2.18% / 55.1%. **`isUnsafeRawColor` returns false, so
`liftForDarkThemeContrast` is never called** — I named the wrong function. **`softenForScoreboard:203`
raises saturation from 2.18% to a 32% MINIMUM while retaining the 204° hue**, producing `#6894B1`.
**A band will not fix this**; it preserves the invented hue at a different lightness. **CARRY row 18 is
binding: chroma reduction, never a hue shift.** A saturation FLOOR is the defect — near-neutral in must
mean near-neutral out.

**2. There are SIX underlays, not three, and no single one governs the band.** CORRECTED 2026-09-09 by
this lane's receipt — my `#171718` was theoretical and sits under no bar. Real: `#09090B` (Overview,
Schedule, Postseason), `#27272A`/`#333336` (Matchups scheduled, non-owner/owner), `#242427`/`#303033`
(Matchups outcome). **Worst is `#333336` at a 36.2% penalty, not 9.5%** — 3:1 against the canvas is
**1.913:1** there. **The LIGHTEST underlay constrains the floor; the DARKEST constrains the ceiling.**

## What is NOT settled, and must not be invented

## THE BAND IS RULED — owner decision 2026-09-09, adopting this lane's proposal

**Floor 2.5:1 against `#333336`, the lightest underlay. Ceiling 5.5:1 against `#09090B`, the darkest.**
Proposed by the Item 198 receipt, verified independently, adopted unchanged.

**Two reasons it carried, and the second was not in the proposal.** The ceiling is anchored in what the
owner actually looked at — today's brightest bar reads as noticeable but not louder than result
emphasis — rather than in arithmetic. **And a 3.0 floor collapses the band: it leaves 4.766–5.5 on
zinc-950, a span of 0.734 to distribute 135 teams across, which is why 106 of them pile onto the
floor.** At 2.5 the span is **1.541**. Below roughly 1.0 the band stops being a band and becomes a
target, and teams stop being distinguishable by bar lightness at all.

**2.5 is deliberately below the WCAG 1.4.11 number, and that is a decision, not an oversight.** 1.4.11
governs components required to understand content; this bar is redundant with the team name beside it.
**Do not "restore" 3.0 during implementation** — it was chosen against, with the cost measured.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Confirm or refute the near-neutral hue hypothesis, naming the function and the line.** Say what
   `#8a8d8f` becomes at each step of the chain. If saturation amplification is not the mechanism, that
   is the finding and the fix changes.
3. **Re-derive the three background values and say which the bar actually composites over, per row
   type.** Quote `CompactGameScoreboard.tsx:53` and `globals.css:29`. **If a fourth surface exists that
   nobody has named, that is the finding** — CARRY row 17 has been open since before Item 119 shipped.
4. **Propose the band's bounds and the visibility floor, with the distribution that results.** Show
   what happens to min, median and max, measured against the worst-case background rather than the
   canvas.
5. **Name every consumer that would change appearance.** Row 71 requires a shared-row decision to name
   its surfaces. All 135 bars change, including the 125 that look correct today — say which surfaces
   that reaches.
6. Anything that CONTRADICTS what you were handed. The median arithmetic, the 9.5% owner-row penalty
   and the hue hypothesis are all mine and all checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`codex/198-colour-band` **from the held Item 119 commit `c3972931`** — CORRECTED 2026-09-09; v1 said
`origin/main` one line above saying this builds on 119, which is a contradiction the lane caught and
resolved correctly. **`main` contains no bar, no opacity and no consumers**, so branching from it would
leave nothing to modify. **Rebase the stack onto current `main` before implementation.**
In `/Users/zach/cfb-app-codex`. A `pre-push` hook runs `npm run lint:all`.

<task>
1. **Normalise every colour into a band** — not only those flagged unsafe. The current
   `resolveTeamColorCandidate` returns a colour untouched when `isUnsafeRawColor` is false, which is why
   52 bars sit below 2.00.
2. **Remove the 72% mute** once the band is doing its work.
3. **Fix the near-neutral hue assignment** per CARRY row 18.
4. **Normalise against the worst-case background** per CARRY row 17.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 17 — LIVE, ANSWERED 2026-09-09.** Pick one background constant and state it before either
> change ships. THREE exist: `#0a0a0a` (canvas), `#09090b` (zinc-950) and `#171718` (owner-row tint).
> Canvas-vs-zinc-950 is 0.5% noise; the owner-row tint costs 9.5%. Normalise against `#171718`.

> **Row 18 — LIVE.** If OKLCH ships, the reserved-hue guard is **chroma reduction**, not a hue shift.

> **Row 19 — LIVE.** It is a **restoration on the shared row**, across Overview, Matchups and Schedule
> — not a widening; there is no incumbent.

> **Row 71 — LIVE, durable.** A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is
> recorded — Overview, Matchups, Schedule, recap.
</task>

<gate>
**Do NOT change the fallback rule.** Georgia Southern, Penn State and UConn render no accent. Settled,
and `DESIGN.md:171` carries it.

**Do NOT shift a hue to solve contrast.** Row 18 is binding: chroma reduction only.

**Do NOT pick the band's bounds unilaterally.** Propose with measurement, stop for the owner.

**Do NOT touch the stored catalog or the provider mapping.** Items 199 and 204 shipped; this reads what
they produce.

STOP and report if removing the mute makes any bar compete with result emphasis — that is the concern
the mute existed for, and it reappearing means the band's ceiling is wrong, not that the mute was right.
</gate>

<completeness_contract>
- **Every rendered bar clears the proposed floor against the WORST-CASE background**, asserted over the
  real catalog, not a fixture. A test that samples five teams proves nothing about 135.
- **No bar exceeds the band's ceiling** — asserted separately. A one-sided band is a lift.
- **A near-neutral input produces a near-neutral output.** Assert on `#8a8d8f` specifically, and prove
  by mutation that the assertion can fail: restore the hue amplification and show a named test go red.
- **Hue is preserved for chromatic inputs** within a stated tolerance, asserted against a colour whose
  hue is unambiguous.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
**Item 207 is an open flake in `polling-planner/__tests__/route.test.ts`** — roughly 1 in 3, four
tests, `plan-held`. If you see it, re-run once and **say that you did, and why**; never report the
clean number alone.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the resulting distribution against the
worst-case background; the mutation proving the near-neutral assertion can fail; and anything you
deliberately did not do.

**This changes all 135 bars, including the 125 that look correct today.** Say so plainly — the owner
needs a walkthrough before merge, not a review finding after it.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 198 status, and
`item-87-INDEX.md` rows 17 and 18 moved to DISCHARGED with where the work landed.
`docs/next-tasks.md` stays with planning.

**Do NOT push `preview` without saying so** — Item 119 currently holds it and the two are coupled.
</output_contract>
