PROMPT_ID: PLATFORM-102-SLICE-2-CRON-SYNTHESIS-CLAUDE-v1
PURPOSE: Item 102 slice 2 — two pure functions over slice 1's polling windows: synthesize the cron expression that covers them, and derive the scheduler delivery expectation from them. Both ship DORMANT; nothing consumes either yet.
SCOPE: `src/lib/schedule/pollingWindows.ts` (or a sibling under `src/lib/schedule/`) and its `__tests__/`; `src/lib/server/schedulerDeliveryHealth.ts` ONLY to make its policy derivable, plus that file's tests. No route, no cron, no QStash call, no environment variable, no durable write, no component.

Read `AGENTS.md` first. Nothing in it is restated here.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical, and it wins over anything summarised below:**

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 102**, the slice definitions. Read the whole
  entry, not just slice 2: the four collisions, the "what the planner actually buys" note, and the
  three owner decisions of 2026-09-05 all constrain this slice.
- [`docs/campaigns/vercel-active-cpu.md`](../campaigns/vercel-active-cpu.md) — the measurement this
  item exists for, including _The 20% duty cycle is an ANNUAL average_.
- `src/lib/schedule/pollingWindows.ts` — slice 1, merged and live. You are building directly on its
  exports. It has no consumer yet; that is by design, and you are not adding one.

## STOP — post a READ RECEIPT before writing any code

You have the prompt document and whatever short message was pasted into your chat. Build from the
document. Report these, then **STOP and wait** — no branch, no code, no tests until the owner replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. `pollingWindows.ts:88` sits inside the `slowEndMs` docstring. Quote the sentence containing it and
   say, in one line, what that comment says a previous version got wrong. It is the exact failure this
   slice must not repeat.
3. `pollingWindows.ts:218` ends a sentence about over-approximation. Quote it, and name which function
   it documents.
4. The exact current `cron`, `cadenceLabel` and `graceMs` values at `schedulerDeliveryHealth.ts:82`
   and `:88`.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If you find
   nothing, say so explicitly — but note that one owner decision below reverses what an earlier
   version of the plan assumed.

A receipt that summarises without quoting, or that could have been written from the chat message
alone, is not a receipt. If a reference is missing or two references disagree, say so rather than
resolving it yourself.

## Branch and worktree

Work in **`/Users/zach/cfb-app-claude`**, not the primary worktree — see `CLAUDE.md` →
**Worktrees and session roles**. `git pull`, then branch from current `origin/main` as
`claude/102-slice-2-cron-synthesis`. Never commit to `main`. Codex is concurrently on
`platform/087-slice-5a-scoreboard-contract-v2` in a different worktree; it touches
`src/components/` only, so there is no file overlap — do not go near it.

<task>
**CORRECTED 2026-09-05 after your receipt. Your finding (a) was right and it changed the design.**

Two pure functions over slice 1's `PollingWindow[]`. No QStash, no environment variable, no durable
write, no consumer. Ships dormant.

1. **Windows → TWO crons, not one.** Slice 1 emits `densePhase` and `slowPhase` per window, and they
   need different cadences. One cron cannot express that — `parseCron` applies one minute-set to every
   hour it matches, exactly as you found. So synthesize **a dense cron (`*/3`-style over
   `utcHoursCovered(densePhase(...))`) and a slow cron (hourly over `utcHoursCovered(slowPhase(...))`)**.
   `live-scores` and `game-stats` each get two QStash schedules in slice 4.

   **Use comma-separated explicit hours only.** Your finding (b) is confirmed: `parseCronField`
   handles `*`, `*/n`, a bare integer and comma lists — a range like `12-23` parses to an EMPTY set
   and delivery health then fails silently. `utcHoursCovered` already returns exactly that list.

   **Never UNDER-cover.** Over-covering is safe for the reason `pollingWindows.ts:218` states.
   Under-covering the slow phase re-commits the failure `:88` records. Assert that direction
   explicitly, with a positive control.

2. **Windows → delivery expectation.** Derive `cadenceLabel` and `graceMs` from the same windows so
   `schedulerDeliveryHealth.ts:82,88` no longer hardcodes them — **collision 2**. With no windows
   supplied it must fall back to today's exact constants, so this ships as a NO-OP.

   **Absence and emptiness are DIFFERENT inputs — your finding (d).** "No windows supplied" (fall
   back to constants) and "a plan with zero windows" (the offseason) must not both be `[]`, or the
   no-op proof and the offseason case cannot both hold. Make that distinction in the signature.
