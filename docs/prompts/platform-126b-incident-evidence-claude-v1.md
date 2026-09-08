PROMPT_ID: PLATFORM-126B-INCIDENT-EVIDENCE-CLAUDE-v1
PURPOSE: Item 126 Tier B — a failed multi-year refresh must durably say WHICH year failed, WHY, and what class of upstream fault caused it. Today it says `failure / year-results` and nothing else, and the supporting evidence has already been overwritten.
SCOPE: `schedule-refresh` and `rankings` — the two multi-year jobs — plus the receipt target builder and the System Health copy that reads it. Tests for each. NOT the four single-unit jobs. NOT Tier A.

Read `AGENTS.md` first. Two of its rules bind unusually hard: the **mandatory planning split** (which is why this is Tier B alone), and **every surface a PR touches carries its own tests** — this one touches two automation jobs and both need route-level coverage.

## This is not hypothetical. Read what production holds RIGHT NOW.

The September 1 12:00 UTC weekly refresh failed. Here is the **entire** durable record, read from
production 2026-09-07, 153 hours later:

```json
{ "job": "schedule-refresh", "reason": "year-results", "result": "failure",
  "target": { "kind": "schedule-years",
              "years": [ { "year": 2026, "operation": "ordinary-maintenance" } ] },
  "startedAt": "2026-09-01T12:00:01.664Z", "durationMs": 37124,
  "invocationId": "d563a545-3204-4cd2-8530-55de43149c46",
  "providerCallAttempted": true }
```

**That is all an operator has.** One year, one operation, a duration, and the word `failure`.

**And the corroborating evidence is ALREADY GONE — this is layer 3, demonstrated, not predicted.**
`provider-refresh-status` is latest-only, and `schedule:year:2026` now reads:

```json
{ "lastError": null, "lastSuccessAt": "2026-09-07T14:03:14.993Z", "durationMs": 3785 }
```

A later success has overwritten the failed attempt whose details the postmortem needed. The item
predicted exactly this; production has since done it. **You cannot recover the September 1 evidence,
and that is the point — build so the next one survives.**

`docs/operations/diagnostics.md` holds the incident record. Its diagnosis — a transient CFBD
partition timeout exhausting three 12-second attempts — is **high-confidence but not provable**, and
it is unprovable *because of the four gaps below*. Do not treat it as settled fact.

## The four layers of loss — verified on `main` 2026-09-07

1. **`scheduleYearsTarget` (`schedulerExecutionStatus.ts:380`) discards per-year outcome.** It
   RECEIVES `scoreRepairs`, `scoreDifferenceCount`, `scoreSweepFailedPartitions`,
   `scoreSweepCannotTellCount` and `kickoffsChanged` per entry, then maps to
   `{ year, operation }` and aggregates the rest to run level (`:396`). The per-year `result`,
   `reason`, `providerCallAttempted`, `rowsReceived`, `rowsCommitted` and `dataChanged` never reach
   it at all. **`failedSeasonTypes` is a THIRD case, corrected from your receipt: it is not on the
   cron year entry either, so widening this builder cannot reach it — the ROUTE drops it one layer
   earlier.** The authorities already compute it (`fullSeasonScheduleRefreshResult.ts:69`,
   `refreshAuthority.ts:443`).
2. **Runtime events lack `invocationId`** — **0 of NINE** modules, corrected from your receipt. My
   "0 of 7" came from a `-name cronExecutionLog.ts` glob that misses `lifecycleCronExecutionLog.ts`
   and `pollingPlannerCronLog.ts`. **That is Tier A and NOT yours.** Noted so you do not solve it
   here, and because Tier A is sized off that count.
3. **`provider-refresh-status` is latest-only.** Shown above, already realised.
4. **The upstream class collapses to `fetch-failed`**, identically in both jobs:
   `schedule/fullSeasonScheduleFetch.ts:67` and `rankings/refreshAuthority.ts:111` are the same line
   of code. Timeout, network, HTTP status and JSON-parse all become one token, so even the provider
   status cannot say what kind of fault it was.

## References — READ THESE BEFORE WRITING ANYTHING

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 126**, especially the two-tier boundary and the
  explicit not-in-scope ruling.
- `docs/operations/diagnostics.md` — the incident record and its evidence classification.
- `src/lib/server/schedulerExecutionStatus.ts` — `scheduleYearsTarget` (`:380`), the target union,
  and `MAX_SCHEDULER_TARGET_YEARS`.
- `src/lib/schedule/fullSeasonScheduleFetch.ts` and `src/lib/rankings/refreshAuthority.ts` — the two
  identical collapses.
- `src/lib/server/schedulerExecutionStatus.ts`'s receipt parser, and its consumers in
  `systemHealthIssues.ts` / the System Health section that renders "execution failed".

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **Quote `scheduleYearsTarget`'s parameter list and its `.map(...)` at `:396`.** Name every field
   it receives per entry and discards, and separately every field it never receives. Those are two
   different problems and the fix differs.
3. **Quote both collapse sites.** Say what distinguishes them, if anything, and what a shared
   closed class would have to express to serve both.
4. **The receipt is a DURABLE CONTRACT with a parser and FIVE read sites** — your count, accepted
   over mine; the contract covers all five, including the writer's own prior-parse, which is the one
   that decides replaceability. Name them, and say what a
   reader on the old shape does when it meets a widened year entry. A migration that assumes
   simultaneous deploy is wrong.
