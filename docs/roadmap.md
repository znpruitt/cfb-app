# CFB App Roadmap

Status: Current
Last verified: 2026-07-14
Owner: Project documentation
Canonical for: high-level product/platform roadmap and development philosophy only
Supersedes: (none)

## Development philosophy

The CFB app is a single-developer, AI-assisted, league-first web app that should stay predictable, maintainable, and economical to run.

Core principles:

- **Schedule-first game identity.** The schedule remains the canonical source of truth for the game universe.
- **API-first ingestion.** CFBD and The Odds API remain upstream sources of truth for schedule/scores and odds.
- **Shared cached production reads.** Hosted member traffic should primarily consume shared cached state instead of repeatedly triggering upstream rebuild work.
- **Small durable footprint.** Use one small managed database for truly persistent shared state.
- **Quota-conscious freshness.** Freshness matters, but it must be balanced against CFBD and Odds API monthly quotas.
- **Admin-controlled persistence and refresh.** Season-persistent shared data should update through commissioner/admin flows, not opportunistically from public traffic.
- **Diagnostics over silent failure.** Problems should surface clearly and be recoverable.
- **Prompt traceability.** Codex prompts should use standardized headers and stable `PROMPT_ID`s so work can be referenced and revised cleanly across campaigns.

Prompt format and registry guidance live in `docs/prompt-registry.md`.

> **Backlog slugs are provisional planning labels, not formal prompt IDs.** Items below tagged `Backlog slug (provisional)` are working names for not-yet-activated tasks. A formal `PROMPT_ID` — `<CAMPAIGN>-<###>-<SHORT_NAME>-v<version>` per `AGENTS.md` — is assigned only when a task is activated (and its `<###>` verified against `docs/prompt-registry.md` then). Do not treat a backlog slug as an assigned prompt ID.

## Current status

All foundational work is complete: architecture stabilization, production hardening, league UX, visual redesign, multi-league support, historical analytics, draft tool, admin auth, product design audit (7A–7F), commissioner self-service, season lifecycle, and launch prep.

Active work is organized into named workstream campaigns (see below). Phase numbering is retired — existing `P{n}` prompt IDs are grandfathered; new prompts use `{CAMPAIGN}-{###}` format.

## Production data policy

See `docs/vision.md` for the canonical production data policy.

## Hosted production target

### Goal

Deliver a hosted app that league members can reliably use throughout the season with low commissioner overhead and controlled API usage.

### Recommended stack

- **Vercel** for app hosting, preview deploys, and production deploys.
- **One small managed Postgres** for shared durable state.
- No extra queue/worker/cache layer unless proven necessary.

### Durable shared state target

Keep this intentionally small:

- aliases
- owner roster
- postseason overrides
- team database snapshot
- durable odds snapshots if retained for line continuity
- season/reference snapshots only where they materially reduce repeated upstream rebuild work

---

## Workstreams

### Data & Intelligence

#### Game Stats Pipeline ✓ Complete

Fetch and cache weekly game-level team stats from CFBD to power the Insights Engine.

- **Data source:** CFBD `game_team_stats` endpoint — one call per week, returns all team stats for all games in that week
- **Storage:** Cached in `appStateStore` by week, same pattern as scores
- **Cron:** Monday 11am UTC — fetch weekend game stats (complements the daily 00:00 UTC season-transition cron; see `vercel.json`)
- **Owner aggregation:** `aggregateOwnerGameStats()` resolves teams via `TeamIdentityResolver`, attributes stats per owner at query time
- **Stats available:** Yards gained/allowed, turnovers, turnover margin, third-down conversion %, time of possession, plus 6 special teams return stat fields
- **API cost:** ~19 additional calls per season — well within the CFBD Tier 1 limit (5,000 calls/month)
- **2021–2025 backfilled** (5 seasons × ~19 weeks = 95 weeks cached)
- See `docs/completed-work.md` for full detail.

#### Insights Engine Foundation ✓ Complete

Generator interface, type system, and engine scaffolding for the Insights Engine.

- `src/lib/insights/types.ts` — `LifecycleState` (7 states), `InsightCategory` (9 categories), `InsightGenerator`, `InsightContext`, `OwnerSeasonStats`
- `src/lib/insights/engine.ts` — `registerGenerator()`, `runInsightsEngine()` with lifecycle filtering, try/catch isolation, priority sorting
- `src/lib/insights/generators/existing.ts` — existing insights ported as registered generators (trajectory, season_wrap, championship_race)
- Naming conflict resolved: legacy `deriveLeagueInsights` renamed to `deriveGameMovementInsights`
- `Insight` type extended with `category`, `lifecycle`, `stat` optional fields
- See `docs/completed-work.md` for full detail.

