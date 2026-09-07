PROMPT_ID: PLATFORM-102-SLICE-4-ACTIVATION-CLAUDE-v1
PURPOSE: Item 102 slice 4 — activate the planner. A daily cron derives windows, synthesizes crons, records intent, and upserts or pauses the two QStash schedules. This is the slice where the saving lands: live-scores drops from 480 wakeups/day to ~64 annually.
SCOPE: a new cron route and its schedule manager; `scripts/lib/qstashSchedule.ts` for `upsert`'s authority; `docs/deployment-runbook.md:89` and the six `scripts/manage-*-schedule.ts` headers for the credential statements; the row's nothing-due display. Tests for each. NOT `pollingWindows.ts`, `pollingCron.ts` or `pollingPlannerRecord.ts` — slices 1, 2 and 3a own those and they are done.

Read `AGENTS.md` first. Three rules there bind this slice unusually hard and are not restated: **generated spaces over the type's contract**, the **round limits**, and **reachability before design** — which resolved both of this slice's blockers before it started.

## READ THIS FIRST — the branch family's recurring failure

Slices 2, 3a and 3b each shipped the **same mistake in different clothes**, and each cost a review round:

| slice | the guard was placed at | what it missed |
| --- | --- | --- |
| 3a r1 | the constructor | the sink — an optional projector left the allowlist unenforced at the write |
| 3b r3 | the read side | the write side — the sink projected fields the read would reject |
| 3b r5 | the value | the shape — `Number('')` is `0`, so an empty comma part became slot zero |

**One root: a guard on what something MEANS while what it IS goes unchecked.** Expect it here. This
slice writes to an external system, so the sink is a network call and the shape is a request body.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical; they win over anything summarised below.**

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 102**, the whole entry: the four collisions, the
  two-schedules-per-job decision, slice 4's own bullets, and **the two owner decisions of 2026-09-07**
  that resolved this slice's blockers.
- `scripts/lib/qstashSchedule.ts` — `buildUpsertRequest` (`:176`), `buildPauseRequest` (`:222`),
  `buildResumeRequest` (`:233`), `evaluateScheduleContract` (`:331`, cron compared at `:342`),
  `RunDeps` (`:437`, no store access), and the `ScheduleContract` constants each `manage-*` script
  declares.
- `src/lib/schedule/pollingCron.ts` — slice 2. `synthesizePollingCrons` produces the dense and slow
  expressions; `PollingCronPlan` is `{ dense: … | null; slow: … }`.
- `src/lib/server/pollingPlannerRecord.ts` — slice 3a. `recordPollingPlannerRun`,
  `buildPollingPlannerRun`, the allowlisted projection, and `readPollingPlannerRuns`.
- `src/lib/server/schedulerDeliveryHealth.ts` — slice 3b. What now reads the record, and the
  `deliveryRowStatus` mapping (`systemHealthPresentation.ts:119`) that the nothing-due decision
  touches.
- `docs/deployment-runbook.md:89` — *"Never commit it or configure it in Vercel."* Collision 3 makes
  this false. **Six `scripts/manage-*-schedule.ts` headers say the same thing** in their own words
  (`odds`, `rankings`, `schedule-refresh`, `live-scores`, `game-stats`, `usage-sample` — `team-records`
  does not); that is **seven statements**, measured, not estimated. Verify the count yourself before
  editing — if it has moved, the count is a finding.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. A branch checkout is fine; no code, no tests until the owner
replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote the `QSTASH_TOKEN` sentence from `docs/deployment-runbook.md:89`** and report **your own
   count** of the places stating the same thing — this prompt claims seven; say whether you measured
   the same. Then say why this slice must change them, and what the repo would be asserting if it did
   not.
3. **`buildUpsertRequest` and `buildPauseRequest` differ in what they carry.** Name every header the
   upsert sends that the pause does not, and say which of them are secrets. Then say what that means
   for a slice that will now call both on a schedule.
