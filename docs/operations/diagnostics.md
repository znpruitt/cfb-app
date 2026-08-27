# Diagnostics & Debugging

Status: Current
Last verified: 2026-08-27
Owner: Project documentation
Canonical for: diagnostic surfaces, debug auth, structured observability, and upstream-first debugging order
Supersedes: the PLATFORM-086 per-slice implementation narrative formerly maintained in this file

When a surface looks wrong, diagnose upstream-first. Current data flow is documented in
[`../architecture/game-data-flow.md`](../architecture/game-data-flow.md); operator repair procedures
live in [`../deployment-runbook.md`](../deployment-runbook.md).

## Debugging order

```text
1. authorized provider response or durable cache
2. provider normalization
3. schedule-derived canonical AppGame identity
4. score / odds / ownership / evidence attachment
5. selector output
6. UI presentation
```

A wrong score or owner on screen is usually an attachment or identity problem, not a rendering
problem. Preserve the same year, provider week, season type, canonical week, and request-time
`currentDate` while moving through the layers.

## Access and side effects

- `/admin` and `/debug` pages require a signed-in Clerk `platform_admin` through middleware.
- `/api/admin/*` and `/api/debug/*` use `requireAdminAuth`, so approved machine callers may use the
  transitional `ADMIN_API_TOKEN` fallback.
- `/api/cron/*` uses `CRON_SECRET`, not admin auth.
- Debug APIs are not automatically read-only. The scores and attachment diagnostics deliberately
  exercise authorized refresh paths; cold shared context can also refresh schedule or conference
  data. Use Data Maintenance & Recovery for deliberate repair, and check the implementation before
  treating any diagnostic GET as quota-free.

See [`../architecture/auth-and-privacy.md`](../architecture/auth-and-privacy.md) for the complete
boundary.

## Diagnostic surface inventory