#### Insights Engine — Generators and Wiring ✓ Complete

Historical and rivalry generators wired through `GET /api/insights/[slug]` into the overview panel.

- `deriveLifecycleState()` — maps `LeagueStatus` + `SeasonContext` + calendar to `LifecycleState`
- `buildInsightContext()` — assembles `InsightContext` from standings history, games, game stats, archives, rosters, and AP rankings
- Historical generator (drought, dynasty, most-improved, consistency) with universal tie suppression (4+ suppress, 2–3 group copy, 1 existing)
- Rivalry generator (lopsided, even, dominance streak); even-rivalry copy branches on win differential
- Active owner filtering across all seven insight types (former owners excluded)
- `GET /api/insights/[slug]` API route merges league-scoped + global aliases server-side
- See `docs/completed-work.md` for full detail.

#### Insights Engine — Context Extension ✓ Complete

`pointsAgainst` added to `OwnerSeasonStats`; `OwnerCareerStats` type + `buildOwnerCareerStats()` assembles full career records from archive data. Diagnostic route `GET /api/debug/insights-career-diagnostic`. Unlocks Luck Score and all career-based generators.

#### Insights Engine — Generator Batch 2 ✓ Complete

16 new generators across 3 new files (`career.ts`, `stats.ts`, `milestones.ts`). Generator-level `tone` property added. `InsightWindow` type defined. UTF-8 encoding and trending direction logic fixed. See `docs/completed-work.md` for full detail.

- **career.ts:** career_points_leader, career_turnover_margin, volatility, never_last, title_chaser, rookie_benchmark, greatest_season, trending_up/down
- **stats.ts:** ball_security, takeaway_king, yards_per_win, clock_crusher, third_down, team_identity
- **milestones.ts:** milestone_watch, perfect_against
- **Note:** in-season stats generators (ball_security, takeaways, yards_per_win, clock_crusher, third_down, team_identity) require an active season with game stats to validate end-to-end

#### Copy Variation Architecture ✓ Complete

`newsHook` (11 types) + `statValue` on all generators. Per-league, per-season suppression gate (`insights-suppression:{leagueSlug}:{season}`). Engine async with pre-load, post-filter, post-write. 2–5 deterministic templates per insight type, hook-driven selection. `?bypassSuppression=1` admin param. Season rollover clears suppression per successfully rolled league. See `docs/completed-work.md` for full detail.

#### Insights Panel UI Redesign ✓ Complete

5-insight panel with category microlabels, tappable rows, first-row prominence, and "See all →" link shipped. Polish pass added HISTORICAL/RIVALRY deep-link arrows, three history page section anchors, and light-mode banner tuning. Followup pass rerouted `champion_margin` / `failed_chase` to `/history/{year}`, added offseason "{year} Final Standings" subheader on the standings page via archive-resolved year, and tightened arrow contrast to WCAG 3:1 in light mode. Subsequent STANDINGS-SUBHEADER-FIX wired the subheader plumbing into the main league page so the branch fires on the primary WeekViewTabs click flow, not just the dedicated `/standings` route.

- Row 1 prominence currently flattened pending ranker maturity (restore via INSIGHTS-RANKER-TUNING)
- Three Tier 2 insight types (`career_points_leader`, `career_turnover_margin`, `milestone_watch-points`) currently return `null` from the deep-link resolver — blocked on HISTORY-REWORK career surface
- "See all →" link wired and visible; dedicated insights page stabilized via ALL-INSIGHTS-SCHEME-FIX + ALL-INSIGHTS-OFFSEASON-FALLBACK (see ALL-INSIGHTS-PAGE entry below)
- See `docs/completed-work.md` for full detail.

#### Insights Panel — Microlabel Palette (planned)

Rationalize category microlabel colors to resolve HISTORICAL/STANDINGS/SEASON shared-purple and STATS/LEAGUE/fallback shared-slate token collisions. Includes a micro-discovery on why SEASON-labeled rows render in the panel when no generator appears to set `category === 'season_wrap'` at render time. Constrained by `DESIGN.md`'s strict ban on amber/green/red/blue hues for category use.

