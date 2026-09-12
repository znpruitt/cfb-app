PROMPT_ID: PLATFORM-733-PLANNER-REPAIR-DEAD-END-CLAUDE-v1
PURPOSE: A `polling-planner` execution failure renders a repair link to Data Maintenance & Recovery,
a surface with no planner action of any kind. Stop routing the operator to a page that cannot help.
SCOPE: `src/lib/server/systemHealthIssues.ts` and its suites. NOT the planner routes, NOT
`schedulerDeliveryHealth.ts`, NOT the maintenance-action catalog — do not ADD a planner action here.
CARRIES: NONE — checked. #733 is not an Item 87 item, so `docs/campaigns/item-87-INDEX.md` has no
row for it, and `docs/campaigns/vercel-active-cpu.md` carries no CARRY block. The governing rule is
in the file you are editing and is reproduced below verbatim.

Issue: [#733](https://github.com/znpruitt/cfb-app/issues/733), filed out of your own #619 work.

---

## The rule already exists, in the file, written for this exact case

`systemHealthIssues.ts:204-209`, the comment on `usage-sample`'s membership in
`JOBS_WITHOUT_EXECUTION_REPAIR`:

> Item 127 — the usage sampler reports `partial` when `/info` is unavailable, which raises an issue
> by design. But Data Maintenance & Recovery has no sampler repair action, so linking there would
> send an operator to a page that cannot help. The remediation is a provider or credential problem,
> not a dataset repair.

And `:590-593`: *"A repair link is a claim that the destination can act on this fault."*

## Measured at `0a47d36e` — the defect is SPECIFIC, not systemic

The issue asks whether this is a dead end for every planner fault. It is narrower and sharper than
that: **`polling-planner` is the only linked job with no corresponding action at all.**

- `EXTERNAL_SCHEDULER_JOBS` is **ten**: live-scores, team-records, game-stats, odds, schedule-refresh,
  rankings, season-transition, season-rollover, usage-sample, polling-planner.
- `JOBS_WITHOUT_EXECUTION_REPAIR` exempts **four**: team-records, season-transition, season-rollover,
  usage-sample.
- So **six** jobs get `repairFor('data-maintenance')` → `/admin/data/cache`.
- `MAINTENANCE_ACTIONS` (`src/lib/admin/maintenanceActions.ts:42`) holds **eleven** ids, and five of
  the six linked jobs have a matching one: `schedule-full-year-refresh`, `scores-aggregate-refresh`,
  `game-stats-partition-refresh` / `game-stats-full-backfill`, `odds-refresh`, `rankings-refresh`.
- **Nothing in the catalog is planner-related**, and a grep of the admin surfaces for
  `polling-planner` returns nothing.

**Verify this table before relying on it** — it is the whole basis of the fix, and it is receipt
question 1.

## The trap: the hint is SHARED, so removing this link does not free it

Your own #619 comment (`:551-557`) says the `settings-unavailable` hint deliberately does **not** tell
the operator no action is required, *because* `polling-planner` still carries a visible Data
Maintenance link and "a hint contradicting a visible control is worse than one that says less."

It would be natural to read this item as unblocking that sentence. **It does not.** The same comment
(`:545-549`) records that the hint is JOB-NEUTRAL because **three routes answer a
`getProviderRefreshSettings` throw with `settings-unavailable`: polling-planner, rankings and
schedule-refresh** — and rankings and schedule-refresh both keep their links, because both have real
actions. A hint rewritten to say "nothing to do here" would be inherited verbatim by two jobs where
it is false.

**So this slice removes a false link. It does not strengthen the hint.** If you conclude the hint
should change, say so and file it — do not fold it in.

## What #619 left behind, deliberately

That lane asserted the current (wrong) behaviour in a test with a comment, rather than silently
encoding a link it believed was wrong. **Find that test and update it with the fix** — an assertion
that pins a defect must not outlive the defect, and its comment is the breadcrumb that says so.

---

## STOP — read receipt before writing any code

Answer from the files.

1. **Build the ten-row table**: for each `ExternalSchedulerJob` — is it in
   `JOBS_WITHOUT_EXECUTION_REPAIR`, what repair does a failed receipt render, and does
   `MAINTENANCE_ACTIONS` contain an action that can act on that job's fault? My claim is that
   `polling-planner` is the only linked job with none. Prove or break it. **If a second job also has
   none, say which and whether it belongs in the same fix.**
2. Quote the #619 test that pins the current behaviour, with `file:line` and its comment.
3. Is `repairFor('data-maintenance')` the only repair a scheduler-execution row can render, or can
   one reach `'team-identity'`? Show the call sites. If Data Maintenance is the only destination,
   then membership of that set is a binary "is there any action for this job" — say so.
4. Does anything OTHER than the execution-issue path give `polling-planner` a repair link — a
   different issue code, a delivery-health row, a diagnostics row? A fix to one path that leaves
   another rendering the dead end is a partial fix wearing a passing test.
5. Adding a job to `JOBS_WITHOUT_EXECUTION_REPAIR` removes a control from an operator surface. **What
   is the operator supposed to do instead when the planner genuinely fails?** If the honest answer is
   "nothing on any admin page", that is a finding worth recording in the closeout, not a reason to
   keep a link that lies.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
