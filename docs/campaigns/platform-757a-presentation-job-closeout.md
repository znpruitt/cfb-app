# PLATFORM-757a — schedule presentation becomes its own job (closeout)

Status: Implemented and gated; pre-merge closeout, not a deployment claim.
Prompt: `PLATFORM-757A-PRESENTATION-JOB-CLAUDE-v1`.
Branch: `claude/757a-presentation-job`.
Base: `7e540eee67c4068d3c560be9d62e91c1c824505c`.
Implementation: `beb49eae` (single commit).
Merge of current `main` into the branch: clean, no conflicts.

This slice is **additive**. Every inline presentation call stays where it is; 757b removes
them once this job is live in production and at least one standalone receipt has been
observed. **The merge ships the route and the CLI; it installs no schedule and changes no
behaviour** — auto-promotion is off, and no scheduler can reach the route until the owner
runs `upsert --apply` per runbook §8i.

## Sizing — the approval, and the real number

The owner approved slice A on 2026-09-22 at **~26 files / ~1,500 lines**, both
stop-and-reassess signals, because most of the count is type-forced one-line edits to
exhaustive `Record` maps plus the runbook sweep.

**The actual diffstat is larger than the approval and is reported as such:
28 files, 2,659 insertions, 172 deletions.** Split: **1,332 non-test lines, 1,499 test
lines.** The overrun is in tests, not in production code — acceptance 3's clock-driven
stall harness and acceptance 4's type-checker pin are each substantially longer than a
normal assertion block, and both are load-bearing rather than incidental. The production
side landed close to the estimate.

**Registration: 11 symbols, ~15 edit sites, out of a 26-point checklist.** The receipt's
"26 registration points" counted everything an audit of the scheduler surface turned up,
including test-side registries and things that turned out to need nothing. What this diff
actually touched: 6 total `Record<ExternalSchedulerJob, …>` maps, 3 union/exhaustive-switch
sites, the route, and the manage script — 11 symbols — across roughly 15 edit sites once
the test fixtures that share those maps are counted. The remaining checklist entries were
either derived (issue ordering comes from `EXTERNAL_SCHEDULER_JOBS.indexOf`) or correctly
inapplicable (`vercel.json`, `PLANNER_OWNED_JOBS`). The distinction matters for 757a2's
scoping: **adding a job is an 11-symbol edit, not a 26-point one.**

## Acceptance 1 — a standalone scheduled job, with its own receipt

Passed. `/api/cron/schedule-presentation` authenticates against `CRON_SECRET`, selects
active season years from the league registry, runs `refreshSchedulePresentation` per year,
and files one latest-only durable receipt per authenticated invocation from its outer
`finally`. `ACCEPTANCE 1: a standalone run refreshes presentation and writes its own
receipt` asserts it makes the provider calls itself, commits the media cache, and produces
a `schedule-presentation` receipt with `source: 'qstash'`.

Identity is created only after authentication: `an unauthenticated request is 401 and
creates NO receipt` asserts `deferrer.count() === 0`, so an unauthenticated request cannot
advance a receipt even by deferral.

## Acceptance 2 — System Health shows the job and knows when it is late

Passed, in two halves, because registration and visibility are different claims.

**Classification.** `schedule-presentation classifies against Tuesday 13:00 UTC with a
24-hour grace` drives production's own classifier: on-time at the required slot, `late` one
millisecond before it. It also asserts the two weekly jobs do **not** resolve to the same
required slot, so the hour of separation is a tested property rather than a label. Three
states are pinned separately because they are three different facts — `late` (an overdue
receipt), `missing` (no key, which is what this row will read until the owner installs the
schedule), and `invalid` (a key present but unreadable, which is what a broken stored-target
guard would produce).

**Rendering.** `PLATFORM-757a: the presentation job renders its own row, reads Late, and
shows skipped years` renders `SchedulerHealthSection` and asserts the row and the word
`Late` appear. Asserting the job name is in `EXTERNAL_SCHEDULER_JOBS` would prove
registration, not visibility. It also asserts `1 year(s) skipped for budget` reaches the
page — without that, `yearsSkippedForBudget` would be a field nothing renders, which is the
same invisibility as not recording it.

