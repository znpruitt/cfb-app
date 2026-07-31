# Admin Control Plane

Status: Current
Last verified: 2026-07-30
Owner: Project documentation
Canonical for: the admin route/action inventory, admin information-architecture ownership model, scheduler-health receipt contract, and the PLATFORM-086F2 migration map
Supersedes: (none — companion to `docs/architecture/auth-and-privacy.md` for who may access these surfaces and `docs/operations/diagnostics.md` for debug endpoints)

This document is the source of truth for **what the admin area contains, what each action costs and mutates, which surface owns each responsibility, and how the area migrates to the target information architecture** (the PLATFORM-086F2 arc). It was produced by a read-only audit of clean `main` at `7d5741a` (2026-07-30) under `PLATFORM-086F2A-ADMIN-CONTROL-PLANE-IA-v1`; the "current" inventory sections describe that state and are updated as F2 slices land. Binding invariants stay in [`AGENTS.md`](../../AGENTS.md); the current queue stays in [`docs/next-tasks.md`](../next-tasks.md).

## Locked decisions

These were decided at audit acceptance and bind every F2 slice:

1. **Existing admin URLs remain stable.** The reorganization changes grouping, naming, and page content — not routes.
2. **All `/admin` surfaces remain restricted to `platform_admin`.** "Commissioner Tools" describes the intended audience of a group, not a new permission role. No commissioner-role enforcement or self-service permissions are introduced by F2 (that is the separate Multi-tenant Commissioner Sign-up campaign; see `AGENTS.md` → Auth Architecture Invariants).
3. **Manual rollover must use the same strict eligibility gate as automatic rollover.** The gate is `resolveNationalChampionshipRollover` (`src/lib/schedule/nationalChampionshipRollover.ts`): structured `cfbd-structured` CFP national-championship identification, confirmed complete final, and the seven-day delay. Exceptional forced recovery, if ever needed, requires a separately reviewed future operation — it is not an F2 deliverable.
4. **Scheduler health uses latest-only durable execution receipts**, stored under a distinct scope, separate from `provider-refresh-status`. Scheduler delivery answers "did the job run?"; provider status answers "what data operation was attempted and committed?". Neither may be inferred from the other.

## Terminology

| Term | Meaning |
| --- | --- |
| **Platform Operations** | The operator-facing group: System Health, Data Maintenance & Recovery, Season Management |
| **Platform Configuration** | The registry/identity group: League Management, Team Identity |
| **Commissioner Tools** | League-scoped management surfaces (`/admin/[slug]` and children). Audience label only — still `platform_admin`-gated |
| **System Health** | Observation-first surface: automation gates, scheduler delivery, data freshness, quotas, storage, prioritized issues. Contains no provider-refresh or repair mutations |
| **Data Maintenance & Recovery** | All provider refreshes, rebuilds, imports, and historical repairs, each disclosed with cost/target/effect/class |
| **Action class** | Every maintenance action is classified `routine` (normal upkeep, usually automation-owned), `recovery` (manual repair of a known gap), or `emergency` (high-cost or wide-blast-radius operations such as the full game-stats backfill) |
| **Scheduler receipt** | A latest-only durable record proving an external scheduler delivered a cron invocation, regardless of whether any provider work resulted |

Provider costs quoted below are **nominal per successful attempt**; retry/pacing can increase request attempts. Quota policy itself is owned by `AGENTS.md` and `docs/architecture/game-data-flow.md` (CFBD Tier 1 5,000 calls/month; The Odds API ~500 credits/month).

## Current route inventory (audited at `7d5741a`)

Twelve page routes exist under `src/app/admin/`; the audit confirmed there are no others.

