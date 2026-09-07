PROMPT_ID: PLATFORM-102-SLICE-4-ACTIVATION-CLAUDE-v1
PURPOSE: Item 102 slice 4 — activate the planner. A daily cron derives windows, synthesizes crons, records intent, and upserts or pauses the two QStash schedules. This is the slice where the saving lands: live-scores drops from 480 wakeups/day to ~64 annually.
SCOPE: a new cron route and its schedule manager; `scripts/lib/qstashSchedule.ts` for `upsert`'s authority; `docs/deployment-runbook.md:89` and the six `scripts/manage-*-schedule.ts` headers for the credential statements; the row's nothing-due display. Tests for each. NOT `pollingWindows.ts`, `pollingCron.ts` or `pollingPlannerRecord.ts` — slices 1, 2 and 3a own those and they are done.

Read `AGENTS.md` first. Three rules there bind this slice unusually hard and are not restated: **generated spaces over the type's contract**, the **round limits**, and **reachability before design** — which resolved both of this slice's blockers before it started.

## READ THIS FIRST — the branch family's recurring failure

Slices 2, 3a and 3b each shipped the **same mistake in different clothes**, and each cost a review round:

| commit | the guard was placed at | what it missed |
| --- | --- | --- |
| `aed26d19` (3a) | the constructor | the sink — an optional projector left the allowlist unenforced at the write |
| `0e294603` (3a) | the read side | the write side — a write/read asymmetry, plus a divergent exit code |
| `e812b3c0` (3b) | the value | the shape — an unreadable cron part had to fail closed, not coerce |

**One root: a guard on what something MEANS while what it IS goes unchecked.** Expect it here. This
slice writes to an external system, so the sink is a network call and the shape is a request body.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical; they win over anything summarised below.**

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 102**, the whole entry: the four collisions, the
  two-schedules-per-job decision, slice 4's own bullets, and **the two owner decisions of 2026-09-07**
  that resolved this slice's blockers.
- `scripts/lib/qstashSchedule.ts` — verified 2026-09-07: `buildUpsertRequest` (`:187`),
  `buildPauseRequest` (`:222`), `buildResumeRequest` (`:233`), `ScheduleAuthority` (`:342`),
  `evaluateScheduleContract` (`:352`, taking `authority` at `:355`, cron compared at `:368`),
  `resolveExpectedContract` (`:680`), `RunDeps` (`:529`), and the upsert dispatch (`:887`).
  **Slice 3a already built the authority machinery** — `ScheduleAuthority = 'fixed' | 'recorded-intent'`
  exists, and `runInspect` (`:742`) already resolves through it. Read `:700-733` for what a
  recorded-intent resolution does and does not substitute; it is narrower than it sounds, and
  deliberately so.
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
3. **`buildUpsertRequest` (`:187`) and `buildPauseRequest` (`:222`) differ in what they carry.** Name
   every header the upsert sends that the pause does not, and say which of them are secrets. Then say
   what that means for a slice that will now call both on the same schedule.
4. **`resolveExpectedContract` (`:680`) substitutes exactly ONE field from a recorded intent, and
   refuses on three others.** Name the field, name the three, and quote the reason the comment gives.
   Then say what routing `upsert` through it would change — including which refusal branches become
   reachable that are not reachable today.
5. **Both of this slice's blockers were resolved by a measurement or a mechanism nobody had used, not
   by a judgement call.** Name both, and say for each what was being assumed before.
6. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing, say
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

3. **`upsert` answers to the record, not the fixed contract — and this is SMALLER than it sounds.**
   Verified on `main` 2026-09-07: `runInspect` (`:742`) already calls `resolveExpectedContract`, but
   the upsert dispatch (`:887`) calls `buildUpsertRequest(contract, …)` with the **raw fixed
   contract** (the call is at `:892`; `:887` is the dispatch check), never the resolver. So `inspect`
   blesses recorded intent while `upsert` writes the fixed cron — a planner-owned schedule that goes
   absent gets reprovisioned at the fixed cadence, which the next `inspect` then refuses. **Do not
   rebuild the authority machinery; slice 3a shipped it.** Route `upsert` through the existing
   resolver.

   **Two refusal branches change meaning on a mutating path — both RULED 2026-09-07 from your
   receipt, which raised them correctly.**

   - **`absent` → `fixed` is correct on the upsert path too, and it is the bootstrap.** The first
     planner run has no prior record, so upsert must be allowed to write the fixed contract or the
     planner can never take ownership. It is also the right behaviour AFTER the planner is live: if
     the record store is wiped, upsert falls back to the dense fixed cadence, which over-approximates.
     **Over-approximation is this item's stated safety direction** — the handler guards remain the
     correctness protection, so the fallback costs CPU, not correctness. Assert both readings.
   - **`indeterminate` (exit 4) must NOT refuse on the upsert path.** On `inspect` a refusal is a
     diagnosis. On `upsert` it means never retrying the one operation whose outcome is unknown, so a
     single exit 4 wedges the planner until a human intervenes — and the daily cron would re-refuse
     every morning. **The upsert is idempotent under a pinned `Upstash-Schedule-Id`, which is what
     makes re-issuing safe; VERIFY that against Upstash's management API before relying on it** and
     stop and report if it does not hold. A per-action divergence in how one refusal reason is
     treated must be explicit in the code, not implicit in a call order.