- **Backlog slug (provisional):** `INSIGHTS-017-PALETTE-v1`

#### Insights — All Insights Page ✓ Complete

`/league/[slug]/insights` renders the full insight pool for a league. Originally logged as scaffolded-but-unpopulated during DOCS-CLOSEOUT-006; investigation during INSIGHTS-017 PR review identified two bugs preventing the page from rendering:

- **ALL-INSIGHTS-SCHEME-FIX** (commit `2acdcf5`) — fixed the `x-forwarded-proto` fallback on the server-side fetch. The old `'https'` fallback forced HTTPS against local/self-hosted HTTP dev servers, silently failing the fetch.
- **ALL-INSIGHTS-OFFSEASON-FALLBACK** (commit `e208104`) — added a context-builder fallback to the most recent archive's `ownerRosterSnapshot` when the current-year owners CSV is empty. Resolves the offseason transition window (post-rollover, pre-preseason-upload) where `currentRoster` was empty and every generator filtered to zero output.

Future polish work (grouping by category, lifecycle filtering, pagination for long lists) is tracked separately under "Insights — 'See All' Dedicated Page" below.

- See `docs/completed-work.md` for full detail.

#### Insights Ranker — Priority Tuning (planned)

Audit base priority weights across all 26 generators. Add sample-depth awareness (e.g. "perfect record at 6 games" should not rank as high as "perfect record at 20 games"). Foundation for restoring row-1 visual prominence once the ranker earns it. Revisit when priority decay ships.

- **Backlog slug (provisional):** `INSIGHTS-RANKER-TUNING-v1`

#### Pairing Cards (planned)

Post-processing pass after generator run; pairing priority = `max(A, B) + 10`; AI copy (cache-time, curated subset). Natural pairings: Title Chaser + Volatility, Ball Security + Takeaways, Career Points + Drought, Trending Leader.

- **Prerequisites:** Copy Variation Architecture

#### Luck Score Generator (planned)

Points scored vs points allowed differential — "lucky" or "unlucky" based on opponent scoring. `pointsAgainst` now available via Context Extension.

#### Bounce-Back Candidate Generator (planned)

Identifies owners trending down who historically recover — combines Volatility + Trending Down signals.

#### Insights — "See All" Dedicated Page (planned)

Full-page view of all insights for a league, accessible via "See all →" from the overview panel. Grouped by category, full descriptions, lifecycle filtering.

#### Insights Engine — Two Weekly In-Season Pulses (planned)

Enrich the existing insights panel on the overview page with contextual, data-driven narrative content. The panel structure is already built — this campaign populates it with meaningful insights that adapt automatically based on lifecycle state (offseason / preseason / in-season / postseason).

**Core principle:** Every insight must tell the user something they couldn't figure out just by reading the table. No restating visible data without a compelling angle.

**Placement:** 2–3 highlight insights on overview page (existing panel); full pulse on dedicated tab.

**Content adapts by lifecycle state:**

- **Offseason / Preseason:** History-based insights (defending champion, drought, collapse), draft-based insights (conference concentration, diversity, AP poll rankings per owner), schedule strength projections
- **In-season:** Two weekly pulses — Look Back (Monday 6am ET) and Forward Look (Thursday 6am ET)
- **Postseason:** Championship race narrative, bracket implications, owner vs owner outcomes

**Two weekly in-season pulses:**

- **Monday 6am ET (11am UTC) — Look Back:** Weekend recap, notable results, standings movement, trash-talk fodder, owner vs owner outcomes, surprising performances
- **Thursday 6am ET (11am UTC) — Forward Look:** Games to watch this weekend, owner vs owner collision preview, rivalry implications, who needs a win

**Data sources (tiered by availability):**

- **Always available:** League history archive, current standings, owner rosters, head-to-head records
- **August onward:** AP poll rankings per owner, preseason projections vs actual; schedule strength per owner (ranked opponent count, aggregate SP+)
- **In-season:** Game stats (via Game Stats Pipeline), form/momentum, owner vs owner matchup frequency

**Insight categories:**

- Historical context ("Maleski's runner-up finish is the closest gap in 4 years")
- Cross-table connections ("Pruitt leads standings but has the hardest remaining schedule")
- Owner vs owner narrative ("Ballard has never beaten Pruitt in 6 matchups")
- Championship race ("Three owners within 2 games of first with 4 weeks remaining")
- Trash-talk fodder ("Shambaugh's teams have been outgained in 3 straight weeks")
- Projection vs reality ("Jordan's roster was rated highest by SP+ but sits 8th")

