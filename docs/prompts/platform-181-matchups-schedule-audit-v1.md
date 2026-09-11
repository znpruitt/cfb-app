PROMPT_ID: PLATFORM-181-MATCHUPS-SCHEDULE-AUDIT-v1
PURPOSE: Item 181 — audit Matchups and Schedule against the shared row contract the way Item 167 audited Overview, and report how many divergences map to NO filed item. The residue count is the deliverable.
SCOPE: READ ONLY across `src/components/MatchupsWeekPanel.tsx`, `src/components/GameWeekPanel.tsx`, `src/lib/selectors/matchups.ts`, `src/lib/selectors/gameWeek.ts` and the tests that render them. **NO edits to `src/`. NO edits to `docs/`.** The output is a report.
CARRIES: `item-87-INDEX.md` CARRY rows 7 and 8, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`**. Nothing in either is restated.

## Why this exists, and what Item 167 established

**Item 167 audited Overview and found EIGHT divergences mapping to no filed item.** Its conclusion is
the reason this item exists: the back-application gap was in **every section nobody had looked at**,
and Item 160 was filed against the watchlist only because a screenshot of the watchlist is what
prompted it.

**Overview has now been measured. Matchups and Schedule have not.** The audit's own finding was that
the gap exists wherever nobody has checked, so leaving two of the four consumers unmeasured leaves the
same question open on two thirds of the surface.

**Read `item-87-reference-overview-composition.md` §7 for the shape of the exercise**, then adapt: its
four page-level checks are Overview's own (section order, empty sections, disclosure controls, chrome
zone) and do not transfer. **The row-level checks do.**

## The contract you audit AGAINST

**`docs/campaigns/item-87-reference-game-row.md`** — read §1 through §11 in full. **§11 is the consumer
matrix and it is the spine of this audit.** Its governing rule: _a slot a surface does not pass renders
nothing — it does not reserve space, and it does not fall back._

| | Matchups | Schedule |
| --- | --- | --- |
| **States rendered** | scheduled, live, final | scheduled, live, final |
| **Status row / Tag slot / Team logo / Rank-FCS prefix / Record / Owner suffix** | yes | yes |
| **Anchor** | record / score | record / score |
| **Odds footer** | yes | **tier-2 body** |
| **Tier-2 expansion** | no | **yes** |
| **Owner tint** | **yes** | no |
| **Broadcast** | scheduled, live | scheduled, live |
| **Date grouping** | no | **yes** |
| **Week scoping** | **yes** (tab) | no |

**Reference renders:** `mockups/matchups-schedule-mockup.html`. Note `mockups/live-scoreboard-mockup.html`
was rebuilt 2026-09-08; the Matchups/Schedule mockup was not, so **check its notes block for claims the
rebuild superseded.**

## EXCLUSIONS — three of them, and they are not oversights

**1. Matchups' status row is being reconstructed RIGHT NOW.** Item 143 v4 is live in the Codex lane and
owns the **tag placement seam, the caller-supplied status label, and the live-indicator options.**
**Do not audit those three.** They are known, ruled, and in flight; counting them would inflate the
number this item exists to produce. **Everything else on Matchups is in scope.**

**2. The outcome rail and the owner tint are not divergences.** CARRY row 20 retires the rail, and it
cannot be retired alone — it exists BECAUSE the tint's outcome states are unbuilt. **The tint itself is
documented on two axes and nothing proposes removing it.** Report the pair's current state if useful;
do not count it.

**3. The recap is out of scope.** It is not a consumer yet — `RecapPrimitives.tsx:277` still defines a
bespoke `GameScoreboard` — so auditing it against a contract it does not consume would measure nothing.

## Map against this list — RENUMBERED 2026-09-10, items are now GitHub issues

**#675** Featured nature and ordering · **#676** counts and the silent cap · **#678** third column tier ·
**#682** postseason · **#683** Schedule records · **#669** the six Overview watchlist divergences ·
**#715** Matchups scheduled odds · **#716** `Close` on unplayed games · **#685** dead scoring term ·
**#661** disrupted-status comments · **#671** the Overview audit's tag residue · **#679** kickoff
metadata on forbidden rows · **#680** `awaiting` on Schedule and Matchups · **#681** the Schedule
breakpoint.

**Item 119 (colour bars) is GONE from this list — retired 2026-09-10.** PR #719 ships **28px team
logos** at the line start instead, documented as permanent. **Audit the logo, not a colour bar**, and
a divergence in logo treatment maps to no filed item.

**Item 143's Matchups status-row seam remains excluded**, as below.

## ⚠️ ADDED 2026-09-10 — TWO WIDTH BUDGETS ARE KNOWN STALE, AND THAT IS PART OF WHAT YOU MEASURE

**#678 and #681 both reason about column breakpoints from a line-start element they describe as an 8px
colour bar. It is now a 28px logo — twenty pixels wider, on the element those budgets are built from.**

**Do not re-derive the breakpoints here** — that is those issues' work. **But when a column or
truncation divergence appears, say whether the 28px line-start element explains it**, because the
existing issues will otherwise absorb a finding they were not scoped for and their own numbers are
wrong.


**A partial match is RESIDUE, not a match** — same rendering wrong for a different reason than the item
names. **Name the near-miss item beside each residue entry** so the count can be re-derived rather than
trusted. This procedure was set by the Item 167 auditor and is adopted.

## STOP — post a READ RECEIPT before auditing anything

Report these, then **STOP and wait**.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote §11's Matchups and Schedule columns** and say, slot by slot, whether the code agrees —
   from the props actually passed to `CompactGameScoreboard`. **This is where residue is most likely**,
   because a slot mismatch is invisible until the table is compared to the call site.
3. **Name every list/row component each surface renders through**, and say whether either shares one
   across states the way Overview's `GameCardList` does. **That sharing is what cost Overview its
   broadcast on live rows** — check for the same shape here.
4. **Say which of §7's eleven checks transfer, which do not, and what replaces the four that do not.**
   Matchups has owner cards and week tabs; Schedule has date grouping and blocks. **Name your
   substitutes before you run them**, so the coverage is legible.
5. Anything that CONTRADICTS what you were handed — including the §11 table above, which I transcribed.

A receipt that summarises without quoting is not a receipt.

## Branch

`<lane>/181-matchups-schedule-audit` from current `origin/main`.
**Do NOT push `preview`** — the Codex lane holds it for Item 143 v4.

<task>
Run the adapted checks across **Matchups** and **Schedule**. For each divergence: what renders, what
the contract says, and **which item owns it, or NOTHING**.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation** before putting it in a prompt — they have been stale at least twice, and
> `DESIGN.md` moved again on 2026-09-08.

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — five direct renderers, and the recap is not one;
> `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.
</task>

