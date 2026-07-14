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

Neither is a real-time updater — freshness is bounded by the cron/refresh cadence, and neither spends provider quota on public reads. A genuinely empty provider array (postseason before bowl season, a future week) is valid absence, not a failure. Classifying an empty response reads the prior durable schedule; if that read fails (transient app-state outage) both paths record the open refresh attempt as a failure (`schedule-prior-cache-read-failed`, prior-good retained, no lifecycle transition) rather than leaving it stranded `in-progress`. (Provider refresh cadence / cron ownership is PLATFORM-086, still open — its automation cadences are **planned, not yet active**.)

## Provider-refresh observability & controls (PLATFORM-086A)

The `/admin/diagnostics` **Provider Data Status** panel gives operators one place to see, per provider dataset (scores/schedule/odds/rankings/conferences/game-stats): the newest attempt's **explicit state** (in progress / interrupted / succeeded / partial / failed / **completed with no applicable data**), or — when no PLATFORM-086A refresh-status record exists yet — a cache-aware no-history state (*serving cached data · no refresh history recorded* / *no cached data or refresh history* / conservative *no refresh history recorded* when availability is unknown), last successful refresh + age, last error, rows committed, partial-failure state, cache-only missing-data warnings, CFBD/Odds quota, and a manual refresh button. The newest attempt's state is read from an explicit outcome field, so an in-flight, interrupted, or valid-no-op probe is never mislabeled as a leftover success or failure (PLATFORM-086A rereview). Cache availability is determined cache-only (`getProviderCacheStates`), so missing observability history is never equated with missing data. Odds quota is read from **durable storage on every panel load**, so a refresh on another instance is reflected rather than masked by a stale process memo. **CFBD quota** is reconciled once by a shared model (`normalizeProviderQuota`) consumed by both this panel and the legacy API Usage panel — the canonical **Tier 1 limit is 5,000 calls**, `used + remaining = limit`, and an internally-inconsistent provider observation is reported honestly (fall back to the canonical Tier limit, or "quota status unavailable") rather than as an impossible "remaining of limit" combination. The panel isolates all year-scoped state to the currently selected year (request seq + `AbortController` + echoed-year + live selected-year guard; manual-refresh state keyed by `${year}:${dataset}`), so a response, error, spinner, or "Refresh complete" for one year can never surface under another. Durable status itself is keyed by a **canonical target scope** (PLATFORM-086A-SCOPED), so each card reflects only its own target (year / global / canonical-odds) and a refresh for another year, a single partition/week, or a filtered odds query never advances the card's status — the card shows a small scope chip stating which target it reflects. It also exposes two operator settings, persisted durably (`provider-refresh-settings`):

- **Global pause** — shown as **Global provider pause: Off/On**, it halts **noncritical** automatic provider polling. It does **not** block manual admin refresh, and it does **not** block the lifecycle-critical season-transition cron (which is exempt so preseason→season transitions never stall). The wording reflects that most PLATFORM-086 jobs are still planned; the label change alters no persisted setting or cron behavior.
- **Per-dataset enable/disable** — turns automatic refresh off for one dataset without deleting prior-good data or blocking manual repair.

**Manual refresh honesty.** A manual score refresh is ONE aggregate action under a **single** `scores` refresh attempt, so the whole operator action resolves as one truthful status and a partition's success or valid no-op can never erase another partition's failure. The **server** derives the **applicable** partitions cache-only from the requested year's schedule (regular, plus postseason once the schedule carries bowls), so it does not fire a doomed postseason request mid-regular-season even if the client omits the list, and a valid empty CFBD partition is a successful no-op rather than dragging the action to failure — but if any applicable partition fails, the aggregate reports failure (with the failed partitions listed, prior-good last-success preserved). A route that degraded to a bundled/prior-good/stale fallback (conferences with no CFBD key **or an empty/malformed provider payload** → `meta.fallbackUsed`; rankings rejecting an empty/drifted replacement → `meta.stale`/`meta.rebuildRequired`) is reported as a failure ("fallback data is still serving"), never as "Refresh complete." Conferences reference data does not legitimately disappear, so a non-array (`conferences-invalid-payload`) or empty/zero-usable (`conferences-no-usable-rows`) response is a failure that retains prior-good rather than committing an empty cache. A failed refresh's panel message is cache-state-aware — a cold first failure with no cache says "no cached data is available," not "prior-good still serving" — and game-stats manual-action state is keyed by year + week + season type so a result never shows against a partition that was not refreshed.

