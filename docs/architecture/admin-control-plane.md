# Admin Control Plane

Status: Current
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: current admin information architecture, route/action ownership, and scheduler-health receipt contract
Supersedes: the completed PLATFORM-086F2 migration plan, archived at `docs/archive/operations/admin-control-plane-f2-2026.md`

This document describes the admin surface that exists now. Binding architecture and lifecycle
invariants live in [`AGENTS.md`](../../AGENTS.md); authentication rules live in
[`auth-and-privacy.md`](auth-and-privacy.md); operator procedures live in
[`../deployment-runbook.md`](../deployment-runbook.md); current deferrals live only in
[`../next-tasks.md`](../next-tasks.md).

## Access boundary

Every `/admin` page and admin API is restricted to Clerk users whose
`publicMetadata.role === 'platform_admin'`, with the documented token fallback where applicable.
“Commissioner Tools” is an information-architecture label for league-scoped work, not an enforced
commissioner role. Commissioner and member self-service remain future product work.

## Locked decisions

1. **Admin URLs remain stable.** Reorganization changes ownership and presentation, not routes.
2. **Every admin surface remains platform-admin-only.** No route infers authority from the
   “Commissioner Tools” label.
3. **The lifecycle cron is the sole season-rollover executor.** There is no admin rollover route,
   page, force action, or manual archive-preview workflow.
4. **Scheduler delivery and provider refresh are separate facts.** A scheduler receipt proves an
   authenticated job reached and completed in the app; provider-refresh status describes the
   attempted data target and durable outcome. Neither is inferred from the other.
5. **Draft ordering is neutral.** SP+ ratings and betting win totals are not draft recommendation
   inputs. Available teams use a deterministic alphabetical order with a stable canonical-id
   tie-break; neutral factual context may still be shown.

## Information architecture

| Group | Surface | Responsibility |
| --- | --- | --- |
| Platform Operations | System Health | Scheduler delivery, provider/cache health, quota, storage, prioritized issues, and bounded automation safety controls. |
| Platform Operations | Data Maintenance & Recovery | Provider refreshes, rebuilds, imports, historical repair, and emergency recovery, each with cost and mutation disclosure. |
| Platform Configuration | League Management | League registry creation, naming, deletion, and platform-level league access configuration. |
| Platform Configuration | Team Identity | Global alias repair and team-catalog maintenance. |
| Platform Configuration | Draft Sequencing | Cross-league draft readiness and ordering. |
| Commissioner Tools | League-scoped pages | Preseason setup, owner confirmation, roster/settings work, insights, draft/test controls, and historical repair entry points. The label does not grant access. |

System Health is observation-first. Its only mutations are the global automation pause and the
enable controls for datasets with live consumers. Provider refreshes and data repair belong on Data
Maintenance & Recovery.

## Page routes

Twelve current page routes exist under `src/app/admin/`:

| Route | Responsibility |
| --- | --- |
| `/admin` | Platform navigation and per-league entry points. |
| `/admin/diagnostics` | System Health. |
| `/admin/data/cache` | Data Maintenance & Recovery. |
| `/admin/leagues` | League Management. |
| `/admin/aliases` | Global Team Identity repair. |
| `/admin/draft` | Cross-league draft sequencing/readiness. |
| `/admin/[slug]` | League lifecycle summary and test controls. |
| `/admin/[slug]/preseason` | Assignment method and setup completion. |
| `/admin/[slug]/preseason/owners` | Preseason owner confirmation. |
| `/admin/[slug]/roster` | Direct roster editing and historical/repair CSV entry. |
| `/admin/[slug]/settings` | League display and access settings; lifecycle-owned fields are read-only. |
| `/admin/[slug]/insights` | League-scoped Insights management. |

There is no `/admin/season` page.

## Admin API surface

The current routes under `src/app/api/admin/` are:

| Route | Methods | Responsibility |
| --- | --- | --- |
| `/api/admin/provider-status` | GET, POST | Cache-only provider status/diagnostics and bounded automation settings. |
| `/api/admin/usage` | GET | CFBD usage observation. |
| `/api/admin/odds-usage` | GET | Durable Odds quota observation. |
| `/api/admin/team-database` | POST | Team-catalog synchronization. |
| `/api/admin/cache-historical-schedule` | POST | Historical schedule repair. |
| `/api/admin/cache-historical-scores` | POST | Historical score repair. |
| `/api/admin/storage` | GET | Storage diagnostics. |
| `/api/admin/leagues` | GET, POST | League listing and creation. |
| `/api/admin/leagues/[slug]` | PATCH, DELETE | Allowed league configuration and explicit deletion. |
| `/api/admin/leagues/[slug]/password` | PUT, DELETE | League password configuration. |

