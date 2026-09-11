PROMPT_ID: PLATFORM-692-FINAL-OBSERVATION-STAMP-CLAUDE-v1
PURPOSE: Record, per game, the first observation at which its SCORE read final, so the
`kickoff + 24h` reconciliation tail can be sized from a distribution instead of a six-game sample.
Observation-only: no polling, eligibility, or rendered output changes.
SCOPE: `src/lib/scores/cache.ts`, `src/lib/liveScores/scoreMerge.ts`,
`src/lib/scores/manualPartitionMerge.ts`, and their existing suites. NOT `pollingTarget.ts`, NOT
`pollingWindows.ts`, NOT any cron cadence, NOT `ScorePack`, NOT any route response.
CARRIES: NONE — checked. Item 140/#692 belongs to the game-stats/reconciliation cluster, not the
Item 87 campaign, so `docs/campaigns/item-87-INDEX.md` has no row for it;
`docs/campaigns/vercel-active-cpu.md` carries no CARRY block. The two binding constraints below come
from the issue itself and are reproduced verbatim rather than summarized.

> **Do NOT resize the tail as part of this item, and do not fold it into Item 102 slice 4.** The tail
> is pinned to `pollingTarget`'s `POLLING_WINDOW_AFTER_KICKOFF_MS`, and `pollingWindows.ts:54-62`
> forbids the planner closing before the handler's eligibility window. Moving it changes what the
> handler will poll at all — a correctness change with its own review, not a scheduling tweak.

> **SCOPE PROTECTED 2026-09-09.** This item measures when a **SCORE** first reads final. **It cannot
> measure when STATISTICS stop changing, and it is NOT a prerequisite for Item 110A or 110B.**

---

## Ship today. There is a full slate tomorrow.

2026-09-12 is a full Saturday. The 2026-09-05 equivalent carried **232 kickoffs in one cluster**.
This measurement is **perishable** — CFBD publishes no end time, so a game's finish instant exists
only as our own observation, and every weekend this is not deployed is a weekend that can never be
recovered. Verified against the live API 2026-09-11: `/games` exposes 36 fields whose only temporal
ones are `startDate` and `startTimeTBD`; `/scoreboard` nulls `period` and `clock` the moment a row
reads `completed`. **Nothing can be backfilled.**

Size the work accordingly. It is smaller than the issue implies — see below.

## The detector already exists. It counts the event and throws away the identity.

`src/lib/liveScores/scoreMerge.ts:274-279`:

```ts
if (
  classifyScorePackStatus(result.row) === 'final' &&
  (!protectionRef || classifyScorePackStatus(protectionRef) !== 'final')
) {
  finalized += 1;
}
```

That branch fires exactly when a row becomes final **and was not final before** — a first-transition
test, already written, already in the merge txn, already keyed by `id`. The item is to record `id →
now` there instead of only incrementing a counter.

## Where the stamp goes, and why not on `ScorePack`

**Put it on `CacheEntry` (`src/lib/scores/cache.ts:6`) as an optional per-provider-game-id map.**
That shape is already the house pattern, twice over on the same type:

- `itemUpdatedAtById?: Record<string, number>` — per-id, optional, absent on legacy entries, with a
  documented fallback so pre-B1 entries reconcile exactly as before.
- `pendingFinalConfirmationIds?: string[]` — per-id, optional, "never required by any reader."

`ScorePack` (`src/lib/scores/types.ts:29`) is the shape that reaches rendered output and route
responses. A field added there leaves observation-only territory immediately. Follow the precedent
that is already on the type you are writing.

## Three constraints that decide whether this works

**1. FIRST write wins, permanently.** Once an id is stamped it is never re-stamped. A game that reads
final, then is corrected by a later `/games` pass, keeps its ORIGINAL stamp — the question being
measured is when we first believed it, not when it settled. Merge prior over new, not new over prior.

**2. ALL THREE writers must carry the map forward, or it vanishes silently.** Enumerated at
`a774b3f6`, writers and consumers both — a seam audit that stops at writers is half of one:

