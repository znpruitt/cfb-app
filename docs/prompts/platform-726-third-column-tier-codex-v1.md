# PLATFORM-726 — a third-column tier for Matchups and Schedule, on a number derived after #821

```text
PROMPT_ID: PLATFORM-726-THIRD-COLUMN-TIER-CODEX-v1
PURPOSE: Overview gained a three-column tier in #750; Matchups and Schedule never did. Add one to
         both, on a breakpoint DERIVED by measurement rather than inherited — and derive it against
         the post-#821 model, in which the abbreviation is the width fallback and no name truncates.
SCOPE:   src/components/GameWeekPanel.tsx (the grid at `:100`) and
         src/components/MatchupsWeekPanel.tsx (the grid at `:595`), plus their tests and a browser
         measurement. DO NOT change the shared row, the tag selector, `CompactGameScoreboard`,
         Overview's grid, or DESIGN.md (planning owns it — bring the number back and planning writes
         the rule).
CARRIES: From #681, folded here by planning 2026-09-11 — **picking Schedule's three-column
         breakpoint is this slice's, not a separate ask.** Its finding stands verbatim: the number is
         documented as 1320px and reproduces nowhere. `presentation-decisions.md:72` gives
         3 × (400 + 24) + 2 × 16 = **1304**; the mockup comment gives 3 × (400 + 24) + 2 × 20 =
         **1312**; the mockup's own CSS (10px block padding, 16px gap) gives **1300**. One number,
         three sources, no two alike. **Do not adopt any of them** — see below.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - A measurement claim states the population it was taken over.
```

---

## RECEIPT ADJUDICATED 2026-09-24 — proceed, with one measurement redone

**Accepted in full, including both corrections to this prompt. One ruling changes the number you
derive.**

### THE POPULATION RULING — neither 276px nor 314px is measured over what renders

Planning measured the rendered 2026 schedule from production `/api/schedule` (3,679 games, **716
distinct teams**) against `src/data/team-abbreviations.json` (682 entries):

- **`Limestone` DOES NOT RENDER IN 2026.** Its 9-character `LIMESTONE` drove the 314px figure. **That
  is a clean measurement of a population the surface cannot show** — the artifact is what the app
  INGESTS, not what it renders.
- **The widest abbreviation that can actually render is `APPRE` (5 ch, Apprentice School)**, then a
  band of 4-character ones. `WASH` is in that band, so the 276px basis is real.
- **And the governing case is neither.** **50 of the 716 rendered teams cannot use the fallback at
  all** — 47 have no artifact entry and 3 carry explicit nulls. The longest is **`Westgate Christian
  University`, 29 characters**, which must render as a full name with no abbreviation to fall back to.

**So the worst case under #821 is a team with NO abbreviation, not the longest abbreviation.** Derive
against that set, or exclude it with a stated reason — do not let it be excluded by never having been
enumerated. This prompt's own framing pointed you at abbreviation width and was wrong to.

**The populations also differ BY SURFACE, which is a second reason the two numbers may differ.**
Schedule renders the whole season, all 716. Matchups renders owner slates built from `rosterByTeam`,
so its population is the drafted teams. **Derive each surface against its own rendered population**;
"one shape, two surfaces" means one METHOD, not one number. Your padding finding (20px Schedule vs
34px Matchups, records on one and not the other) points the same way and is accepted.

### Corrections to this prompt, both yours, both right

1. **Acceptance 2 called 219px a "published minimum". It is not, and `DESIGN.md` says so in the same
   breath it gives the number** (`:426-428`): *"a boundary for that fixture, not a universal constant
   or a code value"*, *"No supported minimum width is set"*. **Planning wrote that text and then
   misquoted it one slice later.** Acceptance 2 is corrected below: the floor is context, not a
   constraint to derive against.
2. **Abbreviations are not 2-4 characters** — `LIMESTONE` is 9 in the artifact, `APPRE` is 5 in the
   rendered set. Any reasoning that assumed a short fixed width is void.

