# PLATFORM-757a — schedule presentation becomes its own job

```text
PROMPT_ID: PLATFORM-757A-PRESENTATION-JOB-CLAUDE-v1
PURPOSE: Two crons run the media/venue refresh INLINE, after their own schedule work, inside one
         300s invocation. Their worst cases add, and on Hobby 300s is a hard maximum. This slice
         creates a standalone scheduled presentation job. It is ADDITIVE: the inline calls stay,
         and a follow-on slice (757b) removes them once this job is live and observed.
SCOPE:   a new cron route for the presentation refresh, its registration in
         EXTERNAL_SCHEDULER_JOBS and its delivery policy, its QStash manage script and runbook
         entry, a bounded per-COMMIT change history for media, and their tests.
         DO NOT remove or change the inline presentation calls in cron/schedule-refresh,
         cron/season-transition or /api/schedule. That is 757b and it must not ship before this job
         is live. The change history MAY add a write at the media COMMIT point inside the presentation
         authority (see acceptance 6 for why it cannot live in the job). Beyond that additive write,
         DO NOT change what refreshSchedulePresentation fetches, commits or reports, the schedule
         refresh authority, or AGENTS.md / DESIGN.md (planning owns both; report what your diff
         falsifies).
CARRIES: NONE from the Item 87 campaign index, having checked. This is scheduler and store work
         and touches no scoreboard row, tag slot or row anatomy.

         Three standing obligations bind, and the first is the defect itself:

         "A try/catch proves a call cannot THROW, never that it cannot HANG." Both crons wrap the
         inline call in a "defensive contract boundary" try/catch (schedule-refresh/route.ts:595-600,
         season-transition/route.ts:587-590). That boundary guarantees a presentation fault never
         escapes. It does nothing to stop presentation's latency from consuming the invocation.
         The isolation contract at schedule-refresh:582-592 separated presentation's RESULT and left
         out its DURATION. That gap is #757.

         AGENTS.md -> Scope and sizing: "A planning split is MANDATORY before implementation when
         work crosses ... separate automation jobs." This work touches three jobs. It is split into
         757a (this) and 757b because of DEPLOYMENT ORDER: removing the inline calls before this
         job is live would silently stop broadcast refreshes.

         "Audit seams BEFORE writing": the new job's risk sits in where it REGISTERS, meaning the
         job registry, the delivery policy and the System Health row. A job whose receipt no panel
         reads is invisible.
```

---

## Why, measured

**The ceiling cannot be raised.** The team plan is `hobby`. Vercel's limits table says *"Hobby: 300s
default and maximum."* The owner ruled Pro cost-prohibitive, so no `maxDuration` fixes this.

**The worst case, per invocation of `cron/schedule-refresh`:** schedule (`:548`), then media and
venues (`:596` → `schedulePresentationRefresh.ts:709-710`), run sequentially. Each is a 3-attempt
site at `CFBD_PEAK_LATENCY_TIMEOUT_MS` = 40s (`cfbdRequestPolicy.ts:7`), so roughly 121s each and about
363s together. `cron/season-transition` has the same shape (`:429` then `:588`) under its own
`maxDuration = 300` (`:58`).

**What a kill actually costs** is the durable receipt, not data. The schedule commit happens first,
so it is safe. The receipt is written in the outer `finally` (`schedule-refresh:634`), which most
likely never runs on a killed invocation. That is reasoned from the code, not measured. The result
is that System Health cannot tell a killed run from one that never happened. The risk only arises on
the monthly run where the 30-day venue TTL has expired (`venue-catalog/current` last committed
2026-08-29T16:18:27Z) **and** CFBD is degraded enough to use its retries. **This is rare but real, and
it is not an emergency.**

## Three decisions already made, with their evidence

