# PLATFORM-832 — the abbreviation width fallback

```text
PROMPT_ID: PLATFORM-832-ABBREVIATION-FALLBACK-CODEX-v1
PURPOSE: Render a team's abbreviation when a column cannot hold the full school name, so a team name
         is never truncated. #831 shipped the lookup with no consumer; this slice is the consumer.
SCOPE:   src/components/CompactGameScoreboard.tsx (the participant name), the callers that pass
         `teamName`, and their tests. The recap's own primitive
         (src/components/recap/RecapPrimitives.tsx:277) ONLY if receipt item 2 shows it needs the
         same treatment. DO NOT change src/lib/teamAbbreviations.ts or the artifact, the team
         catalog, any selector's choice of WHICH name to pass, the column tiers or their constants
         (#726 re-derives those AFTER this ships), or DESIGN.md (planning owns it).
CARRIES: Item 87 INDEX row 71, verbatim, because the participant name is ROW ANATOMY and therefore
         shared:

         "**A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded** —
         Overview, Matchups, Schedule, recap. [...] **every decision in it about the status row, the
         tag slot or row anatomy applies to all four surfaces.**"

         Row 7, verbatim: "**Do not read campaign status from the canonical document**, and
         **re-derive every line-number citation** before putting it in a prompt — they have been
         stale at least twice, and `DESIGN.md` moved again on 2026-09-08."
```

---

## The rule, already decided

