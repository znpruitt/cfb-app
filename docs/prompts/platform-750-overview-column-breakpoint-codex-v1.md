# PLATFORM-750 — Overview's three-column breakpoint, measured

```text
PROMPT_ID: PLATFORM-750-OVERVIEW-COLUMN-BREAKPOINT-CODEX-v1
PURPOSE: Replace Overview's inherited 416px column target with a measured one, and derive the
         three-column breakpoint from it plus a stated headroom. The shipped 1348px comes from
         unmeasured mockup prose; production rows use far less width than it assumes.
SCOPE:   src/components/OverviewPanel.tsx (the constants at :78-104 only),
         src/components/__tests__/OverviewScoreboardGrid.browser.test.tsx, src/test/browserFixture.ts
         if the harness needs a wider fixture, and the component suites whose assertions carry the
         number. DO NOT change row anatomy, the logo slot, the column gap, the one-column boundary
         at 760.01px, Featured's four-item cap, any selector, or DESIGN.md (planning amends it with
         the derived number before merge — see "What planning owns"). DO NOT touch Matchups or
         Schedule: their tiers are #726, which takes this slice's method afterwards.
CARRIES: Item 87 INDEX, LIVE rows for this surface, verbatim:

         Row 7: "**Do not read campaign status from the canonical document**, and **re-derive every
         line-number citation** before putting it in a prompt — they have been stale at least twice,
         and `DESIGN.md` moved again on 2026-09-08."

         Row 71: "**A shared-row decision NAMES THE SURFACES IT GOVERNS at the point it is recorded**
         — Overview, Matchups, Schedule, recap. [...] **every decision in it about the status row, the
         tag slot or row anatomy applies to all four surfaces.**" The breakpoint itself is NOT a
         shared-row decision — `presentation-decisions.md` scopes column tiers per surface — but the
         worst-case fixture you derive IS reusable, and #726 will reuse it.

         Row 1 (records): a build with records absent or stale is a sequenced dependency, not a
         defect. Overview HAS records wired, so this is context, not a constraint here.
```

---

## Why this slice exists

**Owner ruling 2026-09-18 on [#750](https://github.com/znpruitt/cfb-app/issues/750), option 2**, taken
against two production screenshots. Just below the threshold, Overview renders two columns ≈870px wide
carrying ≈350px of content; three columns at that width would be ≈570px each and still comfortable.

**The 416px target was never measured.** `DESIGN.md:411-422` records its provenance in full: 400px of
unmeasured prose in `mockups/live-scoreboard-mockup.html`, minus that mockup's 16px `.sb-line`
padding, plus the shipped 32px logo slot. `OverviewPanel.tsx:78-97` builds `1348` from it: three
targets, two 40px gaps, 20px headroom.

**The existing measurement already says it is loose**: the stress row uses **268.094px** and retains
**104.844px** before the score in a 422.656px column, on the verified macOS host.

## The rendered population, measured by planning on the read-only replica 2026-09-18

**This is the fixture's input, and it is smaller than the raw store.** Measure it again yourself
(receipt item 1) — the numbers below are planning's, dated, and they decay.

| quantity | value |
| --- | --- |
| longest provider name reachable on a league row | **24 chars** — `Southeast Missouri State`, `Mississippi Valley State` |
| longest rostered team name | 21 — `Florida International` |
| longest owner label across all 10 stored rosters | **12** — `Mastromatteo` |
| distinct names reachable on 2026 league rows | 238, across 888 games involving a rostered team |
| longest name in the raw 2026 store | 29 — `Westgate Christian University`, lower-division only |

**The 29-character name is not the fixture.** No rostered team plays those schools, so it cannot
render on these rows. Using it would be a correct measurement of the wrong population — and the
opposite error, measuring only what is on screen today (`Miami`, `SMU`, `Georgia`), is what produced
the number this slice is replacing.

## What the slice derives

1. **A worst-case participant row**, stated as a fixture and defended: the 24-character name, a rank
   prefix, a record, the 12-character owner, a three-digit score, and the always-reserved 32px logo
   slot. Rank and the `FCS` marker are mutually exclusive — do not stack them.
2. **The measured minimum column width** for that row, with the margin before the score named
   separately from the content width, so a later reader can see which part is content and which is
   comfort.
3. **The headroom, as its own named constant with its own reason.** The current 20px is invisible
   inside the arithmetic. Whatever you choose, it must survive the argument that these measurements
   come from one host and the production font stack resolves differently elsewhere.
4. **The breakpoint**, computed from 2 and 3 exactly as `OverviewPanel.tsx:93-97` computes today, so
   the derivation stays readable rather than becoming a magic number.

## Acceptance

1. Every constant in the chain is derived, and the code comment states each input's provenance — the
   current comment does this well; keep that standard.
2. The browser gate measures the worst-case fixture at the NEW threshold and shows it fits, with the
   remaining margin reported. **Assert properties, not the pixel values**, as PLATFORM-729's gate does.
3. **A control at a width where the fixture genuinely clips**, proving the gate can fail. #729's gate
   has one at 200px; this needs its own for the new number.
4. The one-column boundary and the column gap are unchanged, and a test pins that.
5. Featured still renders `3 + 1` at the wide tier (`DESIGN.md:409-411`) — the cap is count-based, so
   lowering the threshold must not change it. Pin it.
6. Every assertion carrying `1348` elsewhere in the suite is updated, and you list them.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.** A suite going red is not the evidence; the named assertion going red is.

**A gate that cannot fail is not a gate** — acceptance 3 is that proof, and it is the one most likely
to be skipped because the fixture "obviously" fits.

**Pair every mechanism comment with the test that asserts the same behaviour.**

---

## What planning owns

`DESIGN.md:405-422` states the tier boundaries and the 416px provenance. **Do not edit it.** Report
the derived numbers in your final message; planning amends `DESIGN.md` on `main` before your merge,
and `AGENTS.md` binds that the amendment lands before the change is considered settled.

---

## STOP — read receipt before writing any code

1. **Re-measure the population.** Longest reachable name, longest owner label, and the count of
   games involving a rostered team, from the read-only replica (`DATABASE_URL_RO`; never print the
   connection string). Say whether planning's numbers still hold.
2. **What is the worst-case row, exactly?** Name every element and say which are mutually exclusive.
   Say whether a record can be wider than `12–0` — a tie-carrying archive row may differ.
3. **What does the fixture measure at, and what is the minimum column width** it implies? Give the
   content width and the margin separately.
4. **How much headroom, and why that much?** This is the judgement in the slice. Argue it from the
   font-stack variance, not from a round number.
5. **Which existing assertions carry `1348`** — list them by file and line, including any that carry
   it indirectly through the exported constant.
6. **Does lowering the threshold change anything other than column count?** Check Featured's `3 + 1`,
   the six-item caps, the remainder alignment rule, and the recap tile's full-width exception.
7. **Can this harness measure Matchups and Schedule unchanged**, or does #726 need a different
   fixture? A one-line answer is fine; it decides whether #726 is a sibling or a rebuild.
8. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