### Approved as proposed

- **Matchups converts to container queries preserving its two-column transition at 976px**, not moved
  to Schedule's 760.01px. It keeps current geometry, so acceptance 4 holds, and it puts the surface on
  the same coordinate system as the other two. Your measurement (1023 viewport → 975 content,
  1024 → 976) is the derivation; state it in the report.
- **Item 1's full inventory is accepted.** Seven column rules, not three; the four beyond the game
  grids are out of scope and stay untouched.
- **Overview is stale in its DERIVATION and that is now filed** — see below. Your distinction is
  exactly right and planning has adopted its wording: the old fit derivation no longer justifies
  `403px` as NECESSARY; it does not follow that the layout is undesirable. Those are different
  questions and only the first is settled.

## Two things the issue says that are no longer true, and one it does not say at all

**#726 reads as "Overview has a tier, copy its shape to two surfaces that are otherwise alike."
Neither half of that survives contact with the code.**

### 1. The surfaces are NOT alike — they are on different coordinate systems

| surface | grid | query type |
| --- | --- | --- |
| Overview | `@max-[760.01px]:grid-cols-1` … `@min-[1341px]:grid-cols-3` (`OverviewPanel.tsx:110-132`) | **container** |
| Schedule | `grid-cols-2 @max-[760.01px]:grid-cols-1` (`GameWeekPanel.tsx:100`) | **container** |
| Matchups | `grid gap-2.5 lg:grid-cols-2` (`MatchupsWeekPanel.tsx:595`) | **viewport** (`lg` = 1024px) |

**Matchups is not "missing a tier". It is on a media query with no explicit one-column rule at all** —
one column is the default and `lg:` adds the second. Schedule names its one-column threshold
explicitly at a container width. **So adding a third tier to Matchups is a conversion decision
before it is an arithmetic one**, and that decision is the larger half of this slice.

**This matters beyond tidiness, and `DESIGN.md` now records why:** a viewport query and a container
query cannot be made to coincide, because the container is narrower than the viewport by whatever
gutters and siblings sit outside it. A "1320px breakpoint" means two different things on the two
surfaces. Planning corrected exactly this class of error in `DESIGN.md` on 2026-09-24 after four
reviewer passes missed it.

### 2. The derivation was INVERTED by #821, after every number in this issue was written

