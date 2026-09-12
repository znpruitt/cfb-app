PROMPT_ID: PLATFORM-732-HELD-PLANNER-RUN-TRACE-CLAUDE-v1
PURPOSE: Give a HELD polling-planner run a durable trace, so "has a settings-unreadable hold ever
happened in production?" is answerable rather than unanswerable. Observability only — no change to
planning, cron synthesis, or what the planner applies.
SCOPE: `src/lib/server/pollingPlannerRecord.ts`, `src/app/api/cron/polling-planner/route.ts`,
`src/lib/server/schedulerDeliveryHealth.ts` only if the chosen shape reaches it, and their suites.
NOT `pollingWindows.ts`, NOT `pollingCron.ts`, NOT cadence, NOT #733's repair-link defect.
CARRIES: NONE — checked. Item 732 is not an Item 87 item, so `docs/campaigns/item-87-INDEX.md` has
no row for it, and `docs/campaigns/vercel-active-cpu.md` carries no CARRY block. Read that campaign
document anyway before starting: it owns the planner's design and its standing instruction is
*"Before changing what enters or leaves the schedule row set, re-run both greps."*

Issue: [#732](https://github.com/znpruitt/cfb-app/issues/732), filed out of your own #619 work.

---

## CORRECTION TO THE RECOMMENDATION THAT QUEUED THIS — read before sizing it

I recommended this item on the grounds that planner history was rotating away. **That was wrong.**
`POLLING_PLANNER_MAX_RUNS = 400` (`pollingPlannerRecord.ts:64`) against one write per job per day —
roughly 400 days. Production holds 7 runs because the planner **has only run 7 times** since it
activated on 2026-09-07, not because anything aged out. Nothing is being lost to retention, and there
is no deadline here.

**The real gap is narrower and does not decay: a held run is never written at all.** #619 made the
state distinguishable *when it occurs*; this makes it findable *afterwards*. Size the work against
that, not against urgency I invented.

## The three obstacles, verified at `dc728519`

1. **`sortAndBound` rebuilds the series as `{ runs, droppedRuns }`** (`:597-602`). A field added to
   the series object anywhere else is dropped by the next write, silently.
2. **A held run has no `slow`, and the schema says `slow` is not optional** (`:154-155`):
   *"The slow schedule. Always present — no cron expression can mean 'never'."* So a held-run record
   is **not** a superset of `PollingPlannerRun`. That comment is a real invariant, not incidental —
   do not weaken it to `slow: PlannerScheduleRun | null` without pricing what reads it.
3. **`readPollingPlannerRunsForWrite` refuses a present-but-unparseable value** (`:641`):
   `if (raw.length > 0 && parsed.runs.length === 0) return { ok: false }`. A held-run variant that
   `parsePollingPlannerRuns` rejects is dropped on read — so it never persists — and if the series
   ever contained only such rows, **every subsequent write is refused and the planner stops recording
   entirely.** Worse than the gap being closed, exactly as you filed it.

## The consumer, which the issue does not mention, and which should decide the shape

**`schedulerDeliveryHealth.ts` is the only reader of this series, and it is not a log viewer.**
`scheduleTimeline` (`:764-795`) walks the runs pairwise to build a piecewise account of which cron was
in force when, cross-checking each span against the FOLLOWING run's `previousCron`. A run with no
`dense`/`slow` degrades it in three places:

- as the oldest run, `firstSchedule` is null → the pre-history span becomes
  `{ kind: 'unknown', reason: 'plan-incomplete' }`;
- as the *next* run, `nextSchedule` is null → the span BEFORE it loses its cross-check;
- as the current run, `installedState(run, kind)` has no schedule to report.

**So inserting held rows into the same array converts confident timeline spans into `unknown` on a
live health surface.** That is a regression in the thing Item 102 slice 3b was built to make truthful.

**This points at a separate series rather than a variant row**, and I am not ruling it — the receipt
decides. But whichever you choose, the falsifiable requirement is the same: **a held run is durably
recorded AND `scheduleTimeline` produces byte-identical segments to what it produces today for the
same applied runs.** A test that proves the second half is the one that matters.

---

## RULINGS ON THE READ RECEIPT — 2026-09-12, binding

**Shape C accepted: a separate series, key `held:<job>`, inside `pollingPlannerRecord.ts`.** Your
argument is the right one and it is stronger than the test I asked for — byte-identical timeline
segments hold **by construction** because the applied series' input is bit-for-bit unchanged, so the
boundary test documents the guarantee instead of being the only thing defending it. Same-module
placement accepted for the reason you gave: the held parser needs `POLLING_PLANNER_FUTURE_SKEW_MS`,
the exact-midnight `dayStartMs` rule and the `at` normalization verbatim, and a second module that
re-implements them is the trap `:172-176` already names.

**A is rejected on your finding, not mine.** `pollingPlannerApply.ts:69-85` says in terms that closing
the dead-day case *"needs `slow` to become nullable in slice 3a's store."* It wants nullable `slow` to
mean **paused / not expected to fire**; a held job's slow schedule is **armed and firing**. One
encoding, two opposite meanings, and the collision lands the day that follow-up ships. Verified.

**B is rejected on the rollback path.** Build N+1 writes a held row, a rollback to build N rejects it,
and if the key holds only such rows `readPollingPlannerRunsForWrite:641` refuses every subsequent
write — permanently, with no bug, by deploy alone. That it also takes the operator's repair path down
with it (Q2) makes it worse than the gap.

**Q5's route-throw is the real hazard under C, and your framing is correct.** The held write sits on
the `continue` branch inside the `for` at `route.ts:387`; a throw there escapes to the outer catch and
**the job that was NOT held loses its whole day**. Build all four tests. Test 1's mutation control —
delete the try/catch and it must go red — is the one that matters; the others can pass vacuously
without it.

**Q7 accepted as a shaping constraint, not scope.** Make the held row's `reason` a **string**, not a
boolean, so the `read.kind !== 'usable'` day (`:351-358`, returns before the loop) can be added later
without a second durable-schema change. Do not add that day here.

**Reuse the receipt's vocabulary and `invocationId`** per your Q1 — `plan-held` / `settings-unavailable`
and the same id, so the two correlate. That is free Item 126 Tier A correlation on this surface.

**Three corrections to this prompt, all yours:**
`schedulerDeliveryHealth.ts` is **not** the only reader — `scripts/lib/plannerIntentReader.ts` reads
the raw row by SQL over the read-only rail and refuses on `{ok:false}`, so the operator's `inspect`
and `upsert --apply` go down at the same instant the record does. I warned the grep might
under-report and it did, which is the third time this week I enumerated from the wrong layer.
Production holds **8 runs per key across two keys**, not 7 — mine was correct when measured and a
planning day passed. And **"never written at all" is true of the planner record, not of the system**:
the receipt carries `reason` and `jobsHeld`, latest-only. The gap is HISTORY, not trace.

**The orphaned follow-up is filed as #746** — nullable `slow` for the dead-day case, which existed
only in a code comment. Not yours; do not fold it in.

Proceed to implementation.

## STOP — read receipt before writing any code

1. Quote the exact point in `route.ts` where a held run is decided and show what it returns. Does the
   route today reach the record writer at all on that path, or return before it?
2. Enumerate every reader of `POLLING_PLANNER_RECORD_SCOPE` and of `PollingPlannerRunSeries`. I claim
   exactly one (`schedulerDeliveryHealth.ts`). A grep of the type name alone under-reports if anything
   reads the raw store value — check that too.
3. For each of the three candidate shapes — nullable `slow`, a discriminated union in `runs[]`, a
   separate series/key — state what `scheduleTimeline` does with it and whether `sortAndBound`,
   `parsePollingPlannerRuns` and `readPollingPlannerRunsForWrite` need changes. Recommend one.
4. If a held run goes in a separate series, what answers "what happened on day X" — does anything
   have to merge the two, and does that merge have the same refusal hazard as obstacle 3?
5. **What would make the planner stop recording entirely?** Name the shortest path from your proposed
   change to that outcome, and the test that proves it cannot happen.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and I have ruled on it.
