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

`/admin/diagnostics` includes a **Provider Data Status** panel — the first stop when a dataset looks stale or missing. Per provider dataset (scores/schedule/odds/rankings/conferences/game-stats) it shows the durable refresh status — the newest attempt's **explicit state** (refresh in progress / attempt appears interrupted / last attempt succeeded / partial / failed / **completed — no applicable data** / never refreshed), last success + age, last error, rows committed, partial-failure/failed partitions, source — alongside cache-only **missing-data diagnostics**:

- **Scores:** a completed slate (latest kickoff > 6h ago, derived from the canonical schedule) with no cached **terminal** score. Coverage requires a canonical terminal classification (final, or a canceled game that will never have a final) — a mid-game refresh that left only an in-progress numeric row does **not** count as covered, so the missing-final warning is not suppressed until finals actually land.
- **Game stats:** a completed slate with no **usable cached game-stats content**. Coverage is judged by the cached `WeeklyGameStats.games` resolved through canonical game identity, **not** by cache-key existence — a record with `games: []` (or all rows dropped in normalization, or rows with blank team identities) is not coverage. Only **stat-producing** games are expected: disrupted games (canceled/postponed/suspended/delayed, via the shared `expectsGameStats` helper) are excluded, so a slate composed *entirely* of disrupted games is not applicable and raises no missing-stats warning. Status classification is **separator-agnostic** — the shared `gameStatus` classifier normalizes provider/cache enum labels (`STATUS_CANCELED`, `STATUS_POSTPONED`, hyphenated or spaced variants) to tokens before matching, so an underscore-delimited enum is not silently treated as stat-producing. Partial coverage (some expected games missing) surfaces as an info note rather than being hidden by the key's presence.
- **Schedule:** no current-season schedule cached, a partial last refresh, or a schedule older than the weekly policy during an active season.
- **Rankings:** no **usable** rankings — missing, or a cached record whose `response.weeks` is empty (pre-poll / schema-drifted) — or usable-but-older than the weekly policy during an active season. Record presence alone is not coverage.
- **Odds:** recency of the **selected season's CANONICAL** served odds cache — the exact key the default (unfiltered) UI request reads (`defaultOddsCacheKey`). A game without an offered line is **not** a failure — odds are classified as available/stale/not-offered, never errored for missing lines. Staleness derives from that canonical `odds-cache` entry's `lastFetch` only — **not** the newest across filtered markets/bookmakers variants (a filtered refresh must not make the served snapshot look fresh) and **not** the global quota-observation timestamp; absence of the canonical snapshot is reported as unknown, never treated as fresh.