5. Anything in the references that CONTRADICTS or narrows what you were handed. If nothing, say so
   explicitly.

## Branch

`claude/126b-incident-evidence` from current `origin/main`, in `/Users/zach/cfb-app-claude`.

**DO NOT PUSH `preview`.** Codex holds it for Item 117 under a slice-scoped exception, and
`CLAUDE.md`'s standing instruction to push it every commit is SUSPENDED for this branch. Two writers
is the exact ambiguity that rule exists to prevent. If you believe you need it, ask.

<task>
1. **Extend each durable receipt year entry** with the allowlisted per-year `result`, `reason`,
   `failedSeasonTypes`, `providerCallAttempted`, `rowsReceived`, `rowsCommitted` and `dataChanged`
   the authority already produces. **A run-level result cannot say which year failed when a run
   spans several** — that is the whole item.
2. **Preserve a closed upstream class** in place of the `fetch-failed` collapse. **RULED 2026-09-07
   from your receipt — FIVE members, mirroring `UpstreamErrorKind` exactly:** `timeout`, `aborted`,
   `network`, `http` with a numeric status, `parse`. My "four" came from the item's prose;
   `fetchUpstream.ts:1` says five and **the code wins**. Your argument decided it: collapsing
   `aborted` onto `network` is precisely the lossy mapping this item exists to remove, and inventing
   it inside the module whose job is not losing things would be self-defeating. Construct the class
   from `details.kind` and `details.status` ONLY — never spread `UpstreamError`, which carries
   `message`, `statusText`, `url` and `responseBody`.
3. **Record the class PER FAILED PARTITION, not once per year — RULED 2026-09-07.** You were right
   that the prompt did not settle this and right not to pick silently. Partitions fail
   independently, so a year with regular succeeding and postseason timing out is a real state that
   one class per year cannot express without a lossy tie-break. **This resolves together with your
   finding (a):** `failedSeasonTypes` is dropped a layer earlier than layer 1 described, so the fix
   is one shape — each failed season type carries its own class. Do not add a per-year class as
   well; one home for the fact.
4. **Let System Health show the retained reason and partition evidence** instead of only the generic
   "execution failed" copy — without treating observability metadata as canonical data truth.
</task>

<gate>
**NEVER persist a raw error, a response body, a URL, a header, or a payload.** The upstream class is
closed and secret-safe by construction: **five** members, one optional numeric status. A branch that
records an error message to be helpful has created an exfiltration path in a durable store.

**Do NOT generalise per-target outcome structures into the single-unit jobs.** `live-scores`,
`game-stats`, `odds` and `team-records` process one unit per run, so their run-level `result`/`reason`
already identifies what failed. Widening them for symmetry grows the receipt contract for every job
to solve a problem two jobs have. **Owner decision 2026-09-04 — do not re-argue it.**

**Do NOT collapse scheduler delivery and application execution into one bit.** Controlled application
failures intentionally return HTTP 200 so QStash does not retry them. That contract is load-bearing
and is not yours to change incidentally.

**Do NOT do Tier A.** `invocationId` on runtime events is a separate slice across seven jobs.

**Do NOT bound the receipt by dropping years.** `MAX_SCHEDULER_TARGET_YEARS` already truncates; if
widened entries make the receipt too large, that is a stop-and-report, not a silent narrowing.

STOP and report if the widened entry cannot be made backward-compatible for a reader on the old
shape, or if the two jobs' fault taxonomies do not actually unify.
</gate>

<completeness_contract>
- **A multi-year run with ONE failing year names that year and its reason.** The headline; assert it
  directly, with a run spanning at least three years so a single-year fixture cannot pass by accident.
- **Each of the FIVE upstream classes survives to the durable record**, asserted per class. A test
  that only exercises `timeout` proves one branch of five.
- **A year with ONE failed partition and one succeeding one records exactly that** — the mixed pair
  is the case a per-year class could not express, so it is the case that proves the ruling.
- **No secret reaches the store.** Positive control: feed a real error carrying a URL and a response
  body through the classifier and assert the durable value contains neither — and that the scan can
  see them if the classifier is removed.
- **A reader on the OLD receipt shape does not throw** on a widened entry. Assert it; a durable
  contract outlives one deploy.
- **Both jobs are covered at route level.** `AGENTS.md`: a second job shipped without route coverage
  is a scope violation, not a test gap. Named failure case is `PLATFORM-086F2H1B` v1.
- **The four single-unit jobs are byte-identical.** Prove by mutation.
- **Generate over the type's contract**, varying year count, which year fails, class, and absent
  optional fields.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutation proving the single-unit jobs
are untouched; the secret-scan positive control; and anything you deliberately did not do.

**Say what an operator would now see for the September 1 failure had this shipped** — that is the
item's acceptance test in one sentence, and a report that cannot answer it has not delivered.

**Report the receipt size delta.** You are widening a durable record written by every run of two
jobs; slice 3a's review found a planner record storing 479 windows nobody read. Measure it.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 126 status
recording that Tier A remains open, and `docs/operations/diagnostics.md` noting which of the four
layers this closed and which stay open.

Merge is delegated to this lane under `CLAUDE.md` → **Worktrees and session roles**, including the
four conditions. Promotion is not. **Push the branch only — not `preview`.**
</output_contract>