| Surface                                                                   | Purpose                                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/admin/diagnostics`                                                      | System Health: scheduler delivery/execution, provider/cache health, automation gates, quota, storage, and prioritized issues. |
| `/admin/data/cache`                                                       | Provider refresh, historical repair, rebuild, and emergency recovery actions with cost/mutation disclosure.                   |
| `/debug/teams`                                                            | Interactive team-identity inspection.                                                                                         |
| `/api/debug/schedule` / `schedule-eligibility`                            | Canonical schedule build and eligibility diagnostics.                                                                         |
| `/api/debug/scores` / `scores-attachment` / `postseason-score-attachment` | Authorized score fetch and attachment traces; potentially provider-spending and cache-mutating.                               |
| `/api/debug/resolve-team` / `conference-diagnostics`                      | Team and conference identity diagnostics.                                                                                     |
| `/api/debug/archive-audit` / `archive-integrity`                          | Archive comparison and integrity checks.                                                                                      |
| `/api/debug/insights-career-diagnostic` / `insights/[slug]/suppression`   | Insights career-input and legacy suppression diagnostics.                                                                     |

## What to inspect by layer

- **Schedule/identity:** inspect `providerGameId`, `providerWeek`, `canonicalWeek`, `seasonType`,
  `canHome`, and `canAway`. Postseason canonical week is
  `maxRegularSeasonWeek + providerWeek`. Repair aliases through the centralized identity authority;
  do not patch provider labels downstream.
- **Scores:** attachment precedence is provider id, direct/reversed pair plus week, then pair plus
  date within the bounded window. Confirm orientation and terminal status. All season-level score
  readers reconcile aggregate and per-week durable keys through the shared cache reader.
- **Odds:** attachment is one-to-one by canonical pair within the kickoff window. `date_mismatch`,
  `unmatched_pair`, and `ambiguous_pair` mean the adapter refused to guess; a game with no offered
  line is not itself a provider failure.
- **Ownership:** current-season attribution must pass through `gameOwnership.ts`; raw provider-label
  equality is not authority.
- **Game stats:** evidence attaches by numeric provider game id, exact partition, and participant
  validation. Cache-key presence or a nonempty raw row list does not establish coverage.
- **Selectors/UI:** only inspect these after upstream identity and attachment are correct. A stale
  derived view is often an invalidation problem; do not reproduce selector logic in a component.

## System Health

`/admin/diagnostics` builds one server-side view model for the operational season resolved from
production leagues. There is no `?year=` browser selector and no client polling. Refreshing the page
rebuilds the model.

The model keeps independent facts separate:

| Fact                  | Meaning                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Scheduler delivery    | Whether the latest authenticated invocation arrived for the expected fixed slot.                                |
| Scheduler execution   | The result/reason recorded by that invocation. A timely failure and a late success are different faults.        |
| Provider refresh      | The explicit attempt/outcome for the dataset's canonical target scope.                                          |
| Canonical data health | Durable cache content, freshness, terminal-score coverage, or participant-verified evidence coverage.           |
| Automation            | Global pause plus enabled state for the five setting-consuming datasets.                                        |
| Quota                 | One cached CFBD usage observation and the durable Odds usage snapshot, evaluated against the relevant reserves. |
| Storage               | Configuration/availability facts, never a claim inferred only from the configured mode.                         |

The build writes nothing. All data-health inputs are durable/cache reads; the one deliberate provider
contact is the CFBD `/info` usage observation through its ordinary 10-minute cache. Each loader is
bounded and isolated, so one timeout or read failure marks that fact unavailable without erasing the
other sections.

System Health's only mutations are the global automation pause and dataset enable controls for game
stats, scores, Odds, ordinary schedule maintenance, and rankings. Conferences are manual-only.
Lifecycle-critical season transition, season rollover, and postseason-boundary schedule work are
not disabled by these noncritical settings. All provider refresh and repair actions live on Data
Maintenance & Recovery.

## Reading provider-data health

Each provider row separates canonical status, latest narrower activity, cache availability,
freshness, and diagnostics. A targeted week/partition or filtered Odds refresh never masquerades as
success for a year-wide/canonical card. Legacy unscoped status remains deep-diagnostic data only.

Important coverage rules:

- **Scores:** coverage is game-granular inside completed provider slates. Every expected canonical
  game must have its own attached terminal evidence: canceled games resolve scorelessly, while a
  final requires both numeric scores. An in-progress numeric row—or a terminal sibling in the same
  slate—cannot cover the game. System Health includes at most six bounded game identities plus the
  complete affected count and routes recovery to Data Maintenance. A separate
  `scores-elapsed-time-conclusions` warning identifies unresolved canonical games accepted through
  the eight-hour all-pending allowance; this check does not wait for the completed-slate threshold.
- **Game stats:** `evaluatePartitionCoverage` is authoritative. Only stat-producing canonical games
  are expected; disrupted games are excluded. Empty/all-dropped/mismatched rows do not count.
- **Schedule:** a missing current schedule, incomplete refresh, rejected replacement, or active-season
  staleness is visible. Partition uncertainty retains prior-good data.
- **Rankings:** coverage requires at least one usable week; raw record presence is insufficient.
- **Odds:** freshness comes from the selected season's canonical/default Odds cache, never a filtered
  variant or the quota-observation timestamp. Missing lines remain “not offered,” not an error.
- **Conferences:** the bundled snapshot is a fallback floor; the dataset has no automatic job.

A provider-refresh failure never advances `lastSuccessAt`. A valid empty/inapplicable result is an
explicit no-op and also does not advance success. Status metadata is observability, never canonical
data.

## Scheduler receipts and runtime logs

Seven jobs emit one allowlisted runtime JSON event per invocation, including authentication failures
and controlled skips:

| Job                  | Event                    | Scheduler   |
| -------------------- | ------------------------ | ----------- |
| Live scores          | `live-scores-cron`       | QStash      |
| Game stats           | `game-stats-cron`        | QStash      |
| Odds                 | `odds-cron`              | QStash      |
| Schedule maintenance | `schedule-refresh-cron`  | QStash      |
| Rankings             | `rankings-cron`          | QStash      |
| Season transition    | `season-transition-cron` | Vercel Cron |
| Season rollover      | `season-rollover-cron`   | Vercel Cron |

Runtime events are best-effort, single-line, secret-safe Vercel Runtime Log records. They contain a
closed result/reason, bounded target/counts, whether provider work was attempted, and duration; they
never copy a request, response, provider payload, environment value, URL, header, credential, or
thrown message.

After successful cron authentication, each job also writes one latest-only durable receipt at
`scheduler-execution-status/<job>`. The receipt proves an authenticated delivery reached and
completed in the app; it does not prove provider success. Authentication failures appear only in
runtime/request logs and never advance a receipt. Receipt writes are post-response and best-effort,
so a missing receipt can mean delivery failure, non-provisioning, or receipt-storage failure. Read
the full receipt contract in
[`../architecture/admin-control-plane.md`](../architecture/admin-control-plane.md#scheduler-receipt-contract).

Schedule presentation enrichment separately emits `schedule-presentation-refresh` from its shared
authority. That event reports the bounded media/venue cache operation and remains distinct from the
weekly schedule job's top-level receipt and provider-refresh status.

## Vanished CFBD schedule records

After a confirmed `written-clean` full-season schedule commit, the app emits
`schedule-games-vanished` when a positive numeric CFBD game id existed in the prior snapshot but is
absent from the new snapshot. This is a provider-record disappearance signal, not proof of
cancellation. CFBD commonly deletes the old record and publishes a new id for a postponement or
reschedule.

Same-id rewrites—including kickoff, teams, and venue—are deliberately silent. Synthetic/id-less
rows never establish numeric identity. Prior duplicates are deduplicated. Malformed rows are skipped
individually, strings are trimmed and capped at 160 characters, details are capped at 25 games, and
`vanishedGameCount` retains the complete count with `truncated: true` when necessary.

The event contains only:

```json
{
  "event": "schedule-games-vanished",
  "year": 2026,
  "observedAt": "2026-08-26T12:00:00.000Z",
  "vanishedGameCount": 1,
  "vanishedGames": [
    {
      "providerGameId": 401234567,
      "week": 2,
      "seasonType": "regular",
      "startDate": "2026-09-05T23:30:00.000Z",
      "homeTeam": "Example State",
      "awayTeam": "Example Tech"
    }
  ],
  "truncated": false
}
```

Emission happens after the durable commit and process-cache publication. Unchanged, stale, empty,
rejected, incomplete-provider, and store-failure outcomes emit nothing. On a first aggregate
publication, regular/postseason partition snapshots may supply the prior ids. The event does not
currently encode that baseline source; the evidence-gated follow-up is maintained only in
[`../next-tasks.md`](../next-tasks.md#item-79--vanished-schedule-observability-follow-ups-are-evidence-gated).
Logging is runtime-only and cannot fail or roll back the schedule commit.

## Guardrails

- Do not spend provider quota from public paths to test a cache; public reads intentionally do not
  cold-fetch.
- Do not add team/ownership matching outside `teamIdentity.ts` and `gameOwnership.ts` to work around
  a miss.
- Do not recompute standings or Insights state in a component; trace selector inputs and cache
  invalidation.
- Do not treat status timestamps, scheduler receipts, or key presence as canonical data coverage.
- Do not infer a cancellation from `schedule-games-vanished`; confirm the replacement schedule
  record and provider context.