**1. Presentation is independent of the schedule job's result, and it checks its own
precondition.** The module header, `schedulePresentationRefresh.ts:18-19`: *"unusable context never
triggers provider work, and an absent/empty canonical schedule makes NO provider call."* So the new
job does not wait for, read, or gate on the schedule job. Gating on the schedule job's receipt would
couple the jobs again, and a lost receipt (#757's own failure) would then stop presentation too.

**2. It runs weekly, on Tuesday, AFTER the schedule job.** Measured 2026-09-22 across the 888
FBS-involved games (detail on #757): by the Tuesday run, **that Saturday is 100% settled** for both
channels and kickoff times. Next Saturday is 84% settled for channels and 31% for times. A daily run
would repeat Tuesday's result. Start it **after** the 12:00 UTC schedule job, so it reads a fresh
schedule and the two do not hit CFBD at the same moment. The receipt recommends the exact time.

**3. It records what changed on each media commit.** The stores keep only the latest snapshot, so today
nobody can tell whether channels move after Tuesday. A bounded history of media changes answers that
from data. It is the only thing that can justify a second weekly run later.

## What this job must do

- Run the existing `refreshSchedulePresentation` for the years it applies to. Do not change what it
  fetches, commits or reports. The one permitted addition is the change record at its media commit
  point (acceptance 6).
- Write **its own durable receipt**, registered in `EXTERNAL_SCHEDULER_JOBS`
  (`schedulerExecutionStatus.ts:102`) with a delivery policy
  (`schedulerDeliveryHealth.ts:144` holds the per-job policies) whose expected cadence is weekly.
  An unregistered job has an unread receipt.
- Be scheduled by a `manage:*` script like the other ten (`package.json:33-42`), with a runbook row
  alongside `turfwar-schedule-weekly` (`docs/deployment-runbook.md:36`, contract at `:505`).
- **Write its receipt even when the provider hangs.** That is the property #757 is about, so this job
  must have it from its first commit, not gain it later. **Planning read the per-attempt timeout
  and it covers the body, not just the headers:** `fetchUpstream.ts` passes the timeout signal to
  `fetch` (`:390`), reads the body through `consumeClassified` at `:426`/`:440` INSIDE the timed
  `try` (`:374`–`:471`), and clears the timeout in the `finally` only after the read. So a stalled
  body is aborted at the per-attempt bound, and this job's worst case, two sites at about 242s, is
  bounded by the code's structure below 300s. *That is structural reasoning, not a measurement,
  and acceptance 3's test is what proves it.* A job-level deadline is therefore insurance against
  a future third site, not a requirement. Whether to add one is your call; the receipt says which
  you chose.
- **Record media changes per commit** in a bounded series, trimmed on every write, following
  `providerUsageSeries.ts` (`PROVIDER_USAGE_MAX_OBSERVATIONS`, `:48`, trimmed on write so no cleanup
  job exists to forget). Media only. Venues change too rarely to be worth recording.

## Acceptance

1. **A standalone scheduled job runs the presentation refresh** on its own route, with its own
   durable receipt.
2. **System Health shows the job and knows when it is late.** It is registered in
   `EXTERNAL_SCHEDULER_JOBS` with a weekly delivery policy, and a test proves its row appears and
   reads late when no receipt has arrived within the cadence. **A job that registers but files under
   no panel is the integration defect this repo keeps shipping.**
3. **Its receipt is written while the provider hangs.** Pinned by a test in which the provider
   **stalls mid-body**, not merely delays its headers, and the receipt still exists. A header-only
   delay tests less than the claim: the question is whether the per-attempt bound covers the whole
   request.
4. **The inline calls are unchanged.** A test pins that `cron/schedule-refresh`,
   `cron/season-transition` and `/api/schedule` still call `refreshSchedulePresentation`, so this
   slice is additive and safe to promote at any time.
5. **Concurrent runs are safe.** During the overlap window both the inline call and this job run on
   a Tuesday. State what the presentation lease does when they meet, and pin it.
6. **Every media COMMIT records its changes, whichever caller triggered it**, bucketed by
   days-to-kickoff at the time of the change. **This cannot live in the new job**, and planning's first
   draft of this prompt put it there. During 757a the inline call still runs at 12:00 and commits
   the new media first. A job-level recorder would then diff against the already-updated snapshot,
   see nothing, and **record zero changes for as long as 757a is live**, which is exactly the question
   the history exists to answer. Record at the commit, so every caller's changes are captured.
   **A commit that changed nothing records zero, and that zero is distinguishable from a run that
   computed nothing.** A run that timed out or gave up has computed nothing, and it must not write
   zero. #804 is a live example of a count whose failure and whose real zero look identical. Do not
   build a second one.
7. **The QStash schedule has a manage script and a runbook entry.** Installing it in production is
   an owner step. The closeout gives the exact command and says who runs it.

## Testing requirements, which are not negotiable on this project

**Every claim needs a mutation that reddens ITS OWN named assertion, and you must say which assertion
fired.**

**Acceptance 3 is the likely false green.** A test that lets the provider return promptly passes
whether or not the receipt survives a hang. The provider has to actually hang, and the test must fail
against a version of the job that writes its receipt only after presentation returns.

**Acceptance 2 needs a real observer.** Asserting that the job name is in the array proves
registration, not visibility. Assert what System Health renders.

**Pair every mechanism comment with the test that asserts the same behaviour.**

## Not this slice: 757b, written when this one is live

757b removes the inline presentation calls from `cron/schedule-refresh` and
`cron/season-transition`, and decides `/api/schedule`, which is an interactive admin path. **It is
gated on this job being live in production, its schedule installed, and at least one standalone
receipt observed in production.** A merge builds but does not ship, since auto-promotion is off. Its
acceptance: each cron's receipt is written while the provider hangs, and the per-invocation worst
case is stated with its arithmetic. Design this slice so 757b is a deletion, not a rework.

---

## STOP — read receipt before writing any code

1. **Enumerate every caller of `refreshSchedulePresentation`.** Planning found three production
   callers across all of `src` (`schedule/route.ts:440`, `cron/season-transition/route.ts:588`,
   `cron/schedule-refresh/route.ts:596`). Confirm or correct that, by a method stronger than a
   single-line grep.
2. **How does the job choose which years to refresh?** The schedule cron selects candidate years.
   Say whether this job must match that set, and **reuse** the selection rather than re-implementing
   it. A second spelling of "which years are active" is how #838's defect came about.
3. **What happens when this job and an inline call meet** on the same Tuesday? Trace the presentation
   lease and say what each run writes.
4. **Where does the new receipt surface in System Health, and what does "late" mean for a weekly
   job?** Name the row and the policy fields you set.
5. **Trigger vocabulary.** `refreshSchedulePresentation` takes a `trigger` (`'weekly'`, `'manual'`,
   `'season-transition'`). Say whether this job gets its own value, and how logs tell a standalone run
   from an inline one during the overlap.
6. **What does "changed" mean for the history, and where exactly is it recorded?** Name the commit
   point inside the presentation authority, what each commit compares against, and what the first
   commit records when there is no prior snapshot. Confirm that the inline callers' commits are
   captured too.
7. **Deadline or not?** Your recommendation for the job's own budget, with the arithmetic.
8. **Sizing.** Estimate files and lines. If this crosses the stop-and-reassess signals in
   `AGENTS.md`, propose the cut. The change history is the natural piece to split off.
9. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
