# Game Data Flow

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: schedule → canonical games, score/odds attachment, public cache-reader + authorized-refresh policy, provider quota
Supersedes: (none — complements `AGENTS.md` Core rules #1, #7, #8)

The whole system hangs off one direction of flow:

```
CFBD schedule → canonical AppGame → scores / odds attach onto those games
```

Score and odds layers **attach onto** schedule-derived canonical games; they never construct game identity independently.

## Schedule is the source of truth

`buildScheduleFromApi(...)` (`src/lib/schedule.ts`) builds canonical `AppGame[]` from the CFBD schedule wire items, resolving every team through the centralized `createTeamIdentityResolver({ teams, aliasMap, observedNames })` (see [identity-and-ownership.md](identity-and-ownership.md)). Each `AppGame` carries `week`, `providerWeek`, `canonicalWeek`, and `providerGameId`.

**Postseason canonical week** is computed as `canonicalWeek = maxRegularSeasonWeek + providerWeek`, applied only when there's regular-season context. `providerWeek` is **always preserved** alongside `canonicalWeek` because score/odds fetching and attachment trace by `providerWeek`.

## Score attachment (`src/lib/scoreAttachment.ts`)

`buildScheduleIndex` indexes the canonical games four ways — by `providerGameId`, home/away+week, pair+week, and pair+date — with week indexes keyed by **both** `canonicalWeek` and `providerWeek`. `matchScoreRowToSchedule` attaches by precedence:

1. **Provider event id** — strongest and hydration-independent (so a placeholder bowl/CFP slot is still attachable). Accepted only when every *known* schedule side resolves to the correspondingly-positioned row team (orientation must be `direct`); a reversed/unresolvable side declines and falls through, preventing a swapped positional attach.
2. **Team-resolved fallbacks** — exact home/away+week, then reversed pair+week, then pair+date (±18h).

Match orientation (`direct`/`reversed`) is tracked so scores are stored in schedule orientation.

## Odds attachment (`src/lib/oddsAttachment.ts`)

`attachOddsEventsToSchedule` is event-centric and schedule-canonical: **odds never create canonical identities** — only games already present in the schedule can be returned. Each event's pair is resolved via `resolver.buildPairKey`, narrowed to candidates within `±24h` of `commenceTime`, and attached **one-to-one**: an already-claimed game is never overwritten; zero candidates → `date_mismatch`/`unmatched_pair`, more than one → `ambiguous_pair` (it refuses to guess).

## Public cache-reader policy (PLATFORM-075)

**Public reads must not spend provider quota.** The public `/api/scores` and `/api/odds` surfaces are **pure cache readers**: an anonymous request serves fresh cache, else stale cache, else a controlled empty/stale response — it **never** triggers a cold-cache upstream fetch.

Only an **authorized refresh** spends quota. Both routes gate on `refresh=1` behind `requireAdminAuth` (see [auth-and-privacy.md](auth-and-privacy.md)): the upstream CFBD/Odds fetch lives *only* in the authorized branch. `/api/schedule` follows the same shape via `bypassCache=1` (admin-gated); a non-admin cache miss serves stale or asks for an admin refresh rather than fetching.

**CFBD is the sole normal production score provider (PLATFORM-086A rereview).** ESPN was removed as an automatic score fallback and as a durable score source — it introduced a parallel provider contract and could mask CFBD failures instead of surfacing them. The reliability mechanism is now prior-good CFBD cache retention, not a second provider. On an authorized `/api/scores` refresh: valid CFBD rows commit durably and record success; a **valid empty CFBD partition** (postseason before bowls, a future week — the request succeeded and validated but had no rows) is a **no-op / valid absence** that writes nothing, preserves any prior-good rows, and returns a successful empty response (never a 502); a CFBD **failure** (missing key, fetch/validation/persistence error) preserves the prior-good durable cache, records a failed refresh attempt, and returns a failure. No ESPN substitution occurs on any of these paths. (The `CacheEntry`/`ScoresMeta` `source` union still carries `'espn'` solely to read/label durable entries written before the removal; nothing writes it now.) The admin manual score refresh runs as **one aggregate action** (PLATFORM-086A 6th review): the panel issues a single `refresh=1&aggregate=1` request that fans out over the applicable partitions under ONE `scores` attempt (`handleAggregateScoreRefresh`), so a partition's success or valid no-op can never erase another partition's failure — the attempt resolves exactly once from the combined outcomes (all-succeed → success, any-fail → failure with `failedPartitions`, all-no-op → no-op). A direct single-partition `refresh=1` still records its own truthful attempt for targeted repair. Applicability is **server-authoritative** (7th review): the endpoint derives the applicable partitions cache-only from the requested year's schedule (`getApplicableScoreSeasonTypes`), so an ordinary refresh never spends a doomed postseason request before bowls exist and a client cannot force an unnecessary partition by omitting/mis-sending the list; a nonempty `seasonTypes` query is an explicit targeted repair only.

- **Authorized refresh / cron keeps caches warm** — platform admin, server cron, or `ADMIN_API_TOKEN` may refresh; `GlobalRefreshPanel` and `/api/debug/*` score diagnostics forward `refresh=1` + admin auth.
- **The league password grants no fetch authority** — unlocking a passworded league never authorizes quota spend; that gate is solely `requireAdminAuth`.

**Provider refreshes publish durable cache before process memory (PLATFORM-085A).** On an authorized refresh, each provider route/store persists the durable app-state snapshot first, then updates its process-local cache, then invalidates dependent standings — never memory-first. A failed durable write therefore surfaces as an error and leaves the process cache untouched, so it can never make one instance report "fresh" schedule/scores/odds that durable storage (and other instances) don't have. See [storage-and-caching.md](storage-and-caching.md) → "Durable-first commit order".

**Schedule publication requires a complete validated schedule (PLATFORM-085B / 085C).** Both the season-transition cron and the authorized `/api/schedule` refresh publish a schedule partition only when it resolves without a fetch/schema failure. A partition that **throws**, returns a **non-array**, or normalizes a **nonempty** payload to **zero** rows (schema drift) is uncertainty: the cron retains prior-good durable schedule/probe and reports `partialFailure`; `/api/schedule` returns `502` (via `hasRequiredSeasonTypeFailure`) before its commit block, leaving the durable cache, process cache, and standings invalidation untouched. Neither commits partial/drifted rows as complete fresh state, so downstream standings/Insights/rollover never treat an incomplete schedule as authoritative. An **all-empty** refresh (every requested partition validly returned zero rows) is classified **before** any durable/process-cache write (PLATFORM-086A 4th review): if a populated schedule is already cached the empty result is **rejected** as an unexpected replacement (prior-good retained, refresh recorded as failed, `502`); only a genuinely inapplicable/unpublished empty (postseason before bowls, a future season not yet published) resolves as a **no-op** that writes nothing and preserves prior-good success metadata. An empty schedule is never committed-then-labelled-a-no-op (which would empty the cache while claiming old rows are still served). Both paths share ONE empty-response classifier (`classifyEmptyScheduleRefresh` in `scheduleSeasonFetch.ts`, PLATFORM-086A 6th review) so they cannot drift: the season-transition cron applies the same rule, so an empty probe over a populated prior-good schedule is a rejected failure (prior-good retained, and the league does **not** flip off the empty probe that run) rather than a silent no-op. See [storage-and-caching.md](storage-and-caching.md) → "Schedule refresh completeness".

**Public scores and canonical consumers share ONE cache-only season score reconciliation (PLATFORM-084B).** Scores cache under a season-wide key (`${year}-all-${seasonType}`) and per-week keys (`${year}-<week>-${seasonType}`). The shared reader `loadReconciledSeasonScores` (`src/lib/server/scoreCacheReader.ts`) merges the season-wide and per-week entries — deduped by canonical game identity (through `teamIdentity.ts`), newest cache entry winning — and is used by the public `/api/scores` season read, canonical standings, and the season-rollover archive build alike. So a week-specific refresh visible on `/api/scores` is now equally visible to standings, Insights, and archives. The reader is cache-only (no provider call); see [storage-and-caching.md](storage-and-caching.md) for the reconciliation mechanics.

**Refresh freshness metadata is observability-only (PLATFORM-086A).** Each authorized refresh records a per-dataset status (last attempt/success/error/rows) under the `provider-refresh-status` scope, and provider responses carry `generatedAt`/`capturedAt`/`source` meta. These describe *how fresh the cache is* and are surfaced to operators (the `/admin/diagnostics` Provider Data Status panel) and to users (the subtle `FreshnessLabel` chips). They are **not** a source of canonical game data — identity, scores, odds, and standings still derive only from the schedule-attached canonical model, never from a freshness timestamp. See [storage-and-caching.md](storage-and-caching.md) → "Provider-refresh status & settings".

**Empty provider results are classified before commit across datasets (PLATFORM-086A 4th/5th/6th review).** The same no-op / reject-empty discipline applied to the schedule refresh extends to game-stats and rankings: a genuinely empty CFBD response is a **no-op** (nothing written, prior-good preserved, last-success not advanced), a **nonempty** payload that normalizes to zero usable rows is a **failure** (prior-good retained), and only usable content commits. Game-stats "usable" requires a real provider game id **and** a nonempty team identity on both sides (a blank-identity row can't resolve to an owner, so it is not coverage); the game-stats cron skips slates with no stat-producing (non-disrupted) games so it never re-spends quota on a permanently statless week. Rankings validate each partition (regular/postseason) **independently before combining** (6th review): a nonempty partition that normalizes to zero usable weeks is schema drift (`rankings-partition-schema-drift`, prior-good retained) — one healthy partition can never mask a drifted one — while a raw-empty rankings response is a pre-poll no-op (no prior-good) or a rejected empty replacement (prior-good exists). A rankings failure resolves the attempt exactly **once** with its most specific metadata: the drift branch records the specific code/`failedPartitions` and throws a marked already-recorded error so the outer catch rethrows without a second generic `recordProviderRefreshFailure` that would erase the code (7th review); a genuine fetch/network failure still records the generic code. Status classification itself is separator-agnostic: `src/lib/gameStatus.ts` normalizes provider/cache enum labels (`STATUS_CANCELED`, `STATUS_POSTPONED`, hyphen/space variants) to tokens before matching, so an underscore-delimited enum is never silently misbucketed by the score-terminal or game-stats-applicability logic that consumes it. See [storage-and-caching.md](storage-and-caching.md) → "Schedule refresh completeness".

## Provider quota constraints

CFBD is the source of truth for schedule/scores; The Odds API for odds (~500/month). CFBD's monthly limit is **tier-derived from the provider-reported patron level** (free tier ~1000/month; higher tiers report a larger allowance) — it is never assumed to be a fixed 1,000. The cache-reader policy exists to keep public/member traffic from exhausting these quotas; season-persistent data updates through admin/cron flows, not opportunistically from public reads.

## Non-negotiable

- Public reads never spend provider quota; authorized refresh/cron keep caches warm.
- Game identity is constructed once, in the schedule layer — score and odds layers attach to it and must not build identity independently. Team canonicalization and schedule-game attachment live in shared `src/lib/` helpers, never duplicated in route handlers or UI.