The existing 9-label list was extended to all eleven; it was **also missing `Polling
planner`** before this slice, so it is now the whole registry.

**Three suites passed while covering nothing of the new job, and were fixed:** the
per-job cron/grace assertions and the manage-script parity assertion are hardcoded per job
(so the new policy was free to drift from its CLI with no test failing), and the
`qstashScheduleRecordedIntent` `CLIS` array did not include the new CLI.

## Acceptance 3 — the receipt is written while the provider hangs

Passed, and this is the acceptance the prompt flagged as the likely false green.

`ACCEPTANCE 3: the receipt is written even when the provider stalls MID-BODY` uses a stub
that completes its headers, emits a first byte, then stalls the body forever unless its
signal aborts. The first byte is deliberate: an empty stalling stream could be satisfied by
a deadline covering only the headers, because nothing would distinguish "no body yet" from
"no response yet". The test asserts every attempt was **aborted during the body read**,
then that the run completed and its receipt exists.

**The clock is driven, and only the clock.** The production bound is 40s per attempt over 3
attempts and `run-tests.mjs` caps a process at 30s, so the real ceiling cannot be waited
out. `setTimeout` is mocked and ticked; the AbortController, the stream error, the fault
classification and the receipt write are all the real ones. The 40s value is pinned by its
own assertion so the mechanism test cannot silently start ticking a different number.

Two things cost time here and are recorded so the next reader does not repeat them. A
microtask-only flush (`await Promise.resolve()`) cannot advance the durable store's
filesystem reads, so the run never reached the provider and the whole file died with
*"Promise resolution is still pending but the event loop has already resolved"* rather than
failing an assertion — the settle step yields a macrotask via `setImmediate`. And too few
ticks produces that same file-level death rather than a red assertion, so the tick count
carries deliberate headroom.

**Mutation.** Making the receipt conditional on `exec.result === 'success'` — a job that
records nothing when the provider hung — failed **`the receipt exists despite the hang —
this is what #757 is about`**. That is the mutation the prompt asked for.

## Acceptance 4 — the inline calls are unchanged

Passed. `inlinePresentationCallers.test.ts` resolves callees **through the TypeScript type
checker** to the declaration in `schedulePresentationRefresh.ts`, and asserts the exact
call-site map: the three inline callers plus the new job, one call each.

A substring search would have been satisfied by a comment, an unused import, or a docblock
mention — all three exist in this repo — and would have missed an aliased import. The
positive control compiles a virtual caller that imports the function **under an alias** and
asserts the scan counts it, through the same `scan` function rather than a copy of its
predicate.

**Mutation.** Deleting the weekly cron's inline call failed both
`ACCEPTANCE 4: every inline presentation caller is still exactly where 757a found it` and
`the standalone job is an ADDITION…`, the latter naming **`weekly cron`**.

## Acceptance 5 — concurrent runs are safe

Passed. The two parts sit behind independent durable leases — media per year
(`schedule-media-refresh-control/<year>`), venues global
(`venue-catalog-refresh-control/current`) — acquired inside a key transaction, so
overlapping acquirers serialise.

When the inline call holds the media lease, this job's media part returns
`refresh-in-progress` and **issues no media request**, while its venue part proceeds
normally. The reverse is pinned too. Asserting both directions is what would catch a future
change that collapsed the two leases into one.

An overlap is the **expected** state during 757a, not a fault: an all-`no-op`/`in-progress`
run classifies as `no-op`, which raises no System Health issue.

## Acceptance 7 — manage script and runbook entry

Passed. `scripts/manage-schedule-presentation-schedule.ts` binds the fixed contract
(`turfwar-schedule-presentation-weekly`, GET `/api/cron/schedule-presentation`,
`0 13 * * 2`, retries 0) into the shared contract-parameterized policy, and was added to
the all-CLI recorded-intent suite.

**Runbook §8i was rewritten, and it used to be false.** It read *"There is nothing to
provision or toggle"*, which was true while presentation ran only inline. It now carries the
contract, the exact command, and the statement that **installing it in production is an
owner step**.

