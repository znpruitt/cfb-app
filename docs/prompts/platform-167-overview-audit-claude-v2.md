PROMPT_ID: PLATFORM-167-OVERVIEW-AUDIT-CLAUDE-v2
PURPOSE: Item 167 — audit Overview's four sections against the shared row contract, and report how many divergences map to NO filed item. That count is the deliverable; it is the only measurement of whether the campaign's remaining scope is known.
SCOPE: READ ONLY across `src/components/OverviewPanel.tsx`, `src/lib/selectors/overview.ts`, `src/lib/selectors/overviewGameSections.ts` and the tests that render them. **NO edits to `src/`. NO edits to `docs/`.** The output is a report.
CARRIES: `item-87-INDEX.md` CARRY rows 7 and 8, verbatim in the task block.

Read `AGENTS.md` first, then **`DESIGN.md`**. Nothing in either is restated.

## THIS ITEM MEASURES THE UNKNOWN. Everything else on the board is known work.

**Say that to yourself before starting.** Every other queue item names a thing to build. **This one
exists to find out whether the queue is complete.** Its value is not the list of divergences — most of
those are already filed — it is **the count that maps to nothing.**

The watchlist's six divergences (Item 160) all came from ONE omission: decisions made during the
Schedule and Matchups work were recorded as Schedule decisions and never applied back to Overview.
**Nobody has checked whether the other three sections have the same problem.** If they do, the campaign
has unscoped work; if they do not, Item 160 is the whole of it and the board is trustworthy. **Both
answers are useful and one of them closes a question.**

## The sources

- **`docs/campaigns/item-87-reference-game-row.md`** — the contract you audit AGAINST. Read §1, §2,
  §3, §4, §5, §10 and §11 in full. **§11 is the consumer matrix and it is the most important**: a slot
  a surface does not pass renders nothing, and it does not fall back.
- **`docs/campaigns/item-87-reference-overview-composition.md` §7** — the brief. Eleven checks, seven
  per-section and four page-level. **It is PROPOSED SCOPE, not findings. Nothing in it has been run.**
- **`docs/campaigns/item-87-followon-overview-back-application.md`** — **the file that enumerates Item
  160's six.** Added in v2: you were right that a gate turning on a list must name the file holding
  it. My omission.
- `mockups/live-scoreboard-mockup.html` — Overview's reference render.

## The four sections, and where they live

`OverviewPanel.tsx`: `FeaturedGamesList` (`:818`), `GameCardList` (`:653`, **serving BOTH Live and
Recent finals**), `WatchlistScoreboardList` (`:715`). Ordering and section composition are in
`selectors/overview.ts` and `selectors/overviewGameSections.ts`.

## THE MAPPING LIST IS STALE IN ONE PLACE — corrected here

