PROMPT_ID: PLATFORM-110B-CORRECTION-RECONCILIATION-CLAUDE-v1
PURPOSE: Item 110B — recurring correction reconciliation. Revisit satisfied partitions so provider revisions are picked up instead of sitting until someone audits. The cadence is UNDECIDED and this slice measures before it designs.
SCOPE: a reconciliation path over the existing game-stats ingestion authority, its scheduling, and tests. NOT the initial polling window (Item 131). NOT the raw-category merge gap (Item 193, deliberately). NOT `provider-refresh-status` correction (Item 194).
CARRIES: NONE from Item 87. Item 110A's findings are carried in the body.

Read `AGENTS.md` first. Nothing in it is restated.

## Why this exists, in one paragraph

**Item 110A proved the gap is live, not theoretical.** Five records in `2026:1:regular` disagreed with
CFBD and were corrected on 2026-09-09. **They were not missed** — a successful refresh committed 203
rows on 2026-09-08 at 04:45:12Z and **CFBD revised five of them afterwards.** Once a game's evidence is
`satisfied` the poller stops considering it, and the kickoff window closes about a day after that. So
nothing was ever going to look again.

**Evidence:** [`docs/archive/audits/codebase-audit-existing-plans-2026-09-08.md`](../archive/audits/codebase-audit-existing-plans-2026-09-08.md)
→ **C3**, including its dated recovery note. **Read C3 in full before anything else.**

## THE CADENCE IS THE DESIGN, AND IT IS NOT DECIDED

**Do not pick one from intuition.** The audit left it deliberately open, the planning session has
already reasoned about it from a wrong number once, and it determines everything else about this slice.

**Measure first. That is receipt work, not implementation.**

### What is measurable and what is not

**You cannot re-measure the 25-hour revision rate.** `2026:1:regular` is the **only** 2026 partition —
Week 2 has not been played. There is no second current week.

**What you CAN measure is long-run drift, and it is the more useful number.** All 2021–2025 partitions
were fetched **2026-04-16** in a bulk backfill. **Fetch one historical week fresh and diff it against
the stored partition.** That answers the question a cadence actually turns on: **do provider revisions
settle, or do they keep arriving for months?**

- **If a 2025 week fetched in April still matches today**, revisions settle quickly and a tight cadence
  buys nothing — a short window after the initial satisfaction would do.
- **If it differs materially**, they do not settle, and the reconciliation has to be recurring and
  probably season-wide.

**Those two answers imply completely different slices. Get the number before you design.**

### The inventory, so the cost of any design is known

**97 partitions exist**, one `app_state` row each under scope `game-stats`. **CFBD `/games/teams` is
partition-granular** — `buildCfbdGameTeamStatsUrl` (`src/lib/cfbd.ts:88`) emits only `year`, `week`,
`seasonType` — so **one call per partition**. A full-history sweep is **~97 calls**; a single-season
sweep is ~16. The budget is 5,000 a month and the last observation was **4,713 remaining**.

**CFBD documents a `gameId` parameter that this codebase does not use.** Item 110A found it and did not
add it. **If per-game fetches would change your design, say so** — but verify it costs a call before
building on it, and budget that call.

## What Item 110A established — carried so you do not re-derive it

- **The authority:** `ingestGameStatsPartitionResponse` → `mergeGameStatsPartitionDurable`. An
  activation-invariant test pins the merge to exactly two callers, so the coordinator is the only door.
- **A bounded restriction already exists.** 110A added `restrictToProviderGameIds` — refuses empty,
  refuses a set matching nothing, describes only the selected batch in diagnostics. **Reuse it rather
  than building a second bound.**
- **Fence semantics.** A strictly newer observation with identical content writes anyway
  (`refreshed`) — **repeatability is NOT zero database writes.** Differing content is `updated`. An
  older fence is `stale` and refuses. Equal fence with different content is `conflict`.
- **The repair is partial by construction and that is FINE here.** `mergeRawEvidence` writes a raw
  category only where a parser exists, and `publicProjection.ts:137` exposes only those same
  categories. **The unrepairable fields are exactly the invisible ones** (Item 193). Do not solve it.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Run the drift measurement and report the number.** One CFBD call against one historical partition
   of your choosing — say which and why. Report: rows compared, rows differing, and **which fields**.
   **State the call cost and the remaining quota before and after.**
3. **Given that number, propose a cadence and say what it rules out.** A proposal that does not name
   what it rejects has not used the measurement.
4. **Say what the reconciliation does about a partition that is currently ELIGIBLE for ordinary
   polling.** Two writers on one partition is the collision the writer fence exists for — say whether
   you avoid it by scope, by lock, or by scheduling.
5. Anything that CONTRADICTS what you were handed — including the 97-partition inventory and the
   one-call-per-partition claim, both mine.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/110b-correction-reconciliation` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`. **Do NOT push `preview`** — the Codex lane holds it.

<task>
Build the reconciliation the measurement supports. **Its shape is yours to propose and mine to rule on
at the receipt** — that is why the receipt comes first.

Whatever the shape:

1. **It revisits SATISFIED partitions.** That is the whole point; ordinary polling already covers the
   rest.
2. **It records what changed and what failed**, per run, truthfully.
3. **It supports missed-run recovery.** A skipped day must not mean a permanently skipped correction.
4. **It preserves canonical identity, writer fencing, prior-good retention and quota controls.**
</task>

<gate>
**DO NOT WRITE TO PRODUCTION.** This slice builds and tests a path; it does not run it against live
data. **Item 110A's apply was separately authorized by the owner after an evidence review** — that
precedent is a gate, not a licence.

**Do NOT pick a cadence before measuring.** Receipt item 2 exists because the planning session already
reasoned about this item from an imported number and got it wrong.

**Do NOT touch the initial polling window.** Item 131 owns it, and the audit says extending it alone is
insufficient anyway.

**Do NOT try to repair raw-only categories.** Item 193, and they are invisible to every consumer.

**Do NOT build a second bounding mechanism.** 110A's `restrictToProviderGameIds` exists.

**Do NOT spend more than the calls you budget in the receipt.** State them, then stay inside them.

STOP and report if the drift measurement suggests the cadence should be something the audit did not
anticipate — that is a finding about the audit, not a reason to build around it.
</gate>

<completeness_contract>
- **The drift measurement is reported as a number**, with its partition, its call cost, and quota before
  and after.
- **The cadence is justified by that number**, and the report says what the number ruled out.
- **A reconciliation run records changed games and failures.** Assert truthful outcomes — a failed
  observation must not report as a no-op.
- **Missed-run recovery works.** Assert that skipping a scheduled run does not permanently skip its
  partitions.
- **It cannot collide with ordinary polling.** Prove by mutation that the fence or lock rejects a
  concurrent writer, with a positive control showing the same call commits when the contention is gone.
- **Quota controls hold.** Assert the path refuses to run when the reserve is short.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
**Lead with the drift number and the cadence it supports.** The code is secondary to the decision it
implements.

Then: what changed and where; the measured test delta; the mutation proving no collision with ordinary
polling; the CFBD calls actually spent; and anything you deliberately did not do.

**Say what this costs per run and per season**, in calls. A reconciliation whose cost is unstated cannot
be scheduled.

**Report new findings; do not file them.**

Closeout after review convergence: registry entry, Item 110B status, and the audit evidence file's C3
gaining the drift measurement. **Planning stands off that file for the duration** — `CLAUDE.md`, added
2026-09-09 after we collided on it silently.

Merge is delegated to this lane. **Running the reconciliation against production is NOT.** Promotion is
not.