These diagnostics are **cache-only** — they read the canonical schedule and durable caches and never spend provider quota to determine status (the panel's status `GET /api/admin/provider-status` makes no provider call; live CFBD usage is fetched separately as an authoritative read). Reading the panel answers "when did this last succeed / is it stale / did the last attempt fail / is expected data missing / how much quota remains" without touching logs or storage.

The same panel exposes the operator **global pause** and **per-dataset enable/disable** controls and manual refresh for each dataset (see [deployment.md](../deployment.md) → "Provider-refresh observability & controls"). A failed refresh never advances the dataset's last-success timestamp, so a red "last attempt failed" with an older green "last success" means prior-good data is still being served.

Panel behavior to know when reading it:

- **The newest attempt's state is explicit.** The state line reads the durable `latestAttemptOutcome`, not an inference from the last success/error — so an in-flight, interrupted, or valid-no-op probe shows its true state instead of a leftover "succeeded"/"failed."
- **"Completed — no applicable data" is not a failure.** When CFBD returns a valid empty partition (postseason scores before bowls are published, a week with no games), the refresh resolves as a **no-op**: nothing is written, prior-good data is preserved, and the card shows a muted "no applicable data" — not a red failure. ESPN is no longer an automatic fallback, so a genuine CFBD failure is surfaced (prior-good retained) rather than masked by a second provider.
- **An empty schedule is classified before it is stored.** A schedule refresh that returns zero games is judged *before* any durable/process-cache write: if a populated schedule is already cached, the empty result is **rejected** as an unexpected replacement (prior-good schedule retained, refresh recorded as failed) rather than committed and then labelled a no-op; only a genuinely inapplicable/unpublished empty (e.g. postseason before bowls, a future season) resolves as a no-op. A committed empty schedule that then reported "no-op" (preserving stale success metadata while the cache was emptied) is the exact contradiction this prevents.
- **Game-stats and rankings empties are classified too.** A game-stats refresh (cron or manual) that gets a genuinely empty CFBD array resolves as a **no-op** — no `games: []` record is written and last-success is not advanced (a written empty would read as covered yet still be retried); a **nonempty** payload that normalizes to zero usable rows (schema drift / blank identities) is a **failure** (`game-stats-no-usable-rows`, prior-good retained). Rankings behave the same, and validate each partition **independently before combining**: a nonempty regular *or* postseason partition that normalizes to zero usable weeks is schema drift (`rankings-partition-schema-drift`, prior-good retained) — a healthy partition can never mask a drifted one, and drift is never mistaken for valid absence. A genuinely empty (raw) rankings response is a pre-poll no-op when no prior-good rankings exist, and an unexpected empty replacement (`rankings-empty-replacement-rejected`) that retains prior-good when they do.
- **Disrupted-only slates never retry.** The game-stats cron selects only slates with at least one stat-producing (non-disrupted) game, so a week of only canceled/postponed/suspended/delayed games is never re-fetched every run (it can never produce usable stats) and never raises a missing-stats warning.
- **Odds quota freshness ≠ odds-data freshness.** The panel's quota display reads durable odds usage on every load, but the odds **staleness diagnostic** derives from the selected season's **canonical** `odds-cache` entry (`defaultOddsCacheKey`), not that quota timestamp and not any filtered-query variant — a failed 402/429, another season's request, or a filtered markets/bookmakers refresh can move quota or a sibling cache key without refreshing the served snapshot, and must not make stale odds look fresh.
- **Manual score refresh is ONE aggregate action, server-authoritative on applicability.** The scores refresh issues a single aggregate request under **one** `scores` attempt, so the whole operator action has a single truthful status owner — a partition's success or valid no-op can **never** erase another partition's failure. The **server** derives the applicable partitions cache-only from the requested year's schedule (`getApplicableScoreSeasonTypes` — regular, plus postseason once bowls are scheduled; 7th review), so a mid-regular-season refresh does not fire a doomed postseason request **even if the client omits or mis-sends the partition list**, and the action does not report failure merely because an inapplicable partition was skipped or validly empty. A client `seasonTypes` list is honored only as an explicit targeted repair (e.g. postseason-only); an absent/invalid list falls back to server-derived applicability. If any applicable partition fails, the aggregate reports failure with the failed partitions listed even when another partition committed (`partialFailure` set, prior-good last-success preserved).
- **The status feed ignores year-mismatched responses.** The panel guards `/api/admin/provider-status` loads with a monotonic request sequence + an `AbortController` and validates the echoed `year` (`isCurrentStatusResponse`), so if the operator changes the year while a load is in flight, an older year's response can never overwrite the newer feed — the visible year, its diagnostics, and any manual refresh always agree on one year. Superseded/aborted loads surface no stale error or spinner.
- **Manual game-stats repair is season-type-aware.** The game-stats card has both a week and a season-type (regular/postseason) selector — a postseason repair targets the postseason cache key rather than defaulting to regular.
- **Fallback is not success.** A manual refresh whose route degraded to bundled/prior-good/stale fallback is reported as "Provider refresh failed; fallback data is still serving," not as complete. The shared interpreter treats `meta.fallbackUsed` / `meta.source: 'local_snapshot'` (the conferences route on a provider error) **and** `meta.stale` / `meta.rebuildRequired` (the rankings loader returns HTTP 200 with these when it rejects an empty/drifted replacement and keeps serving prior-good rankings) as failure — none of them read as "Refresh complete."
- **Odds quota is a fresh durable read.** The panel reads durable odds usage on every load (not a process memo), so a refresh on another instance is reflected rather than showing an indefinitely stale remaining/quota.
- **Controls are interactive only when they do something.** A per-dataset auto-refresh toggle is interactive only for datasets whose setting a live job consumes today (game-stats). Planned datasets show read-only "control not active yet"; the lifecycle-critical schedule shows "exempt from provider polling pause controls." The settings API likewise rejects toggling a planned or exempt dataset. This keeps the panel from implying a runtime effect that does not exist yet.

## Guardrails while debugging

- **Do not spend provider quota from public paths** to "test" — use the admin-gated `refresh=1`. The public surfaces intentionally cannot cold-fetch.
- **Do not add name-matching or ownership logic outside `teamIdentity.ts` / `gameOwnership.ts`** to work around a miss — fix the alias/roster input instead (see [../architecture/identity-and-ownership.md](../architecture/identity-and-ownership.md)).
- **Do not recompute standings in a component** to reconcile a discrepancy — the canonical selector is the source of truth; a stale on-screen value is usually a missing tag invalidation, not a derivation bug (see [../architecture/standings.md](../architecture/standings.md)).