`composition.md` §7's *Expected outcome* names Items 115, 119, 134, 143, 157 and 162 as the items
divergences should map to. **157, 162 and 163 MERGED on 2026-09-08** (PR #585) — the tag vocabulary is
now game facts only. **So a tag-VOCABULARY divergence no longer maps to a filed item and IS residue.**
Tag PLACEMENT still maps to **Item 143**, in flight in the other lane.

**Map against this list**, which is current as of `efa269df`:

| item | covers |
| --- | --- |
| **113** | **ADDED in v2 — my list was incomplete.** Featured being results-based rather than must-watch. **Verified: `FeaturedGamesList` hard-codes `state="final"` (`OverviewPanel.tsx:852`)**, so Featured can never render the scheduled or live states §11 and §13 both give it. **Map it to 113; it is not residue.** |
| **115** | section counts and the silent cap |
| **119** | team colour bars |
| **134** | the third column tier |
| **143** | tag placement — the status-row seam |
| **160** | the six known watchlist divergences |
| **168** | Matchups scheduled-row odds (not Overview, but check you are not re-finding it) |
| **169** | `Close` on an unplayed game |
| **170** | the owner name truncating |
| **171** | the dead `isRankedSpotlight` scoring term |
| **172** | comments describing disrupted statuses the provider never sends |

## RULINGS ON YOUR RECEIPT — five points, four of them my errors

**Every code claim you made reproduces.** Featured hard-codes `state="final"`; `broadcast` is passed
only by `WatchlistScoreboardList` so **live rows render none**; **`classification` appears zero times**
in `OverviewPanel.tsx`, so the FCS prefix is unreachable there; `RecapPrimitives.tsx:277` has its own
scoreboard.

### RULING 1 — Item 113 goes on the list. Map to it.

Your (a) is right and the omission was mine. Added to the table above.

### RULING 2 — the 160 collision: a residual that SURVIVES its own item is residue, and it is the most valuable kind

You found that my v1 correction ("a tag-vocabulary divergence is now residue") contradicts the gate
("Item 160's six are off-limits"), because **160's #4 IS the tag-vocabulary divergence and was filed as
157**. My error — I wrote the correction without checking what 160's six were.

**The ruling is neither of your two defaults.** 157 shipped and unified the **vocabulary** — the label
sets. What you observed persisting is a different axis: **two visual TREATMENTS in one slot**, plain
bronze text beside a bronze pill. **A divergence that survives the item filed to fix it is not "known"
— it is the discovery that a closed item did not close what it was filed to close.** That is exactly
what this audit exists to surface.

**So: count it as RESIDUE, labelled `survives Item 157`.** Do not fold it into 160 and do not net it
away. **The gate is amended below** so the two rules no longer collide.

### RULING 3 — the treatment split is UNAUTHORISED, and the conflict is a code error not a document one

Your (c), resolved so it does not block you. `matchups-schedule-design.md:348-350` exempts the
**FEATURED TILE's** reason row (`sb-title`) — *"a card title on its own line rather than an inline tag
beside a status"*. **`gameUi.ts:177-188` cites that exemption to justify the WATCHLIST's reason row.
Different rows.** And the document settles nothing: *"Consequence: bronze appears in two shapes.
**Flagged rather than settled** — making it a pill too is a one-line change if the inconsistency reads
badly."*

**So §2's rejection is not contradicting a decision; it is contradicting a code comment that treated a
flagged question as closed.** Report the watchlist's plain reason row as residue with this ruling
attached. **Do not change the comment** — the gate forbids fixes, and it is planning's to correct.

### RULING 4 — broadcast on live rows is residue

Your (e). Verified: `GameCardList` accepts and passes no broadcast, so Live inherits the finals rule.
**I searched the item set so you do not have to: nothing owns it.** Count it.

### RULING 5 — your partial-match procedure is adopted as written

Your (4) is better than what I asked for. **Naming the near-miss item beside each residue entry so the
count can be re-derived** is the property that makes the number checkable rather than trusted, and I am
adding it to the completeness contract.

**One thing to hold to:** you also said you would not fold a partial match into an item to shrink the
count. **That direction is the one under pressure** — folding feels like tidiness. It is not.

## AUDIT THE CODE AND THE RENDERED TEST OUTPUT, NOT A BROWSER

**A browser is not available to you and you must not treat its absence as a gap.** The Clerk secret in
this worktree was invalid as of 2026-09-08 — every navigation 404s while server rendering, tests and
builds pass, so no gate reports it (`docs/deployment-runbook.md` → *A worktree 404s on every browser
navigation*). **Audit by rendering components in tests and reading the output**, which is
reproducible and citable. If a check genuinely cannot be answered without a browser, **say so and name
it** rather than guessing.

## STOP — post a READ RECEIPT before auditing anything

Report these, then **STOP and wait**.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote §11's consumer matrix row for Overview**, and say for each slot whether the code agrees.
   **This is the check most likely to find residue**, because a slot mismatch is invisible until
   someone compares the table to the props.
3. **Name the four sections and the component that renders each**, from the code. **Two of them share
   a component** — say which, and whether that sharing forces any behaviour they should not share.
4. **Say what you will do when a divergence matches an item PARTIALLY** — the same rendering wrong for
   a different reason than the item names. **That case is residue, not a match**, and deciding it now
   stops the count being shaded later.
5. Anything that CONTRADICTS what you were handed. **The section-to-component mapping above is mine
   and is checkable.**

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/167-overview-audit` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
**Do NOT push `preview`** — the Codex lane holds it for Item 143.

<task>
Run the eleven checks from `composition.md` §7 across **Live, Recent finals, Featured and the
watchlist**. For each divergence found, record: what renders, what the contract says, and **which item
owns it, or NOTHING**.

**CARRIED OBLIGATIONS — verbatim:**

> **Row 7 — LIVE.** **Do not read campaign status from the canonical document**, and **re-derive every
> line-number citation** before putting it in a prompt — they have been stale at least twice, and
> `DESIGN.md` moved again on 2026-09-08.

> **Row 8 — LIVE.** Selection and precedence stay selector-owned; the scoreboard **must not be
> forked**. **CORRECTED 2026-09-08** — there are five direct renderers, and the recap is not one of
> them; `RecapPrimitives.tsx:277` still defines a bespoke `GameScoreboard`.
</task>

<gate>
**Do NOT fix anything.** Not a comment, not a test, not a class name. **A fix inside an audit destroys
the measurement** — the count of unmapped divergences is the deliverable, and it cannot be trusted if
the auditor removed some of them along the way.

**Do NOT file queue items.** `AGENTS.md` → **Documentation closeout timing**: the implementation lane
reports findings and planning files them. Report them in your final message.

**Do NOT count a known divergence as residue — but a RESIDUAL is not a known divergence.** Item 160
lists six for the watchlist (enumerated in `overview-back-application.md`); re-finding them as filed is
expected and must not inflate the count. **However, where a filed item SHIPPED and the divergence
persists in another form, that is residue** — see RULING 2. **The test is whether the item's own
mechanism still describes what you are looking at.**

**Do NOT treat a missing browser as an unrunnable check** — see above.

STOP and report if a check cannot be answered from the code and the tests, or if the contract itself
turns out to be ambiguous about what Overview should render.
</gate>

<completeness_contract>
- **All eleven checks run against all four sections**, or a named reason a check does not apply to a
  section. A skipped check is a hole and cannot be inferred from the others.
- **Every divergence carries its mapping** — an item number or `NOTHING`. No divergence is left
  unmapped in the report.
- **The residue count is stated as a number**, prominently, with each residue item named.
- **Every residue entry names its nearest item and why that item does not cover it**, so the count can
  be re-derived by a reader rather than trusted. Your procedure, adopted.
- **State the population you covered**: which files you read, which checks you could not answer, and
  what you could not reach. **"Zero residue" and "zero residue in what I could see" are different
  claims** (`AGENTS.md` → a measurement's coverage is part of its result).
</completeness_contract>

<verification>
This item changes no code. Run `npx tsc --noEmit` and `npm run lint:all` once at the end and report
their exit codes, to prove the tree is unmodified. **If `npm test` moves at all, you have edited
something.**
</verification>

<output_contract>
**Lead with the residue count.** A number, then the list. Everything else is supporting detail.

Then, per section: the divergences found, each with what renders, what the contract says, and its
mapped item or `NOTHING`.

**Say plainly whether Item 160 is the whole of the back-application problem or only the part that was
visible in a screenshot.** That is the question this item exists to answer and a report that does not
address it directly has not delivered.

**Report the coverage limits** — checks you could not run, and why.

No closeout. No registry entry. **This item ships nothing and files nothing**; its output is the
report, and planning records the findings against their items.
</output_contract>