| Route | Current responsibility | Finding |
| --- | --- | --- |
| `/admin` | Platform cards and per-league links | Flat grouping obscures the operations/configuration boundary; does not link `/admin/draft` |
| `/admin/diagnostics` | Provider status + automation gates, quota observation, storage diagnostics — observation and safety controls only | The F2D1+F2D2 relocation is complete: no provider-data repair mutation remains here; the System Health rename/redesign is F2G |
| `/admin/data/cache` | **Data Maintenance & Recovery** (F2C): provider maintenance/recovery, season inputs, historical recovery — every action carries a cost/scope disclosure from the shared contract (`src/lib/admin/maintenanceActions.ts`) | Lifecycle rollover removed (Season Management owns it); Diagnostics-owned mutations still relocate here in F2D |
| `/admin/season` | Rollover (eligible-year execution + per-year status panels — the sole rollover surface since F2C), archive backfill, archive list | Correct destination; still duplicates rollover UI internally (two strict per-year panels; consolidation is F2H) and lacks full lifecycle state |
| `/admin/leagues` | Create/delete leagues; edit name (year read-only since F2B) | Duplicates per-league settings; the year-desynchronization hazard was resolved by F2B (year is lifecycle-managed) |
| `/admin/aliases` | Global alias editing | Correct global scope, but "Aliases" understates its cross-league identity impact |
| `/admin/draft` | Cross-league draft sequencing/readiness | Orphaned from navigation (no inbound link anywhere) and overlaps league-scoped commissioner tools |
| `/admin/[slug]` | League state, preseason transition, roster/settings links, test controls | Correct commissioner grouping; the render-time status write was removed by F2B |
| `/admin/[slug]/preseason` | Assignment method and setup completion | Commissioner-scoped |
| `/admin/[slug]/preseason/owners` | Owner confirmation | Commissioner-scoped |
| `/admin/[slug]/roster` | Direct roster editing plus historical/repair CSV | Combines a commissioner operation with platform recovery |
| `/admin/[slug]/settings` | Display name, founded year, password | Duplicates part of `/admin/leagues`; season year is correctly read-only here |

The admin API surface under `src/app/api/admin/` comprises: `provider-status` (GET/POST), `usage` (GET), `odds-usage` (GET), `rollover` (GET/POST), `backfill` (POST), `team-database` (POST), `cache-sp-ratings` (POST), `win-totals` (GET/POST), `cache-historical-schedule` (POST), `cache-historical-scores` (POST), `storage` (GET), `leagues` (GET/POST), `leagues/[slug]` (PATCH/DELETE), and `leagues/[slug]/password` (PUT/DELETE).

## Action, cost, and mutation inventory

Target **destination** names the owning surface in the target IA (below); "Data Maintenance" is column shorthand for the Data Maintenance & Recovery group. Provider refreshes marked "authorized" go through the public provider route with admin credentials per the cache-reader + authorized-refresh policy (`docs/architecture/game-data-flow.md`) — note the forced-refresh parameter differs by family: schedule uses `bypassCache=1` (the schedule route does not parse `refresh=1`), while scores and Odds use `refresh=1`.