**Owner ruling on [#821](https://github.com/znpruitt/cfb-app/issues/821), 2026-09-20, in `DESIGN.md`:**
a scoreboard row shows the provider's full school name; **when the column cannot hold it, the row shows
that team's abbreviation instead. A team name is never truncated.** The full name stays available to
assistive technology, the abbreviation is the provider's own and is never fabricated, and a team with
no abbreviation keeps its full name.

## What [#831](https://github.com/znpruitt/cfb-app/issues/831) shipped for you — merged `41f688c5`

- **`src/data/team-abbreviations.json`** — pinned to 2026, `{ year, sourceUrl, generatedAt, items }`,
  **682 rows, 679 abbreviations, 3 explicit nulls.**
- **`getTeamAbbreviation(school: string): string | null`** (`src/lib/teamAbbreviations.ts`) — exact
  provider-name lookup, client-safe, no team matching, never fabricates. `TEAM_ABBREVIATIONS_YEAR` and
  `TEAM_ABBREVIATIONS_SOURCE_URL` are exported beside it.
- **`Chicago State` returns `null`** and is the only renderable-adjacent school without one; it never
  appears opposite a rostered team today.
- Measured on production: of the **238** names that can render on a league surface, **238** have an
  abbreviation, 2-4 characters.

**The lookup has no consumer today. That is deliberate and it is this slice's job.**

## Where the name renders

`CompactGameScoreboard.tsx:332` — `<span data-scoreboard-team={side}>{participant.teamName}</span>`,
inside a `min-w-0 truncate` wrapper (`:331`). That `truncate` is today's behaviour and is what the
ruling replaces for the name.

**Three of the four surfaces reach it through this component** — Overview, Matchups, and
Schedule/Postseason via `GameWeekPanel`. **The recap does not**: `RecapPrimitives.tsx:277` defines its
own `GameScoreboard`. Receipt item 2 decides whether it is in scope.

## THE MECHANISM PROBLEM — read before proposing anything

**CSS cannot measure text, and the server does not know the rendered width.** So the swap cannot fire
"when the name would overflow". It has to be driven by something available at render time — the
container-query tier the row sits in, plus a per-name marker such as the label's length.

**A name will therefore swap at a WIDTH, not at the pixel where it would have clipped.** Some names
will abbreviate slightly before they had to, and some may still not fit at the narrowest tier. **Write
that limitation into the code**, next to the mechanism, rather than leaving it for a reviewer to find.

**AMENDED 2026-09-20, after round 1's reviews — and the ambiguity was planning's.** The paragraph
above specifies the trigger's SHAPE and never said WHAT IT MEASURES, so the first implementation
calibrated its thresholds against TOTAL ROW content. That produced four findings across two reviewers
which are one defect seen from four directions: abbreviating early on the compact scoreboard (a
~169px name inside a ~293px box at the 390px fixture), ~50-60px earlier again on the recap row, which
has no `pl-8` gutter, badge or record; a 404-459px DEAD BAND where a 27-character name clips without
abbreviating, which is the truncation `DESIGN.md` forbids outright; and `Iowa` → `IOWA`, an
abbreviation 19% WIDER than the name it replaces.

**So the predicate's input is named here rather than left to inference: the question is whether the
full name overflows ITS OWN BOX at this tier — never whether the row overflows.** The row's other
content (record, owner, score, badge) varies per surface and per state, so a table calibrated on it is
early in one layout, late in another, and backwards for a short name. Calibrate per surface with the
browser harness; the recap gets its own numbers.

**And a rule the shape above does not imply: never swap to an abbreviation that is not NARROWER than
the name.** Measure it — four uppercase characters can exceed four mixed-case ones, so a character
count cannot answer this. Swapping in that case makes the fit worse while destroying information,
which is the opposite of the rule's purpose.

## Decisions this slice owns

1. **Per name or per row.** If `Southeast Missouri State` becomes `SEMO`, does `Ohio State` opposite it
   stay full? **Planning recommends per name** — the rule is about what fits, and a row is two
   independent labels — but a mixed row is visible, so pin the choice with a test and put a screenshot
   in the closeout.
2. **The threshold per tier AND per surface**, derived with the browser harness PLATFORM-750 used
   (`src/test/browserFixture.ts`), not picked, and measured against the NAME'S OWN BOX per the
   amendment above. Measured population, all 1,776 rendered labels: median 9 characters, p90 16,
   p95 18, max 24. **A character count is the marker, not the quantity** — derive the count at which
   the name span exceeds its box, per surface, and state the font assumption that makes the mapping
   hold.
3. **What the accessible name is.** The full school name must remain available when the abbreviation
   renders. Say which mechanism carries it and what a screen reader announces.
4. **What happens when the lookup returns `null`.** The full name renders and today's overflow
   behaviour applies — that is the ruling, not a fallback you may improve on.

## Acceptance

1. At a width that cannot hold it, a long name renders its abbreviation; at a width that can, the full
   name renders. Both pinned, with a mutation reddening each.
2. **The abbreviation is never fabricated.** A `null` lookup renders the full name — test `Chicago State`.
3. **The full name is available to assistive technology** whenever the abbreviation renders.
4. **Overview, Matchups and Schedule all get the behaviour** from the shared component; if the recap is
   in scope it gets it too, and if it is not, the closeout says why.
5. **The column tiers and their constants are unchanged.** #726 re-derives them after this; a test pins
   that this slice moved none of them.
6. A browser-gate measurement shows the abbreviation fitting at the tier that triggered it — **and a
   control at a width where even the abbreviation would not fit**, so the gate can fail.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**A fixture whose names all fit proves nothing.** Use fixtures where the full name and the
abbreviation differ AND where the tier genuinely forces the swap — the likely false green here is a
test that passes whether or not the fallback exists.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## STOP — read receipt before writing any code

1. **What triggers the swap, exactly?** Name the mechanism, where the marker is computed, and what a
   reader should understand its precision to be. If the honest answer is that a name may abbreviate
   before it had to, say so here and plan to say so in the code.
2. **Is the recap in scope?** `RecapPrimitives.tsx:277` has its own scoreboard. Say whether its rows
   can render a name long enough to matter, measured against what the recap actually renders, and
   recommend in or out.
3. **Per name or per row** — your recommendation, and what the mixed-row case looks like.
4. **Where does the lookup get called?** The component, the callers, or a selector. Note that SCOPE
   forbids changing which name a selector passes; you are adding a fallback, not a new name source.
5. **What does the accessible name become**, and what does a screen reader announce for a row whose
   name abbreviated?
6. **Which tiers can actually force a swap today?** With #750's Overview tiers and Schedule's
   unchanged ones, say where a 24-character name fails to fit and where it does not.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