The `authProofRef` initially cited **§8m, which is the CFBD usage sampler** — a real
mis-citation, caught and corrected to §8i before commit.

Counts swept from ten to eleven across the runbook (11 statements) and the five manage
scripts carrying the `ALL TEN schedules` rotation sentence. Verified rather than assumed:
11 cron routes all requiring `CRON_SECRET`, 11 manage scripts. The unrelated *"ten minutes
before the day it plans"* is asserted intact by the sweep script.

## Acceptance 8 (new, owner-ruled) — the operator gate

Passed. The job reports `automation-paused-or-disabled` and makes **no provider call** under
global pause or with the Schedule dataset toggle off.

This was the receipt's finding, not the prompt's. Presentation is already covered by the
operator's pause today — indirectly but completely — because the inline call fires only on
a canonical success and the canonical refresh for an ordinary year is itself gated. A
standalone job ignoring it would have called CFBD while the operator had paused schedule
auto-refresh: **a silent loss of operator control, in a slice billed as purely additive.**

Runbook §8i's own closing paragraph states the same property independently, and the
asymmetry it describes is preserved: lifecycle-critical transition and postseason-boundary
work bypasses the gate today and continues to. This job is never lifecycle-critical.

`ACCEPTANCE 8: the Schedule dataset toggle alone also stops the run` additionally asserts
that a **different** dataset being disabled does not stop this job — without it, the test
would pass against a job gated on the wrong dataset.

A settings-store outage **fails closed** with `settings-unavailable` and no provider call:
an unreadable gate cannot prove the gate is open.

**Mutation.** Removing the gate failed exactly the two acceptance-8 tests.

## Acceptance 9 (new, owner-ruled) — the budget

Passed. `maxDuration = 300` is declared; the job checks its 240s budget before each year,
orders years most-stale-media first, and counts years it never started.

**The arithmetic the prompt got wrong.** The prompt costed one year. The loop is per-year,
and two active years is a normal configuration — a league in `season(2026)` beside one in
`preseason(2027)` is exactly what the registry owner map encodes:

```text
worst case ≈ N × 121s + 121s      (N = selected years; the trailing term is venues)
N=1 → 242s      N=2 → 363s      N=3 → 484s
```

At N≥2 the invocation is killed past 300s and loses its receipt — **#757 reproduced inside
its own fix**. The venue part is global and TTL-gated, so a run pays for it once regardless
of year count; `it refreshes every active season year…` asserts exactly that (2 media calls,
1 venue call for two years), which is the arithmetic the budget rests on.

**A budget stop OUTRANKS the refresh aggregate. Refreshing year 1 cleanly and never
reaching year 2 is not a success, since year 2's media is as stale as if nothing had run.**
A receipt reporting success beside a nonzero skip count would be a number whose failure and
whose real zero look identical — #804's defect in a new place — and System Health raises
issues only for `failure` and `partial`, so `success` would let a job chronically unable to
reach its later years render green forever. The ordering holds in both directions: a budget
stop also outranks a failure, so the capacity fact is never hidden behind a provider fault
an operator would go chasing instead.

Most-stale-first is what makes a truncated run useful: without it, a two-year configuration
under sustained provider degradation would refresh the same year every week and never once
reach the other. A year with no media entry sorts ahead of every dated one.

**The first version's reservation was wrong, and both reviewers found it — see the review
round below.** The budget now reserves the venue leg too until some year has settled it.

**Mutations.** Sorting by ascending year instead of staleness failed both acceptance-9
ordering tests. Demoting the budget check below the refresh aggregate failed
**`A BUDGET STOP OUTRANKS A CLEAN REFRESH — the rule this job exists to get right`**.
Restoring the pre-review one-leg reservation failed **`P1: an unsettled venue leg stops a
SECOND year from starting`**.

## The year-selection relocation

`selectRankingsTargetYears` moved to `src/lib/activeSeasonTargets.ts` as
`selectActiveSeasonTargetYears`; `rankings/automaticContext.ts` re-exports it under the
established rankings names, so its consumers and tests are unchanged — **rankings suites
pass 101/101, untouched**, as the ruling required.

