# Deployment

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: high-level deploy/env/auth-secret/cron overview and operational checks
Supersedes: (none — the detailed step-by-step operator checklist remains [../deployment-runbook.md](../deployment-runbook.md); this doc is the high-level companion)

This is the orientation layer for deploying and operating the app. For the full step-by-step operator checklist (exact commands, per-phase gates, failure-diagnosis playbook) use [../deployment-runbook.md](../deployment-runbook.md), which stays current and is the authoritative procedure. This page summarizes *what* has to be in place and *why*; the runbook is *how*.

## Environment variables (high level)

Names only — never commit real values; configure them in the hosting platform's secret store.

**Required in production**

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection for the app-state store. Production **requires** it — the store throws (`production-misconfigured`) rather than fall back to the file store. See [../architecture/storage-and-caching.md](../architecture/storage-and-caching.md). |
| `CFBD_API_KEY` | CFBD provider key (schedule/scores). Quota ~1000/month. |
| `ODDS_API_KEY` | The Odds API key. Quota ~500/month. |
| Clerk keys | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` — identity & app roles. |
| `CRON_SECRET` | Bearer secret for `/api/cron/*`. Missing → every scheduled run fails closed (`401`), stopping season transition/rollover/stats ingestion. |
| `LEAGUE_AUTH_SECRET` | HMAC key for the per-league password gate. Required whenever any league sets a password; the gate throws on a missing/empty value. |

**Transitional / optional**

| Variable | Purpose |
|----------|---------|
| `ADMIN_API_TOKEN` | Transitional admin-API fallback (Auth Invariant #5) for machine callers; retire in Phase 8. When unset, non-production treats requests as authorized for local dev only. |
| `NEXT_PUBLIC_SEASON`, `PGSSLMODE`, debug flags | Optional overrides — see the runbook. |

The three auth secrets are **independent** (see [../architecture/auth-and-privacy.md](../architecture/auth-and-privacy.md)): Clerk (identity/roles), `ADMIN_API_TOKEN` (admin-API fallback), and `LEAGUE_AUTH_SECRET` (per-league privacy gate). The league password grants no role and no provider-refresh authority.

## Cron & scheduled work

Scheduled routes under `/api/cron/*` authenticate with `Bearer ${CRON_SECRET}` (independent of admin auth) and drive season transition, season rollover, and weekly game-stats ingestion. They also keep provider caches warm via authorized refresh, so public reads stay quota-free (see [../architecture/game-data-flow.md](../architecture/game-data-flow.md)). A missing/rotated-away `CRON_SECRET` silently disables all of them — verify it after any secret rotation.

**Schedule refresh safety guarantees (PLATFORM-085B / 085C).** Both schedule refresh paths refuse to publish a partial or schema-drifted schedule as complete. A CFBD partition that fails (fetch error, non-array response, or a **nonempty** payload that maps to **zero** rows) is treated as uncertainty, not empty:

- `/api/cron/season-transition` probes/caches the season schedule and flips leagues preseason → season at kickoff. On any partition failure it retains the prior-good durable schedule/probe and reports `partialFailure` in that year's result — the next run retries. It does **not** guarantee an immediate transition on a partial-provider day; a league flips only off a validated (current or prior-good) schedule probe.
- authorized `/api/schedule` (admin `bypassCache=1`) returns `502` on a failed/drifted partition and does not overwrite the prior-good durable schedule cache, so a subsequent public read still serves the last good schedule.

Neither is a real-time updater — freshness is bounded by the cron/refresh cadence, and neither spends provider quota on public reads. A genuinely empty provider array (postseason before bowl season, a future week) is valid absence, not a failure. (Provider refresh cadence / cron ownership is PLATFORM-086, still open — its automation cadences are **planned, not yet active**.)

## Provider-refresh observability & controls (PLATFORM-086A)

The `/admin/diagnostics` **Provider Data Status** panel gives operators one place to see, per provider dataset (scores/schedule/odds/rankings/conferences/game-stats): the newest attempt's **explicit state** (in progress / interrupted / succeeded / partial / failed / **completed with no applicable data** / never refreshed), last successful refresh + age, last error, rows committed, partial-failure state, cache-only missing-data warnings, CFBD/Odds quota, and a manual refresh button. The newest attempt's state is read from an explicit outcome field, so an in-flight, interrupted, or valid-no-op probe is never mislabeled as a leftover success or failure (PLATFORM-086A rereview). Odds quota is read from **durable storage on every panel load**, so a refresh on another instance is reflected rather than masked by a stale process memo. It also exposes two operator settings, persisted durably (`provider-refresh-settings`):

- **Global pause** — halts **noncritical** automatic provider polling. It does **not** block manual admin refresh, and it does **not** block the lifecycle-critical season-transition cron (which is exempt so preseason→season transitions never stall).
- **Per-dataset enable/disable** — turns automatic refresh off for one dataset without deleting prior-good data or blocking manual repair.

**Manual refresh honesty.** A manual score refresh fans out only over the **applicable** partitions (regular, plus postseason once the schedule carries bowls), so it does not fire a doomed postseason request mid-regular-season; a valid empty CFBD partition returns a successful no-op rather than dragging the action to failure. A route that degraded to a bundled/prior-good fallback (e.g. conferences with no CFBD key) is reported as a failure ("fallback data is still serving"), never as "Refresh complete."

**Diagnostics measure real coverage, not presence (PLATFORM-086A 4th review).** The panel's missing-data warnings judge content, not markers: a completed slate's **score** coverage requires a canonical **terminal** row (final/canceled — an in-progress numeric row does not silence the missing-final warning); **game-stats** coverage requires usable cached games resolved through canonical identity (a `games: []` record is not coverage, and the game-stats cron re-fetches such a week instead of skipping it forever); and **odds** staleness is measured from the selected season's `odds-cache` entry, **separate from** the CFBD/Odds **quota** display — a quota timestamp advanced by a failed 402/429 or another season's request cannot make this season's stale odds look fresh. An **empty schedule** refresh over an already-populated schedule is rejected (prior-good retained), not stored and then labelled a no-op.

**Current automation coverage vs. planned.** Today only the **game-stats** cron consumes these settings (it skips when paused/disabled). The season-transition cron is exempt. The other datasets have **no automatic job yet** — their settings persist as intent that the planned PLATFORM-086B–086E jobs will consume. The panel's per-dataset "Policy" lines describe that *planned* cadence and must not be read as automation that is already running. Cadence is fixed in code / `vercel.json` and is not editable from the panel.

## Deploy-time checks

- **Storage mode:** confirm `getAppStateStorageStatus()` reports `postgres` (not `production-misconfigured`) — i.e. `DATABASE_URL` is set and reachable.
- **Auth wiring:** platform-admin sign-in reaches `/admin` and `/debug`; a non-admin is redirected; `/api/admin/*` + `/api/debug/*` reject unauthenticated calls.
- **Cron:** a manual authorized `/api/cron/*` call with the Bearer secret returns success; without it, `401`.
- **Provider quota:** public `/api/scores` and `/api/odds` serve cache without spending quota; only admin `refresh=1` spends it.

## Rollback, backup & restore

Follow the runbook's procedures. In brief: durable state lives entirely in the `app_state` table (Postgres), so back it up with standard Postgres tooling; application rollback is a redeploy of the prior build. Because caches are tag-invalidated (not time-expiring), a rollback that changes derivation logic may warrant a standings-tag invalidation so snapshots recompute. See the runbook for the exact backup/restore and rollback steps.
