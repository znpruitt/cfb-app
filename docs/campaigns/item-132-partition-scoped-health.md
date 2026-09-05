# Item 132 — partition-scoped dataset health

Status: Current
Last verified: 2026-09-05
Owner: Project documentation
Canonical for: the evidence behind Item 132 — what the defect is, what two attempts got wrong, and
what the next attempt must not re-derive.
Supersedes: (none)

Queue entry: `docs/next-tasks.md` → **Item 132**. That entry stays short; this file holds the
evidence.

---

## The defect, in one sentence

On `/admin` System Health, the **Scores** and **Game stats** rows report `No refresh history` while
those datasets are refreshing normally — and they cannot report a stall at all.

**Why.** Every other dataset records a refresh under a year scope (`schedule:year:2026`,
`rankings:year:2026`). These two record per week partition (`scores:week:2026:1:regular`), and the row
reads the canonical year scope. Verified in production 2026-09-05: `provider-refresh-status` held
`scores:week:2026:1:regular` and `game-stats:week:2026:1:regular`, and no year record for either.

**Two symptoms, one cause.** The row summary says "No refresh history" beside a freshness dot reading
"Current"; and because the dot is driven by cache presence — and scores stay cached through a total
polling outage — the row cannot go unhealthy no matter what happens to live scoring.

---

## Attempt 1 — a freshness model, reverted

A model answering "was a refresh due, and did it happen" from `provider-refresh-status` fields,
reviewed twice and reverted. **It kept discovering semantics of that record it had assumed.** These
are the reason it comes back as its own item rather than a patch:

1. **A no-op preserves `lastSuccessAt`.** `recordProviderRefreshNoop` "clears the latest error but
   preserves the prior-good success", and live-scores records a no-op on every poll that finds
   nothing to commit. Reading success therefore called every halftime, every scoreless stretch, and
   the minutes between arming and kickoff a stall.
2. **`in-progress` is the NORMAL state mid-poll.** Both cron routes call
   `beginProviderRefreshAttempt` before any provider work, so an admin page load landing inside a run
   sees it. `attemptFaultIssue` already handles this with `INTERRUPTED_ATTEMPT_AFTER_MS`.
3. **`automation-paused-or-disabled` means polling is OFF**, not that nothing was due. Treating it as
   "nothing due" made a paused dataset read green "Idle — no games in window" during a live slate.
4. **The model year and the receipt year derive differently and disagree for months.**
   `resolveOperationalSeasonYear` takes the max `status.year` of active leagues and preseason sets
   `year + 1`; the crons stamp `seasonYearForToday`, which returns `year − 1` from January to June. A
   guard comparing them would have shown "Attention needed" for roughly half of every year.
5. **`scores` DOES write a year rollup** — `scoresAggregateScope` on a covering manual aggregate
   (`/api/scores`, `/api/admin/cache-historical-scores`). "Never written" holds for `game-stats` only.
6. **Delivery grace is not a receipt-validity window.** `requiredStartedAt` is
   `previousSlot(now − graceMs)`, so a receipt stays on-time for grace PLUS one period — 9 minutes for
   live-scores, 45 for game-stats.

**The direction this implies.** `attemptFaultIssue` in `systemHealthIssues.ts` already interprets
these records correctly. The reverted model was a SECOND interpreter, rediscovering the first one's
knowledge one defect at a time. **Build on the issue layer, not beside it**: derive the row's state
from the issues already raised for the dataset, and add only the fact that layer genuinely lacks —
"a refresh was due and no activity followed".

---

## Attempt 2 — a display-only fix, also reverted

Scope reduced to routing the row's summary and details to the partition record. Five review rounds;
abandoned at `17f32dc7` on `platform/partition-scoped-health` (pushed, unmerged, kept for reference)
under a pre-agreed rule: any behavioural finding in the final pass meant folding it into this item.

**What it got wrong, so the next attempt does not:**

- **Compare SCOPE KEYS, never object identity.** A guard reading `summaryFact !== row.canonicalStatus`
  is always true, because the summary wraps the status in a fresh object. It rendered a verbatim
  duplicate of the summary line whenever the canonical record was also the latest activity.
- **Label every detail by the record it came from.** Printing `Canonical scope: scores:year:2026`
  above an error read from a week record sends an operator to repair a season over a week's fault.
- **Do not gate shared UI on a dataset predicate.** Making the "Latest activity" line conditional on
  partition-scoped datasets silently removed it from Schedule and Odds, whose targeted and filtered
  refreshes are exactly what lives there.
- **A consistency rule must be "at least as severe", not "downgrade if healthy".** A row already
  yellow from a diagnostic stayed yellow beneath a CRITICAL issue it caused.
- **Excluding `provider-status-invalid` from that rule must be narrow.** Unconditionally skipping it
  let a fully green row sit beneath a warning naming it — the same contradiction, reintroduced by the
  fix for a different finding.
- **A preserved `lastError` is not the current attempt's error.**
  `beginProviderRefreshAttempt` sets `in-progress` while intentionally keeping the prior error, so
  routing a partition status into the error block renders a historical failure beside "In progress",
  implying the running attempt has already failed. Gate error details on the explicit outcome, or
  label them as historical.
- **Switching the detail block to one record DROPS the other's forensics.** When a failed or partial
  `scores:year:<year>` aggregate is followed by newer week activity, the canonical
  `failedPartitions`, `durationMs`, `rowsCommitted`, last-success and attempt timestamps all
  disappear — while issue derivation still raises the aggregate fault independently, leaving the
  operator without the evidence to diagnose the thing being warned about. Whatever the next attempt
  does, both records' forensics must remain reachable.

**The test rule that cost two of the five rounds.** `canonicalOutcome(dataset, …)` derives its scope
from `canonicalScopeFor` — a YEAR scope. Building a "week partition" fixture through it produces two
statuses sharing one key, a snapshot `readProviderRefreshHealth` cannot emit, and it changes issue
severity (`providerAttemptIssues` passes the real cache state instead of `'unknown'`, turning a
warning into a critical). **Any fixture claiming to be partition activity must be built with
`weekPartitionScope`**, and the test should assert the two scope keys DIFFER.

---

## What "done" looks like

- The two rows stop reporting `No refresh history` while refreshing.
- They distinguish "no refresh was due" from "a refresh was due and did not happen", and never report
  healthy in the second case.
- With games in the kickoff window, the row stops reading healthy within one polling window of live
  scoring stopping — proven by suppressing the writer in a test, not by reasoning about thresholds.
- Outside the window, a multi-day gap raises nothing.
- A row never reads healthier than an issue naming that dataset.
- Fixed for the CLASS: `game-stats` reads null the same way, measured three minutes after a
  successful run.

**Do not** fix it by writing a synthetic year-scope record. That populates the row while still
answering the wrong question.