| Action / API | Provider cost (nominal) | Durable effect | Automation owner | Destination |
| --- | --- | --- | --- | --- |
| `GET /api/admin/provider-status` | None | None | All provider jobs | System Health |
| Provider global pause / dataset toggles (`POST /api/admin/provider-status`) | None | `provider-refresh-settings` | All noncritical jobs | System Health |
| `GET /api/admin/usage` | One CFBD `/info` observation | None | Operator | System Health |
| `GET /api/admin/odds-usage` | None | None | Odds refresh writers | System Health |
| Full-year schedule refresh (authorized `bypassCache=1`) | 2 `/games` plus `/games/media`, and `/venues` when due: normally 3–4 | Schedule, probe, presentation caches, statuses; standings invalidation on change | Weekly QStash + lifecycle crons | Data Maintenance |
| Aggregate score refresh (authorized `refresh=1`) | 1–2 CFBD `/games` partitions | Score caches/status; standings invalidation | Live-score QStash | Data Maintenance |
| One game-stats partition | Usage probe plus one `/games/teams` request | Game-stat partition/status | Game-stats QStash | Data Maintenance |
| Full game-stats backfill | Up to 19 dataset calls plus probes | Multiple game-stat partitions/statuses | Operator recovery | Data Maintenance (emergency class) |
| Odds refresh (authorized `refresh=1`) | One three-credit `/odds` request, with quota observation | Raw/canonical Odds, usage, status | Hourly QStash | Data Maintenance |
| Rankings refresh | 2 CFBD rankings partitions | Rankings/status | Publication QStash | Data Maintenance |
| Conferences refresh | 1 CFBD request | Global conference cache/status | Manual only | Data Maintenance |
| Team database sync (`POST /api/admin/team-database`) | 1 CFBD teams request | Global team catalog; standings invalidation | Manual only | Data Maintenance |
| SP+ ratings refresh (`POST /api/admin/cache-sp-ratings`) | 1 CFBD request | `sp-ratings` | Manual only | Data Maintenance |
| Win totals CSV (`/api/admin/win-totals`) | None | `win-totals` | Manual import | Data Maintenance |
| Historical schedule repair (`POST /api/admin/cache-historical-schedule`) | 0 when already accepted; otherwise 2 CFBD partitions | Historical schedule cache/status | Manual recovery | Data Maintenance |
| Historical scores repair (`POST /api/admin/cache-historical-scores`) | 0 when cached; otherwise up to 2 partitions | Historical score cache + scoped year-rollup `provider-refresh-status` attempt (the pre-F2C status gap is closed — see operational clarity findings) | Manual recovery | Data Maintenance |
| Score-attachment diagnostic (`GET /api/debug/scores-attachment`) | 1–2 CFBD score requests nominally; when the schedule/conference caches are stale or absent, its context loader (`loadDebugSeasonContext`) forwards admin credentials and adds up to 2 schedule partitions plus 1 conferences request; worse, if a season-wide score partition returns non-2xx, `fetchScoreRows` (`src/lib/scores.ts`) falls back to per-week refresh requests across that season type — the recovery path can issue dozens of CFBD requests while still returning HTTP 200 | Score caches/status (propagates `refresh=1` upstream — **not read-only**); may also refresh schedule/conference caches and statuses via the context loader | Operator diagnostic | Data Maintenance, clearly labeled as mutating |
| Storage status (`GET /api/admin/storage`) | None | None | — | System Health |
| Rollover preview/execution (`/api/admin/rollover`) | None; cache-only source (strict per-year gate since F2B — see resolved finding 1) | Archives, lifecycle status, suppression state | Daily rollover cron / manual | Season Management |
| Archive backfill/overwrite (`POST /api/admin/backfill`) | None; cache-only source | Season archive; standings invalidation | Manual recovery | Season Management |
| Archive listing | None | None | — | Season Management |
| League create/delete/configuration (`/api/admin/leagues*`) | None | League registry/settings | Platform operator | League Management |
| Global alias save | None | Cross-league alias map; standings invalidation | Platform operator | Team Identity |
| Preseason / owner / draft / roster actions | None | League lifecycle, owners, roster, draft state | Commissioner-intent operator | Commissioner Tools |
| Historical roster CSV repair | None | Owner CSV and possibly global aliases | Platform recovery | Data Maintenance |
| League password/privacy (`/api/admin/leagues/[slug]/password`) | None | League authentication configuration | Commissioner-intent operator | Commissioner Tools |

## Priority findings

### High-priority correctness — ✅ RESOLVED by F2B (`PLATFORM-086F2B-LIFECYCLE-AUTHORITY-SAFETY-v1`)

The binding rules now live in `AGENTS.md` → **Lifecycle Authority Invariants**; the paragraphs below record the pre-F2B defects and their resolutions.