| site | role | what it must do with the new map |
| --- | --- | --- |
| `liveScores/scoreMerge.ts` | rebuilds the entry; **owns the stamp** | write new ids, carry prior ones |
| `scores/manualPartitionMerge.ts` | rebuilds the entry | carry forward; never synthesize |
| `app/api/admin/cache-historical-scores/route.ts:327` | `setAppState<CacheEntry>` backfill | carry forward; **never synthesize** |

**The third one is the trap.** It is an admin BACKFILL path writing historical partitions, where
"the first observation at which we saw this final" is a fact that does not exist — those games
finished before anything was watching. It must preserve an existing map and must never invent a stamp
from its own write time, or the distribution is poisoned with values that are really backfill
timestamps. `/api/scores/route.ts` constructs entry-shaped objects but calls no `setAppState`, so it
is not a writer; confirm that rather than assuming it.

A new optional field missing from any of the three is dropped on the next write with no error.

**This is the exact failure #732 measured in the planner record**, where `sortAndBound` rebuilds the
stored value so any added field "is silently dropped by the next write. A naive addition would appear
to work and then vanish." Same hazard, different file. **A test must prove a stamp survives a
subsequent unrelated write through each rebuilder** — not that a stamp can be written.

**2b. The consumers are all pure, and the response boundary holds — verified, not assumed.** Four
modules read a scores `CacheEntry` and none writes, enumerates its keys, measures its serialized
size, or rejects unknown fields: `server/providerCacheState.ts`, `schedule/finalScoreSweep.ts`,
`server/scoreCacheReader.ts`, and `liveScores/canonicalContext.ts` — the last of which reads
`pendingFinalConfirmationIds` and is the worked example of how an optional per-id field is consumed
here. **And `/api/scores` builds its response as `{ items, meta }` from `ScorePack[]`
(`route.ts:91-92`), never from the entry** — which is what actually makes the `CacheEntry` choice
observation-only rather than merely intended to be. Re-derive this; it is the claim that, if wrong,
means the stamp ships into a public API response.

**3. Nothing reads it yet, and that is correct.** No route, no selector, no UI. The consumer is a
future `psql` query against the durable store. Do not add a reader "for completeness"; do not resize
anything; do not touch the cadence.

## What good evidence looks like

The tail exists for the straggler path and **that path has never been measured** — Item 108's six
games measured the normal path (`kickoff + 3.40h..4.75h`) and sized the DENSE window. The production
measurement of 2026-09-11 showed the fixed 8h margin is **86% of the dense window on a weeknight
cluster and 97% on a single-game Monday**, so what this stamp unlocks is the largest remaining CPU
lever in the binding month. But one weekend is a mechanism, not a distribution — **the value comes
from it running for weeks**, which is the argument for shipping it tomorrow rather than perfecting it.

---

## STOP — read receipt before writing any code

Answer from the files. Every question is one this prompt could be wrong about.

1. Quote the `finalized` branch at `scoreMerge.ts:274-279` and say whether it can fire **twice** for
   one provider game id across separate writes. What state, if any, prevents it? Your answer decides
   whether constraint 1 needs code or is already guaranteed.
2. I claim **three** writers and **four** pure consumers, in the tables above. Prove or break both
   lists. `src/lib/scores/historicalScoreWrites.ts` references the type and appears in neither —
   say which it is and why. A name collision already caught me out once here:
   `app/api/schedule/route.ts` has its own unrelated `CacheEntry`, so a bare grep for the type
   over-reports.
3. `manualPartitionMerge.ts` copies `itemUpdatedAtById` forward differently from `scoreMerge.ts`.
   Show both, and say whether the new map can reuse either approach unchanged.
4. Is the durable store's per-entry size bounded? A 232-kickoff Saturday adds 232 keys to one entry.
   Say what the largest existing `itemUpdatedAtById` map is in production terms and whether this
   doubles it.
5. Does `classifyScorePackStatus` returning `'final'` mean the SCORE is final, or can a statistics-
   only or provisional state reach it? Cite the function. The C3 scope protection turns on this.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