4. **Both of this slice's blockers were resolved by a measurement or a mechanism nobody had used, not
   by a judgement call.** Name both, and say for each what was being assumed before.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing, say
   so explicitly — but note that Item 102's slice-4 bullets were written before the two 2026-09-07
   decisions and one of them is now stated more strongly than it needs to be.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/102-slice-4-activation` from current `origin/main`, in `/Users/zach/cfb-app-claude`. Never
commit to `main`. A `pre-push` hook runs `npm run lint:all` and refuses a failing push. Codex is
concurrently on `src/lib/selectors/` — no overlap.

<task>
**What this slice turns on.** Slices 1–3b built the whole apparatus and shipped it dormant: window
derivation, cron synthesis, the durable record, and delivery health reading that record instead of
extrapolating. Nothing writes a record and no schedule is planner-owned. **This slice is the switch.**

1. **A daily cron** that derives windows from the canonical schedule, synthesizes the dense and slow
   crons, records what it derived and sent, and applies it to QStash. One run per day, per job.

2. **Pause on a dead day — owner decision 2026-09-07.** The rule:
   - **Games today** → dense active over the game hours, slow over the tail.
   - **No games, tail still open from yesterday** → slow only, dense **paused**.
   - **Nothing at all** (mid-week, offseason) → **both paused**.

   **Pause, never delete.** A paused schedule still exists, so `inspect` can still check it and the
   tamper signal survives. Deleting makes it vanish and reappear daily as a new schedule, which
   undermines exactly what slices 3a and 3b were built to protect. **This also removes the `dense: null`
   ambiguity** — the planner never has to express "deliberately off", because *paused* is the state
   and it is visible in QStash rather than inferred from a missing field.

3. **`upsert` answers to the record, not the fixed contract.** Slice 3a left this deliberately, because
   choosing `upsert`'s authority IS the planner-ownership decision. Today a planner-owned schedule that
   goes absent makes `inspect` print *"not provisioned. Run `upsert --apply` first"*, which provisions
   the fixed cron that the next `inspect` then refuses. Resolve that loop here.

4. **`QSTASH_TOKEN` into the Vercel environment — collision 3.** **Check first whether QStash offers a
   scoped management token** limited to the two schedules the planner touches; if it does, use it.
   **Update every statement saying otherwise in the same PR** — the runbook plus the six script
   headers — or the repo asserts a security posture it no longer holds. Note that
   `qstashSchedule.ts:22` says only that the secrets are never printed; that stays true and should not
   be touched.

5. **Nothing due renders GREEN — owner decision 2026-09-07.** If nothing is due, the job is doing what
   it was told; that is healthy. **But the row must distinguish "nothing due yet" from "no evidence
   this job has ever run"** — slice 3b measured a job dead five days rendering green because nothing
   had been due, while a job with no receipt at all raised a warning. Absence warned and staleness did
   not. Make that a **display** distinction; do not add a sixth `SchedulerDeliveryState` member.
</task>

<gate>
**The existing handler guards STAY.** They are the defence against kickoff changes, postponements,
stale QStash state and planner mistakes. The planner reduces wakeups; it must never become the only
correctness or quota protection. If a guard looks redundant now, that is a finding, not a cleanup.

**Do NOT change `pollingWindows.ts`, `pollingCron.ts` or `pollingPlannerRecord.ts`.** Slices 1, 2 and
3a own them and all three are merged. If one does not expose what you need, report it.

**Do NOT add a sixth `SchedulerDeliveryState` member.** Item 102 has now declined to widen it three
times. The nothing-due distinction is presentation.

**Never log or persist a header block, a raw request, or a response body.** `buildUpsertRequest`
carries `Authorization: Bearer <QSTASH_TOKEN>` and `Upstash-Forward-Authorization:
Bearer <CRON_SECRET>`. The record's projection is allowlisted for this reason and slice 3a enforces it
at the write; do not route around it.

STOP and report if a scoped QStash management token does not exist and the full-privilege token is the
only option — the owner accepted that risk on a stated rationale and should confirm it against what
you actually find. Also stop if pausing a schedule loses state `inspect` needs.
</gate>

<completeness_contract>
- **The three schedule states are each asserted end to end** — games today, tail only, nothing at all —
  against what is actually sent to QStash, with the request builder exercised rather than mocked away.
- **Pause is proven not to be delete.** After a pause, `inspect` still finds the schedule and still
  compares it. Mutation-prove it: make pause delete instead and show a named test go red.
- **The `upsert`/`inspect` loop is closed.** Assert that a planner-owned schedule going absent does not
  produce a fixed cron that the next `inspect` refuses — the loop slice 3a left open.
- **No secret reaches a record, a log, or an error path.** Positive control: feed the real
  `buildUpsertRequest` output — both secret values in a real header block — through whatever this
  slice records or logs, and show the scan detects them if the allowlist is removed.
- **Nothing-due renders green, and "never run" does not.** Both asserted; the distinction is the point.
- **Generate over the type's contract** (`AGENTS.md`), not over the shapes today's schedule produces.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with a standing known-failure baseline recorded in
`docs/next-tasks.md` (**Item 137**). Verify against that baseline, not against zero: exactly those
failures and no others.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving pause is not delete and
the one proving no secret escapes; and anything you deliberately did not do.

**This slice is NOT dormant — say so plainly and say what it changes on the first run.** Slices 2, 3a
and 3b all shipped dormant; this one writes to an external system and takes ownership of two live
crons. Report what the first planner run does, and what an operator should see on System Health the
morning after.

**Report the projected saving against the measured baseline** — live-scores 480/day today; slice 2
measured 63.9 annually and 193.7 in October. Say whether the shipped planner matches that and, if not,
why.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 102 slice-4
status, the runbook and manage-script credential corrections, and `docs/deployment-runbook.md`'s
activation section.

Push branch and `preview` together. Merge is delegated to this lane under `CLAUDE.md` →
**Worktrees and session roles**, including the four conditions. **Promotion is not** — and this is the
first Item 102 slice where promotion has a visible operational effect, so it is the owner's to time.
</output_contract>
