PROMPT_ID: PLATFORM-693-STANDINGS-INVALIDATION-CLAUDE-v1
PURPOSE: A failed canonical-standings invalidation is swallowed and the code comment promises a
recovery the cache cannot provide. Report the failure separately from the commit, and support replay
without another provider fetch.
SCOPE: `src/app/api/schedule/route.ts` (both post-commit invalidation blocks),
`src/lib/selectors/leagueStandings.ts` if the reporting seam belongs there, and their suites. NOT the
standings derivation, NOT the cache key shape, NOT `standingsCacheWarmer.ts` (#785), NOT the other
`invalidateStandings` callers unless the receipt shows they share the defect.
CARRIES: `AGENTS.md` → *Truthful provider-refresh status (PLATFORM-086A)*, verbatim in the part that
governs the shape of any fix here:

> A **failed** attempt must NEVER advance `lastSuccessAt` — it preserves the prior-good
> `source`/`rowsCommitted` still being served; **success** is recorded only AFTER the durable
> provider-data commit (composing with durable-first); and the record helpers are **best-effort** —
> they must never throw into the provider path, so a status-write failure can't corrupt the data
> commit.

**That invariant is why this defect exists and it must survive the fix.** The swallow is not
careless — the commit has already succeeded, and throwing would turn a completed state change into a
500. **The bug is that the failure is discarded rather than recorded, not that it is caught.**

Issue: [#693](https://github.com/znpruitt/cfb-app/issues/693). **Audit finding R3**, and the LAST open
item of the 2026-09-08 audit's reliability and security set — R1, R2, R4, S1 and S2 are all closed.

---

## Lane and branch

**Platform lane, `/Users/zach/cfb-app-claude`.** Fast-forward `claude/base` — it is well behind —
then branch and **verify the SHA**. `npm test` exits 0 on clean `main`; **the known-failure set is
EMPTY**.

**`CLAUDE.md`'s push-`preview` instruction is SUSPENDED for this branch** if the UI lane holds the
grant when you start; confirm before pushing it. No user-visible surface here.

## The defect

Two post-commit blocks, `route.ts:823-832` and `:1194-1201`, both:

```ts
try {
  const leagues = await getLeagues();
  for (const league of leagues) {
    invalidateStandings(league.slug, year);
  }
} catch {
  // Non-fatal — … canonical will refresh on the next mutation or natural cache turnover.
}
```

**The comment is false in its second half.** `dataCachedCanonicalStandings` is **`revalidate: false`** —
tag-only. **There is no natural cache turnover.** A swallowed invalidation leaves the cached standings
stale until some *other* mutation happens to fire the same tag, and **a subsequent unchanged provider
refresh commits nothing, so it fires nothing.**

**Three distinct failures hide behind one bare `catch`:**

1. **`getLeagues()` throws** — no league is invalidated, and the loop never runs.
2. **`invalidateStandings` throws mid-loop** — some leagues invalidated, some not. **Partial, and
   silent.**
3. **`revalidateTag` throws `E263`** ("static generation store missing") because there is no request
   context — which is **benign** and already has a dedicated handler.

**`invalidateStandingsSafely` (`leagueStandings.ts:408`) exists precisely to separate case 3**, and
these two sites do not use it. So today a genuine failure and a benign out-of-context call are
indistinguishable.

## What the fix owes

**Report the failure separately from the commit.** Per CARRIES, the commit stands and nothing throws
into the provider path — **the failure becomes recorded state, not an exception.**

**Support replay without another provider fetch.** A missed invalidation must be retryable from
recorded state alone. **The whole point is that re-fetching from CFBD to fix a cache-tag failure is
the wrong shape** — it spends provider quota to solve a local problem.

**Correct the comment.** It is load-bearing: someone reading it concludes the failure self-heals.

## Where the recording goes — the decision this item owns

**Do not invent a new durable surface if an existing one fits.** `provider-refresh-status` already
records per-dataset outcomes and System Health already reads it. **Receipt item 3** asks whether an
invalidation failure belongs there, in its own key, or somewhere System Health can surface it —
**establish what already exists before adding.**

**And say what consumes it.** A recorded failure nobody reads is the same defect with an audit trail.
If nothing surfaces it today, say so — that is a finding, and it may be the more valuable half.

## Acceptance boundary

- A failed invalidation is **recorded**, distinguishable from success, and does not fail the commit.
- **`E263` is not recorded as a failure.** Use the existing safe wrapper or its predicate; do not
  re-implement the discrimination.
- **Partial failure is visible as partial** — case 2 above must not record as total success or total
  failure.
- **Replay needs no provider call.**
- The comment no longer promises natural turnover.
- **No change to what a successful refresh records**, per CARRIES.

## Verification

- `npm run lint:all`, `npx tsc --noEmit`, `npm test` — each its own command, each its own real exit
  code, never behind a pipe. **One complete run that itself exits 0.** Report the DELTA at both ends.
- **Reproduce the swallow first.** Force `invalidateStandings` to throw mid-loop and show that today
  nothing records it and the stale cache survives. **A test that does not go red against `main` is not
  a regression test for this.**
- **Mutation-prove the three cases discriminate** — `getLeagues` failing, a mid-loop throw, and
  `E263` — with a test for each. **One test covering all three cannot tell you which is wired.**
- **A fake that resolves immediately makes a failure assertion unfalsifiable.** Check the subject can
  reach the condition before trusting the test — three vacuous tests shipped on the last branch from
  exactly that shape.

## Reviews

`/code-review` and `/codex:review` are **user-invocable only**. Run everything else, then stop and ask
the owner to invoke both against the same commit. Gather both before any remediation.

## Closeout

Pre-merge: `docs/prompt-registry.md` and the `docs/next-tasks.md` spine row, **keyed by the issue
link**. **Record that this closes the 2026-09-08 audit's reliability and security set** — it is the
last of R1-R4, S1-S2. Report any `AGENTS.md` sentence that goes false rather than editing it.

**At merge, verify BOTH directions in the shared ledger files by reading them**, and prefer the
**identical-tree-hash** check when the merge is fast-forward-shaped — it turns "gates passed on the
branch" into "gates passed on this tree."

## STOP — read receipt before writing any code

1. **Reproduce it.** Force a mid-loop throw and show the cache stays stale with nothing recorded.
   Confirm there is no TTL that would rescue it. **If it self-heals, the issue is wrong and I need to
   know first.**
2. **Do the other `invalidateStandings` callers share this defect?** There are several in
   `admin/[slug]/actions.ts` and the draft reset route, and some already use the safe wrapper.
   Enumerate them with which wrapper each uses. **Scope says leave them unless they share it — say
   whether they do.**
3. **What durable surface should hold the failure?** Establish what `provider-refresh-status` records
   today and whether an invalidation failure fits its shape, before proposing anything new.
4. **What would CONSUME the record?** Name the surface. If nothing does, say so plainly.
5. **What does replay look like, concretely** — a cron, an admin action, a retry on next request? Say
   which, and what makes it idempotent.
6. **The audit's unfinished validation gate attaches here:** it never completed a cached-versus-fresh
   comparison because deployed requests hit the league-password gate. **All three production leagues
   carry a password**, so an anonymous comparison still cannot be done. Say what would settle it, and
   whether this slice can.
7. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.

---

## SCOPE AMENDMENT — 2026-09-14, planning ruling, after `/code-review` on `4efd3c19`

**Cite this section by its commit SHA in the PR and the registry entry.** `AGENTS.md:462` requires
that a crossed stop-and-reassess signal be explained in the PR and either split or **explicitly
approved**, with the approval and the actual diffstat recorded in the registry entry. This is the
approval, and the reasoning it rests on.

### What expanded

The branch as reviewed was 15 files / 556 insertions / 48 deletions — **already at the 15-file
signal**, with net lines well under 1,500. Remediation adds a durable pending-state module, a drain
phase in the existing schedule-refresh cron, and their tests, so the file count crosses.

### Why, and why a split is refused

`/code-review` finding 1: the branch as built produces a **warning that clears itself while the
fault persists**. Run 1 commits rows, the invalidation throws, the year records `partial`. The
repair policy sends the operator to the full-year refresh. They click it; content is unchanged, so
run 2 takes the `completeStandingsInvalidation()` sentinel, never re-walks, and records `success`.
`schedulerExecutionStatus` is latest-only monotonic persistence, one row per job, so run 2's record
replaces run 1's and the warning disappears with standings permanently stale.

**A false all-clear is worse than the silence #693 was opened to fix** — before, there was no
warning to falsely clear.

The per-run record is truthful and the per-year status is false: *"no walk was needed this run"* and
*"no walk is outstanding"* are different claims and nothing in the system distinguishes them. So no
per-run reclassification fixes it, and the two obvious partial ships are both worse than the branch:

- **Ship as-is** — the false all-clear above.
- **Never record success without a walk** — an unclearable warning, which is the failure mode
  `CLAUDE.md` records against [#721](https://github.com/znpruitt/cfb-app/issues/721): a check that
  cannot pass is a line people learn to skip.

**Detection is therefore not shippable without a working repair.** Replay was in this prompt's *What
the fix owes* and its acceptance boundary from the start (*"a missed invalidation must be retryable
from recorded state alone"*, *"replay needs no provider call"*) and was never descoped. **This is not
scope growth; it is scope that was specified and not built.** Splitting it would ship the false
all-clear and defer the thing that makes the branch net-positive.

### Approved, with conditions

Planning approves crossing the file-count signal, subject to:

1. **The PR explains the expansion and cites this amendment by SHA.** The registry entry records
   this approval and the final measured diffstat.
2. **`AGENTS.md:464` does not trip.** The drain is a phase inside the EXISTING schedule-refresh
   cron, not a second automation job. State this in the PR — a reviewer will reach for the line, and
   its named failure case (`PLATFORM-086F2H1B` v1) is two jobs with the second untested.
3. **`AGENTS.md:468` binds: route-level coverage for the drain is mandatory.** Delete the drain and
   the suite must go red, demonstrated as an explicit mutation naming which tests fire.
4. **Owner sign-off on the expansion is requested and still outstanding** at the time of writing.
   Planning's approval covers the engineering judgement; it does not substitute for the owner's, and
   the registry entry must record which was obtained.

### Design, as ruled

- **Pending state is keyed by YEAR, never by league slug.** No identifier enters a policed surface;
  `scheduleYearsTarget` already records years. Replay re-walks all leagues for the year.
- **A separate `app_state` scope, NOT co-located with the schedule-refresh lease.**
  `releaseScheduleRefreshLease` writes `{ lease: null }` — a whole-record replacement — so a field
  beside it is erased by the release at the end of the very run that wrote it. Co-location is
  self-erasing, not merely untidy.
- **Discharge is one mechanism: the cron drains the pending set at run start**, bounded, oldest
  first. Year Y's own discharge falls out of that. A per-year trigger alone cannot work:
  `admin/cache-historical-schedule` explicitly refuses active-season and preseason years, so the
  only years it can pend are ones the cron never revisits.
- **Clear only on a walk that actually busted** — `complete` AND `invalidated === attempted`.
  Otherwise an all-`E263` drain busts nothing, clears the record, and loses the fault permanently:
  this branch's own defect relocated into its repair path.
- **The pending record is its own failure report.** A failed drain leaves it uncleared; that is the
  durable evidence. No second reporting channel, and a drain failure must not fail the run or alter
  the refresh's reported status.
- **Over-invalidation on the replay path is not a reversal of the ruling against it on the commit
  path.** The discriminator is evidence: the commit path has none that a bust failed, so it would
  spend an unrelated blast radius on a maybe; the replay path names a year known to have one.
  Bounded cost for a known fault versus unbounded cost for an unknown one.

### The bound — a correction to planning's own framing

I instructed that the drain bound be derived from deferred rebuild cost rather than cron wall-clock.
**That framing overstates the cost and the constant's comment must not record it.**

The drain is cheap — a registry read and `revalidateTag` per league, no provider call, no recompute.
The rebuild is deferred to the next READ, so an invalidated year with no readers costs nothing at
all, and most of the pendable population is cold historical archives. The realized cost is bounded
by **readership**, not by entry count, and the rebuilds are spread across whenever each entry is
next read rather than landing together. The active year is the only one reliably read, and it is
already invalidated by every content-changed refresh, so draining it adds nothing to what a normal
run costs.

**So the bound is a safety rail against pathological growth of the pending set, not a cost
optimisation.** `N = 4` is accepted on that basis — it is defensible as a rail without needing a
rebuild measurement nobody has taken. **Do not ship a constant whose comment states the
deferred-cost model**: that would be a plausible, disproven rationale frozen in a comment, which is
the same defect class as the disproven comment at `standingsCacheWarmer.ts:153` that this branch's
own finding 6 is about.
