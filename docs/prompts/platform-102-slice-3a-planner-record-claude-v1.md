PROMPT_ID: PLATFORM-102-SLICE-3A-PLANNER-RECORD-CLAUDE-v1
PURPOSE: Item 102 slice 3a — a durable record of what the planner derived and sent, and `inspect` diffing live QStash state against that recorded intent instead of a fixed constant. Additive and dormant; nothing writes a record in production.
SCOPE: a new durable store under `src/lib/server/`; `scripts/lib/qstashSchedule.ts` for the divergence check; tests for both. NOT `src/lib/server/schedulerDeliveryHealth.ts` — that is slice 3b. No route, no cron, no QStash call, no `QSTASH_TOKEN`, no component.

Read `AGENTS.md` first. Two rules there bind this slice unusually hard and are not restated: the
**allowlisted-projection / secret-handling** expectations, and **"an invariant over a space must be
tested over the space"** — the rule slice 2 earned.

## References — READ THESE BEFORE WRITING ANYTHING

**Canonical; they win over anything summarised below.**

- [`docs/next-tasks.md`](../next-tasks.md) → **Item 102**, the whole entry. Slice 3's definition, the
  four collisions, and the **reconstructibility** argument that this slice exists to satisfy. Read the
  collisions — slice 3a resolves collision 1 and is blocked from touching collision 2.
- `src/lib/server/providerUsageSeries.ts` — **the pattern to follow.** A durable append-only store
  with a fail-closed read path, built under PLATFORM-127. Its `readProviderUsageSeriesForWrite`
  (`:207`) is the shape this slice's read path should take, and the reason is in the file.
- `scripts/lib/qstashSchedule.ts` — `buildUpsertRequest` (`:176`) and the divergence check (`:336`).
- `src/lib/server/schedulerExecutionStatus.ts` — how `invocationId` is generated and ordered
  (`:42-52`), for the Item 126 Tier A correlation.
- `src/lib/schedule/pollingCron.ts` — what slice 2 shipped. `PollingCronPlan` and `SynthesizedCron`
  are the inputs a record describes.

## STOP — post a READ RECEIPT before writing any code

Report these, then **STOP and wait**. No branch, no code, no tests until the owner replies.

1. The `PROMPT_ID:` line of THIS document, verbatim.
2. **`buildUpsertRequest` carries two secrets.** Name both header keys and both values, and say which
   one QStash itself redacts and by what mechanism. Then say why that redaction does NOT make it safe
   to record the header block.
3. From `providerUsageSeries.ts`: quote the `readProviderUsageSeriesForWrite` body and say, in one
   line, what would happen on a WRITE path if it were tolerant instead of fail-closed.
4. Item 102 lists **four collisions**. Quote collision 1 verbatim and say which of the four this slice
   resolves, which one it is explicitly forbidden from touching, and why.
5. Anything in the references that CONTRADICTS or narrows the message you were handed. If nothing, say
   so explicitly — but note that the standing Item 102 entry describes slice 3 as covering more than
   this prompt scopes.

A receipt that summarises without quoting is not a receipt. If two references disagree, say so rather
than resolving it yourself.

## Branch

`claude/102-slice-3a-planner-record` from current `origin/main`, in `/Users/zach/cfb-app-claude`.
Never commit to `main`. A `pre-push` hook runs `npm run lint:all` and refuses a failing push; do not
bypass it. Codex is concurrently on `src/components/` — no overlap.

<task>
**Why this slice exists.** Item 102 makes the cron **planner-owned**, which destroys the property that
made it reconstructible: today `qstashSchedule.ts` holds the schedule contract as FIXED constants and
`inspect` diffs live QStash state against them, so it can say a cron is *correct*, not merely
*current*. Once the planner rewrites the cron daily, that check has nothing to diff against — and the
job that most needs a tampering signal becomes the one without one. This slice replaces the constant
with a record of intent.

