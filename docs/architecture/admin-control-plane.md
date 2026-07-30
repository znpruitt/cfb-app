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
| `/admin/diagnostics` | Provider status, automation controls, quota, team sync, storage, score attachment | Mixes observation with provider-spending mutations |
| `/admin/data/cache` | Rollover, schedule/scores/game-stats refresh, SP+, win totals, historical repairs | Mixes lifecycle, routine maintenance, imports, and recovery |
| `/admin/season` | Rollover, archive backfill, archive list | Correct destination, but duplicates rollover UI and lacks full lifecycle state |
| `/admin/leagues` | Create/delete leagues; edit name and year | Duplicates per-league settings and can desynchronize the lifecycle year (finding 2) |
| `/admin/aliases` | Global alias editing | Correct global scope, but "Aliases" understates its cross-league identity impact |
| `/admin/draft` | Cross-league draft sequencing/readiness | Orphaned from navigation (no inbound link anywhere) and overlaps league-scoped commissioner tools |
| `/admin/[slug]` | League state, preseason transition, roster/settings links, test controls | Correct commissioner grouping, but currently writes status during render (finding 3) |
| `/admin/[slug]/preseason` | Assignment method and setup completion | Commissioner-scoped |
| `/admin/[slug]/preseason/owners` | Owner confirmation | Commissioner-scoped |
| `/admin/[slug]/roster` | Direct roster editing plus historical/repair CSV | Combines a commissioner operation with platform recovery |
| `/admin/[slug]/settings` | Display name, founded year, password | Duplicates part of `/admin/leagues`; season year is correctly read-only here |

The admin API surface under `src/app/api/admin/` comprises: `provider-status` (GET/POST), `usage` (GET), `odds-usage` (GET), `rollover` (GET/POST), `backfill` (POST), `team-database` (POST), `cache-sp-ratings` (POST), `win-totals` (GET/POST), `cache-historical-schedule` (POST), `cache-historical-scores` (POST), `storage` (GET), `leagues` (GET/POST), `leagues/[slug]` (PATCH/DELETE), and `leagues/[slug]/password` (PUT/DELETE).

## Action, cost, and mutation inventory

Target **destination** names the owning surface in the target IA (below). Provider refreshes marked "authorized `refresh=1`" go through the public provider route with admin credentials per the cache-reader + authorized-refresh policy (`docs/architecture/game-data-flow.md`).

| Action / API | Provider cost (nominal) | Durable effect | Automation owner | Destination |
| --- | --- | --- | --- | --- |
| `GET /api/admin/provider-status` | None | None | All provider jobs | System Health |
| Provider global pause / dataset toggles (`POST /api/admin/provider-status`) | None | `provider-refresh-settings` | All noncritical jobs | System Health |
| `GET /api/admin/usage` | One CFBD `/info` observation | None | Operator | System Health |
| `GET /api/admin/odds-usage` | None | None | Odds refresh writers | System Health |
| Full-year schedule refresh (authorized `refresh=1`) | 2 `/games` plus `/games/media`, and `/venues` when due: normally 3–4 | Schedule, probe, presentation caches, statuses; standings invalidation on change | Weekly QStash + lifecycle crons | Data Maintenance |
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
| Historical scores repair (`POST /api/admin/cache-historical-scores`) | 0 when cached; otherwise up to 2 partitions | Historical score cache/status | Manual recovery | Data Maintenance |
| Score-attachment diagnostic (`GET /api/debug/scores-attachment`) | 1–2 CFBD score requests | Score caches/status (propagates `refresh=1` upstream — **not read-only**) | Operator diagnostic | Data Maintenance, clearly labeled as mutating |
| Storage status (`GET /api/admin/storage`) | None | None | — | System Health |
| Rollover preview/execution (`/api/admin/rollover`) | None; cache-only source | Archives, lifecycle status, suppression state | Daily rollover cron / manual | Season Management |
| Archive backfill/overwrite (`POST /api/admin/backfill`) | None; cache-only source | Season archive; standings invalidation | Manual recovery | Season Management |
| Archive listing | None | None | — | Season Management |
| League create/delete/configuration (`/api/admin/leagues*`) | None | League registry/settings | Platform operator | League Management |
| Global alias save | None | Cross-league alias map; standings invalidation | Platform operator | Team Identity |
| Preseason / owner / draft / roster actions | None | League lifecycle, owners, roster, draft state | Commissioner-intent operator | Commissioner Tools |
| Historical roster CSV repair | None | Owner CSV and possibly global aliases | Platform recovery | Data Maintenance |
| League password/privacy (`/api/admin/leagues/[slug]/password`) | None | League authentication configuration | Commissioner-intent operator | Commissioner Tools |

## Priority findings

### High-priority correctness (owned by F2B)

