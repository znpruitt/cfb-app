# PLATFORM-832 v2 — the client measures, the server abbreviates

```text
PROMPT_ID: PLATFORM-832-ABBREVIATION-FALLBACK-CODEX-v2
PURPOSE: Render a team's abbreviation when the column cannot hold the full school name, so a name is
         never truncated. v1 failed three review rounds on one class; the mechanism is replaced, not
         recalibrated.
SCOPE:   src/components/CompactGameScoreboard.tsx (the participant name and the box it renders in),
         a new client-side fit measurement and its hook, the recap's own primitive
         (src/components/recap/RecapPrimitives.tsx:277) if receipt item 3 shows it needs the same
         treatment, and their tests. DO NOT change src/lib/teamAbbreviations.ts or its artifact, the
         team catalog, any selector's choice of WHICH name to pass, the column tiers or their
         constants (#726 re-derives those AFTER this ships), or DESIGN.md (planning owns it — the
         mechanism ruling is already written there).
CARRIES: Item 87 INDEX row 71, verbatim, because the participant name is ROW ANATOMY and therefore
         shared:

         "**A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded** —
         Overview, Matchups, Schedule, recap. [...] **every decision in it about the status row, the
         tag slot or row anatomy applies to all four surfaces.**"

         Row 7, verbatim: "**Do not read campaign status from the canonical document**, and
         **re-derive every line-number citation** before putting it in a prompt — they have been
         stale at least twice, and `DESIGN.md` moved again on 2026-09-08."

         And the standing obligation this slice exists because of: "**A clean measurement of the
         wrong population** — name the population the CLAIM is about. A CORRECT measurement stated
         too broadly is the cheaper cousin of a wrong one."
```

---

## Why v2 replaces the mechanism instead of recalibrating it

v1 produced eleven findings across three rounds and **every serious one was the same defect**: a
correct measurement presented as a claim about a population it did not cover.

| round | the table that was derived | the population it was actually valid for |
| --- | --- | --- |
| 1 | thresholds from **row** overflow | one row composition |
| 2 | thresholds from the **name box** | one box that still contained record/owner suffixes |
| 3 | never-wider guard at the **heaviest weights** | one font weight, one platform |

Round 3's two findings are the clearest statement of it. At **206px, just above the 205px fallback
threshold**, the full name is selected and still renders truncated, because the suffixes sharing its
container overflow — sibling content deciding the name's fate, which is round 1's defect returning.
And at production `font-normal`, **`Berry` is 34.922px while `BERR` is 35.234px** at 14px, so the
never-wider guard and its browser test both false-green.

**The fact that makes a fourth table pointless:** the shipped font is the **viewer's system UI
stack.** Verified in the built output 2026-09-20 — neither built stylesheet consumes
`var(--font-geist…)` even once, and `body` resolves to
`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, …`. A name renders in SF Pro on macOS,
Segoe UI on Windows, Roboto on Android, at different advance widths, and **the server cannot know
which.** `DESIGN.md` now records this so it is not re-proposed.

**An absolute invariant cannot be enforced by an approximate predicate.** The ruling says a name is
never truncated. So the measurement moves to the only place that can take it.

## The mechanism, ruled by the owner 2026-09-20

**The server renders the abbreviation for any name long enough to be at risk at that tier. The client
measures the name's own span against its own box, in the font actually rendering, and upgrades to the
full name when it fits. With no JavaScript the row stays abbreviated.**

```text
SSR:      SEMO                        conservative, cannot truncate
hydrate:  measure span vs box, real font, real weight
fits?     Southeast Missouri State    upgrade
no JS:    SEMO                        safe, permanent
```

**The direction of the transition is the point, not an implementation detail.** Rendering the full
name first and swapping on overflow would display truncation for one frame, and the rule admits no
frames. Abbreviation → full name is an upgrade; the invariant holds at every instant.

**There is no threshold table, no per-surface calibration, no font-weight constant and no platform
assumption.** If your implementation grows one, that is the signal it has drifted back into v1.

The server's conservative choice is allowed to be crude — it only has to never be *too confident*.
Say in the receipt what it is and why erring toward the abbreviation is always safe.

## Two constraints that bind regardless of how you build it

1. **The name needs its own box.** While record and owner suffixes share the name's container and
   that container owns the ellipsis, sibling content decides whether the name truncates. That is the
   206px finding and it is the original defect. Give the name a box whose width is the thing being
   measured.
2. **The never-wider check is per viewer, not per table.** Whether an abbreviation is narrower than
   its name depends on the rendering font — `Berry`/`BERR` proves a character count cannot answer it
   and neither can a derived constant. Measure it where you measure the fit, and if the abbreviation
   is not narrower, keep the full name.

## Where the name renders

`CompactGameScoreboard.tsx:332` — `<span data-scoreboard-team={side}>{participant.teamName}</span>`,
inside a `min-w-0 truncate` wrapper (`:331`). **Three of four surfaces reach it through this
component** — Overview, Matchups, Schedule/Postseason via `GameWeekPanel`. **The recap does not**:
`RecapPrimitives.tsx:277` defines its own `GameScoreboard`. Receipt item 3 decides whether it is in
scope. Re-derive all four citations before relying on them.

