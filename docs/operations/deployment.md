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

## Deploy-time checks

- **Storage mode:** confirm `getAppStateStorageStatus()` reports `postgres` (not `production-misconfigured`) — i.e. `DATABASE_URL` is set and reachable.
- **Auth wiring:** platform-admin sign-in reaches `/admin` and `/debug`; a non-admin is redirected; `/api/admin/*` + `/api/debug/*` reject unauthenticated calls.
- **Cron:** a manual authorized `/api/cron/*` call with the Bearer secret returns success; without it, `401`.
- **Provider quota:** public `/api/scores` and `/api/odds` serve cache without spending quota; only admin `refresh=1` spends it.

## Rollback, backup & restore

Follow the runbook's procedures. In brief: durable state lives entirely in the `app_state` table (Postgres), so back it up with standard Postgres tooling; application rollback is a redeploy of the prior build. Because caches are tag-invalidated (not time-expiring), a rollback that changes derivation logic may warrant a standings-tag invalidation so snapshots recompute. See the runbook for the exact backup/restore and rollback steps.
