# Diagnostics & Debugging

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: diagnostic endpoints, debug-surface auth, upstream-first debugging order
Supersedes: (none — complements [../architecture/game-data-flow.md](../architecture/game-data-flow.md) and [../architecture/auth-and-privacy.md](../architecture/auth-and-privacy.md))

When data looks wrong on a surface, diagnose **upstream-first**. The single most common mistake is starting at the UI; by then the fault is almost always several layers up.

## Debugging order (never start at the UI)

```
1. API response          ← is the provider payload itself right?
2. normalization layer    ← did schedule normalization preserve it?
3. canonical game model   ← is the AppGame identity/week correct?
4. attachment layers      ← did scores/odds/ownership attach to the right game?
5. UI                     ← only after 1–4 check out
```

Diagnose in this order because every downstream layer *attaches onto* the schedule-derived canonical game (see [../architecture/game-data-flow.md](../architecture/game-data-flow.md)). A wrong score or owner on screen is usually a mis-*attachment* (layer 4) or a mis-*resolved identity* (layer 3), not a rendering bug (layer 5).

## Diagnostic surfaces & their auth

All debug/admin diagnostics are gated — none are public.

- **`/debug` and `/admin` pages** are gated by the Clerk middleware and require the `platform_admin` role (fail closed: signed-out → `/login`, wrong role → `/`).
- **`/api/debug/*` endpoints** are **route-gated** by `requireAdminAuth` (not the page middleware), so the `ADMIN_API_TOKEN` fallback works for machine callers. They return `401` JSON otherwise.

See [../architecture/auth-and-privacy.md](../architecture/auth-and-privacy.md) for the full gating model.

## What to inspect at each layer

- **Schedule / identity (layers 2–3):** does the canonical `AppGame` carry the expected `providerGameId`, `week`/`providerWeek`/`canonicalWeek`, and resolved `canHome`/`canAway`? An unresolved team means a `teamIdentity` miss — check the alias map (stored global > year > seed) rather than patching downstream. Postseason weeks use `canonicalWeek = maxRegularSeasonWeek + providerWeek`; a bowl/CFP game filed under the wrong week is a canonical-week issue, not a UI filter issue.
- **Score attachment (layer 4):** attachment precedence is provider-event-id → home/away+week → reversed pair+week → pair+date (±18h). A missing score is usually an unattached row; a swapped score is an orientation (`direct`/`reversed`) issue. Score diagnostics forward `refresh=1` + admin auth to inspect the authorized path.
- **Odds attachment (layer 4):** one-to-one, ±24h of `commenceTime`. `date_mismatch`/`unmatched_pair` = no candidate; `ambiguous_pair` = it refused to guess between multiple. Odds never create canonical identities.
- **Classification / lifecycle:** time-dependent state (preseason/awaiting-kickoff/live) is decided in consumers from a cached time-invariant fact plus request `currentDate` — reproduce with the same `currentDate`, not an implicit "now" (see [../architecture/standings.md](../architecture/standings.md)).
- **Provider quota:** public reads are pure cache readers and spend nothing; if data is stale, the fix is an **authorized** refresh (admin `refresh=1` / cron), not a public re-fetch. Check odds-usage/quota state before assuming a provider outage.

## Provider Data Status panel (PLATFORM-086A)

`/admin/diagnostics` includes a **Provider Data Status** panel — the first stop when a dataset looks stale or missing. Per provider dataset (scores/schedule/odds/rankings/conferences/game-stats) it shows the durable refresh status (last attempt, last success + age, last error, rows committed, partial-failure/failed partitions, source) alongside cache-only **missing-data diagnostics**:

- **Scores / game stats:** a completed slate (latest kickoff > 6h ago, derived from the canonical schedule) with no cached score rows / no cached game-stats week.
- **Schedule:** no current-season schedule cached, a partial last refresh, or a schedule older than the weekly policy during an active season.
- **Rankings:** missing, or older than the weekly policy during an active season.
- **Odds:** snapshot recency only. A game without an offered line is **not** a failure — odds are classified as available/stale/not-offered, never errored for missing lines.

These diagnostics are **cache-only** — they read the canonical schedule and durable caches and never spend provider quota to determine status (the panel's status `GET /api/admin/provider-status` makes no provider call; live CFBD usage is fetched separately as an authoritative read). Reading the panel answers "when did this last succeed / is it stale / did the last attempt fail / is expected data missing / how much quota remains" without touching logs or storage.

The same panel exposes the operator **global pause** and **per-dataset enable/disable** controls and manual refresh for each dataset (see [deployment.md](../deployment.md) → "Provider-refresh observability & controls"). A failed refresh never advances the dataset's last-success timestamp, so a red "last attempt failed" with an older green "last success" means prior-good data is still being served.

## Guardrails while debugging

- **Do not spend provider quota from public paths** to "test" — use the admin-gated `refresh=1`. The public surfaces intentionally cannot cold-fetch.
- **Do not add name-matching or ownership logic outside `teamIdentity.ts` / `gameOwnership.ts`** to work around a miss — fix the alias/roster input instead (see [../architecture/identity-and-ownership.md](../architecture/identity-and-ownership.md)).
- **Do not recompute standings in a component** to reconcile a discrepancy — the canonical selector is the source of truth; a stale on-screen value is usually a missing tag invalidation, not a derivation bug (see [../architecture/standings.md](../architecture/standings.md)).