**Tone:** Mix of dry stats, narrative storytelling, and light humor.
**Prerequisite:** Game Stats Pipeline ✓, Insights Engine Foundation ✓, Insights Engine Generators and Wiring ✓

**Future polish (non-blocking):** Remove dead view model properties `keyMovements`, `leaguePulse`, `shouldShowLeaguePulse` from `selectOverviewViewModel` — computed but never read by any component.

---

### Draft

#### Slow Draft Mode (planned)

Enable async drafts where owners have a configurable window to make each pick rather than requiring everyone online simultaneously.

- **Use case:** Family leagues, geographically distributed leagues, casual leagues where coordinating a live draft is impractical
- **How it works:**
  - Commissioner configures pick window duration (e.g. 24 or 48 hours) in draft settings
  - When it's an owner's turn, they are notified (email or in-app) that they're on the clock
  - Owner logs in within the window to make their pick
  - If the window expires without a pick, auto-pick fires and advances to the next owner
  - No live countdown timer — replaced with a deadline display ("Pick by Monday 6pm")
  - Draft board shows all picks made so far and available teams, same as live draft
  - Commissioner retains undo and override controls
- **Settings additions:** Pick window duration (hours); notification timing (e.g. at 50% and 25% of window remaining)
- **New infrastructure required:** Email notification pipeline — not currently in place
- **Dependencies:** Email notification system (new), draft settings UI update

#### Draft Difficulty Settings (planned)

- Auto-pick algorithm configuration (random, SP+ rating, preseason rank)
- Team data visibility controls during draft (show/hide SP+ ratings, win totals, schedule insights)

---

### Platform

#### Provider Refresh Observability & Automation (PLATFORM-086)

The provider campaign: truthful refresh observability (complete), then narrow correctness follow-ups, then automation — correctly sized, cohesive PRs under the campaign's PR-sizing rule (detailed plan, task boundaries, and execution order live in `docs/next-tasks.md` → Active priorities #1).

Provider limits (canonical): CFBD Tier 1 = 5,000 calls/month; The Odds API = 500 credits/month (current request cost 3 credits; Odds automation targets ~450 credits with a ~50-credit safety buffer).