4. **`QSTASH_TOKEN` into the Vercel environment — collision 3.** **Check first whether QStash offers a
   scoped management token** limited to the two schedules the planner touches; if it does, use it.
   **Update every statement saying otherwise in the same PR** — the runbook plus the six script
   headers — or the repo asserts a security posture it no longer holds. Note that
   `qstashSchedule.ts:22` says only that the secrets are never printed; that stays true and should not
   be touched.

5. **Nothing due renders GREEN — owner decision 2026-09-07. Verified on `main`; this is a COLOUR and
   LABEL change only, and it is small.** Slice 3b already did the state-level work and its reasoning
   stands: nothing-due must NOT be `on-time`, because `on-time` asserts delivery was timely and
   nothing measured that (`schedulerDeliveryHealth.ts:1353-1370`). It resolves to `unavailable`
   instead, and `missing` still covers "no receipt at all" — **so the distinction the owner asked for
   already exists in the state layer.** Do not redo it.

   What is left is that a healthy idle job currently renders a **yellow row labelled "Unavailable"**:
   `deliveryRowStatus` (`systemHealthPresentation.ts:120`) is `state === 'on-time' ? 'green' :
   'yellow'`, and `deliveryStateDisplay` (`:124`, `unavailable` case at `:138`) returns the word
   "Unavailable". **Its TONE is already `muted`, so only the LABEL is wrong there** — an earlier
   version of this prompt said both signalled fault, which overstated it. The yellow comes entirely
   from `deliveryRowStatus`.

   **The discriminator is the RECEIPT, not the reason — corrected 2026-09-07 from your receipt, and
   the correction is load-bearing.** This prompt and Item 102 both said `planUnavailableReason === null`
   identifies nothing-due. It does not. **Four** branches reach `unavailable`, and the null-reason case
   is not unique:

   | line | branch | reason | receipt | fault? |
   | --- | --- | --- | --- | --- |
   | `:1326` | receipt-scope read failed | **may be null** | `null` | **YES** |
   | `:1334` | no receipt for this job, plan faulted | non-null | `null` | yes |
   | `:1351` | plan faulted beside a published receipt | non-null | present | yes |
   | `:1370` | nothing due | null | **present** | **no** |

   `unavailable` + null reason is true for BOTH `:1326` and `:1370`, so a `deliveryRowStatus` widened
   to take only the reason paints a receipt-store OUTAGE as healthy. **Nothing-due is uniquely
   `reason === null && receipt !== null`** — it reached `:1370` through `entriesByJob.has(job)`, so it
   always carries a parsed receipt; the scope failure never does.

   **This is the branch family's own failure shape, committed in the prompt that warns about it** —
   a guard on what the state MEANS while which branch produced it goes unchecked. Assert `:1326`
   explicitly; it is the case that turns a real outage green.

   **Slice 3b's final review filed exactly this**, and it named the target: **`PanelStatus` already
   has `gray`.** Its argument is the one that matters — the row renders a yellow dot while the page
   reads healthy and the issues list is EMPTY, arriving on cutover morning on a shape `slowHoursFor`
   emits routinely. _"A dashboard that renders yellow for routine states teaches operators to ignore
   yellow, which is worse than the false `late` this whole item exists to prevent."_

   **The owner's word was "green"; `gray` may serve the decision better** — the ruling was that a
   healthy idle job must not read as a fault, not that it must be the same green as a measured on-time
   delivery. Argue it either way, but argue it.

   **Both functions are among the four `SchedulerDeliveryState` consumers this campaign has twice
   avoided touching, so widening their signatures is a REPORTABLE change** — the recorded finding
   calls that out as "the decision, and it belongs with the slice that makes the state reachable",
   which is you. **Still no sixth state member.**

## Carried forward from slice 3b — READ THIS, it is most of the risk

Slice 3b filed **seven follow-ups**, all recorded on Item 102 and all classified _ordinary, not
blocking_ **at the time**. That classification was made against a `main` where **nothing writes a
planner record**. You are the slice that makes records exist, so several of them stop being
theoretical the moment this ships. Judge each against the world AFTER your cutover, not the world
that filed it.

**One is assigned to you outright.**

