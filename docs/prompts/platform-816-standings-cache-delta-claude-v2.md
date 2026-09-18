# PLATFORM-816 v2 — reconstruct the detector as observables

```text
PROMPT_ID: PLATFORM-816-STANDINGS-CACHE-DELTA-CLAUDE-v2
PURPOSE: Rebuild the cache-read detector so it PUBLISHES WHAT IT OBSERVED and derives almost nothing.
         v1's detector classified by elimination, and four review passes each added ~3 instances of
         one class — the detector claiming more than it observes — including round 4, whose entire
         purpose was to remove that class.
SCOPE:   Reconstruct the detector section of
         src/app/api/debug/standings-cache-delta/route.ts and its tests. KEEP the comparison core,
         the blockers, the year bound, the admin gate, the import guard and the stale-snapshot
         harness — with ONE correction carried below (the history digest sorts). Re-derive; do NOT
         cherry-pick v1's detector commits, which carry the defects that stopped them.
         DO NOT change caching behaviour, tags, `invalidateStandings`, System Health, or anything
         #693 touched. DO NOT widen `computeCanonicalStandingsUncached`'s single legitimate caller.
CARRIES: Every finding on the v1 branch, restated as SPECIFICATION rather than as bug reports. The
         enumeration lives in the v1 closeout at `1a29024f` and in
         [#817](https://github.com/znpruitt/cfb-app/issues/817),
         [#818](https://github.com/znpruitt/cfb-app/issues/818),
         [#819](https://github.com/znpruitt/cfb-app/issues/819). Read them before writing anything;
         the ones planning can name are below. If the closeout lists a finding this prompt omits, the
         closeout wins — say so in the receipt.

         REFUTED, do not re-derive: `classifyCacheRead` branching on `workStoreCachePresent` where
         Next branches on the work-store object. `work-store.js:43-45` builds the store's cache as
         `renderOpts.incrementalCache || globalThis.__incrementalCache`, so "store present, cache
         absent" implies the global is absent and the `unavailable` path fires first. Struck on
         #819 with the evidence.
```

---

## The rule this reconstruction exists to obey

**Do not classify by elimination.** Every defect in v1's detector had the same shape: a verdict derived
from what did *not* happen — nothing was queued, so it must be a hit; not draft mode, so it must be X —
and each derivation was only as sound as an enumeration that kept turning out incomplete.

**So: publish the observations. Derive a verdict only where it is a pure function of values the request
actually read, and print those values beside it** so a reader can re-derive the verdict without trusting
the route. Where the observations do not determine an answer, the answer is that they do not — an
explicit "cannot tell", never the nearest confident verdict.

**A field that cannot be observed must not exist.** v1 kept `publicationConfirmed` and
`dataCachePublicationQueued` alive through four rounds of increasingly careful wording; each round the
wording was the thing that was wrong. If the route cannot observe whether a publication happened, it
reports the `pendingRevalidates` keys it saw at entry and at exit and stops there.

## What the observations are

At minimum, printed as facts:

- the snapshot's `generatedAt`, and the exact stamp this request passed in
- whether a work store was present; whether an incremental cache was present
- `isDraftMode`, `isOnDemandRevalidate`, `fetchCache`
- the `pendingRevalidates` **keys** at entry and at exit, not a count — `patch-fetch.js:182` and `:723`
  DELETE keys, so a count is not monotonic and a difference of zero is not evidence of no write
- the resolved year and where it came from

Derived, and only if each is a pure function of the above: whether the returned snapshot was stamped by
this request. Everything else stays an observation.

## The one correction inside the kept surface

**`digestHistoryWeek` sorts (`route.ts:546-549`), and order is load-bearing.** `selectRankTrend` derives
rank from `byWeek[week].standings.findIndex(...)`, so two histories differing ONLY in order render
different rank trends and this digest reports them equal. **Compare positionally.** This is a
comparison-core defect, not a detector one — planning's earlier "the core is clean" claim was wrong,
and the receipt should say whether anything else in the core normalises away a difference a consumer
can see.

## Acceptance

1. **Every field in the response names the observation it rests on**, in the code, and a test asserts
   that behaviour. A field whose comment describes a mechanism no test pins is a defect here.
2. **A reader can re-derive every verdict from the printed values.** Prove it by example in the
   closeout: one `hit`, one `miss`, one "cannot tell", with the printed values that force each.
3. **"Cannot tell" is a first-class outcome**, reachable and tested, and it must not be reachable only
   through an error path.
4. **The history digest is order-sensitive**, with a test where two histories differ only in order and
   the comparison reports a difference.
5. **The comparison core, blockers, year bound, admin gate and import guard behave as they do today**,
   pinned by their existing tests where those still hold. Any test you drop, you name and justify.
6. **No `setAppState` write on any path**, with an observer carrying its own positive control; the
   data-cache write on a miss named explicitly in the response and the comment.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.**

**The detector needs its own positive control, separate from the comparison's.** An observer that
watches a guard is not proven by proving the guard.

**State the harness's limitation in the test file**, as v1 did: real `unstable_cache`, fake incremental
cache, inline `set` versus production's deferred `pendingRevalidates` write.

**A fifth pass on this class ends the branch.** The precommitment that stopped v1 carries forward: if
review finds another instance of *the detector claims more than it observes*, we ship with the
limitation documented rather than patch again.

---

## STOP — read receipt before writing any code

1. **List every finding you are carrying**, from the `1a29024f` closeout and #817-#819, and say for
   each whether the rebuild removes it by construction, fixes it, or documents it. A finding that
   survives as a documented limitation is an acceptable answer; an unlisted one is not.
2. **Which fields survive the "publish observations" rule, and which die?** Name the deaths. If
   `dataCachePublicationQueued` or `publicationConfirmed` survive in any form, justify them against
   four rounds of evidence that they could not be stated truthfully.
3. **What replaces the millisecond-stamp comparison** (#817), or is it retained with its residuals
   printed as observations? Either is acceptable; deriving a verdict by elimination is not.
4. **Does the year bound take #818's archived-season disjunct now?** It is a behaviour change, so it
   is a ruling, but the rebuild is the moment to ask.
5. **Beyond the history digest, does anything else in the kept core normalise away a difference a
   consumer can see?** Name what you checked.
6. **What in this prompt contradicts the v1 closeout or the files?** The closeout wins over this
   prompt on the findings enumeration.

Do not start until the receipt is answered and it has been ruled on.