</task>

<owner_decisions>
Settled 2026-09-05. Do not re-derive or re-litigate these.

- **The floor-cadence decision is WITHDRAWN — your finding (c) disproved its rationale.** It claimed a
  dark cron would report `late` or `missing`. `buildDeliveryRow` (`:290-320`) derives `late` from
  `receipt.startedAt < requiredMs` where `requiredMs` is the previous slot OF THAT CRON, and `missing`
  only when the receipt key is absent. A dead day under a narrowed cron reads **`on-time`**. You were
  right not to re-litigate it; the owner withdrew it. **Still do not add a sixth `SchedulerDeliveryState`
  member** — that part holds, and none of its four consumers should be touched.
- **The offseason still needs an expression**, because no cron can mean "never" — but it is the SLOW
  schedule that carries it, not a separate floor. A zero-window plan yields a slow cron and no dense
  one. This is the behaviour superseding the manual half of Item 96.
- **`cadenceLabel` is plan-derived** and must show the day's actual shape, e.g. _"every 3 min until
  04:00 UTC, then hourly"_ — it renders verbatim at `SchedulerHealthSection.tsx:99`. **But the plan
  record does not exist until slice 3.** In THIS slice, derive the label from the windows you are
  handed and keep the existing static constants as the fallback. **Do not build a plan reader, and do
  not wire the health row to durable state** — that is slice 3, and reaching for it here creates a
  dependency on something unbuilt.
</owner_decisions>

<completeness_contract>
- **Ships dormant. Nothing calls the synthesizer.** The delivery-expectation change must be a
  provable no-op against production: with no windows supplied, `schedulerDeliveryPolicy` returns
  byte-identical values for all nine jobs. Prove it by MUTATION — break the fallback and show a
  SPECIFIC named test going red, then restore.
- **The never-under-cover property gets its own test**, and a positive control proving that test can
  fail: construct a deliberately under-covering cron and show the assertion rejects it. A property
  test that has never seen a violation is not evidence it would catch one.
- The floor cadence is exercised for: no windows at all (offseason), windows covering part of a day,
  and windows covering a full day. The boundary between floor and in-window cadence is asserted.
- Every one of the nine `EXTERNAL_SCHEDULER_JOBS` still resolves a policy. The seven jobs this slice
  does not touch must be untouched — assert that, do not assume it.
- Test count delta reported as a measured number.
</completeness_contract>

<gate>
STOP and report, without coding around it, if: the cron expression cannot express the windows without
under-covering (that is a real finding about collision 4, not a problem to paper over); deriving the
delivery expectation forces a change to `SchedulerDeliveryState` or any of its four consumers
(`deliveryStateDisplay`, `deliveryRowStatus`, `noReceiptExecutionLabel`, `systemHealthIssues.ts:352`)
— the two-schedule design was chosen specifically so that would not happen, so if it does, the
decision needs revisiting; or making the policy derivable requires the health row to read durable
state.

**Explicitly out of scope:** the faster in-window cadence. It spends provider quota that dead days
never spent, and it is Item 95 portion 2, gated on Item 94. Also out: `QSTASH_TOKEN`, any QStash
management call, the durable planner record, and `qstashSchedule.ts` — slices 3 and 4.
</gate>

<verification>
Run each separately and report its own exit code — never chained behind `&&` and never behind a pipe,
which reports the last command's status rather than the gate's:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; which mutation proved the no-op and which
proved the never-under-cover property; and anything you deliberately did not do.

**Also report the floor's measured cost** — runs/day for `live-scores` and `game-stats`, in-window
versus floor — so `docs/campaigns/vercel-active-cpu.md` can be corrected at closeout. The projection
standing in that document is windows-only and will otherwise keep claiming a number the code no longer
produces. Do not edit that document yourself; closeout is a separate pre-merge commit.

Push the BRANCH ONLY, and push `preview` with it — you own the feature branch, so `preview` is yours
per `AGENTS.md` → **Preview branch**. Do not open a PR.
</output_contract>