- **Slice 2's `plan` parameter on `schedulerDeliveryPolicy` is dead — remove it.** It was the seam
  slice 3 was expected to wire; 3b wired the RECORD instead, so it is now the predictive path with no
  production caller. It was left because removing it churns slice 2's tests. **`AGENTS.md`: a module
  left with no production consumer must say why in the code — or go.** This one goes.

**Four are unreachable today and reachable after you.** For each: say whether you handled it, or why
it can wait, and do not silently inherit it.

- **A dropped NEWEST planner run reads as no run at all.** The tolerant parser drops a malformed row,
  leaves `droppedRuns` nonzero, and the timeline treats the prior cron as current. 3b argued a dropped
  row surfaces as a `previousCron` contradiction — **that holds only for a drop BETWEEN two retained
  runs.** A dropped newest run has nothing after it to contradict it. **The reasoning was wrong, not
  just the code**, which is why it is recorded. Your daily writer produces exactly the newest run.
- **A STALLED planner read stalls the whole snapshot.** A promise that never settles blocks the
  enclosing `Promise.all`, and System Health's 8 s timeout then replaces all nine rows. Same failure
  mode the receipt scope read already carried — but **the amplification is real: one durable read on
  this path became three**, and until now all three answered `absent` immediately. Yours are the first
  that do real work.
- **The all-unavailable global short-circuit drops per-schedule plan faults.** When the receipt scope
  read fails every row is `unavailable` and the function returns before the per-schedule scan, so a
  simultaneously corrupt planner record raises no issue at all.
- **Mixed per-schedule reasons collapse to the first.** A dense `plan-indeterminate` beside a slow
  `plan-unreadable` tells the operator both have the same cause — losing the planner-vs-database
  distinction `PLAN_UNAVAILABLE_EXPLANATION` exists to preserve. Two schedules per job is your
  normal case.

**Three are NOT yours. Do not fix them and do not let them widen this branch.**

- The **two-store deferral** (`pollingPlannerRecord` + `providerUsageSeries`): preserve unparsed rows
  rather than pruning, and the aggregate refusal that wedges the writer when every stored row is
  unparseable. Filed as one item across both twins deliberately — changing one leaves two behaviours
  for one problem.
- **The record read filters future-skewed rows against `Date.now()`** rather than the snapshot's
  pinned clock. In slice 3a's store.
- **`hourly (:01) at 00:00, 12:00 UTC` overstates a twice-daily schedule.** Not a shape
  `synthesizePollingCrons` emits.

**And one argument from Item 102 supports the pause rule — carry it.** If slice 4 leaves a stale
dense schedule installed on a dense-less day, that schedule **is still firing, and its failure is
invisible until the next day that has a dense phase.** Pausing is not only tidier; it is what keeps a
dead schedule's silence meaningful.

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
- **Nothing-due does not render as a fault, and a genuinely unreadable plan still does.** Both
  asserted, discriminated by `planUnavailableReason`. Assert `missing` is untouched — "no receipt at
  all" must keep warning.
- **Generate over the type's contract** (`AGENTS.md`), not over the shapes today's schedule produces.
- **`schedulerDeliveryPolicy`'s dead `plan` parameter is gone**, and slice 2's tests are updated
  rather than deleted.
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

**Answer the four newly-reachable slice-3b follow-ups one by one** — handled, or deferred with the
reason. A blanket "inherited unchanged" is not an answer for a defect this slice makes reachable.

**This slice is NOT dormant — say so plainly and say what it changes on the first run.** Slices 2, 3a
and 3b all shipped dormant; this one writes to an external system and takes ownership of two live
crons. Report what the first planner run does, and what an operator should see on System Health the
morning after.

**Report the projected saving against the measured baseline.** Against today's 480 runs/day, slice 2
measured the shipped synthesizer at **63.2/day annual and 190.7 in October** for `live-scores`, and
**28.8 / 45.1** against 96 for `game-stats` (`schedule / 2026-all-all`). Say whether the shipped
planner matches those, and if not why.

**Report October separately from the annual figure, and do not lead with the annual one.** The
annual saving is ~87%; October is ~60%, because the 24-hour tail means one Saturday game arms all of
Sunday (74% of October hours armed, against 17% for the year). October is the binding month — the
Hobby allowance is monthly. Item 102's entry is explicit that this is built _"for the ~83% annual
saving and the manual pause it retires — not as the fix for in-season pressure."_ A report quoting
only the annual number would overstate what an operator sees in October.

**The pause-on-dead-day rule should improve on 63.2.** Slice 2's figure predates it. Report the
delta if there is one; do not assume it.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 102 slice-4
status, the runbook and manage-script credential corrections, and `docs/deployment-runbook.md`'s
activation section.

Push branch and `preview` together. Merge is delegated to this lane under `CLAUDE.md` →
**Worktrees and session roles**, including the four conditions. **Promotion is not** — and this is the
first Item 102 slice where promotion has a visible operational effect, so it is the owner's to time.
</output_contract>
