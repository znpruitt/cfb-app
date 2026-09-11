PROMPT_ID: PLATFORM-102-SLICE-3B-DELIVERY-CONSUMER-CLAUDE-v1
PURPOSE: Item 102 slice 3b — make delivery health read what the planner ACTUALLY scheduled instead of extrapolating today's cron backwards, and let one row describe two schedules. This is what stops slice 4 shipping a permanent false alarm.
SCOPE: `src/lib/server/schedulerDeliveryHealth.ts` and its tests; `src/lib/server/systemHealth.ts` only where the plan must be threaded. NOT `pollingPlannerRecord.ts` — slice 3a owns the store and this slice is its consumer. No QStash call, no `QSTASH_TOKEN`, no cron ownership, no component.

Read `AGENTS.md` first. Two rules there bind this slice hard and are not restated: **"an invariant over a space must be tested over the space"** — including that the space is the *type's contract*, which slice 2 and 3a both earned — and the **round limits**, because this slice inherits findings from two branches and must not become a third.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical; they win over anything summarised below.**

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 102**, the whole entry. In particular **collision 2**,
  the **four inherited items**, and the **two-schedules-per-job** decision. The entry also records that
  slice 3 was split — slice 3a is merged; you are the second half.
- `src/lib/server/pollingPlannerRecord.ts` — **what slice 3a shipped and you consume.** Read its
  exports, especially `readPollingPlannerRuns` (four states) and `PollingPlannerRun` / 
  `PlannerScheduleRun`. **3a deliberately did NOT build your reader** — it owns storage and parsing;
  you own interpretation.
- `src/lib/server/schedulerDeliveryHealth.ts` — the file you change. `previousScheduleSlotMs` (`:327`),
  `requiredStartedAtMs` (`:339`), `requiredStartedAtForJob` (`:354`), `SchedulerDeliveryHealthOptions`
  (`:364`), `buildDeliveryRow` (`:407`), `readSchedulerDeliveryHealth` (`:387`).
- `src/lib/schedule/pollingCron.ts` — slice 2. `PollingCronPlan` is `{ dense: … | null; slow: … }`,
  which is why one row cannot describe one cron.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. A branch checkout is fine; no code, no tests until the owner
replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote `previousScheduleSlotMs` (`:327-337`)** and say in one line what assumption its loop makes
   about the cron. Then say why that assumption is false once slice 4 lands, and what it produces —
   with the direction of the error, not just "wrong".
3. **`readPollingPlannerRuns` returns four states. Name them**, and say what each should mean for a
   delivery row. Two of them are NOT the same fact; say which two and why collapsing them would repeat
   a defect slice 3a already fixed once.
4. `buildDeliveryRow` (`:407`) and `requiredStartedAtForJob` (`:354`) do **not** take a plan, while
   `schedulerDeliveryPolicy` does. Say what a partial wiring would produce, and why no existing test
   would fail.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing, say
   so explicitly — but note that one of the four inherited items is stated in terms this slice's own
   state vocabulary cannot express as written.

A receipt that summarises without quoting is not a receipt.

## Branch

`claude/102-slice-3b-delivery-consumer` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
Never commit to `main`. A `pre-push` hook runs `npm run lint:all` and refuses a failing push. Codex is
concurrently on `src/lib/selectors/` and `src/components/` — no overlap.

<task>
**Why this slice exists.** Slice 4 makes the cron **planner-owned and rewritten daily**.
`previousScheduleSlotMs` walks backwards through TODAY's cron as if it were eternal, so on any day
whose plan differs from yesterday's it derives a required slot **that never existed**. Measured on the
real parser: a game day of `*/3 19,20,21,22,23` after a dead day of `0 * * * *` reports **false `late`
for ~19 hours** — and that is **collision 2's exact failure, reintroduced by the fix for collision 2**.
Ship slice 4 without this and the two rows that matter most on a game day alarm continuously.

Four inherited items, all recorded on Item 102:

1. **Stop extrapolating.** The record slice 3a writes holds `previousCron` per schedule. Read what was
   in force; do not predict it.
2. **The row carries BOTH crons**, taking `max(previousSlot(dense), previousSlot(slow))`. One cron
   cannot describe two schedules: the cadence label is untrue, and a slow-schedule delivery failure is
   invisible for a measured **15.0 h**.