The split of documentation is deliberate: the structural rationale (demo exclusion ordering,
the refusal sink, lifecycle precedence) moved with the code; the rankings-specific
consequence analysis (the inert `lifecycle` field, the demo-only-year publication loss, the
`Date.UTC('2026', …)` coercion hazard) stayed with rankings, attached to the re-export.

**The weekly cron's inline copy is NOT unified here** — that is #858, and the new module's
header says so rather than implying the spellings have already converged.

## Trigger vocabulary

`'presentation-weekly'` added to `SchedulePresentationRefreshTrigger`. The trigger selects
no behaviour; it is a label that reaches the runtime event. Reusing `'weekly'` would make
standalone and inline runs indistinguishable during exactly the overlap window this slice
exists to observe. **Mutation:** reusing `'weekly'` failed `the standalone run is
distinguishable from an inline one in the logs`.

## The safety question — writers of the durable schedule

Answered in the receipt and recorded here because the conclusion is load-bearing for this
job. There is exactly **one** writer of the canonical schedule, `commitFullSeasonSchedule`
in `fullSeasonScheduleRefresh.ts`, reached by three callers; `scheduleReadEnumeration.test.ts`
records it structurally as *"the only WRITER"*.

It **can** store a row the presentation reader rejects: `cfbdSchedule.ts:735` synthesises
`` `${week}-${homeTeam}-${awayTeam}` `` when CFBD omits `id`, which fails
`isCanonicalProviderGameId`. Rejection is per row and degrades gracefully. **The owner
measured this path as never having fired: 0 of 22,760 stored rows carry a non-numeric id
(for #653)** — so it is recorded beside the graceful-degradation argument rather than
treated as live.

The whole-year case (`no-usable-ids`) maps to `canonical-context-unavailable` →
**`failure`**, so it cannot become a silent green no-op. The coupling that also suppresses
the venue part in that state is pre-existing and is **#857**; untouched here.

## Review round 1 — both reviewers, gathered before any remediation

`/code-review 776fb157 high` and `/codex:review --base 547d2fd5`, both against the same
commit. The Codex run was verified before being treated as gathered: **exit 0**, eight
`git diff` lines carrying `547d2fd51218`, **no other base anywhere in the transcript**, and
no capacity sentence in the body.

**The two reviewers independently found the same defect**, Claude's finding 1 and Codex's
P1. That is the strongest signal in this round and it was a real bug in the code added to
prevent exactly it.

### P1 / finding 1 — the budget under-reserved (FIXED)

The reservation was one media leg (121s) per year, resting on "year 1 commits the venue
catalog". `refreshVenuesPart` becomes TTL-exempt **only after a successful durable commit**
(it reads the committed entry at `schedulePresentationRefresh.ts:452`); every other outcome
releases the lease with the catalog exactly as stale as before. Year 1 could finish in ~80s
having refreshed no venues, year 2 would pass the 121s check, and the run could spend
another ~242s on both legs — killed past 300s with its receipt unwritten. **#757 reproduced
inside its own fix.**

Worse than either reviewer stated: the fastest no-commit path is **losing the venue lease to
the inline caller**, which is the expected 757a overlap, not an exotic fault. The unsafe
window is reachable on an ordinary Tuesday.

Fixed by reserving `media + venues` until a year settles the venue leg (`fresh-cache`,
`written-clean` or `unchanged-clean`). `stale-observation` is treated conservatively as
unsettled: over-reserving costs at most one skipped year, under-reserving costs the receipt.
The first selected year always runs, since its own 242s worst case fits under the ceiling
alone and a budget that skipped everything would make the job useless.

Both reviewers also noted the budget-skip branch had **no route-level test**. It now has two
— the unsettled case (one year runs, one skipped) and the settled complement (both run),
the latter present so the former cannot be satisfied by a job that simply never runs a
second year.

### P2 — a refused production target was ignored (FIXED)

Codex only. With one valid active league and one active **production** league carrying a
structurally invalid `status.year`, `invalidLifecycleTargets` was incremented and then
ignored: the run reported `success`, which raises no System Health issue, so nothing would
ever have told an operator the refusal happened. Only the all-invalid population was
covered.

`AGENTS.md`'s lifecycle-refusal rule is explicit, and `schedule-refresh/route.ts:612-622`
already implements it in the sibling job — the omission was mine. The aggregate now degrades
the **result** and never the reason, because the receipt's year entries carry no reason
field and overwriting would erase the only durable record of what those years did. A
refusal maps a non-success aggregate to `failure`, not `partial`, so it cannot upgrade a run
whose valid years did nothing.

### Finding 8 — budget/failure masking (ACCEPTED and fixed)

Raised as a judgement call. It was right. Returning `partial` whenever a year was skipped,
before inspecting the executed years, meant a run where every executed year **failed** and
one was skipped reported `partial` and understated itself. The result is now the worse of
the year aggregate and `partial`, so both facts survive: reason `budget-exhausted`, result
`failure`.

### Findings 2–7 — all accurate, all fixed

| # | What was wrong | Fix |
| --- | --- | --- |
| 2 | A comment named `schedulePresentationJobRoute.test.ts`, which **does not exist** — a direct breach of the rule that a comment asserting runtime behaviour names the test asserting it | Names the real assertion and file |
| 3 | "one structured line per **authenticated** invocation" — false; the emit is in the unconditional `finally`, so a 401 emits one too | Now says so, and states the event/receipt split |
| 4 | `receiptYearFailureEvidence` ignored the third multi-year job, so a failed year was invisible in the issue text | Added, via the part reasons; classifies failure through the authority's own `STATUS_FOR_REASON` rather than a second list |
| 5 | "the four lifecycle-bearing variants" — now five | Corrected |
| 6 | Runbook line 103 said eleven routes, then listed nine jobs | List completed |
| 7 | A comment narrated "Tuesday 12:30" for a fixture instant that is a **Wednesday** | Rewritten to describe the instant actually used |

Nothing was disputed. Every finding in both reports was verified against the code before
remediation began, and each fix that changes behaviour carries a mutation that reddens its
own named assertion.

## Verification

Run against the merged tree at `HEAD`, worktree clean, each gate its own command:

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint:all` | exit 0 |
| `npm test` | exit 0 — **5563 pass, 0 fail, 0 cancelled** |

The known-failure set on `main` is empty, so zero failures is the merge condition and it is
met.

## What this diff falsifies

- **Runbook §8i's "There is nothing to provision or toggle"** — now false; rewritten.
- **`maintenanceActions.ts`'s `automationOwner: 'Weekly QStash schedule + lifecycle crons'`**
  for the schedule action — a third owner now refreshes the presentation caches that
  descriptor rewrites. Updated, because it is an operator-facing string and leaving it would
  be a false claim.
- **The prompt's 363s worst case** — it is per-year; #757 is ~726s at N=2.
- **The prompt's "whether to add [a deadline] is your call"** — required at N≥2.
- **Counts of "ten" schedules/routes/managers** across the runbook and five manage scripts.

## Not falsified, but worth flagging to planning

The rulings commit `1e1323fc` edited the prompt's citation line to read *"is now `:482`, not
`:482`"* — the original said `:440`. A typo in a planning-owned prompt file; flagged rather
than edited, since `docs/prompts/` stays with planning.

## Follow-ups

- **757a2** — acceptance 6, the per-commit media change history, recorded at the media
  commit inside the presentation authority. Ships before 757b. Note for its scoping: the
  commit point receives only `eligibleGameIds: ReadonlySet<string>`, so days-to-kickoff
  bucketing needs `startDate` threaded through `resolveCanonicalContext`, and `startDate` is
  nullable, so an `unknown` bucket is mandatory. The media cache holds no kickoff times, so
  the history is **channels-only** by construction.
- **757b** — remove the inline calls. Gated on this job being live, its schedule installed,
  and at least one standalone receipt observed in production.
- **#858** — the weekly cron's inline year-selection copy.
- **#857** — `no-usable-ids` suppressing the venue part.