1. **Manual rollover bypassed hardened lifecycle safety — resolved.** Pre-F2B, `src/app/api/admin/rollover/route.ts` never imported the strict gate: its confirmed-execution branch flipped leagues to `offseason` with no eligibility check, while GET consulted only the weaker display-oriented `isSeasonComplete()` (since deleted), and it assumed one global season (`leagues[0].year`). Now the manual route is per-year and shares the automatic cron's authority end-to-end: target selection via `groupRolloverTargets` (`src/lib/rolloverTargeting.ts` — non-test `status.state === 'season'` leagues grouped exclusively by `status.year`, ascending), eligibility via `resolveNationalChampionshipRollover` re-evaluated on **every** POST (a stale preview never authorizes execution; refusals are `409 rollover-not-eligible` with the exact stable reason, `409 rollover-year-not-active`, or `503 rollover-eligibility-unavailable` on a durable read failure), group-atomic archive-first two-stage execution (any archive failure prevents every status transition for the group; the automatic cron keeps its per-league isolation — in neither path can a league transition without its own durable archive), every transition through the guarded `completeSeasonRollover` (the league must still be in `season` for the exact requested year at write time), truthful partial-failure reporting, and no force/emergency bypass. GET returns the sanitized per-year `ManualRolloverStatusResponse` (`src/lib/manualRollover.ts` — the shared client contract both panels decode). Both panels (`RolloverPanel`, `SeasonRolloverPanel`) send an explicit year on every request, never render an execute control for an ineligible/unavailable year, and render the authoritative per-year dates (the page-computed global "next rollover" estimate was removed); their consolidation into one surface remains F2H.
2. **League year had two competing authorities — resolved.** `updateLeagueStatus` (`src/lib/leagueRegistry.ts`) is now the single lifecycle mutation authority: `season`/`preseason` synchronize the top-level `league.year` to `status.year` in one serialized registry write (all registry mutations hold the registry-key transaction, closing the concurrent lost-update window), `offseason` writes the last authoritative season year (the outgoing `status.year`) into `league.year` — healing any desynchronized legacy top-level year — and a failed write can never leave the two fields partially synchronized. Generic `updateLeague` rejects lifecycle fields (type- and runtime-level); `PATCH /api/admin/leagues/[slug]` rejects `year` (`409 league-year-lifecycle-managed`) and `status` (`409 league-status-lifecycle-managed`); the `/admin/leagues` edit form no longer offers a year field; creation seeds an explicit `status: { state: 'season', year }`. `beginPreseason` is offseason-guarded so re-invocation cannot re-increment the year. Legacy missing-status records stay excluded from rollover targeting (as they already were from the automatic cron); their explicit repair path is owned by F2H's lifecycle recovery — F2B deliberately ships no migration or repair UI.
3. **A page render mutated durable lifecycle state — resolved.** `src/app/admin/[slug]/page.tsx` no longer fire-and-forgets `updateLeagueStatus` during render; the legacy missing-status inference (`{ state: 'season', year: league.year }`) is read-only, and a regression test pins the registry byte-equivalent across renders.

### Operational clarity findings

