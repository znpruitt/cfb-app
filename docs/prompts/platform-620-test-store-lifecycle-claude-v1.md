PROMPT_ID: PLATFORM-620-TEST-STORE-LIFECYCLE-CLAUDE-v1
PURPOSE: Issue #620 — the test app-state store is keyed by `process.pid` and nothing deletes it, so a recycled pid hands a new process a previous run's populated store. Close the class that Items 207 and 211 guarded three instances of.
SCOPE: `src/lib/server/appStateStore.ts` (the path function and any cleanup), `scripts/run-tests.mjs` if the run identity lives there, and tests. NOT the per-seam refusals (#621, shipped). NOT the per-suite delete idiom (Item 207, shipped).
CARRIES: NONE, having checked `item-87-INDEX.md` — audit-spine item with no Item 87 surface.

Read `AGENTS.md` first. Note the new rule at the top: **work items are GitHub issues now.** This is
**#620**, and **the PR that closes it says `Closes #620` in its body.**

## The defect

`appStateStore.ts:88-99` keys the test store by `os.tmpdir()/cfb-app-app-state-test-${process.pid}.json`
under `APP_STATE_TEST_ISOLATION`, and **nothing ever deletes it.** macOS recycles pids, so a test
process can start life owning a previous run's fully-populated durable store.

**Measured, not asserted:** **14,042 such files** on the owner's machine, oldest 2026-09-05. In a live
suite run, **260 of 1,086 app-state-initialising processes (23.9%) started with a pre-existing file at
their pid path.** 394 of the stale files carried a `provider-refresh-settings::global` record holding
both planner jobs — which is how a passing suite produced four failing planner tests one run in
however-many.

**Item 207 fixed three suites by adding a teardown call. #621 guarded three destructive seams. Neither
closes the class** — both depend on every author remembering, and the measured exposed set is larger
than either touched.

## The exposed set — measured, reuse it

The 211 lane's method: **plant an unparseable store at the pid path, run every test file, and see which
suites actually fail.** That turned a 4-suite grep into a measured 10, and proved
`providerUsageWriteOutcome` was not exposed at all despite matching the grep.

Still exposed: `oddsUsageStore`, `schedulerDeliveryHealth`, `durableOddsStore`, `draftSchedule`,
`teamDatabaseStore`, `boardData`, `admin/odds-usage/route`, `admin-debug-auth`, `deliveryNothingDue`,
`seasonOwners`.

**Reuse that harness. Do not rebuild it, and do not fall back to grepping for a helper call** — the
syntactic version was wrong in both directions.

## THE DESIGN QUESTION — answer it before writing code

**Per-RUN unique token plus a per-process suffix, or per-process with guaranteed cleanup?**

Per-pid is what fails today, and **it fails ACROSS runs, not within one.** A scheme that is unique per
process but still collides across runs solves nothing.

**And say what happens under `SIGKILL`.** Exit cleanup that a killed process skips re-creates the leak
more slowly — 14,042 files accumulated in five days, so "slower" is not a fix. **A design whose
correctness depends on orderly shutdown is the wrong design here; say so if you reach one.**

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Re-measure the file count and the inheritance rate** against the current machine. Both figures
   above are two days old and the count grows every run. **If they have moved materially, that is the
   finding.**
3. **Your chosen path scheme, and what happens under `SIGKILL`.** State the failure mode you are
   accepting, not just the one you are fixing.
4. **Re-run the exposure plant against current `main`.** Items 207 and 211 shipped since it was taken —
   **say whether the exposed set is still 10**, and report coverage the way the 211 receipt did (files
   probed, zero-test rows, tests executed against the suite's own count).
5. **The 14,042 existing files: does this item sweep them, is that an owner action, or does the new
   path make them harmless where they sit?** Recommend one and say why.
6. Anything that CONTRADICTS what you were handed.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/620-test-store-lifecycle` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`. **Do NOT push `preview`** — Codex holds it.

<task>
1. **Make inheritance impossible**, at the path scheme rather than by per-suite teardown.
2. **Do not remove the per-suite teardown calls** Items 207 and 211 added. They become redundant, not
   wrong, and deleting them in the same slice couples two changes whose failures look alike.
</task>

<gate>
**Do NOT weaken `APP_STATE_TEST_ISOLATION`'s meaning.** #619's guards branch on it; changing what it
gates would silently re-open a path where `npm test` can transact against production.

**Do NOT sweep the existing files as a side effect.** If a sweep is right, it is a named step with its
own report line — a slice that quietly deletes 14,042 files from a developer's `$TMPDIR` is the kind of
action that must be announced before it runs.

STOP and report if the fix requires changing how `run-tests.mjs` spawns processes. That is a harness
change with the whole suite as its blast radius.
</gate>

<completeness_contract>
- **Two processes with the same pid in different runs cannot collide** — asserted directly, by
  simulating the collision rather than by reasoning about the scheme.
- **The plant that reproduced the planner failure no longer can**, asserted against the same payload
  the 207 lane used.
- **Cleanup happens on a normal exit**, asserted — and **the `SIGKILL` case is asserted separately as
  what it is**, not hidden inside the first assertion.
- **The suites Items 207 and 211 fixed still pass**, reported as a measured count.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: the re-measured figures; the chosen scheme and its accepted failure mode; what changed and
where; the measured test delta; the exposure re-run with its coverage; and anything you deliberately
did not do.

**Say plainly whether the class is closed or only narrowed**, and if narrowed, what still leaks.

**Recommend a disposition for the 14,042 existing files** — do not act on it in this slice without
saying so first.

Closeout is a separate pre-merge commit after review convergence: registry entry and the issue's state.
**The PR body says `Closes #620`** — that is the convention as of 2026-09-10 and this is an early use
of it.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref moved before reporting a push.**
</output_contract>