- **PLATFORM-086A — provider-refresh observability foundation ✓ Complete (PR #391).** Durable per-dataset refresh status with typed canonical scopes and per-scope attempt ordering; cross-scope completion-token rejection; durable operator settings (global noncritical pause + per-dataset enable); `/admin/diagnostics` Provider Data Status panel with manual refresh; cache-aware missing-data diagnostics; CFBD quota normalization (Tier 1 = 5,000); user-facing freshness labels; CFBD as the sole normal score provider (automatic ESPN fallback removed); durable-first commits; empty-response/schema-drift classification; schedule `week + all` read-time cache composition.
- **PLATFORM-086G1 — CFBD score & quota truthfulness ✓ Complete (PR #394).** Contextual target-scoped Scores empty classification (`cfbd-empty-unexpected` failures retain prior-good data; legitimate empties stay no-ops); CFBD quota missing/malformed fields resolve to unavailable, never false exhaustion.
- **PLATFORM-086G2 — Odds boundary & usage truthfulness ✓ Complete (PR #395).** Malformed/schema-drift/unexpected-empty Odds payloads rejected before commit (`odds-invalid-payload` / `odds-schema-drift` / `odds-empty-unexpected`, prior-good retained; legitimate empties stay no-ops, with prior events reconciled against the canonical slate via a typed identity-certainty state model); odds-usage read failure now distinct from snapshot absence end to end. Separate PR from G1 (different provider family).
- **PLATFORM-086H — game-stats recovery (in progress — staged).** 086H1 data-contract foundation ✓ complete (PR #396, dormant). 086H2 durable merge service ✓ complete (PR #397, dormant; single-client advisory-lock transaction, observation fencing, conservative field merge). 086H3 atomic contract activation is **decomposed into prerequisite PRs A–E** (a first single-branch attempt was frozen as a read-only salvage reference after an architecture audit; frozen design in `docs/ai/platform-086h3-contract.md`): A durable multi-key transaction primitive → B revision lineage/ledger + status chronology + operator repair + activation-control fence → C canonical evidence (participant-validated coverage, one duplicate authority) → D recovery/orchestration → E final atomic activation. **This lineage/revision A–E sequence is SUPERSEDED (see below).** **086H3A — durable multi-key app-state transaction primitive — MERGED into `main` (PR #398)** (dormant; production HTTP behavior byte-identical to `main`). B as designed is superseded; C/D remain unimplemented; final activation remains E. Deferred: 086H4 diagnostics + panel no-op wording, legacy-row migration. Nothing activated yet. **086H3B superseded (2026-07 audit):** the revision/status-authority branch is frozen as reference and NOT merged (game stats are reconstructible provider projections; permanent lineage/revision/repair defend a scenario this app cannot have). It is replaced by a small **fenced legacy writer** (serialized partition write gated on a durable `game-stats-writer-control` record; initialize the row before deploy — `npm run init:writer-control`); C/D/E are redefined without lineage/revision/repair. See `docs/ai/game-stats-writer-fence.md`.
- **PLATFORM-086I — settings feedback (planned).** Render stored pause/toggle mutation errors beside their controls.
- **PLATFORM-086B — live-score polling (planned).** Schedule-armed ~3-minute polling only; never bundled with Odds.
- **PLATFORM-086C — Odds polling (planned).** ~6-hour baseline with modest pre-kickoff priority; separate from live scores.
- **PLATFORM-086E1 / 086E2 — slow jobs (planned, separate PRs).** Weekly active-season schedule refresh with an **operation-aware** settings gate: general weekly maintenance is noncritical (honors the global pause and schedule toggle), while the postseason/championship-slate refresh that establishes a trustworthy season-rollover boundary is **lifecycle-critical and exempt** — like the season-transition/rollover operations themselves — so rollover never depends solely on data operators can pause, proceeds only from an authoritative championship boundary, and an empty/partial postseason slate never authorizes it; rankings publication refresh (AP/Coaches Sundays 22:00 UTC, CFP Wednesdays 04:00 UTC — cadence fixed in code/`vercel.json`, never admin-editable).
- **PLATFORM-086F — admin diagnostics information-architecture redesign (planned, last).** After the real automation jobs exist.
- **PLATFORM-086D — absorbed into 086A (retired).** Operator controls shipped with 086A; only the 086I error-rendering remnant remains.
- **Conferences remain manual** — no automation task.

#### Multi-tenant Commissioner Sign-up (planned)

Extend Clerk auth to commissioner and member roles. Enable commissioner self-registration and invite-based league access.

- Commissioner role enforcement on `/league/[slug]/draft/*` and `/admin/[slug]/*` routes
- Commissioner self-registration and invite link flow
- League-scoped permissions in Clerk `publicMetadata`
- Member login and personalized views
- `ADMIN_API_TOKEN` full removal

**Longer-term vision:**
If the app grows beyond manually managed leagues, the minimal viable expansion is lightweight commissioner signup — not a full SaaS platform.

- Commissioner signup flow — create an account, name a league, receive a shareable URL
- No per-member accounts or permissions
- No visibility controls — league URL is the access mechanism
- League picker UI for commissioners managing multiple leagues
- Only warranted if multi-league support is actively used by multiple leagues **and** manual commissioner management becomes a bottleneck. Full SaaS auth is out of scope indefinitely.

#### Server Action Auth Hardening (planned)

Enforce commissioner role on all mutating server actions. Remove `ADMIN_API_TOKEN` fallback from public routes.

#### AppStateStore Caching — Egress Optimization (planned)

Server-side caching for insights panel output (1-hour TTL) and archive reads (longer TTL — archives do not change between games). Single biggest egress-reduction lever available before August draft. Neon Launch tier provides 50 GB/month but active-season + draft-day traffic could push limits without caching. **Season-launch-blocking priority.**

- **Backlog slug (provisional):** `APPSTATESTORE-CACHING-v1`

#### Server Fetch Architecture Audit (planned)

Audit server-side routes that fetch their own API endpoints (e.g. `/league/[slug]/insights` fetching `/api/insights/...`) and evaluate whether they should instead call the underlying selector or data function directly. The current pattern requires URL construction via headers (`x-forwarded-host`, `x-forwarded-proto`), which surfaced a silent-failure bug during INSIGHTS-017 code review (`ALL-INSIGHTS-SCHEME-FIX`). Direct selector calls would eliminate the URL-construction class of bugs entirely and reduce latency by removing the self-fetch hop. Priority: low — "when you have time" cleanup, not urgent. Scope: codebase audit first, then scoped fixes per route.

- **Backlog slug (provisional):** `SERVER-FETCH-ARCHITECTURE-v1`

#### Season Rollover UI and Cron ✓ Complete

- `SeasonRolloverPanel` in `/admin/data/cache` — two-phase preview/execute flow with per-league champion + top 3 display and destructive confirm guard
- `GET /api/cron/season-rollover` — daily cron triggers when `championshipDate + 7 days` has passed, archives all non-test season-state leagues and transitions them to offseason
- TSC successfully rolled over via the new panel
- `vercel.json` now has three cron jobs: season-transition, game-stats, season-rollover
- See `docs/completed-work.md` for full detail.

#### Clerk Production Instance Migration ✓ Complete

- Migrated from Clerk development instance to production instance
- DNS configured, session token customized, production keys set in Vercel
- Commissioner account created with `platform_admin` role; all auth flows verified

#### Custom Domain Setup ✓ Complete

- `turfwar.games` and `tscturfwar.com` registered via Porkbun
- `turfwar.games` connected to Vercel production via A record
- `tscturfwar.com` → `https://turfwar.games/league/tsc` permanent 301 redirect in `vercel.json`

---

### Polish

#### Design Audit — Remaining Pages (planned)

Continue the systematic page-by-page UI/UX review. Phases 7A–7F complete; remaining:

- **Matchups page** — Review and improve layout, information density, interaction model
- **History page** — Review history landing, season detail, owner career for design consistency
- **Members page** — Review member-facing views

#### Copy / UX Writing Audit (planned)

Systematic review and rewrite of all user-facing strings for consistent voice and quality before public launch.

- Inventory all UI copy: headings, subheadings, labels, empty states, error messages, button text, tooltips, banners
- Apply a single consistent voice: concise, direct, league-aware, no filler phrases
- Identify and fix copy that is generic, redundant, inconsistent, or that reveals implementation details to members
- Flag any places where new-name "Turf War" branding can be reinforced
- No logic changes — copy only

#### Back Button Audit (planned)

- App-wide review of back links: styling consistency, copy, destinations
- Ensure all "← Back" links follow a single visual pattern and navigate to the correct parent

#### Aliases Platform Migration (done — with one goal superseded)

- ✅ Alias-model sequence complete (PLATFORM-055 → 067): stored global scope is the primary alias store; the hidden league editor and league-scoped runtime layer were removed (PLATFORM-064/067). Final runtime precedence: **stored global → year → SEED_ALIASES**.
- **Superseded goal:** "remove legacy year-scoped alias support code" is no longer pursued — the accepted final model (PLATFORM-067) **intentionally retains the year scope as a runtime layer** below stored global. Year-scoped aliases are a supported precedence tier, not legacy code pending deletion.

#### History Page — Filter Former Owners (planned)

- Add a "filter former owners" tab or toggle on the history page so members can collapse the view to active roster only
- Current state: former owners are visually distinguished (muted + badge) but still occupy table rows; some members will want a strict active-roster view

#### History Rework — Career Stats Surface (planned)

History page polish plus a dedicated career stats surface. Unblocks Tier 2 insight routing currently returning `null` from the panel-layer resolver (`career_points_leader`, `career_turnover_margin`, `milestone_watch-points` render without arrows today). Also improves the destination quality for insights already routing to the history page.

- **Backlog slug (provisional):** `HISTORY-REWORK-v1`

#### Standings Page — Preseason State (✅ shipped)

Preseason content for the standings page. Three-state progression:

- **Offseason:** prior season's final standings (✓ built via STANDINGS-SUBHEADER-FIX)
- **Preseason:** owner rows when owner data is seeded (draft CSV or preseason owners); a "Season starts {date}" placeholder only when no owner data exists yet (the empty `preseason-awaiting-kickoff` path)
- **Active season:** live data (existing behavior)

Shipped in the Season Launch Hardening campaign (Phase 2, commits `88af434` + `43516b0`; see `docs/campaigns/season-launch-hardening.md`). The cold-cache safety net is in place: the standings selector emits a `preseason-awaiting-kickoff` source carrying an `inferredSeasonStart` (from the schedule probe), and consumers render an explicit placeholder instead of a silently-blank page. No `seasonStartDate` league-config field was required — season start is inferred from the schedule probe. Verified docs-stale and reconciled in DOCS-003.

#### Standings Page — Lifecycle Labeling Sweep (planned)

Broader "Offseason" vs "{year} Season" label inconsistency audit across surfaces beyond the standings page itself. STANDINGS-SUBHEADER-FIX addressed the standings page; other surfaces may still show stale or contradictory year/lifecycle labels during offseason.

- **Backlog slug (provisional):** `STANDINGS-PAGE-LIFECYCLE-LABELING-v1`

#### Link Styling Audit (planned)

App-wide standardization of "view more" / "full view" / "see all" cross-links. Current state is split: blue `↗` arrow icons on history page panels and Overview column headers (Standings, AP Poll) vs. muted `→` on the Insights "See all" link. Chosen convention: muted text + horizontal arrow. Removes redundant blue accent on already-interactive links, aligns with `DESIGN.md`'s single-purpose use of blue for interactivity.

- **Backlog slug (provisional):** `LINK-STYLING-AUDIT-v1`

---

## Completed work (summary)

All completed work is detailed in `docs/completed-work.md`. Key milestones:

| Campaign                                            | Status                      |
| --------------------------------------------------- | --------------------------- |
| Architecture Stabilization                          | ✅ Complete                 |
| Production Hardening                                | ✅ Complete                 |
| League UX / Engagement                              | ✅ Complete                 |
| Overview Visual Redesign                            | ✅ Complete                 |
| Overview Trends Visual Sweep                        | ✅ Complete                 |
| Multi-League Support                                | ✅ Complete (PRs #192–#196) |
| Historical Analytics (all subphases)                | ✅ Complete                 |
| Draft Tool (all subphases P5A–P5D)                  | ✅ Complete                 |
| Admin Cleanup and Auth (P6A–P6E)                    | ✅ Complete                 |
| Product Design Audit (7A–7F)                        | ✅ Complete                 |
| Commissioner Self-Service                           | ✅ Complete (PRs #252–#256) |
| Season Lifecycle (P7B-4 through P7B-7)              | ✅ Complete                 |
| Season Transition Workflow                          | ✅ Complete                 |
| Dry Run Polish                                      | ✅ Complete                 |
| App Naming: Turf War                                | ✅ Complete                 |
| Clerk Production Migration                          | ✅ Complete                 |
| Custom Domain Setup                                 | ✅ Complete                 |
| Game Stats Pipeline                                 | ✅ Complete (PRs #274–#275) |
| Insights Engine Foundation                          | ✅ Complete (PR #276)       |
| Insights Engine — Generators and Wiring             | ✅ Complete (PR #278)       |
| Season Rollover UI and Cron                         | ✅ Complete (PR #278)       |
| History Page Polish                                 | ✅ Complete (PR #278)       |
| Insights Engine — Context Extension                 | ✅ Complete                 |
| Insights Engine — Generator Batch 2                 | ✅ Complete                 |
| Copy Variation Architecture                         | ✅ Complete                 |
| Insights Panel UI Redesign + Polish                 | ✅ Complete                 |
| Pairing Cards                                       | 🔄 Planned                  |
| Luck Score + Bounce-Back Generators                 | 🔄 Planned                  |
| Insights — "See All" Page                           | 🔄 Planned                  |
| Insights Panel — Microlabel Palette                 | 🔄 Planned                  |
| Insights Ranker — Priority Tuning                   | 🔄 Planned                  |
| History Rework — Career Stats Surface               | 🔄 Planned                  |
| Standings Page — Preseason State                    | ✅ Complete                 |
| Standings Page — Lifecycle Labeling Sweep           | 🔄 Planned                  |
| Link Styling Audit                                  | 🔄 Planned                  |
| AppStateStore Caching — Egress Optimization         | 🔄 Planned                  |
| Server Fetch Architecture Audit                     | 🔄 Planned                  |
| Standings Ownership Model Redesign (Phases 0–5)     | ✅ Complete                 |
| Provider Refresh Observability (PLATFORM-086A)      | ✅ Complete (PR #391)       |
| Provider Automation & Correctness (PLATFORM-086B–I) | 🔄 In progress              |

## Architecture rules

See `AGENTS.md` (canonical) for current architecture principles; the original formulation is preserved historically in `docs/archive/governance/cfb-engineering-operating-instructions.md` Section 5.