1. **Manual rollover bypasses hardened lifecycle safety.** `src/app/api/admin/rollover/route.ts` never imports the strict gate: its confirmed-execution branch (`body.confirmed === true`) builds archives and flips leagues to `offseason` with **no eligibility check at all**, while GET consults only the weaker display-oriented `isSeasonComplete()` (never re-checked on POST). It also assumes one global season (`leagues[0].year` — the top-level `league.year`, not `status.year`). The automatic path (`src/app/api/cron/season-rollover/route.ts`) groups leagues by `status.year` and evaluates `resolveNationalChampionshipRollover` per year — structured `cfbd-structured` CFP national-championship item, complete confirmed final, and the seven-day delay. Two different UI panels expose the manual route: `SeasonRolloverPanel` (Data Cache page — always rendered, no eligibility gate) and `RolloverPanel` (Season page — hides itself unless GET reports `seasonComplete`).
2. **League year has two competing authorities.** `PATCH /api/admin/leagues/[slug]` (driven by `/admin/leagues`) writes the top-level `league.year`, while lifecycle automation and canonical selection read `league.status.year` (`resolveStandingsYear` in `src/lib/selectors/leagueStandings.ts`, `src/lib/rankings/automaticContext.ts`, the season-rollover cron, and the Data Cache page's year source). The two can diverge and send product configuration and automation to different seasons.
3. **A page render mutates durable lifecycle state.** `src/app/admin/[slug]/page.tsx` fire-and-forgets `updateLeagueStatus(slug, …)` during server-component render when `league.status` is absent. Rendering an admin GET must remain read-only; initialization or repair must be an explicit action.

### Operational clarity findings

- Diagnostics performs manual provider refreshes (`ProviderDataStatusPanel`), team-database writes (`AdminTeamDatabasePanel`), and score-cache mutations (`DiagnosticsScorePanel` → `ScoreAttachmentDebugPanel`, whose diagnostic read propagates `refresh=1` and updates the durable score cache) from what presents as an observational page.
- Provider costs, target scope, durable effects, and routine-versus-recovery intent are inconsistently disclosed across action surfaces.
- The two rollover panels (`SeasonRolloverPanel`, `RolloverPanel`) hit the same route with different eligibility expectations (see finding 1).
- The Provider Status card reads canonical year-rollup status, so healthy week-scoped live-score or game-stat activity can appear absent. Canonical dataset health and latest scoped activity must be shown separately.
- Provider-refresh status cannot prove scheduler delivery: a harmless skip/no-target invocation creates no provider attempt, so its absence must not be read as scheduler failure (motivates the receipt contract below).
- CFBD quota is loaded twice on Diagnostics: `AdminUsagePanel` and `ProviderDataStatusPanel` each perform an independent CFBD usage read per mount.
- Stale automation descriptors: `src/lib/providerDatasets.ts` still hedges Schedule/Rankings automation with "once provisioned per runbook §8h/§8j" although both QStash schedules are active, and `src/lib/server/providerRefreshSettings.ts` plus `ProviderDataStatusPanel` retain "cadence is fixed in code / `vercel.json`" wording although the active schedules are QStash-managed.
- Legacy-token error messages on `/admin/leagues` say "Enter your token in the Auth panel above". The referenced `AdminAuthPanel` **is** rendered on that page (audit correction — it is not missing), but its visible label is "Admin access token", and the legacy `ADMIN_API_TOKEN` path is a transition-period fallback under Clerk (`AGENTS.md` → Auth Architecture Invariants) — the copy names a panel label that does not exist and over-centers the fallback credential.
- `/admin/[slug]/roster` combines direct roster editing (commissioner operation) with historical/repair CSV import (platform recovery) on one page for different audiences.
- `/admin/draft` is reachable only by URL and duplicates league-scoped navigation.
- Test-convention drift: `src/app/api/admin/team-database/route.test.ts` sits co-located next to its route (outside `src/**/__tests__/`) and has drifted from current route behavior — it lacks the request-context setup the maintained `__tests__/route.test.ts` copy needs for `invalidateAllLeaguesStandings`, so it asserts a success status the route no longer produces under its conditions. Four more co-located `route.test.ts` files share the convention violation: `src/app/api/admin/odds-usage/`, `src/app/api/odds/`, `src/app/api/owners/`, `src/app/api/postseason-overrides/`.

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
| Game stats | `GET /api/cron/game-stats` | Every 15 minutes (QStash) |
| Odds | `GET /api/cron/odds` | Hourly (QStash `turfwar-odds-hourly`) |
| Weekly schedule | `GET /api/cron/schedule-refresh` | Weekly (QStash `turfwar-schedule-weekly`) |
| Rankings | `GET /api/cron/rankings` | Twice daily (QStash `turfwar-rankings-publication`) |
| Season transition | `GET /api/cron/season-transition` | Daily (Vercel cron) |
| Season rollover | `GET /api/cron/season-rollover` | Daily (Vercel cron) |

Contract properties:

- Each receipt is allowlisted and secret-safe: job/source, result/reason, start/completion timestamps, duration, provider-call flag, and a bounded target summary. No credentials, tokens, or upstream URLs.
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
| **F2D** — Operational mutation relocation | Code | Move provider manual refreshes, team database sync, and the mutating score-attachment diagnostic from System Health into Data Maintenance; consolidate duplicate refresh controls; System Health keeps only gates and read-oriented diagnostics |
| **F2E1** — External scheduler receipts | Code | Add the shared receipt authority and instrument the five QStash-triggered routes without changing responses, provider behavior, cadence, or execution logs |
| **F2E2** — Lifecycle scheduler receipts and reader | Code | Instrument season-transition and season-rollover; add the cache-only admin reader and cadence-aware delivery-health classification |
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