[#821](https://github.com/znpruitt/cfb-app/issues/821) was ruled 2026-09-20 and
[#832](https://github.com/znpruitt/cfb-app/issues/832) shipped it on 2026-09-22 — **both after #726,
#678 and #681 were filed.**

`OverviewPanel.tsx:83` records the old model in its own words: *"12px flex gap before the score to get
402.469px, rounded up to the 403px target."* **That is a column sized so the LONGEST renderable name
fits.** #821 ruled that no team name is ever truncated and **the abbreviation is the width fallback**;
`DESIGN.md:424-443` carries the priority order and the measured **219px floor**, below which behaviour
is deliberately unspecified.

**So a column no longer has to hold the longest name.** It has to hold the abbreviation, the record
and the owner, and the full name upgrades into whatever space is left. **Re-deriving from "the longest
name must fit" would reproduce a model the owner has already replaced** — and it is the obvious thing
to do, because the constant that encodes it is still sitting in the file with a comment explaining its
arithmetic.

### 3. Overview's own numbers predate the ruling, and nobody has asked whether they are stale

`403px` and `1341px` were derived on 2026-09-19. The ruling landed 09-20; the fallback shipped 09-22.
**Overview has not been re-derived since.**

**This is not yours to fix and you must not touch Overview's grid.** But you cannot derive a correct
number for two surfaces while a third carries a possibly-over-derived one and call the divergence
closed — that is precisely what the #672 audit exists to catch. **Answer it as receipt item 5 and
planning will rule.**

---

## The method is #750's, and the three arithmetics above are all superseded

PLATFORM-750 derived Overview's breakpoint by **measuring a worst-case row in a browser**, not by
inheriting a mockup's arithmetic. That is why it produced `880.667px` and `1341px` rather than a round
number, and it is why #681's "one number, three sources" problem stopped being a problem: **a number
nobody could reproduce was replaced by one anybody can re-measure.**

Do the same here. The repo's instrument is `npm run test:browser:required`
(`ScheduleScoreboardGrid.browser.test.tsx` is the closest existing harness;
`ScoreboardTeamNameFallback.browser.test.tsx` was built for #832 to measure rendered text boxes at set
container widths).

**State the population.** Which row shape did you measure, at which container widths, and why is it
the worst case under the post-#821 model rather than under the pre-#821 one?

---

## Acceptance

1. **Both surfaces gain a three-column tier**, on a breakpoint derived by measurement, with the
   measurement and its population reported. One shape, two surfaces — implementing one without the
   other recreates the divergence this issue exists to close.
2. **The breakpoint is derived against the post-#821 model AND the rendered population of its own
   surface.** The abbreviation is the width fallback and no name truncates. **`DESIGN.md`'s 219px is
   NOT a minimum to derive against** — it is a measured boundary for one fixture, explicitly *"not a
   universal constant or a code value"*. **The governing case is the 50 rendered teams with no
   abbreviation available**, longest `Westgate Christian University` at 29 characters; include them or
   exclude them with a stated reason. A derivation that sizes the column to the longest renderable
   full name under the OLD model is wrong even if its arithmetic is correct — and so is one that sizes
   it to the longest abbreviation in the artifact, since that set includes teams the surface never
   shows.
3. **Matchups' coordinate system is decided explicitly, and the decision is stated.** Either it
   converts to container queries and matches Schedule and Overview, or it stays on `lg:` and the
   report says why a viewport query is right for that surface. **Do not leave it implicit** — a
   breakpoint number that means two things on two surfaces is the defect, not the fix.
4. **The one- and two-column behaviour is unchanged on both surfaces**, pinned at widths either side
   of the existing thresholds. This slice adds a tier; it must not move the ones already there.
5. **`presentation-decisions.md`'s superseded arithmetic is not resurrected.** It already carries a
   `DOES NOT REPRODUCE` note. Leave the note, cite the new number, and do not restate 1304/1312/1300
   as if one of them were right.
6. **A test pins the derived number to its derivation**, not just to itself. An assertion that the
   class string contains `1341` is satisfied by any typo that round-trips; the test should fail if the
   measured input changes.

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 4 is the likely false green.** A test that only exercises the new three-column width
cannot see the two-column tier move. Assert at widths either side of every threshold, and mutate one
threshold to confirm the neighbouring assertions redden.

**Acceptance 1's second half is the other.** A test that renders only Schedule proves nothing about
Matchups. Both surfaces, or the divergence ships.

---

## STOP — read receipt before writing any code

Answer from the FILES and the browser. Enumerate rather than counting.

1. **Every column rule on all three surfaces**, with its query type (container or viewport) and its
   threshold. This prompt names three; say whether that is the whole set.
2. **What is the worst-case row under the post-#821 model?** Name it, measure it, and say how it
   differs from the pre-#821 worst case that produced `403px`.
3. **What does Matchups' `lg:` threshold correspond to in container width** on that surface, at the
   widths the app actually renders? This is the number that tells you whether conversion changes
   behaviour or only notation.
4. **Does Schedule's `@max-[760.01px]` mean the same container width as Overview's?** Both name
   760.01px; say whether the containers are the same size at the same viewport.
5. **Are Overview's `403px` and `1341px` stale after #821 and #832?** Give your answer and the
   evidence. **Do not change them** — planning rules on it.
6. **What in this prompt contradicts what you found in the files or the browser?**

Do not start until the receipt is answered and it has been ruled on.
