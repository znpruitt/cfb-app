PROMPT_ID: PLATFORM-207-PLANNER-TEST-ISOLATION-CLAUDE-v1
PURPOSE: Item 207 — four polling-planner tests fail roughly one run in three on `plan-held`. The likely cause is NOT a leaked plan record: a bare `catch` turns a transient settings-read failure into `settings = null`, which marks every job held. That is a production hazard as well as a flake.
SCOPE: `src/app/api/cron/polling-planner/route.ts:368-377` (the swallowing catch), its test file, and `scripts/run-tests.mjs` if the harness is implicated. The production change is IN scope — see below; v1 excluded it on a diagnosis that has since been overturned.
CARRIES: NONE, having checked `item-87-INDEX.md` — this is a test-infrastructure item with no Item 87 surface.

Read `AGENTS.md` first — **Verification (binding)** is the section this item exists to protect.

## The observation

**Seen 2026-09-09 during Item 204's merge gate**, on a tree whose `src/` was byte-identical to a commit
that had just gated clean:

    405 - a dead day PAUSES both dense schedules and records what it did
    406 - a game day ARMS both dense schedules with the derived expression
    407 - an ABSENT or EMPTY season record sends nothing — absence is not a dead day
    409 - the durable record stores only the PLANNING DAY's windows

**The mechanism is in the failing run's own log:**
`{"result":"no-op","reason":"plan-held","day":"2026-09-09","jobsHeld":2}`. The planner found a plan
record already held for the planning day and no-op'd, so `pauses.length` was 0 instead of 2.
**Durable state, not logic.**

**Re-running the same commit produced exactly the two Item 137 baseline failures.** So it is
nondeterministic, at roughly one run in three.

## What has been ruled out — verify, do not assume

- **Cross-file contamination.** `scripts/run-tests.mjs:91` sets `APP_STATE_TEST_ISOLATION=1`, keying the
  backing file by pid; no stale temp files were on disk.
- **A logic path from Item 204's diff.** The planner route imports nothing from `teamDatabase.ts`, the
  admin sync route, `leagueStandings.ts` or `ReferenceDataPanel.tsx`.

**But import-reachability does NOT clear a timing-dependent flake, and the analysis must not inherit
the stronger claim.** Item 204 added 12 tests; anything changing execution order or duration changes
whether a late write lands before or after a `reset()`. **"That diff cannot cause it" is established.
"That diff cannot make it more likely" is not.** Treat the diff as a perturbation, not a suspect.

## THE DIAGNOSIS CHANGED — read this before anything else

**v1 of this prompt, and the Item 204 lane's report, both said a plan record survived `reset()`. The
code says that is not required.** `route.ts:376`:

    if (settings === null || jobIsHeld(job, settings)) { exec.jobsHeld += 1; continue; }

`settings` comes from `route.ts:368-372`, wrapped in a **bare `catch` that sets it to `null`**.
`getProviderRefreshSettings` (`providerRefreshSettings.ts:65-71`) awaits `getAppState` with no internal
try/catch, so a transient read or parse failure throws and is swallowed.

**`settings === null` marks EVERY job held on its own, producing `jobsHeld: 2` and `plan-held` with no
leaked record whatsoever.** That matters because `reset()` at `:53-55` explicitly nulls
`POLLING_PLANNER_RECORD_SCOPE` for both jobs — "a record survived `reset()`" was the part nobody could
explain, and **there is nothing to explain: the record is not involved.**

**Likely mechanism: a transient `getAppState` failure racing `__resetAppStateForTests()`**, which the
test file's own comment at `:58` says "clears pools and seams but NOT the backing file."

**THIS IS A PRODUCTION HAZARD, NOT A TEST PROBLEM.** `route.ts:389-394`:

    exec.result = 'no-op';
    exec.reason = 'plan-held';
    // `schedulerExecutionIssues` raises nothing for `no-op` — a deliberate
    // operator stop must not page anyone

**If the settings read transiently fails in production, the planner does nothing, reports a state
indistinguishable from a deliberate operator pause, and the alerting is specifically built to stay
quiet about it.** A swallowed exception wearing the costume of an intentional configuration. `AGENTS.md`
already names this shape — feedback consistent with a wrong model, so the wrong model is reinforced.

**This is a code-path argument, not a measurement. Planning has NOT reproduced it.** It is falsifiable
in one line: log the caught error inside that `catch`. **Confirm or refute before building anything —
if the settings read is not throwing, the leaked-record theory returns and the fix changes.**

## THE HARD PART IS PROOF, NOT DIAGNOSIS