**Diagnostics measure real coverage, not presence (PLATFORM-086A 4th/5th/6th review).** The panel's missing-data warnings judge content, not markers: a completed slate's **score** coverage requires a canonical **terminal** row (final/canceled — an in-progress numeric row does not silence the missing-final warning); **game-stats** coverage requires usable cached games resolved through canonical identity with **nonempty team names** (a `games: []` or blank-identity record is not coverage), only **stat-producing** games are expected (a disrupted-only slate is not applicable — no warning, and the cron never re-fetches it), and the cron/manual refresh classify an empty CFBD response as a **no-op** (no empty write) and a nonempty→zero-usable payload as a **failure**; **rankings** coverage requires ≥1 usable week and each partition (regular/postseason) is validated **independently before combining** — a nonempty partition normalizing to zero usable weeks is schema drift (`rankings-partition-schema-drift`, prior-good retained) so a healthy partition cannot mask a drifted one, while a raw-empty response is a pre-poll no-op (no prior-good) or a rejected empty replacement (prior-good exists); and **odds** staleness is measured from the selected season's **canonical** `odds-cache` entry only, **separate from** the CFBD/Odds **quota** display and from filtered query variants — a quota timestamp or a filtered-markets refresh cannot make this season's stale served odds look fresh. Status classification is **separator-agnostic**: the shared `gameStatus` classifier normalizes provider/cache enum labels (`STATUS_CANCELED`, `STATUS_POSTPONED`, hyphen/space variants) before matching, so an underscore-delimited enum is not silently misbucketed. An **empty schedule** refresh over an already-populated schedule is rejected (prior-good retained), not stored and then labelled a no-op — and the **season-transition cron** applies the **same shared classifier** as the authorized schedule route, so an empty probe over a populated prior-good schedule is a rejected failure (prior-good retained, the league does not flip off it) rather than a silent no-op.

**Current automation coverage vs. planned.** Today only the **game-stats** cron consumes these settings (it skips when paused/disabled). The season-transition cron is exempt. The other datasets have **no automatic job yet** — their settings persist as intent that the planned PLATFORM-086B–086E jobs will consume. The panel's per-dataset "Policy" lines describe that *planned* cadence and must not be read as automation that is already running. Cadence is fixed in code / `vercel.json` and is not editable from the panel.

## Deploy-time checks

- **Storage mode:** confirm `getAppStateStorageStatus()` reports `postgres` (not `production-misconfigured`) — i.e. `DATABASE_URL` is set and reachable.
- **Auth wiring:** platform-admin sign-in reaches `/admin` and `/debug`; a non-admin is redirected; `/api/admin/*` + `/api/debug/*` reject unauthenticated calls.
- **Cron:** a manual authorized `/api/cron/*` call with the Bearer secret returns success; without it, `401`.
- **Provider quota:** public `/api/scores` and `/api/odds` serve cache without spending quota; only admin `refresh=1` spends it.

## Rollback, backup & restore

Follow the runbook's procedures. In brief: durable state lives entirely in the `app_state` table (Postgres), so back it up with standard Postgres tooling; application rollback is a redeploy of the prior build. Because caches are tag-invalidated (not time-expiring), a rollback that changes derivation logic may warrant a standings-tag invalidation so snapshots recompute. See the runbook for the exact backup/restore and rollback steps.