1. **A durable record of every planner run**, holding: the input windows, the generated cron, the
   previous cron, whether an upsert was applied or skipped, the outcome, and the `invocationId` (Item
   126 Tier A correlation). **Durable, not a runtime log** — Vercel logs expire too fast to serve as
   incident history, and rebuilding that defect here is out of bounds.

2. **An allowlisted projection, and nothing else.** Record `cron`, `scheduleId`, `destination`,
   `method`, `retries` and the derived windows. **Never `headers`, never a raw request, never a
   response body.** `buildUpsertRequest` carries `Authorization: Bearer <QSTASH_TOKEN>` and
   `Upstash-Forward-Authorization: Bearer <CRON_SECRET>` — an allowlist is required because a
   denylist fails open the moment a header is added.

3. **`inspect` diffs against the last recorded intent** (`qstashSchedule.ts:336-348`), resolving
   **collision 1**. **With no record present it must fall back to the fixed constant**, so `inspect`
   keeps working today and for every job the planner does not own.

4. **A fail-closed read on the write path.** Follow `readProviderUsageSeriesForWrite`
   (`providerUsageSeries.ts:207`): a stored row that is present but wholly unusable must NOT be
   silently treated as absent, because that would overwrite the history the record exists to keep.
</task>

<gate>
**Do NOT touch `src/lib/server/schedulerDeliveryHealth.ts`.** Slice 3b owns the delivery-health
consumer — the non-extrapolating slot derivation, the two-cron row, corrupt-plan surfacing, and
threading the plan through options. All four are recorded on Item 102. Reading that file to
understand the record's eventual consumer is fine; changing it is out of scope.

**Do NOT apply an upsert, call QStash, or read `QSTASH_TOKEN`.** Records are written by tests only.
Making the cron planner-owned is slice 4.

**Do NOT log or persist a header block, a raw request, or a response body** — under any name, in any
projection, at any level. If the shape you want requires one, STOP and report; that is the finding,
not an obstacle.

STOP and report if `inspect` cannot fall back to the fixed constant without a behaviour change for
the seven jobs the planner does not own, or if the record cannot carry the previous cron without a
second read of live QStash state.
</gate>

<completeness_contract>
- **`inspect` is unchanged for every job the planner does not own.** Prove it by MUTATION — break the
  fallback and show a SPECIFIC named test going red, then restore. Seven jobs; assert them, do not
  assume.
- **A secret can never reach the record.** Assert on the projection with a **positive control**: feed
  a record builder a request whose headers contain both secret values and show the test detects them
  if the allowlist is removed. A test that merely checks the happy-path projection proves nothing
  about a future field.
- **The fail-closed read is mutation-proven.** Make it tolerant and show a named test go red.
- **Generate the record shapes rather than choosing them** (`AGENTS.md`). The space is the type's
  contract, not the shapes slice 2's defaults happen to produce — a generator seeded from
  `derivePollingWindows`' output tests the caller, not the record.
- Test count delta reported as a measured number.
</completeness_contract>

<verification>
Run each separately and report its own exit code — never chained behind `&&`, never behind a pipe:
`npx tsc --noEmit`, `npm test`, `npm run lint:all`.

`npm test` on clean `main` exits **1** with exactly two failures in
`src/app/api/odds/__tests__/writer-convergence.test.ts` — the standing **Item 137** baseline. Exactly
those two, or stop and report.
</verification>

<output_contract>
Report: what changed and where; the measured test delta; the mutations proving the `inspect` fallback,
the secret allowlist, and the fail-closed read; and anything you deliberately did not do.

**State plainly that nothing writes a record in production** — this ships dormant, like slice 2, and a
reader should not have to infer that.

Closeout is a separate pre-merge commit after review convergence: registry entry, Item 102 slice-3a
status, and what slice 3b inherits.

Push the branch and `preview` together — you own the feature branch. Do not open a PR; **merge is
delegated to this lane** under `CLAUDE.md` → **Worktrees and session roles**, including the four
conditions there. Promotion is not delegated.
</output_contract>
