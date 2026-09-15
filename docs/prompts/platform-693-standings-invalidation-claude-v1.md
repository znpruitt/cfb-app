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