3. **A corrupt stored plan surfaces rather than falling back. RULED 2026-09-07, after your receipt.**
   Falling back to the fixed contract claims a firing every three minutes while the real schedule is
   dark, so a corrupt plan reads `late` continuously — a false alarm dressed as a real one.

   **Your finding 1 is correct and Item 102's wording was unusable.** `invalid` means the RECEIPT did
   not parse and renders "Receipt invalid"; using it for a corrupt plan makes the UI assert something
   false about a receipt that parsed fine. The reason it does not fit: **`deliveryState` describes the
   RECEIPT**, and plan corruption is orthogonal — a row can have a good receipt and a corrupt plan.
   Item 3 asked one field to carry two facts.

   **The ruling: reuse `unavailable` for the state, and carry the reason in a SEPARATE field.**
   `unavailable` already means "no basis to judge" and renders muted; extending it from scope-wide to
   per-row is consistent with that meaning, not a redefinition. A companion field distinguishes
   `unreadable` (the plan is corrupt — send the operator to the planner) from `failed` (the store read
   threw — send them to the database), preserving exactly the distinction slice 3a kept for the same
   reason. **No sixth `SchedulerDeliveryState` member. None of its four consumers change.**
4. **Thread the plan through `SchedulerDeliveryHealthOptions`.** The policy functions take a plan;
   `buildDeliveryRow` and `requiredStartedAtForJob` do not. A partial wiring displays one schedule and
   measures against another, **with no test failing**.

Plus two model items carried out of slice 3a's review:

5. **`dense: null` conflates two facts** — "no dense phase today" and "the dense schedule is
   deliberately disabled". Codex's P1. **This is a BLOCKING SPECIFICATION ITEM FOR SLICE 4**, because
   what a dense-less day should do to a live schedule is slice 4's decision. **Do not invent an answer
   here.** Report what the ambiguity costs delivery health and carry it forward.
6. **`action`/`outcome` admits contradictory pairs** — `skipped` + `confirmed` validates. Found by
   ranging over the type's contract rather than over sample values. Whether it belongs here or in the
   store is your call to argue; the store is 3a's and this slice is its consumer.
</task>

<gate>
**Do NOT change `pollingPlannerRecord.ts`.** Slice 3a owns the store, and it deliberately exposed the
series read rather than a day-scoped lookup so that interpretation lives here. If you need something
the store does not expose, that is a finding — report it rather than reaching in.

**Do NOT take cron ownership.** Slice 4 does that. `upsert` still answering to the fixed contract is a
recorded slice-4 item, not yours.

**Do NOT add a sixth `SchedulerDeliveryState` member without reporting first.** The five —
`on-time | late | missing | invalid | unavailable` — have four consumers (`deliveryStateDisplay`,
`deliveryRowStatus`, `noReceiptExecutionLabel`, `systemHealthIssues.ts:352`). Item 102 twice chose
designs specifically to avoid widening it. Inherited item 3 may require a new state to express
"corrupt plan"; if it does, that is the finding, and the owner rules.

**Do NOT let a store read failure take System Health down.** Slice 2's review already flagged
`schedulerDeliveryPolicy` going from total to partial as the hazard for exactly this slice. A bad
stored plan degrades one row; it does not throw on a path every health page calls.

STOP and report if the record cannot answer "what cron was in force on day D" without a second store
shape, or if threading the plan forces a change to any of the four `SchedulerDeliveryState` consumers.
</gate>

<completeness_contract>
- **The false-`late` case is asserted directly and is the headline test.** A game day following a
  differently-armed day must read `on-time`. Prove by MUTATION that restoring the extrapolation turns
  it red — that mutation is the whole slice.
- **The two-cron row is asserted in BOTH directions**: a dense-schedule failure is caught, and a
  slow-schedule failure inside the tail is caught. The second is the one that is invisible today.
- **The seven jobs the planner does not own are byte-identical.** Prove by mutation. Nine
  `EXTERNAL_SCHEDULER_JOBS`, two planner-owned; assert the rest, do not assume.
- **Partial wiring is made impossible, not merely avoided.** Item 4's hazard is that no test fails —
  so add the test that would. A row displaying one schedule while measuring against another must be
  detectable.
- **Generate over the type's contract** (`AGENTS.md`) — vary plan presence, dense-null, record
  absence/unreadable/failed, and day boundaries. A generator seeded from what slice 2's defaults
  produce tests slice 2, not this.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **0** — there is no known-failure baseline. Item 137 (#696)
removed the last two time-bomb failures on 2026-09-11, so **any** failure is a stop-and-report,
not a baseline to verify against.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the false-`late` fix and
the one proving the seven untouched jobs; and anything you deliberately did not do.

**"Live read, dormant output" is the right framing — your finding 4, accepted.** Slices 2 and 3a added
no read; this one makes `readSchedulerDeliveryHealth` perform a new durable read per planner-owned job
on a path `buildSystemHealthViewModel` calls on **every** System Health load. Even with zero records in
production, the read is live: new latency, a new failure mode, and a new store the health page depends
on. Report it that way, and report **how many additional durable reads** a System Health load now
performs.

**Carry item 5 forward as a blocking specification item for slice 4**, with what the ambiguity costs
delivery health — not a proposed answer.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 102 slice-3b
status, and reconciling the entry's inherited-items list against what actually shipped.

Push branch and `preview` together. Merge is delegated to this lane under `CLAUDE.md` →
**Worktrees and session roles**, including the four conditions. Promotion is not.
</output_contract>
