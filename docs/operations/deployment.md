# Deployment

Status: Current
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: high-level deploy, environment, auth-secret, scheduler, and operational-check orientation
Supersedes: (none — the detailed procedure is `docs/deployment-runbook.md`)

This document explains what must be in place and why. Use
[`../deployment-runbook.md`](../deployment-runbook.md) for exact commands, promotion gates, secret
rotation, scheduler management, incident response, backup, restore, and rollback.

## Production deployment model

Merging to `main` creates a production build but does not by itself move `turfwar.games`. Automatic
custom-domain assignment is disabled; production changes only when the intended deployment is
explicitly promoted. Scheduler receipts carry the executing build commit when Vercel exposes it, so
System Health can distinguish merged code from the build actually handling cron work.

Preview deployments are not production evidence. A long-lived preview branch can have its own
database branch and stale scheduler receipts; verify production through the promoted domain and
production environment.

## Environment variables

Configure secrets in the hosting platform; never commit values.

| Variable | Requirement and purpose |
| --- | --- |
| `DATABASE_URL` | Required in production. Postgres backing for `app_state`; production fails closed instead of using the file fallback. |
| `CFBD_API_KEY` | Required for authorized CFBD schedule, score, rankings, teams/conferences, and game-stats refreshes. |
| `ODDS_API_KEY` | Required for authorized The Odds API refreshes. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk identity and the platform-admin role. |
| `CRON_SECRET` | Shared bearer secret for all eight `/api/cron/*` routes. A missing/mismatched value returns `401` before lifecycle or provider work. |
| `LEAGUE_AUTH_SECRET` | Required whenever any league uses the private-link password gate; grants no admin role. |
| `ADMIN_API_TOKEN` | Transitional optional fallback for approved machine/admin API callers. Do not build new flows around it; planned removal belongs to the reviewed commissioner/member authorization work after replacement Clerk scoping exists. |

Optional overrides such as `NEXT_PUBLIC_SEASON`, `PGSSLMODE`, and diagnostic flags are cataloged in
the runbook. Clerk, `ADMIN_API_TOKEN`, `LEAGUE_AUTH_SECRET`, and `CRON_SECRET` are independent
security boundaries; see
[`../architecture/auth-and-privacy.md`](../architecture/auth-and-privacy.md).

## Scheduler ownership

The scheduling boundary is external provider polling through QStash and internal lifecycle
reconciliation through Vercel Cron. The two Vercel lifecycle schedules remain configured at the
fixed triggers below but are temporarily disabled, owner-confirmed 2026-08-27, until the planned
2026 roster publication is complete; re-enable both afterwards and verify their next authenticated
System Health receipts against the promoted build.

| Job | Scheduler | Fixed trigger |
| --- | --- | --- |
| Game stats | QStash `turfwar-game-stats-15m` | Every 15 minutes |
| Live scores | QStash `turfwar-live-scores-3m` | Every 3 minutes |
| Team records | QStash `turfwar-team-records-hourly` | Hourly |
| Odds | QStash `turfwar-odds-hourly` | Hourly |
| Schedule maintenance | QStash `turfwar-schedule-weekly` | Tuesdays 12:00 UTC |
| Rankings | QStash `turfwar-rankings-publication` | 04:00 and 22:00 UTC |
| Season transition | Vercel Cron | Daily 00:00 UTC |
| Season rollover | Vercel Cron | Daily 00:00 UTC |

The seven QStash jobs are intentionally absent from `vercel.json`; versioned manager scripts own
their external schedule definitions. All nine routes authenticate with `Bearer ${CRON_SECRET}`.
The fixed trigger is a delivery ceiling: application policy decides whether an invocation has an
eligible target and whether provider work is due. Provider-free skips are normal.

Rotate `CRON_SECRET` as one coordinated operation across the Vercel environment and all seven QStash
schedules. Follow runbook §8l; a partially rotated set silently disables whichever jobs still carry
the old value.

## Provider and cache safety

Public schedule, score, Odds, rankings, and game-stat reads are cache-only. Only authenticated admin
refreshes and cron jobs may contact providers. Provider-backed writers follow durable-first order:
fetch/normalize, durable commit, process-cache update, invalidation, then response.

Full-season schedule refreshes use one completeness authority. A required partition fetch failure,
non-array payload, or nonempty-to-zero normalization is uncertainty: retain prior-good data and
report failure. An exact empty partition can be valid absence. An all-empty result over a populated
schedule is a rejected replacement, not a healthy empty commit. Season transition uses the same
classification and never changes lifecycle state from an uncertain probe.

Provider-refresh status is scoped to the exact attempted target and is observability only. Failed
and no-op attempts do not advance last success; success is recorded only after a confirmed durable
commit. Scheduler receipts independently show whether an authenticated scheduled invocation ran.

## System Health and maintenance

`/admin/diagnostics` renders System Health for the server-resolved operational season. It separates
scheduler delivery/execution, canonical cache/evidence health, provider-refresh outcomes,
automation settings, quota, and storage. The model writes nothing; its only provider contact is one
cached CFBD usage observation. It has no year selector and no provider-refresh buttons.

System Health can pause noncritical provider automation globally or disable one of the six live
setting consumers: game stats, scores, team records, Odds, ordinary schedule maintenance, and rankings.
Lifecycle-critical season transition, season rollover, and postseason-boundary schedule work are
exempt. Conferences remain manual-only.

`/admin/data/cache` owns every provider-spending refresh, rebuild, historical repair, and emergency
recovery action. Each action discloses its nominal cost, durable mutations, automation owner, and
routine/recovery/emergency class from `src/lib/admin/maintenanceActions.ts`. Manual actions remain
available when automatic jobs are paused.

## Deploy-time checks

- Confirm the intended build, not merely a newer build, is promoted to the production domain.
- Confirm `getAppStateStorageStatus()` resolves to Postgres and the production database is reachable.
- Confirm platform-admin pages open for the authorized Clerk account; wrong-role/signed-out access
  fails closed; admin/debug APIs reject unauthenticated requests.
- Inspect all seven QStash schedules and both Vercel Cron entries. Verify their exact URLs, methods,
  cadence, retry policy, and shared bearer-secret wiring.
- Confirm each job's System Health receipt reports the promoted build after its next fixed slot.
- Verify public data routes serve durable caches without provider calls; run provider-spending checks
  only through the disclosed admin actions.
- Check CFBD and Odds headroom before opening gates or running broad recovery/backfill operations.

## Rollback, backup, and restore

Durable application state lives in Postgres `app_state`; use the runbook's database procedures and
standard Postgres backup tooling. Application rollback is promotion of the prior verified build,
not a Git history rewrite. A rollback that changes derivation behavior may also require the
documented cache invalidation/rebuild procedure.

Game-stats writer control is durably `active`. Never return production to `legacy`. For an ingestion
incident, close the automation gates and pause QStash first; use `active -> read-only-safe` only when
the durable writer fence is required, then recover through `read-only-safe -> active`. The exact
sequence is in runbook §8e and the architecture is in
[`../ai/game-stats-writer-fence.md`](../ai/game-stats-writer-fence.md).
