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

## RULINGS ON THE READ RECEIPT — 2026-09-12, binding

**The plan is approved exactly as you stated it.** All four steps: add `'polling-planner'` to
`JOBS_WITHOUT_EXECUTION_REPAIR` in the `usage-sample` comment form; correct the `:551-557` clause;
flip `systemHealthIssues.test.ts:165` to `assert.equal(raised?.repair, null)` with a positive control
on `rankings`; update the `:105-108` comment. Nothing to add, nothing to cut.

**The `:551-557` catch is the most valuable thing in the receipt, and your handling is right.** That
comment gives the planner's visible link as the REASON the hint shows restraint — so changing `:593`
makes it assert a premise that no longer holds. Restating the surviving reason (two other jobs inherit
the sentence) rather than deleting the restraint is correct: the restraint outlives its original
justification because a second, independent one exists. **This is the same failure you hit on #692** —
a patch stapled to a sentence whose premise had changed — and pre-empting it is the difference.

**Hint stays byte-identical. Confirmed.** File separately if you conclude it should change.

**Q5 accepted: record it in the closeout.** "Nothing on any admin page repairs a planner fault" is a
finding, not a blocker, and your table of the three reasons plus the self-correcting daily re-plan is
what makes it a finding rather than an admission. Include the `AutomationSafetyControls` detail —
the nearest planner-adjacent controls live on System Health itself, not Data Maintenance, and they
hold/release rather than repair. Someone will ask why the row doesn't link THERE; the answer is that
it would be the same class of lie, and the closeout should say so once.

**Carry your Q4 framing into the closeout too:** the planner's RECORD fault already renders
`repair: null` through `PLAN_UNAVAILABLE_EXPLANATION` on the planner-owned jobs, so only its
EXECUTION fault lies. That sentence explains why this is a one-line set membership rather than a
survey, and it is the thing that stops the next reader re-opening the question.

**My citation was wrong:** `:589`, not `:590-593`. Confirmed.

Proceed to implementation.

## RULING 2 — 2026-09-12. C IS APPROVED. MY EARLIER RULING WAS WRONG.

**Finding 1 is real and I verified it.** `seasonYearForToday` is `month >= 6 ? year : year - 1`
(`scores/normalizers.ts:3-7`), 0-indexed, so the flip is **1 July** and `2027-01-01` returns 2026 —
the reviewer's calendar scenario was wrong and yours is right. `resolveOperationalSeasonYear` reads
`status.year` off active leagues (`systemHealthYear.ts:62-72`), so it advances only at lifecycle
rollover. The two authorities diverge for the whole July-onward window until the new season's cache
is first populated, the schedule dataset row evaluates the OLD year and stays healthy, and the
planner's row is the only one that fires. `schedule-unreadable` is set at `route.ts:423` and its
remediation is `schedule-full-year-refresh` on the page I told you to stop linking to.

**Take option C: a per-job reason predicate.** The planner links on `schedule-unreadable` and is null
for `plan-not-applied`, `settings-unavailable`, `plan-partially-applied` and `unexpected-error`. A is
worse than the status quo and B is knowingly defective; C is correct for all five and sits inside the
SCOPE line already written. **The data-structure change is authorized** — a flat membership test
cannot express a property that is per-reason.

**RULED IN, and it is what makes the surviving link honest: name the failed year in the
`schedule-unreadable` explanation.** The receipt target carries `day`, so the year is derivable. An
operator who follows that link lands on a page whose year comes from the registry — which in the
exact window this fires is the WRONG year. A link to a page defaulted to the wrong season is a
subtler version of the dead end this item exists to remove. One sentence, from data already present.

**Findings 2, 3 and 4 fold into the same round.** 2 and 3 are corrections to text that is wrong
either way. On 3 I was wrong to wave it off — you raised the `:604` comment and I answered "nothing to
add"; an independent reviewer finding the same thing is the second signal, and I should have taken
the first. 4 is the real coverage gap: the route suite exercises `schedule-unreadable`, the issues
suite never does, and whatever shape lands must pin it.

**Stopping instead of patching was the right call and is the reason this is recoverable.** The
scope grew past what I approved, so bringing it back was correct — a lane that had patched C in
silently would have shipped a data-structure change under a one-line approval.

**Where my approval failed, recorded because it generalises.** Receipt question 1 asked whether an
action can act on *that job's fault*, and both of us answered per JOB. The property is per REASON,
and the planner is the first candidate for this set whose reasons split. Your five-reason count was
truncated by a `grep -A 20`; my approval never tested the denominator at all. **A clean measurement of
the wrong population reads exactly like a clean measurement** — which is the note in your own file,
and the second time this week a tidy count made a wrong conclusion feel settled.

Proceed to implementation on C.

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
