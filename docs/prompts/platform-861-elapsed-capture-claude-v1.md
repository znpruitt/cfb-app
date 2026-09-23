# PLATFORM-861 — the budget decides on an elapsed time it measured before an await

```text
PROMPT_ID: PLATFORM-861-ELAPSED-CAPTURE-CLAUDE-v1
PURPOSE: schedule-presentation's per-year admission check reuses an `elapsedMs` captured BEFORE an
         awaited durable read, so under a degraded store it can under-count elapsed by up to 15s at
         exactly the moment it decides whether another year fits. Measure elapsed after the await.
SCOPE:   src/app/api/cron/schedule-presentation/route.ts — the admission check in the per-year loop —
         plus its tests. DO NOT change JOB_BUDGET_MS, YEAR_WORST_CASE_MS, VENUE_LEG_WORST_CASE_MS,
         the reservation's composition, the first-year exemption, the ordering of years, or any
         docblock claim that is still true.
CARRIES: NONE from the Item 87 campaign index, having checked — this is a scheduled job's budget
         arithmetic, not a presentation surface.

         Three standing obligations bind, from AGENTS.md:
         - A claim in a comment needs a test asserting the same behaviour.
         - Every claim needs a mutation that reddens its OWN named assertion, and you say which
           assertion fired.
         - ONE remediation round. This is a one-line fix on a branch whose predecessor took five
           rounds without asking; if it grows past one round, stop and report rather than continue.
```

---

## The defect

`src/app/api/cron/schedule-presentation/route.ts`, inside the per-year loop at `:414`:

| line | what happens |
| --- | --- |
| `:421` | `const elapsedMs = Date.now() - startedAtMs` |
| `:433` | cheap pre-check uses `elapsedMs` — correct, nothing has awaited yet |
| `:434` | **`await venueRefreshDue()`** — a durable store read, bounded at 15s under contention |
| `:438` | admission check `elapsedMs + reservationMs > JOB_BUDGET_MS` — **reuses the stale value** |

Worked case: `elapsedMs` at 8s with the venue leg owed gives `8 + 242 = 250`, which admits. The year
actually starts at ~23s and ends near 265s against a 250s promise.

**The error does not compound across years.** `:421` is inside the loop, so each iteration re-reads
the clock and picks up all prior elapsed time, including earlier `venueRefreshDue()` reads. The
under-count is one bounded read per admission decision: at most 15s, once.

**Attribution: the 757a lane's own round-4 fix**, self-reported. Reachability needs a degraded store
AND an owed venue leg AND multi-year selection. No traced case breaches the 300s ceiling.

---

## THE TRAP — the adjacent fix was tried on this code and REVERTED

**Do not fold a store-latency term into the reservation.** It was implemented during 757a round 4 and
backed out, and the reversal is recorded in
`docs/campaigns/platform-757a-presentation-job-closeout.md:477-497` and in the `JOB_BUDGET_MS`
docblock at `:140-165`.

Why it fails: `YEAR_WORST_CASE_MS` and `VENUE_LEG_WORST_CASE_MS` are each `3 × 40s + 1s`, so a year
owing both reserves **242s** against a **250s** budget. Add a 45s store allowance and the reservation
becomes **287s — larger than the whole budget — so no second year can ever be admitted at any elapsed
time.** That is precisely the starvation 757a shipped in round 1 and fixed in round 2. **Two existing
tests failed the moment it went in.** They will fail for you too.

**The arithmetic genuinely does not close**, and that is settled, not open: a year owing both legs
plus any meaningful store term cannot be guaranteed under a 300s ceiling at any budget. The budget
governs CFBD time, the store waits stay bounded by #625's per-operation limits, and the residual is
**documented rather than reserved for**. Do not reopen that.

## Why re-measuring is safe where inflating is not

State this in your report, because it is the whole reason this fix is different from the reverted one:

- **The reservation is unchanged.** The largest reservation the job can produce is still 242s, still
  admissible under a 250s budget. The condition that caused starvation — a reservation exceeding the
  budget — cannot arise.
- **It changes the measurement, not the promise.** A fresh read can only make `elapsedMs` larger, and
  larger means a year that genuinely does not fit is skipped instead of admitted. That is the
  intended behaviour, not a regression.
- **The first year is unaffected either way.** It is ungoverned — `governed` is false while
  `exec.years.length === 0` (`:422`) — so it always runs. Starvation was only ever about later years.
- **With a healthy store the re-read changes nothing**, because the await returns in milliseconds.

## Shape

The value used at `:438` must be measured **after** the await at `:434`. The cheap pre-check at `:433`
must keep using a value measured before it — that check exists so a run which cannot afford a year
under ANY answer does not spend a bounded read discovering which answer it would have got. Preserve
that ordering; it was itself a review finding (round 4, finding 2).

## Acceptance

1. **The admission check decides on an elapsed time measured after `venueRefreshDue()` resolves**,
   proven by a test with a slow-resolving venue read that admits a year today and skips it after the
   fix. The test must fail against current `main`.
2. **The cheap pre-check still runs before the durable read**, so a year that cannot fit under any
   answer costs no store round trip. Pinned by a test asserting the read is not attempted.
3. **The first year still always runs**, including with a slow store and an owed venue leg. This is
   the starvation guard; pin it explicitly.
4. **No constant and no reservation composition changes.** `JOB_BUDGET_MS`, `YEAR_WORST_CASE_MS` and
   `VENUE_LEG_WORST_CASE_MS` are untouched, pinned.
5. **The two tests that caught the reverted fix still pass unchanged.** Locate them as receipt item 2
   and name them in the report — they are the regression net for this whole area.
6. **`docs/deployment-runbook.md` §8i's install gate is removed or amended**, since it names #861 as
   the reason not to run the upsert. Say what it should now read; do not leave a gate pointing at a
   closed issue. **Removing the gate is the only step here with production consequence — it is the
   owner's call, so propose the wording and stop, rather than deciding it.**

## Testing requirements

**Every claim needs a mutation that reddens its OWN named assertion, and you must say which assertion
fired.**

**Acceptance 1 is the likely false green.** With a fast store, before and after behave identically —
that is the whole point of the fix. A fixture whose venue read resolves immediately proves nothing.
The read must be made slow enough to cross the admission boundary, and you should state the timing the
fixture uses and why it crosses it.

**Beware `mock.timers`.** The 757a lane recorded a case where `mock.timers` starting `Date` at 0 made
both sides of a mutation stay green. If you use fake timers, prove the assertion can fail.

---

## STOP — read receipt before writing any code

1. **Every read of `elapsedMs` in this file**, and for each whether it must be measured before or
   after the durable read, with the reason.
2. **The two tests that failed when the store term was folded into the reservation.** Name them. They
   are your regression net and acceptance 5 depends on locating them.
3. **Is `venueRefreshDue()` the only await between `:421` and `:438`?** If there is another, the
   under-count is larger than this prompt states — say so.
4. **What is the largest reservation the job can produce, and what is the budget?** Give both numbers
   from the constants, not from this prompt, and say whether the first is admissible under the second.
5. **What does §8i currently say, verbatim, about not running the upsert?** Quote it, and propose the
   replacement wording without applying it.
6. **What in this prompt contradicts what you found in the files?**

Do not start until the receipt is answered and it has been ruled on.