<gate>
**Do NOT fix anything** — not a comment, not a test, not a class name. **A fix inside an audit destroys
the measurement.**

**Do NOT file queue items.** Report them; planning files them.

**Do NOT audit Item 143's three seams on Matchups**, per the exclusions.

**Do NOT count the outcome rail or the owner tint.**

**Do NOT trust a comment about what the provider sends.** Four such comments were measured false on
2026-09-08 (Item 172): CFBD emits only `scheduled` and `final`, never `postponed`/`canceled`/
`suspended`/`delayed`. **If a divergence turns on provider behaviour, say what would have to be
measured** rather than reasoning from the comment.

STOP and report if a check cannot be answered from the code and tests, or if the contract is ambiguous
about what these surfaces should render.
</gate>

<completeness_contract>
- **Every adapted check run against both surfaces**, or a named reason it does not apply.
- **Every divergence carries its mapping** — an item number or `NOTHING`.
- **The residue count is stated as a number**, per surface and combined, with each entry named.
- **State the population covered**: files read, checks unanswerable, what you could not reach.
  **"Zero residue" and "zero residue in what I could see" are different claims.**
</completeness_contract>

<verification>
This item changes no code. Run `npx tsc --noEmit` and `npm run lint:all` once at the end and report
their exit codes, proving the tree is unmodified. **If `npm test` moves at all, you have edited
something.**
</verification>

<output_contract>
**Lead with the residue count** — per surface and combined. Everything else is supporting detail.

Then per surface: divergences, each with what renders, what the contract says, and its item or
`NOTHING`.

**Answer directly: is the back-application gap the same size on these two surfaces as on Overview,
larger, or smaller?** Overview's number was eight. **That comparison is the point of running this** —
it says whether the campaign's remaining scope is now known or still guessed.

**Report the coverage limits**, and carry them wherever the number is cited.

No closeout, no registry entry. **This item ships nothing and files nothing.**
