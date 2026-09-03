# Item 87 — Follow-on input: team colour bar and normalisation

> **Status:** input for review, not applied. Nothing here is recorded in the base addendum or `DESIGN.md` until stated otherwise.

**This proposes replacing a working normaliser, not introducing one.** `src/lib/teamColors.ts` already ships: `getSafeScoreboardTeamColor(ById)` softens HSL (S ∈ [0.32, 0.78], L ∈ [0.34, 0.68], yellow-gold carve-out at hue 42–72), lifts lightness to ≥3:1 against `#0A0A0A`, and rejects unusable results via `isReasonableScoreboardAccent`. `GameScoreboard` consumes it per team line as a 2–3px left border (`:82, :195`); `GameWeekPanel` resolves it by `teamCatalogById`. An earlier draft of this document described the shipped treatment as top/bottom card borders — that was wrong, and `DESIGN.md:163` carries the same stale claim.

---

## What is actually being proposed

Two separable changes. **Ship them separately.**

### A. Widen the bar (visual, cheap)

The incumbent renders 2–3px. The proposal is a solid 8px muted bar at ~72% opacity. Same position — the line-start slot reserved for future logos — same absence of conflict with the row's emphasis system, but enough width to register as colour rather than a hint.

**Rejected — gradient and full-width band.** Both sit *behind* the text and conflict with the row's most important signal: the scoreboard encodes result through text weight, so a losing team with a bright primary can visually outweigh a winner with a dark one. Avoiding that would require dimming on the trailing side, at which point the colour carries outcome as well as identity and stops being identity. The band was worse — being uniform it sits at full strength under the score rather than receding.

**Why identity colour is admissible at all:** it says "this is Michigan," not "this is good / active / interactive," so it cannot collide with the reserved palette the way a meaning-bearing hue would.

### B. Move normalisation to OKLCH (maths, optional)

**Do this only if measured to matter.** Ship the wider bar on the existing normaliser first; that decouples a visual decision from a colour-science one.

The argument for OKLCH: HSL's `L` is not perceptual, so one threshold behaves differently across hues. The incumbent's yellow-gold carve-out at hue 42–72 is a symptom of exactly that — a per-hue exception compensating for a non-uniform lightness axis. OKLCH's `L` is perceptually uniform, so the carve-out becomes unnecessary for *legibility* purposes.

```text
normalizeTeamColor(hex, { minL = 0.62, maxL = 0.78, maxC = 0.16 }):
  1. sRGB hex → OKLCH
  2. clamp lightness:  L = min(max(L, minL), maxL)
  3. cap chroma:       C = min(C, maxC)
  4. reserved-hue guard (see below)
  5. preserve hue, convert back to sRGB, gamut-map
  6. cache
```

Lightness is **clamped, not scaled** — clamping only moves colours out of band, so a team already legible renders unmodified.

---

## Two gaps in the earlier draft, both closed here

### Reserved-hue guard is required

Chroma capping does **not** stop a gold team's bar reading as champion amber. The incumbent special-cases hue 42–72 for this reason and the OKLCH version needs an equivalent: either shift hue out of the amber band, drop chroma further within it, or explicitly accept the collision on the grounds that a colour bar is identity and champion amber appears as card chrome. **Recommend the chroma reduction** — it preserves hue fidelity and avoids inventing a colour the team does not use.

### One background constant

The incumbent targets `SCOREBOARD_DARK_SURFACE` `#0A0A0A`; this document and the mockup assumed `#161616`. The parameters above are tuned for `#161616` (OKLCH L ≈ 0.20) and would need re-tuning for `#0A0A0A`. **Pick one constant and state it** before either change ships.

---

## Consequences to accept

- **Normalisation alters brand colours.** Penn State stays navy-hued but is not Penn State's navy. The alternative is exact fidelity with dark primaries invisible, which is worse.
- **Collisions increase.** Compressing lightness and chroma converges several reds and several blues. Acceptable because the team name sits beside the bar, so colour is never the sole carrier.

---

## Data availability — a real constraint

**FCS teams have no colour.** The team-database refresh uses `buildCfbdTeamsUrl()` = `/teams/fbs` (`cfbd.ts:85`), so `TeamCatalogItem.color/altColor` is FBS-only by construction, and the checked-in seed has none at all (0/138).

**Therefore FCS rows render no bar** — consistent with the fallback rule below rather than an exception to it. The mockup previously drew bars on FCS teams, contradicting this; corrected.

**Fallback:** a team with no primary renders **no bar**, never a default grey. An absent bar reads as missing data; a grey bar reads as a team whose colour is grey.

---

## Caching

Alongside the catalog: compute when `teamCatalogById` is memoised (`CFBScheduleApp.tsx:651`), or precompute when the team database is written and store raw plus normalised. Not build-time — the seed carries no colours. Not per-request.

**No dependency needed.** sRGB → OKLCH is ~40 lines, and `teamColors.ts` already holds the hex/rgb/luminance scaffolding to host it.

`getOwnerColor()` (`ownerColors.ts:108`) is a separate system with different rules and stays separate.

---

## Recommended sequence

1. Decide the background constant.
2. Widen the bar to 8px on the **existing** normaliser. Visual change only.
3. Measure whether HSL normalisation actually produces bad output at that width. If it does, port to OKLCH with the reserved-hue guard. If not, leave it.