## What #831 shipped for you — merged `41f688c5`

`getTeamAbbreviation(school: string): string | null` (`src/lib/teamAbbreviations.ts`) — exact
provider-name lookup, **client-safe**, never fabricates. `src/data/team-abbreviations.json`, pinned to
2026, 682 rows / 679 abbreviations / 3 explicit nulls. `Chicago State` returns `null`. Of the 238
names that can render on a league surface, 238 have an abbreviation, 2-4 characters.

Client-safe matters now: the measurement runs in the browser and needs the lookup there.

## Acceptance

1. **A name that does not fit renders its abbreviation; one that fits renders in full** — decided by
   a measurement of the rendered box, not a constant. Both pinned, with a mutation reddening each.
2. **No frame ever shows a truncated team name**, including the server-rendered first paint and the
   hydration boundary. Pin the SSR output for a long name at a narrow tier.
3. **With JavaScript disabled the row renders the abbreviation and stays correct.** Pinned. This is
   unconditional.
4. **Wherever measurement is available, an abbreviation that is not narrower than its name is never
   substituted** — decided per viewer, by a real measurement, never a length comparison.
   `Berry`/`BERR` is the regression case.

   **AMENDED 2026-09-21 — acceptances 3 and 4 contradicted each other and the v2 receipt caught it.**
   Without JavaScript there is no measurement, so `Berry` → `BERR` renders abbreviated and stays
   that way even where that viewer's font makes `BERR` wider. **Owner ruling: that is accepted, and
   never-wider is scoped to "wherever measurement is available."** Never-wider is not the invariant;
   the invariant is that a name is never TRUNCATED. Never-wider is the lesser rule that stops a swap
   destroying information while making the fit worse, and the no-JS case loses information without
   truncating anything. The rejected alternative — a server rule for short names — needs a width
   judgement the server cannot make, which reintroduces the heuristic three rounds were spent
   removing. `DESIGN.md` carries the ruling; **state the exemption where it is implemented** so no
   reader has to reconcile the two rules alone.
5. **The name box does not truncate the name, and what it does on overflow is pinned.** The
   no-JS path has no recovery, so if an abbreviation cannot fit its box, say in a test what
   happens — overflow, clip, or wrap. An unstated answer here is where the invariant would leak
   back in.
6. **The abbreviation is never fabricated.** A `null` lookup renders the full name — test
   `Chicago State`.
7. **The full name is available to assistive technology** whenever the abbreviation renders. Say what
   a screen reader announces, and note that the announced name must not change on upgrade.
8. **Overview, Matchups and Schedule all get the behaviour** from the shared component; if the recap
   is in scope it gets it too, and if not, the closeout says why.
9. **The column tiers and their constants are unchanged** — #726 re-derives them after this. A test
   pins that this slice moved none of them.
10. **No threshold table, per-surface constant or font-weight assumption exists in the shipped code.**
   A test or a grep-backed assertion is fine; the point is that v1's shape cannot creep back.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which
assertion fired.**

**The false greens that beat v1, named so they cannot repeat:**

- **A fixture whose names all fit proves nothing.** Use names where the full form and the
  abbreviation differ AND the box genuinely forces the choice.
- **A fixture built from the composition the OLD code already handled proves nothing** — that was
  Codex P2-2 in round 2.
- **A browser test calibrated at one weight or one platform is a measurement of that weight and that
  platform.** State the weight and the engine your measurements were taken at, beside the result.
- **For every sweep or coverage claim, state the population it ran over and how you know it is the
  right one.** Round 2's non-FBS sweep rooted one directory too deep and returned a clean zero.

**Pair every mechanism comment with the test that asserts the same behaviour.** A comment asserting
the name cannot truncate must name the test that proves it.

---

## STOP — read receipt before writing any code

1. **How does the client measure, exactly?** The technique (a canvas metric, a hidden probe, a
   `ResizeObserver`, something else), where it runs relative to paint, and what it costs per row.
   Scoreboard rows are numerous — say how many measurements a full Schedule page performs.
2. **What is the server's conservative rule**, and why is erring toward the abbreviation always safe?
   It may be crude; it may not be confident.
3. **Is the recap in scope?** `RecapPrimitives.tsx:277` has its own scoreboard. Measured against what
   the recap actually renders, in or out.
4. **What does the name's own box become?** Today the suffixes share its container and the container
   owns `truncate` (`:331`). Say what moves, and confirm no column tier or constant changes.
5. **What does a screen reader announce, before and after the upgrade?** The announced name must not
   change when the visible one does.
6. **What happens with JavaScript disabled, and on a hydration mismatch?** Both are real states here
   for the first time in this slice.
7. **Which of your v1 tests and fixtures survive?** The branch is kept; say what is reusable and what
   encoded a threshold table and must go.
8. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
