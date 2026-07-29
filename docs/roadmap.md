# CFB App Roadmap

Status: Current
Last verified: 2026-07-26
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

- **Data source:** CFBD `game_team_stats` (`/games/teams`) endpoint, returning all team stats for all games in a partition. _(The original design made one call per week; the active PLATFORM-086H3E poll is bounded per-run instead — see API cost below.)_
- **Storage:** Cached in `appStateStore` by week, same pattern as scores
- **Cron:** originally Monday 11am UTC — fetch weekend game stats. _(Superseded by PLATFORM-086H3E: the game-stats poll now runs every 15 minutes, triggered by the external QStash schedule `turfwar-game-stats-15m`, and is no longer declared in `vercel.json` — which keeps only the daily season-transition and season-rollover lifecycle crons.)_
- **Owner aggregation:** `aggregateOwnerGameStats()` resolves teams via `TeamIdentityResolver`, attributes stats per owner at query time
- **Stats available:** Yards gained/allowed, turnovers, turnover margin, third-down conversion %, time of possession, plus 6 special teams return stat fields
- **API cost (original weekly design — historical/superseded):** ~19 additional calls per season. _(Superseded by the PLATFORM-086H3E bounded polling model: **zero** CFBD calls when no eligible target exists; **at most one** `/games/teams` call per eligible 15-minute run; an unresolved partition may be re-fetched on later runs while it stays inside the 3–24h post-kickoff window, and later kickoff windows create further eligible runs; automation halts at the 1,000-call monthly reserve. There is no fixed per-week or per-season total under this model.)_ Both models stay well within the CFBD Tier 1 limit (5,000 calls/month).
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
- **PLATFORM-086H — game-stats recovery (production active; broader follow-ups deferred).** The staged H1/H2/H3 sequence is merged and the reviewed code-bearing artifact (`a161e33`) is active in production with writer control durably `active`; the 15-minute QStash trigger is provisioned, and both automation gates are open. **Activation is fully closed (2026-07-26):** gates-open scheduled deliveries returned HTTP `200` with CFBD quota unchanged at `4920` (no eligible partition ⇒ no provider attempt), and Auto-assign Custom Production Domains is re-enabled. The next related work is the separate **PLATFORM-086F** secret-safe scheduler-logging slice. Broader presentation/copy work (086H4) and legacy-row migration remain deferred.
- **PLATFORM-086I — settings feedback ✓ Complete (MERGED to `main` via PR #413, merge commit `da99a11`, 2026-07-27).** The stored global-pause and interactive dataset auto-refresh toggle mutation errors now render as accessible `role="alert"` regions beside their control (conditional `aria-describedby`), authoritative-state preserved; client-only, no diagnostics-page redesign (that stays 086F).
- **PLATFORM-086B — live-score polling, SPLIT into B1 (engine) + B2 (activation).** Schedule-armed live-score polling only; never bundled with Odds.
  - **B1 — polling engine ✓ complete, MERGED to `main` via PR #416 (merge commit `4cbea60`, 2026-07-27); DORMANT; no QStash schedule active.** `GET /api/cron/live-scores` is production-capable but unscheduled: cache-only canonical context → schedule-armed target selection over the `[-15 min, +24 h]` kickoff window → exactly one billed CFBD `/scoreboard` or `/games` request → durable per-partition score merge (monotonic + per-row freshness + pending-final metadata) → `/games` final reconciliation → per-week-partition scoped status → one secret-safe `live-scores-cron` runtime event. Claude self-review + three Codex rounds converged.
  - **B2 — activation, split into B2A (writer-lock convergence) + B2B (activation).**
    - **B2A — score-writer lock convergence ✓ complete, MERGED to `main` via PR #417 (merge commit `4039c98`, 2026-07-28); DORMANT.** A code-only concurrency-safety prerequisite: the manual `/api/scores?refresh=1` durable write now commits through the same per-key advisory transaction the live engine uses (authoritative partition replacement + newer-live-row/monotonic-advance protection + monotonic entry version), resolving the B1 deferral. No activation. Claude self-review + five Codex rounds (P1 then P2 merge-policy corners), all remediated and inert while dormant.
    - **B2B — activation ✓ complete, MERGED to `main` via PR #418 (merge commit `57fab82`, 2026-07-28); ACTIVATED IN PRODUCTION 2026-07-28.** The code activation (shared secret-safe QStash schedule manager + `npm run manage:live-scores-schedule`; self-rescheduling 3-minute visible-tab browser polling + eligibility; `fetchScoresByGame` exact-partition `live=1` durable-reconciled reads via `loadReconciledWeekScores`; durable-snapshot "Scores updated …" label vs. a separate observation-time, clock-reactive live-overlay `isStale`; correction-aware `detectScoreFinalizations`; `scores` descriptor flipped to active + setting-consumed) that makes the B1 engine live. Claude self-review + eight Codex passes (12 remediated / 1 deferred: per-game overlay freshness). **Production live:** QStash `turfwar-live-scores-3m` active/unpaused every 3 minutes; Scores auto-refresh On, global pause Off; browser polling cache-only; `vercel.json` unchanged. Activation proofs + emergency-stop/`CRON_SECRET`-rotation in `docs/deployment-runbook.md` §8f.
- **PLATFORM-086C — Odds polling, SPLIT into C1 (refresh authority) + C2 (activation).** ~6-hour baseline with modest pre-kickoff priority; separate from live scores. The C1/C2 split mirrors 086B (engine/activation) and preserves the campaign execution order (086C1 → 086C2 → 086E1 → 086E2 → 086F2).
  - **C1 — Odds refresh authority & writer convergence ✓ complete, MERGED to `main` via PR #419 (merge commit `b9c6cb3`, 2026-07-28); DORMANT.** A code-only concurrency-safety prerequisite: every durable Odds writer (manual refresh, the future automatic refresh, public closing-line maintenance) converges onto one durable token-safe per-target lease (`odds-refresh-control`, 5-min, 1h/2h/6h/12h/24h backoff) + observation-ordering contract; the raw odds cache and durable per-game store commit atomically in one multi-key advisory transaction with process caches/success published only after the confirmed commit; a concurrent manual refresh returns a truthful `409 / odds-refresh-in-progress`. The Central-date-bounded polling cadence (6h baseline / 2h pregame), the automatic quota gate (cost 3, 50-credit reserve, quota-free `/sports` probe), the cache-only canonical context, and the typed shared refresh-result are built but **dormant** — wired to no route/scheduler. Independent Claude + Codex reviews; all credible findings remediated; no provider quota spent. `odds` descriptor stays inactive + setting-unconsumed.
  - **C2 — Odds polling activation ✓ complete, MERGED to `main` via PR #420 (merge commit `262fdf0`, 2026-07-28); ACTIVE in production (the deployment-runbook §8g activation sequence has been executed).** Activated C1 in CODE ONLY: the manual `/api/odds?refresh=1` and the new automatic `GET /api/cron/odds` share one server-side execution authority (`oddsRefreshExecutor.ts`); the pre-existing `ODDS_API_KEY`-in-error-body leak is closed (upstream URL/message redaction); the cron authenticates `CRON_SECRET`, honors `isAutoRefreshAllowed('odds')`, decides cadence purely, and — only when due — takes the durable lease (fresh-clock timestamped) + a post-acquisition cadence re-check (no duplicate spend), the quota-free `/sports` probe + 50-credit reserve, and at most ONE billed `/odds`, emitting one secret-safe `odds-cron` event; public `/api/odds` becomes strictly durable-cache-only with a bounded 120 s memo; quota accounting is conservative + self-healing; the QStash CLI (`manage:odds-schedule`, id `turfwar-odds-hourly`) and the Odds descriptor flip ship. Converged over 4 remediation cycles + a clean confirming Codex round; full `npm test` 2435/2435; no provider quota spent. **The §8g operator sequence has since provisioned `turfwar-odds-hourly` — automatic Odds polling is active in production.** Next: 086E1 → 086E2 → 086F2.
  - **C3 — Odds cache UI hydration ✓ implemented + review-converged; MERGED to `main` via PR #421 (merge commit `8029136`, 2026-07-29).** A bounded **client-display** follow-up to C2's production rollout (NOT a reopening of C2 activation): the browser previously only loaded Odds when a visible game sat inside the retired `refreshPolicy` `[-12h, +3d]` window, so cached lines for far-future and completed games never reached their cards. A new `useOddsHydration` hook now hydrates canonical Odds from the durable cache **per season, regardless of kickoff time** (cache-only `GET /api/odds?year=<season>`, no `refresh=1`/auth, provider-free, AbortController stale-season guard, re-arming on a `scheduleGeneration` bump so an in-place schedule reload re-hydrates); `useLiveRefresh` no longer fetches Odds on bootstrap (the dormant manual-refresh seam is preserved); and the kickoff-window policy is retired (`getRefreshPlan` + the already-dead `scores` sub-plan removed, `LIVE_MANUAL_COOLDOWN_MS` kept). **Server-side Odds polling cadence/quota/lease, the public read-only route, QStash, `vercel.json`, and automation gates are all unchanged.** Review converged: Codex r1 clean → Claude `/code-review` 4 low findings fixed → Codex cycle-2 1 P2 fixed → confirming round 1 more P2 fixed; +23 focused tests; full `npm test` 2455/2455; no provider or production request.
- **PLATFORM-086E1 — weekly schedule refresh, SPLIT into E1A (refresh authority) + E1B (weekly automation + operator gate) + E1C (broadcast/venue presentation enrichment).** The split mirrors 086B/086C (authority/activation) and preserves the campaign order (086E1A → 086E1B → 086E1C → 086E2 → 086F2).
  - **E1A — schedule refresh authority ✓ complete, MERGED to `main` via PR #422 (merge commit `f320a7e`, 2026-07-29); DORMANT.** The correctness prerequisite for weekly automation: every production full-season schedule writer — the authorized full-year `/api/schedule?bypassCache=1` refresh, the season-transition cron, and the historical schedule repair — converges onto ONE shared authority (`src/lib/schedule/fullSeasonScheduleRefresh.ts`). It owns a durable token-safe per-year lease (`schedule-refresh-control/<year>`, 5-min, no backoff), the regular+postseason fetch with the shared complete-before-commit gate (thrown/non-array/nonempty-normalizes-to-zero → reject aggregate + retain prior-good; all-empty-over-populated → rejected; genuine all-empty → no-op no write), an observation-ordered `withAppStateKeyTransaction` commit on `schedule/<year>-all-all` (durable-first → process cache → standings invalidation only on content change → provider-status), and token-checked release; a concurrent full-year refresh returns `409 / refresh-in-progress` with NO provider request; a typed closed-vocabulary refresh-result is the single truth callers consume. The rollover boundary is hardened: rollover requires a **structured** (`playoffRoundSource === 'cfbd-structured'`) CFP national-championship game — a real numeric provider id + valid kickoff + structured competition/round from CFBD's nested `playoff` object — a CONFIRMED complete final via the centralized score attachment, and the existing seven-day gate; the "latest postseason game" fallback is removed; leagues are grouped by year and evaluated independently; a genuine durable read failure surfaces as a failure, never ordinary absence. Useful no-extra-call schedule metadata is retained provider → cache → canonical `AppGame` (`startTimeTBD`, `venueId`, `completed`, `playoffCompetition`, `playoffRound`, `playoffRoundSource`); the raw provider `playoff` object/row is never persisted. **Dormant — no scheduler, no settings activation, no enrichment fetch, no weather, no UI, no `/api/cron/schedule-refresh`; no provider quota spent.** Independent Claude review (clean) + Codex review converged over 2 cycles (cycle 1: 3 findings — 2 P1 provenance, 1 P2 stale-cache; cycle 2: a hung/cancelled Codex round, then fresh Codex + Claude both caught 1 non-FBS eventKey-guard regression — all remediated); full `npm test` 2497/2497.
  - **E1B — weekly automation + operator gate activation ✓ complete, MERGED to `main` via PR #423 (merge commit `2ddf5c4`, 2026-07-29); DORMANT (no QStash schedule provisioned — §8h activation PENDING).** `GET /api/cron/schedule-refresh` (external QStash trigger `turfwar-schedule-weekly`, Tuesdays 12:00 UTC — provisioned only by the runbook **§8h** operator sequence, never at merge) authenticates `CRON_SECRET`, targets every distinct active `season` year cache-only (registry `status.year`, ascending), and delegates each allowed year ONCE to the E1A authority. The **operation-aware** gate is a pure classifier (`weeklyRefreshOperation.ts`): before `latestRegularKickoff − 7d` a year is **ordinary-maintenance** (honors the global pause + the now-interactive Schedule toggle via a strict `isAutoRefreshAllowed` — its descriptor-based lifecycle bypass is removed; lifecycle routes stay exempt by not calling it, source-scan-pinned), at/after it is **postseason-boundary** — lifecycle-critical, exempt, never consults settings — so an operator pause can never starve the season-rollover boundary; a settings-store failure blocks only ordinary years. E1A results carry `providerCallAttempted` instrumentation; one secret-safe `schedule-refresh-cron` event per invocation (aggregate skipped/success/partial/no-op/failure; a skipped ordinary year never makes a critical success partial); controlled outcomes are HTTP 200 (QStash delivered; the event holds the truth). New shared-manager-bound CLI `manage:schedule-refresh-schedule` (fixed contract, retries 0, forwarded+redacted Authorization, read-only default, `--apply`-gated, no delete); `CRON_SECRET` rotation now spans all FOUR schedules. `vercel.json` UNCHANGED (lifecycle crons only — test-pinned). Criticality is STICKY via a durable per-year boundary latch (`schedule-weekly-control/<year>`, cycle-1 remediation) so a reschedule moving the latest regular kickoff later can never revert a critical year to operator-gated ordinary maintenance. Supersedes the unimplemented v1 prompt (which mis-selected Vercel Cron): the scheduling boundary is external provider polling → QStash, internal lifecycle reconciliation → Vercel Cron. Review converged: independent Claude review clean; Codex round 1 — 3 findings (P1 boundary-revert latch, P2 malformed-seasonType context refusal, P2 truthful partial `rowsReceived`) all remediated; Codex round 2 clean. Full `npm test` 2550/2550; no QStash/CFBD/production contact. **ACTIVATION was HELD post-merge for the preseason coverage gap (E1B targeted only `season` leagues while season-transition refreshes preseason only when unarmed or within 7 days); the bounded correction E1B1 (below) has since MERGED — the §8h operator sequence may now proceed.**
  - **E1B1 — preseason weekly coverage ✓ complete, MERGED to `main` via PR #424 (merge commit `587d5e3`, 2026-07-29); DORMANT (QStash still unprovisioned — §8h may now resume).** The bounded correction closing the E1B preseason freshness gap before provisioning `turfwar-schedule-weekly`. Ownership model: preseason with an unarmed schedule/probe → the DAILY season-transition cron owns discovery; preseason with the first game known and MORE than 7 days away → weekly E1B **ordinary** maintenance (new `preseason-maintenance` operation — honors the pause + Schedule toggle, blocked by a settings failure, never touches the postseason latch); preseason within 7 days of the first kickoff → season-transition owns freshness + the lifecycle transition (`skipped / season-transition-owner`, an intentional provider-free deferral mirroring transition's exact `shouldFetch` comparison — pinned by tests on both sides); active season / postseason-boundary → the existing E1B policy, UNCHANGED (sticky latch intact; a mixed `season`+`preseason` year executes once under the active-season policy; E1A is never invoked twice per year). The no-target reason is corrected `no-active-season` → `no-maintenance-target` (contract updated directly — E1B was never activated, so no emitted alias); a new per-year/top-level `season-transition-owner` reason distinguishes deferral from gating/failure, and deferrals are skips that never make a sibling success partial. Genuine store read failures and armed-probe/missing-schedule contradictions stay `canonical-context-unavailable` — never converted into deferrals. No E1A storage/fetch change, no lifecycle mutation, no QStash contract/CLI/`vercel.json` change. A successful `preseason-maintenance` refresh re-derives the probe’s `firstGameDate` from the committed schedule (cycle-1 remediation) so the transition handoff tracks the freshest committed first game. Review converged: independent Claude review clean (exhaustive predicate-mirror property comparison); Codex round 1 — 1 P1 accepted + remediated (stale-probe handoff), 1 P2 rejected as contradicting the explicit within-seven-days deferral specification; Codex round 2 clean. Full `npm test` 2582/2582; no QStash/CFBD/production contact.
  - **E1C — broadcast/venue presentation enrichment (later, separate PR).** Optional presentation-layer enrichment (broadcasts, venue details) built on the retained schedule metadata; strictly non-authoritative for rollover.
- **PLATFORM-086E2 — rankings publication refresh (planned, separate PR).** AP/Coaches Sundays 22:00 UTC, CFP Wednesdays 04:00 UTC — cadence fixed in code/`vercel.json`, never admin-editable.
- **PLATFORM-086F1 — game-stats cron execution logging ✓ Complete (MERGED to `main` via PR #414, merge commit `a7f5db2`, 2026-07-27).** `GET /api/cron/game-stats` emits one secret-safe, single-line `game-stats-cron` JSON event per run (Vercel Runtime Logs) for skips, every outcome (incl. `partial`), auth failures, and throws — allowlisted fields only (`result`/`reason`/`year`/`week`/`seasonType`/`quotaChecked`/`providerCallAttempted`/`committedGames`/`durationMs`), no durable state, no admin-UI change, no fabricated provider-refresh attempt. Pulled ahead of 086B operationally.
- **PLATFORM-086F2 — admin diagnostics information-architecture redesign (planned, last).** The broader dashboard redesign (system-health summary, severity-ordered issues, comparable dataset health, organized legacy-tool drill-down); an independent last-scheduler-check heartbeat is an optional panel enhancement, kept distinct from provider-refresh status. Comes after the real automation jobs exist.
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

#### AppStateStore Caching — Egress Optimization ✓ Complete

Server-side caching for insights panel output and archive reads to cut repeated Postgres reads (and egress) on the hot history/insights paths. **Shipped** as the `APPSTATESTORE-CACHING` campaign, split into PLATFORM-082A (archive read cache — `React.cache` over `unstable_cache` with tag-only invalidation centralized in `saveSeasonArchive`) + PLATFORM-082B (insights output cache — `loadInsightsForLeague` caches the context-build + raw generation, suppression runs per-request to preserve fire-once). Both merged; failures are never cached (extended to the standings selector by PLATFORM-084A). See `docs/architecture/storage-and-caching.md`.

- **Slug:** `APPSTATESTORE-CACHING` (082A + 082B) — complete.

#### Server Fetch Architecture Audit (planned)

Audit server-side routes that fetch their own API endpoints (e.g. `/league/[slug]/insights` fetching `/api/insights/...`) and evaluate whether they should instead call the underlying selector or data function directly. The current pattern requires URL construction via headers (`x-forwarded-host`, `x-forwarded-proto`), which surfaced a silent-failure bug during INSIGHTS-017 code review (`ALL-INSIGHTS-SCHEME-FIX`). Direct selector calls would eliminate the URL-construction class of bugs entirely and reduce latency by removing the self-fetch hop. Priority: low — "when you have time" cleanup, not urgent. Scope: codebase audit first, then scoped fixes per route.

- **Backlog slug (provisional):** `SERVER-FETCH-ARCHITECTURE-v1`

#### Season Rollover UI and Cron ✓ Complete

- `SeasonRolloverPanel` in `/admin/data/cache` — two-phase preview/execute flow with per-league champion + top 3 display and destructive confirm guard
- `GET /api/cron/season-rollover` — daily cron triggers when `championshipDate + 7 days` has passed, archives all non-test season-state leagues and transitions them to offseason
- TSC successfully rolled over via the new panel
- `vercel.json` carries the two daily (00:00 UTC) lifecycle cron jobs: season-transition and season-rollover. _(Historical note: this section originally added a third `game-stats` cron here; under PLATFORM-086H3E that 15-minute game-stats poll was moved off Vercel crons — Vercel Hobby rejects sub-daily cron expressions — and is now triggered externally by the QStash schedule `turfwar-game-stats-15m` calling the unchanged route, so `vercel.json` no longer declares a game-stats cron.)_
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
| AppStateStore Caching — Egress Optimization         | ✅ Complete (082A + 082B)   |
| Server Fetch Architecture Audit                     | 🔄 Planned                  |
| Standings Ownership Model Redesign (Phases 0–5)     | ✅ Complete                 |
| Provider Refresh Observability (PLATFORM-086A)      | ✅ Complete (PR #391)       |
| Provider Automation & Correctness (PLATFORM-086B–I) | 🔄 In progress              |

## Architecture rules

See `AGENTS.md` (canonical) for current architecture principles; the original formulation is preserved historically in `docs/archive/governance/cfb-engineering-operating-instructions.md` Section 5.
