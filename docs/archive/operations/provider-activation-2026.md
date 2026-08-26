# 2026 Production Activation Record

Status: Archived
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: historical evidence from the 2026 production-promotion and provider-automation activations
Supersedes: historical procedure/evidence formerly embedded in `docs/deployment-runbook.md`

This file preserves evidence from completed production activations. It is not an operator checklist.
Do not replay an activation merely because it appears here. Current procedures, emergency controls,
and schedule contracts live in [`../../deployment-runbook.md`](../../deployment-runbook.md).

## Promotion isolation and deployment evidence

Manual production promotion was established on 2026-08-17 by disabling Vercel's automatic
assignment of custom production domains. Merges to `main` continued to create production builds,
but `turfwar.games` remained on the last explicitly promoted deployment.

The binding was measured on 2026-08-18. Commit `43f0eed6` was promoted while the newer production
build for `6bf38538` remained unpromoted. The 04:00 UTC `live-scores` receipt reported
`Built from: 43f0eed6`, showing that the scheduled request reached the promoted deployment. The
first production receipt carrying the instrumentation reported the full promoted SHA
`43f0eed6be1f4432a40c7cbac404f364b5b9326a`; the preceding 03:51 receipt correctly had no build SHA
because it was written by code predating the field.

Custom-domain assignment was independently checked through `vercel alias ls` and
`vercel inspect turfwar.games`. Inspecting a deployment directly was found insufficient because its
Aliases block omitted the custom domain.

The docs-only build gate was verified against real commits: docs-only commits `de58cc27` and
`ebcef626` skipped their builds, while code commit `873fa2da`, merge commit `8585d844`, and empty
commit `43f0eed6` built. A skipped build still created a canceled deployment record. The account
recorded 42 deployments in the 24-hour period measured on 2026-08-17.

The long-lived `preview` Git branch was also confirmed to use its own reused Neon child branch. It
held scheduler receipts roughly three days behind production and had consumed 0.8 CU-hours, while
short-lived feature branches had consumed about 0.02 CU-hours. That observation established why
preview System Health cannot be treated as production-health evidence.

## Team catalog correction

Performed and verified on 2026-07-24; production behavior reverified on 2026-08-26.

- The production team catalog had 138 items and `updatedAt: 2026-07-24T05:50:09.813Z`.
- `San Diego` resolved to the distinct `sandiego` entry (unknown/not ownable), while `SDSU`
  resolved to `sandiegostate`, `San Jose` to `sanjosestate`, and `New Mexico` to `newmexico`.
- The H3E parity audit was rerun: 2021, 2023, 2024, and 2025 matched exactly. The sole accepted 2022
  exception was game `401506450`.
- The historical repair forced a team database resync, then verified `/api/teams`, resolver
  diagnostics, and the parity audit.

An interim 2026-08-26 statement that this correction was unverified was itself incorrect: the
prompt registry already recorded the completed 2026-07-24 verification.

## Schedule correction

Performed on 2026-07-24 and reverified on 2026-08-26. The durable rows may reflect the later §8d
full-year refresh from 2026-07-26.

- In 2024, non-FBS postseason games `401729786`, `401738295`, `401738307`, and `401729787` retained
  distinct `postseason-*` identities and none used `cfp-*`. CFP semifinals were `401677189` and
  `401677191`; the championship was `401677192`.
- In 2025, non-FBS postseason games `401840097`, `401833989`, `401840096`, and `401833990` retained
  their identities. CFP semifinals were `401769075` and `401769074`; the championship was
  `401769076`.
- The historical repair forced complete 2024 and 2025 regular-plus-postseason refreshes and then
  verified identities, refresh status, cache contents, and parity.

Earlier speculation that these results could have been only a §8d side effect was incorrect; the
registry records the independent §8c sequence on 2026-07-24.

## Schedule identity and archive backfills

Performed and verified on 2026-07-26.

- Full-year schedules for 2021–2025 were refreshed with positive participant IDs and no duplicate
  canonical identities.
- Game `401673469` was confirmed as the genuine Texas-home/Georgia-away SEC Championship.
- Game `401729753` was confirmed as UC Davis–Illinois State, a non-FBS game not eligible for the
  activation target.
- Participant and parity audits reported no unavailable or mismatched rows apart from accepted game
  `401506450`.
- All five season archives were rebuilt with valid paired `gameStatSlate` data.

## Game-stats automation