- ~~Diagnostics performs manual provider refreshes, team-database writes, and score-cache mutations from what presents as an observational page.~~ **Fully resolved by the F2D1+F2D2 split**: `ProviderDataStatusPanel` no longer offers manual refreshes (System Health keeps only the global pause, dataset toggles, status, quota, and diagnostics); Odds/Rankings refreshes, Conferences, and the relocated Team Database sync live on Data Maintenance & Recovery (F2D1); and the mutating score tool is now the explicitly confirmed, emergency-class **score-attachment recovery** action there (F2D2) — one captured target drives its disclosure, mandatory confirmation (naming the target, cache mutations, and possible per-week fan-out), request, and result label, with the trace explicitly disclaiming that it proves upstream refresh success. The backend route/context-loader limitations stay separately owned by the server-fetch backlog.
- ~~Provider costs, target scope, durable effects, and routine-versus-recovery intent are inconsistently disclosed across action surfaces.~~ **Resolved by F2C** for every action on Data Maintenance & Recovery: the shared presentation-only contract (`src/lib/admin/maintenanceActions.ts`, eight descriptors with routine/recovery/emergency classes) renders a compact keyboard-accessible disclosure adjacent to each action; the full game-stats backfill visibly identifies as the emergency action. Diagnostics-owned actions gain their disclosures when F2D relocates them.
- The two rollover panels (`SeasonRolloverPanel`, `RolloverPanel`) now BOTH live on Season Management (F2C moved the per-year status panel there when rollover left the maintenance page) and consume the same strict per-year contract with identical eligibility expectations; consolidation into one surface remains F2H.
- The Provider Status card reads canonical year-rollup status, so healthy week-scoped live-score or game-stat activity can appear absent. Canonical dataset health and latest scoped activity must be shown separately.
- Provider-refresh status cannot prove scheduler delivery: a harmless skip/no-target invocation creates no provider attempt, so its absence must not be read as scheduler failure (motivates the receipt contract below).
- CFBD quota is loaded twice on Diagnostics: `AdminUsagePanel` and `ProviderDataStatusPanel` each perform an independent CFBD usage read per mount.
- Stale automation descriptors: `src/lib/providerDatasets.ts` still hedges Schedule/Rankings automation with "once provisioned per runbook §8h/§8j" although both QStash schedules are active, and `src/lib/server/providerRefreshSettings.ts` plus `ProviderDataStatusPanel` retain "cadence is fixed in code / `vercel.json`" wording although the active schedules are QStash-managed.
- Legacy-token error messages on `/admin/leagues` say "Enter your token in the Auth panel above". The referenced `AdminAuthPanel` **is** rendered on that page (audit correction — it is not missing), but its visible label is "Admin access token", and the legacy `ADMIN_API_TOKEN` path is a transition-period fallback under Clerk (`AGENTS.md` → Auth Architecture Invariants) — the copy names a panel label that does not exist and over-centers the fallback credential. Owned by F2I (the League Management rework).
- ~~Historical scores repair commits its cache write without recording a `provider-refresh-status` attempt.~~ **Resolved by F2C**: whenever provider work is required, `POST /api/admin/cache-historical-scores` records ONE truthful attempt against the exact `scores` year rollup (`scoresAggregateScope` — the repair always targets both complete partitions), begun after the auth/validation/active-year/cached exits but before credential validation. Outcomes: `cfbd-api-key-missing`, `cfbd-fetch-failed` (exact failed partitions), `cfbd-empty-unexpected` (an empty partition over prior-good rows or started schedule games is classified through the shared `classifyEmptyScoresResponse` BEFORE any write — nothing committed, prior rows retained; a genuinely absent target is a no-op with no empty commit), `durable-write-failed` (partial-write truth via the pure `classifyHistoricalScoreWrites`), or success recorded only after the attempted durable commits with `committedAt`/`commitSeq`/rows. Recording is best-effort and never changes the route's provider/cache outcome; no provider bodies, credentials, or storage errors are stored. Known residual hardening follow-up (raised at F2C review by both reviewers, deliberately NOT taken in F2C — the F2C contract pins "do not change its active-year rule"): the repair refuses only `seasonYearForToday()`, narrower than the historical-schedule sibling's league-lifecycle-aware `computeProtectedActiveYears` (force-proof). A repair against an unrolled prior season still in league `season`/`preseason` status can therefore overwrite that active league's score caches (pre-existing) AND its `scores:year:<year>` status rollup (new surface since F2C records status); a deliberate future-year repair can likewise pre-stamp a not-yet-active year's rollup. Adopt `computeProtectedActiveYears` here in a follow-up slice.
- `/admin/[slug]/roster` combines direct roster editing (commissioner operation) with historical/repair CSV import (platform recovery) on one page for different audiences.
- `/admin/draft` is reachable only by URL and duplicates league-scoped navigation.
- Test-convention drift: `src/app/api/admin/team-database/route.test.ts` sits co-located next to its route (outside `src/**/__tests__/`) and has drifted from current route behavior — it lacks the request-context setup the maintained `__tests__/route.test.ts` copy needs for `invalidateAllLeaguesStandings`, so it asserts a success status the route no longer produces under its conditions. Four more co-located `route.test.ts` files share the convention violation: `src/app/api/admin/odds-usage/`, `src/app/api/odds/`, `src/app/api/owners/`, `src/app/api/postseason-overrides/`. Disposition: the drifted team-database duplicate is removed by F2D (which reworks that action's surface and already has a maintained `__tests__/` copy); the four remaining co-located files are a mechanical relocation recorded as a non-F2 cleanup follow-up (pointer in `docs/next-tasks.md` → candidate follow-ups).

## Target information architecture

| Group | Route retained | Responsibility |
| --- | --- | --- |
| Platform Operations → System Health | `/admin/diagnostics` | Automation gates, scheduler delivery, provider/cache freshness, quotas, storage, prioritized issues, links to repair |
| Platform Operations → Data Maintenance & Recovery | `/admin/data/cache` | Provider refreshes, rebuilds, enrichment, imports, historical repairs, roster repair, diagnostic refreshes |
| Platform Operations → Season Management | `/admin/season` | Lifecycle state, automation ownership, preseason/season/postseason, strict rollover, archives, backfills, lifecycle recovery |
| Platform Configuration → League Management | `/admin/leagues` | Registry, league creation/removal, product-configuration navigation; no generic lifecycle-year edit |
| Platform Configuration → Team Identity | `/admin/aliases` | Global canonical matching corrections, cross-league warnings, diagnostics deep links |
| Commissioner Tools | `/admin/[slug]` and children | League-scoped setup, owners, draft, direct roster management, display/privacy settings |
| Compatibility | `/admin/draft` | Redirect or narrow index into league-scoped draft tools once its useful readiness summary is relocated |

System Health remains primarily observational. Global pause and dataset toggles stay there because they are operational safety controls; all provider refresh and repair mutations move to Data Maintenance & Recovery. Every mutation there is described through one shared action contract: provider, nominal cost, target scope, durable mutations, automation owner, and routine/recovery/emergency class.

## Scheduler-health contract (owned by F2E1/F2E2)

A latest-only durable receipt is written under the distinct scope `scheduler-execution-status/<job>` for each externally scheduled job:

| Job | Route | Cadence |
| --- | --- | --- |
| Live scores | `GET /api/cron/live-scores` | Every 3 minutes (QStash `turfwar-live-scores-3m`) |
| Game stats | `GET /api/cron/game-stats` | Every 15 minutes (QStash `turfwar-game-stats-15m`) |
| Odds | `GET /api/cron/odds` | Hourly (QStash `turfwar-odds-hourly`) |
| Weekly schedule | `GET /api/cron/schedule-refresh` | Weekly (QStash `turfwar-schedule-weekly`) |
| Rankings | `GET /api/cron/rankings` | Twice daily (QStash `turfwar-rankings-publication`) |
| Season transition | `GET /api/cron/season-transition` | Daily (Vercel cron) |
| Season rollover | `GET /api/cron/season-rollover` | Daily (Vercel cron) |

Contract properties:

- Each receipt is allowlisted and secret-safe: job/source, result/reason, start/completion timestamps, duration, provider-call flag, and a bounded target summary. No credentials, tokens, or upstream URLs.
- **Receipts are written only after successful cron authentication.** The cron URLs are publicly reachable; a receipt written on an auth failure would let any caller advance the "last delivery" timestamp and mask a broken QStash/Vercel credential. Unauthenticated or malformed invocations must never advance delivery health. Auth failures stay visible in the runtime execution-log events of the five QStash provider routes, which record them today; the two lifecycle crons currently emit **no** app-side execution event (their auth failures appear only in platform request logs), so F2E2 adds lifecycle execution-log events alongside their receipts to close that gap.
- **Stale completions must not overwrite newer receipts.** With at-least-once or overlapping deliveries, an older invocation can complete after a newer one; the latest-only key must be committed with a monotonic ordering rule keyed on invocation start/delivery identity (the store's observation-ordered transaction pattern), not plain last-write-wins.
- A skip or no-target result **proves healthy delivery**. Delivery health is classified cadence-aware (a 3-minute job is late on a different clock than a weekly one).
- Receipt writes are best-effort: a store failure cannot change a cron response, provider behavior, cadence, or the existing execution-log events.
- Latest-only storage keeps row count constant (one row per job); at current cadence this is approximately 604 receipt updates per day, dominated by the 3-minute live-score job.
- The scope name `scheduler-execution-status` is unused at `7d5741a` (verified by repo-wide search) and is reserved by this contract.
- This remains separate from `provider-refresh-status` — see locked decision 4.

## Migration map — the F2 slice sequence

Slices are sequenced so each PR is independently deployable and revertible; the binding PR-sizing rule in `docs/next-tasks.md` (stop-and-reassess at >15 files / >1,500 net lines) applies to every slice. Current slice status lives in `docs/next-tasks.md`; execution records land in `docs/prompt-registry.md`.

| Slice | Kind | Scope |
| --- | --- | --- |
| **F2A** — Admin control-plane inventory and IA | Docs-only | This document, plus queue/roadmap/registry projections |
| **F2B** — Lifecycle authority safety | Code | Converge manual rollover onto the strict automatic eligibility authority, make rollover per lifecycle year, remove unrestricted execution, eliminate render-time status seeding, and prevent generic league-year edits from bypassing lifecycle ownership |
| **F2C** — Maintenance action model and page foundation | Code | Rename Data Cache to Data Maintenance & Recovery (URL preserved); introduce the shared action description contract (provider, nominal cost, target, durable mutations, automation owner, class); remove rollover from this page |
| **F2D** — Operational mutation relocation (split at its audit into **F2D1** provider-maintenance relocation and **F2D2** score-attachment recovery relocation) | Code | D1: move provider manual refreshes + team database sync out of System Health, consolidate duplicate refresh controls, add the Odds/Rankings/Conferences/Team-Database disclosures. D2: relocate the mutating score-attachment tool as an explicitly confirmed emergency-class recovery action; System Health then keeps only gates and read-oriented diagnostics |
| **F2E1** — External scheduler receipts | Code | Add the shared receipt authority and instrument the five QStash-triggered routes without changing responses, provider behavior, cadence, or execution logs |
| **F2E2** — Lifecycle scheduler receipts and reader | Code | Instrument season-transition and season-rollover, including their currently missing execution-log events (auth failures included); add the cache-only admin reader and cadence-aware delivery-health classification |
| **F2F** — System-health read model | Code | One server-side operational view model keeping scheduler delivery, automation gates, canonical data health, latest scoped attempts, quota, and storage distinct; stable issue codes with severity, explanation, and repair link |
| **F2G** — System Health UI | Code | Replace the incremental Diagnostics composition: split the oversized Provider panel, remove stale policy wording, deduplicate quota loading, show scheduler and provider truth separately, link every actionable issue to its owning surface |
| **F2H** — Season Management consolidation | Code | Per-league lifecycle state shown separately from automation ownership; one strict rollover UI; organized archives, backfills, and explicit lifecycle recovery |
| **F2I** — Platform Configuration and Team Identity | Code | Remove duplicated league settings; establish Team Identity's global/cross-league scope; diagnostic deep links without duplicating identity logic |
| **F2J** — Commissioner boundaries and navigation closeout | Code | Separate direct roster management from historical CSV repair; reconcile the orphaned draft page; rebuild the `/admin` landing page around the agreed hierarchy; accessibility/browser verification |

## Verification expectations per slice

- **Inventory (F2A):** markdown lint, link validation, and source-backed route/action completeness.
- **Lifecycle (F2B):** mixed-year rollover, ineligible manual execution, confirmed structured final, render-without-write, and year-authority regressions.
- **Maintenance (F2C/F2D):** every action's endpoint, provider-cost label, scope, confirmation behavior, and durable-effect disclosure.
- **Scheduler receipts (F2E1/F2E2):** auth failures, skips, no-targets, successes, failures, store failures, secret canaries, and unchanged cron responses.
- **Health model (F2F):** stale/missing/failed/scheduler-late distinctions, scoped-versus-rollup truth, severity ordering, and repair links.
- **UI (F2G–F2J):** focused component tests plus authenticated browser verification of every admin route, keyboard navigation, responsive layout, dark mode, and absence of provider calls from observational loads except the single deliberate quota observation.
- **Full gates for every code slice:** `npx tsc --noEmit`, `npm run lint:all`, `npm test`, `npm run build`, and `git diff --check`.

## Assumptions and exclusions

- No commissioner-role authentication or self-service permissions are introduced.
- Existing URLs and API contracts remain compatible unless a correctness fix requires a narrowed mutation contract (the F2B rollover/league-year narrowing is the expected case).
- Manual rollover cannot bypass automatic eligibility; exceptional forced recovery would require a separately reviewed future operation.
- No scheduler cadence, QStash configuration, `vercel.json`, provider quota policy, canonical data model, or public league UI changes are part of F2.
- UI work follows [`DESIGN.md`](../../DESIGN.md); this document defines ownership and behavior, not final visual styling.
