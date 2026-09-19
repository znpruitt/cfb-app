# PLATFORM-663 — targeted schedule repairs must converge

```text
PROMPT_ID: PLATFORM-663-SCHEDULE-CONVERGENCE-CLAUDE-v1
PURPOSE: A repaired WEEK partition is invisible to every whole-season reader, so a corrected week can
         sit in the store while standings, Insights, the draft board and diagnostics keep building
         from an older aggregate. Define the convergence contract, then implement it.
SCOPE:   PHASE A IS DESIGN ONLY — the read receipt ends with a proposed contract and STOPS for a
         ruling. No code until that ruling. Phase B's scope is set BY the ruling; expect
         src/lib/server/canonicalScheduleCache.ts, the commit paths in src/app/api/schedule/route.ts,
         and their tests. DO NOT change what the provider is asked for, the empty-replacement guard,
         the refresh authority's leases, or any UI file.
CARRIES: NONE from the Item 87 campaign index, having checked — this is store-layer work and touches
         no scoreboard row, tag slot or row anatomy.

         Two standing obligations that DO bind here:

         "Audit seams BEFORE writing": enumerate a shared fact's WRITERS, its readers' MEANINGS, and
         the controls live in each state. A reader that takes the aggregate and a reader that takes
         the partition pair are two different meanings of "the season's schedule", and this slice is
         about exactly that divergence.

         #693's lesson, verbatim from its shelf record: "the module publishes certainty where the
         truth is unknown". A convergence contract that cannot say whether a season is complete must
         say so rather than assume it is.
```

---

## What planning measured on 2026-09-19

**Production holds seven schedule keys, and every one is a whole-year aggregate:**

| key | rows | last written |
| --- | --- | --- |
| `2018-all-all` | 1,556 | 2026-04-17 |
| `2021-all-all` | 2,454 | 2026-07-26 |
| `2022-all-all` | 3,705 | 2026-07-26 |
| `2023-all-all` | 3,734 | 2026-07-26 |
| `2024-all-all` | 3,801 | 2026-07-26 |
| `2025-all-all` | 3,831 | 2026-09-03 |
| `2026-all-all` | 3,679 | 2026-09-19 |

**Zero week partitions exist.** No `${year}-${week}-${seasonType}` row, and no legacy `${year}-${week}-all`. So the defect is **latent**: the store has never held a targeted repair for an aggregate to hide. #663's triage says the same, and says it plainly — *"confirmed defect; no current production divergence found"*.

**That is the slice's defining constraint.** There is nothing to fix in the data, and no measurement can show the defect happening today. The work is a contract that makes the divergence impossible, not a repair.

## The divergence, from the code

**The writer can write a week.** `/api/schedule` commits a targeted partition to `${year}-${week}-${seasonType}` (`route.ts:451`, `:532`), with its own scope, its own row count and its own refresh receipt.

**Almost nobody reads one.** `loadCachedScheduleItems` reads `${year}-all-all`, and falls back to the `-all-regular` + `-all-postseason` pair (`canonicalScheduleCache.ts:18-26`). Every whole-season consumer goes through that shape or repeats it inline:

- `seasonBuild.ts:95-103` — the canonical scored build behind standings, Insights and archives
- `providerCacheState.ts:56`, `scoreApplicability.ts:49`, `providerDataDiagnostics.ts:391`, `:483`
- `rankings/automaticContext.ts:230`, `league/[slug]/draft/board/boardData.ts:23`
- `schedulePresentationRefresh.ts:134`, `fullSeasonScheduleRefresh.ts:280`

**Only `/api/schedule` itself reads child keys** (`route.ts:212`, `:263`, `:485-488`). So a corrected week is visible to the route that wrote it and to nothing else.

**And the aggregate can be older than the partition**, with nothing recording the relationship: the two keys carry independent `at` stamps and no ordering between them.

## What the contract has to answer

State each, and say what the store must hold to make the answer checkable:

1. **Precedence.** When a partition and an aggregate disagree about a game, which wins, and how does a reader know without fetching both?
2. **Completeness.** A whole-season reader needs every game. If partitions are authoritative, what proves the set is complete — and what does a reader do when it cannot be proved? #693's lesson applies: an unprovable claim is reported, not assumed.
3. **Observation ordering.** Two writers can commit out of order. What makes "newer" decidable — the `at` stamp, the commit sequence (`nextProviderCommitSeq`), or something the store does not hold yet?
4. **Concurrency.** The full-season writer and a targeted repair can run at once. Which loses, and does the loser know it lost?
5. **Dependent views.** A converged schedule changes standings and Insights. What must be invalidated, by whom, and what happens when that invalidation fails — the failure mode #693 is shelved on.

## Shapes worth weighing, none of them chosen

Name the trade-offs; the ruling picks.

- **Fold on write** — a partition commit rewrites the aggregate in the same transaction. Readers stay as they are; the write gets more expensive and needs the concurrency answer.
- **Fold on read** — readers merge aggregate plus partitions. No write change; every reader pays, and nine of them would have to agree.
- **Aggregate-only** — targeted writes stop producing a separate key and repair the aggregate directly. Simplest store, and it discards the per-partition receipt the refresh authority records today.
- **Generation counter** — the aggregate carries the newest partition generation it has absorbed; a reader can detect staleness without reading partitions.

## Phase A acceptance

The receipt is the deliverable. It must contain:

1. **A verified seam map** — every writer of scope `schedule`, every reader, and for each reader **what it means by "the season"**, with file:line. Planning's list above is a starting point and may be incomplete; say what it missed.
2. **The five answers** above, as a contract.
3. **One recommended shape, with the rejected ones and why.**
4. **What Phase B would change**, file by file, and what its tests would pin.
5. **The blast radius of getting it wrong**, stated concretely: which member-visible surfaces read a schedule that a bad merge could corrupt.

## STOP — read receipt before any code

1. **Re-run planning's inventory** on the read-only replica (`DATABASE_URL_RO`; never print the connection string). Confirm or correct the seven keys and the absence of partitions.
2. **Who writes a week partition today, and under what trigger?** Trace every caller of the targeted path, including cron. If nothing reaches it in production, say so — it changes the urgency and possibly the shape.
3. **The five contract questions**, answered from the code as it is, before proposing anything.
4. **Does the legacy `${year}-${week}-all` key still get read**, and by what? It appears at `route.ts:263` and `:488`.
5. **What happens today if a partition and the aggregate disagree?** Trace one game through both paths and say which value each consumer renders.
6. **Your recommended shape and why**, with the rejected ones.
7. **What in this prompt contradicts what you found in the files?**

**Stop after the receipt. Phase B is a separate ruling.**