Activated on 2026-07-26 from reviewed code commit `a161e33`, Vercel deployment
`dpl_73jnt1KDqaAE5dRT9BJ5uLRfpLEt`.

- Writer control advanced `legacy -> armed -> active`; the production rule is never to return to
  `legacy`. The emergency safe transition is `active -> read-only-safe`.
- The controlled 2025 week 16 regular-season target returned `written-clean`, with one durable game
  and five committed observations.
- CFBD quota moved from 4921 to 4920, matching one provider call.
- QStash schedule `turfwar-game-stats-15m` was provisioned active and unpaused, with retries 0 and
  provider-side Authorization redaction.
- A gates-closed scheduled delivery authenticated successfully, returned HTTP 200 without a
  provider attempt, and left quota at 4920. The gates were then opened dataset first and global
  pause last.

## Live-score automation

Activated on 2026-07-28.

- QStash schedule `turfwar-live-scores-3m` was provisioned for `*/3 * * * *`, GET
  `/api/cron/live-scores`, retries 0, and provider-side Authorization redaction.
- Gates-closed and gates-open provider-free deliveries proved route authentication and policy
  evaluation without quota spend; the recorded quota baseline remained 4914.
- Visible current-season browser tabs began cache-only score reads on the same three-minute cadence
  for the bounded kickoff window. Those browser reads do not call CFBD.

## Odds automation

Activated in production after the live-score sequence.

- QStash schedule `turfwar-odds-hourly` was provisioned hourly with retries 0 and provider-side
  Authorization redaction.
- The shared provider authority and both automation gates were verified before opening.
- Most scheduled deliveries were expected to remain provider-free. An `early-lines-withdrawn`
  result outside the odds expectation horizon was accepted as a truthful no-op.

## Weekly schedule maintenance

Activated on 2026-07-29.

- QStash schedule `turfwar-schedule-weekly` was provisioned for Tuesdays at 12:00 UTC
  (`0 12 * * 2`), retries 0, with provider-side Authorization redaction.
- Provider-free closed- and open-gate deliveries verified authentication. The 2026 year was owned
  by season transition at activation, so both returned the truthful `season-transition-owner`
  deferral without provider calls.
- Final state was Schedule automation On and global pause Off.

The activation established this ownership classifier:

```text
Preseason, schedule/probe not armed        -> daily season-transition discovery
Preseason, first game known and >7d away   -> weekly preseason maintenance
Preseason, within 7d of first kickoff      -> daily transition freshness/lifecycle
Active season                              -> weekly ordinary maintenance
Postseason boundary                        -> sticky lifecycle-critical maintenance
```

Ordinary maintenance honors the Schedule toggle and global pause. Postseason-boundary maintenance
is lifecycle-critical and bypasses those application settings, so pausing the QStash schedule is
the authoritative weekly stop in that window.

## Schedule-presentation observation

This remains an open observation rather than a completed activation. No schedule, toggle, or other
resource must be provisioned.

The manual seed completed on 2026-07-30 at 02:37 UTC: media committed `written-clean` with 456 rows,
venues committed `written-clean` with 844 rows, the aggregate resolved `success`, and terminal CFBD
quota was 4899. A provider-free weekly skip should emit no presentation-refresh event. The first
qualifying canonical automatic success should emit a separate `schedule-presentation-refresh`
event. While the venue catalog is under 30 days old, `fresh-cache` with no `/venues` request is the
expected venue result.

The live checkpoint and closeout instructions remain in deployment-runbook §8i.

## Rankings publication

Activated on 2026-07-30.

- QStash schedule `turfwar-rankings-publication` was provisioned for 04:00 and 22:00 UTC
  (`0 4,22 * * *`), retries 0, with provider-side Authorization redaction.
- Gates-closed QStash message
  `msg_7YoJxFpwkEy4DbXxFQZ91MK8xiB1wPdpTVwXqzbabbkFQqCevikHu` returned HTTP 200,
  `automation-paused-or-disabled`, with no quota check or provider work.
- The open-gate proof returned HTTP 200, `not-a-heartbeat-slot`, with no quota check, provider call,
  rows, or data changes.
- Final state was Rankings automation On, global pause Off, and the schedule active/unpaused.

QStash's at-least-once delivery is bounded by durable publication windows, claims, leases, and
observation ordering. A delayed delivery that misses an exact publication slot skips truthfully;
persistent delay skips indicate a delivery-latency problem rather than an instruction to add
retries.