Provider maintenance also calls the authorized schedule, scores, odds, rankings, conferences, and
game-stats adapters. Their refresh authority and cache behavior are documented in
[`game-data-flow.md`](game-data-flow.md).

## Maintenance actions

`src/lib/admin/maintenanceActions.ts` is the presentation authority for exact action labels,
nominal costs, durable mutations, automation owners, and action classes. It currently defines:

| Class | Actions |
| --- | --- |
| Routine | Conferences refresh; team-database sync. |
| Recovery | Full-year schedule; aggregate scores; one game-stats partition; Odds; rankings; historical schedule; historical scores. |
| Emergency | Full game-stats backfill; score refresh plus attachment trace. |

Costs are nominal successful-attempt estimates; retries can increase provider use. Disclosures do
not authorize a request or establish success. The underlying route remains responsible for auth,
validation, durable-first commit behavior, and truthful provider-refresh status.

League-scoped server actions currently cover test-league status/reset controls, preseason entry,
assignment method, owner confirmation, setup completion, test-owner CSV migration, and test draft
completion. They are not provider-maintenance actions and must use the shared lifecycle/roster
authorities described in `AGENTS.md`.

## System Health contract

System Health consumes one server-built view model that writes nothing. The server resolves the
relevant operational year and combines distinct facts without treating one as proof of another:

- scheduler delivery and execution;
- provider-refresh attempt/outcome by canonical target scope;
- durable cache content/freshness and evidence coverage;
- CFBD and Odds usage observations;
- storage availability;
- automation pause/enable settings;
- prioritized operator issues.

All inputs are durable/cache reads except one deliberate CFBD usage observation through the ordinary
10-minute cache; that call measures quota and does not refresh provider data. A failure or timeout in
one input degrades only that fact instead of failing the whole dashboard.

The page has no independent year selector and does not trigger provider repair. Its settings only
control automatic jobs that actually consume them; lifecycle-critical season transition/rollover
jobs remain exempt, and manual admin refreshes remain available for recovery.

## Scheduler receipt contract

The eight external jobs are `live-scores`, `team-records`, `game-stats`, `odds`,
`schedule-refresh`, `rankings`, `season-transition`, and `season-rollover`. The first six are
QStash-owned; the two lifecycle jobs are Vercel Cron-owned.

Each job stores one latest-only receipt under `scheduler-execution-status/<job>`. An allowlisted
receipt contains an application-generated invocation id, start/completion instants, duration,
closed result/reason values, whether provider work was attempted, a bounded typed target, scheduler
owner derived from the job, and the deployment build commit when available. It never stores request
objects, headers, URLs, credentials, provider payloads, arbitrary errors, or scheduler-supplied ids.

Persistence is monotonic by `(startedAt, invocationId)`, so an older overlapping invocation cannot
overwrite a newer delivery when it completes late. Malformed, mismatched, obsolete, or implausibly
future-dated prior records are replaceable; a genuine read failure aborts the write. Receipt writes
are best-effort and deferred after the response: they cannot change cron behavior or response
status. Receipts remain separate from `provider-refresh-status` and contain no history or heartbeat
table.

## Automated transition convergence

Season transition and season rollover are automatic, lifecycle-critical jobs. They are not gated by
the noncritical provider automation pause/settings.

- Transition evaluates production preseason candidates by their authoritative lifecycle year and
  moves an eligible league into season through guarded lifecycle writes.
- Rollover evaluates production leagues currently in season, identifies a completed structured CFP
  national championship, observes the seven-day delay, builds each archive before transition, and
  advances only through the guarded rollover authority.
- Demo/test leagues are excluded from automatic rollover targeting.
- Structurally invalid lifecycle targets are refused and surfaced in scheduler receipts instead of
  being silently coerced.
- No admin action bypasses these gates. Exceptional recovery would require a separately reviewed
  operation rather than reintroducing a generic manual rollover.

Current unresolved lifecycle decisions and limitations are listed only in
[`../next-tasks.md`](../next-tasks.md#unresolved-decisions--known-deferrals).

## History

The completed F2 audit, migration decisions, intermediate rollover contracts, and per-slice outcome
map are archived in
[`../archive/operations/admin-control-plane-f2-2026.md`](../archive/operations/admin-control-plane-f2-2026.md).
The prompt ledger and completed-work ledger retain the detailed implementation sequence.