**A flake cannot be fixed by observing it stop.** Ten green runs after a change are consistent with a
fix and equally consistent with luck, and this suite takes ~80 seconds a run — so "it stopped failing"
is the cheapest possible false positive and the one this item is most likely to ship.

**The deliverable is a DETERMINISTIC failure, then its removal.** Find the ordering that causes it and
force it — a controlled delay, an explicit interleave, a stubbed clock, whatever the mechanism admits.
**A test that fails 100% of the time with the defect present and passes 100% with it removed is proof.
A rate that dropped is not.**

If you genuinely cannot make it deterministic, **say so and report the rate with its sample size** —
`AGENTS.md` requires a measurement's coverage to be part of its result, and "0 failures in 5 runs"
against a 1-in-3 rate is a 13% chance of missing it. **Do not describe that as fixed.**

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. Branch checkout only.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Reproduce it, and say how many runs it took.** If you cannot reproduce it at all, that is the
   finding and this item changes shape — do not proceed to a fix for a failure you have not seen.
3. **Instrument the `catch` at `route.ts:371` and say whether it fires on a failing run.** Quote what
   it caught. **This is the whole diagnosis** — if it never fires, planning's mechanism is wrong and you
   should say so plainly rather than working around it.
4. **Say whether the four failing tests share a predecessor**, and separately: **enumerate every other
   bare `catch` on this route that converts a failure into a benign-looking value.** One is now known;
   nobody has counted the rest.
5. **Does any OTHER suite have the same shape?** A `reset()` plus an un-awaited durable write is not a
   property of this file. If the pattern exists elsewhere, those suites are flaking too and nobody has
   noticed. **Report the count, not just a yes.**
6. Anything that CONTRADICTS what you were handed. The rate, the ruled-out vectors and the hypothesis
   are all inherited from the Item 204 lane and all checkable.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/207-planner-test-isolation` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
A `pre-push` hook runs `npm run lint:all`.

**Do NOT push `preview`.** Codex holds it for Items 119/198.

<task>
1. **Establish the mechanism**, confirming or refuting the un-awaited-write hypothesis.
2. **Make the failure deterministic**, then fix the isolation so it cannot recur.
3. **Fix the isolation, not the assertion.** Loosening the four tests to tolerate a held plan would
   make the suite green and delete the only signal that the planner's durable scope leaks.
</task>

<gate>
**The production fix IS in scope now — but ONLY the conflation.** Distinguish "settings unreadable"
from "operator held everything"; do not redesign the hold logic, the receipt vocabulary, or the paging
policy. **An unreadable settings record must not report `no-op`/`plan-held`**, because that is the one
result the alerting deliberately ignores.

**STOP and report before changing what a genuine operator hold does.** That path is correct and must
stay silent.

**Do NOT weaken an assertion to make a run green.** If a test is asserting the wrong thing, say so and
argue it; do not widen a tolerance.

**Do NOT declare it fixed on a run count alone.** See the proof section — that is the specific failure
this item is set up to avoid.

STOP and report if the mechanism turns out to be shared across suites. That is a harness change, and a
harness change under a flaky-test item is how an unrelated regression enters the gate.
</gate>

<completeness_contract>
- **A failing settings read no longer reports `plan-held`.** Assert on the distinguishable result, and
  prove by mutation that a GENUINE operator hold still reports `no-op`/`plan-held` and still raises
  nothing — restore the conflation and show a named test go red.
- **The failure is deterministic with the defect present** — a named test failing 100% of runs, stated
  as a measured count, not "reliably".
- **It passes 100% with the fix**, same harness, same count.
- **The fix is the isolation.** Assert that the planner's durable scope is empty at the start of each
  of the four tests, so a future leak fails at its cause rather than three assertions downstream.
- **Any other suite sharing the pattern is named**, per receipt item 5 — or the absence is stated as
  measured, with what was searched.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
**This item's own subject is the other known failure**; report planner results explicitly rather than
folding them into the baseline.
</verification>

<output_contract>
Report: the mechanism; how you made it deterministic; what changed and where; the measured test delta;
run counts with sample sizes on both sides of the fix; and anything you deliberately did not do.

**Say plainly whether any other suite shares the pattern**, and if so, how many.

**Say whether this could have fired in production undetected**, and for how long it would have gone
unnoticed given that `no-op` raises nothing. If the answer is "indefinitely", say that.

**If you could not make it deterministic, say that first**, report the rate with its sample size, and
do not use the word fixed.

Closeout is a separate pre-merge commit after review convergence: registry entry and Item 207 status.
`docs/next-tasks.md` stays with planning.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions. **Verify the remote ref actually moved before reporting a push** — `git ls-remote origin`,
not `cat-file`; the three worktrees share one object database and a local object proves nothing about
`origin`.
</output_contract>
