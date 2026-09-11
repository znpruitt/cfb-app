PROMPT_ID: PLATFORM-110A-GAME-STAT-RECOVERY-CLAUDE-v1
PURPOSE: Item 110A — recover five measured game-stat records that disagree with newer CFBD observations, through the existing authorized writer, with before/after evidence. Bounded to those five.
SCOPE: a recovery path over the existing game-stats ingestion authority, and tests. NOT the recurring reconciliation (Item 110B). NOT the polling window (Item 131). NOT the correction of provider-status comments (Item 172).
CARRIES: NONE. Item 110's campaign obligations are recorded in the item itself; this slice adds no Item 87 dependency.

Read `AGENTS.md` first. Nothing in it is restated.

## THIS SLICE WRITES TO PRODUCTION DATA. That is what makes it different.

**Every slice this campaign has run changed code. This one changes stored records.** The gate below
stops you before the write, and that stop is not a formality.

**Evidence:** [`docs/archive/audits/codebase-audit-existing-plans-2026-09-08.md`](../archive/audits/codebase-audit-existing-plans-2026-09-08.md)
→ **C3**. Read that section before anything else.

## The five records

Measured 2026-09-08 against fresh CFBD observations for 2026 regular-season Week 1. **Stored
observation fence `2026-09-08T04:45:06.949Z`.**

| Provider game ID | Game | Examples of cached → newer |
| --- | --- | --- |
| `401868170` | Charleston Southern at Georgia Southern | GaSo total **424 → 513**, passing **281 → 351**, rushing **143 → 162**; ChSo total **35 → 117** |
| `401858212` | SMU at Florida State | FSU total **329 → 324**, rushing **206 → 199**, passing **123 → 125** |
| `401856661` | Louisville at Ole Miss | Ole Miss total **478 → 488**, rushing **142 → 152**, attempts **42 → 41** |
| `401868967` | Texas Southern at Prairie View A&M | PVAMU total **397 → 398**, rushing **159 → 160** |
| `401867939` | South Carolina State at Florida A&M | FAMU possession seconds **1718 → 1787** |

**Three are FBS-involving and were already classified "satisfied"** — which is why ordinary polling will
never revisit them. **That is the whole difficulty of this item.**

## What makes this hard, stated so you do not rediscover it

**The writer works. Eligibility is what excludes these games.** Game-stat polling excludes satisfied
evidence and bounds eligibility to roughly kickoff +3–24 hours. **Satisfaction establishes usability,
not an immutable final provider revision.**

So the recovery needs a **bounded path that re-observes named games regardless of satisfaction** —
without becoming the general recurring reconciliation, which is Item 110B and is separately designed
and reviewed.

**Existing authority to build on, not around:** `ingestGameStatsPartitionResponse`
(`src/lib/gameStats/ingestionCoordinator.ts:112`), `mergeGameStatsPartitionDurable`
(`src/lib/gameStats/durableMerge.ts:771`), and the game-stats cron route. **Preserve canonical identity,
writer fencing, prior-good retention, quota controls and truthful outcomes.**

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Name the exact authority you will re-observe through**, and say what currently prevents it running
   for these five. **Quote the eligibility check that excludes satisfied evidence.**
3. **Say what a re-observation writes.** Does an identical observation advance the durable fence? **It
   legitimately may** — the audit is explicit that repeatability is not "zero database writes". Say what
   changes and what does not, so the before/after evidence can be read.
4. **Say how many CFBD calls this will cost**, and against what remaining quota. The last durable
   observation was **4,713 of 5,000** at 2026-09-09 00:00:17 UTC. **A recovery that cannot state its
   own cost does not run.**
5. Anything that CONTRADICTS what you were handed — including whether all five still differ, which may
   have changed since 2026-09-08.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/110a-game-stat-recovery` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** Also note: **the Vercel free-tier deployment quota was exhausted on
2026-09-08** (100/day, and a skipped docs build still consumes one). Deployments may be refused for up
to 24 hours. **That is not a build failure and not something you broke** — see
`docs/deployment-runbook.md`.

<task>
1. **Build the bounded recovery path** — re-observe the five named provider game IDs through the
   existing authorized writer and merge the result.
2. **Produce before/after evidence** for each of the five: the stored values, the newly observed values,
   and what changed.
3. **STOP. Do not apply to production.** Report the evidence and wait for the owner.
</task>

<gate>
**DO NOT WRITE TO PRODUCTION WITHOUT EXPLICIT OWNER APPROVAL OF THE EVIDENCE.** Build the path, run it
in whatever mode produces the before/after without committing, and stop. **The owner approves the diff,
then authorizes the apply.** This is the same shape as promotion: the mechanism is delegated, the
decision is not.

**Do NOT build the recurring reconciliation.** Item 110B owns revisiting satisfied partitions on a
cadence, and its cadence is a deliberately open decision. **A recovery that quietly generalises is 110B
shipped without its review.**

**Do NOT extend the polling window.** The audit states plainly that extending it alone is insufficient,
and the window is Item 131's scope.

**Do NOT widen beyond the five.** A season sweep is not this item and would spend quota nobody budgeted.

**Do NOT touch the false provider-status comments.** Item 172 owns them.

STOP and report if re-observation requires bypassing writer fencing, or if the five can only be reached
by a path that would also reach every other satisfied game.
</gate>

<completeness_contract>
- **Each of the five is re-observed and its before/after recorded.** Named by provider ID.
- **Prior-good data survives a failed observation.** Assert it — a partial provider response must not
  destroy a stored record.
- **The path cannot run unbounded.** Assert that it operates on an explicit set and refuses an empty or
  unbounded target rather than defaulting to everything.
- **Writer fencing is intact.** Prove by mutation that a concurrent writer is still excluded.
- **Truthful outcome reporting** — a failed observation reports as failed, not as a no-op.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving fencing holds; **the
CFBD call count actually spent**; and the before/after for all five records.

**Lead with the evidence table, not with the code.** The owner is approving a data change.

**Say plainly whether all five still differ**, and name any that no longer do.

**Report new findings; do not file them.**

Closeout after review convergence and after the apply is authorized: registry entry, Item 110A status,
and the audit evidence file gaining a dated note that recovery ran.

Merge is delegated to this lane under `CLAUDE.md`. **The production apply is NOT.** Promotion is not.
