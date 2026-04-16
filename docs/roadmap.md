# CFB App Roadmap

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
- **Prompt traceability.** Codex prompts should use standardized headers and stable `PROMPT_ID`s so work can be referenced and revised cleanly across phases.

Prompt format and registry guidance live in `docs/prompt-registry.md`.

## Current status

- Phase 1 architecture stabilization is complete.
- Core league surfaces are in place.
- Phase 2A production hardening is **complete**.
- Phase 2B league UX / engagement is **complete**.
- Phase 2C overview visual redesign is **complete**.
- Phase 2D overview trends visual sweep is **complete**.
- Phase 3 multi-league support is **complete**. PRs #192–#196 merged. League registry, scoped storage, routing, admin UI, and migration fallback removal all done.
- Phase 4 — Historical Analytics is **complete**. All subphases (P4A–P4D) and Historical Season Backfill Endpoint shipped.
- **Phase 5 — Draft / Owner Assignment Tool** is **complete**. All subphases (P5A–P5D) shipped. PR #214 open.
- **Phase 6 — Admin Cleanup and Auth** is **complete**. All subphases P6A–P6E shipped.
- **Phase 6 — Admin Polish and Commissioner UX** is **complete**. Gear icon, `isAdmin` prop pattern, per-league commissioner bucket (Roster/Draft/Data/Settings), `LeagueStatusPanel`, `LeagueSettingsForm`, `GlobalRefreshPanel` with explicit year. PRs #230–#233.
- **Phase 7 — Product Design Audit** is **active**. Subphases 7A–7F complete. 7G (Matchups) is next. Design principles codified in `DESIGN.md`.
- **Phase 7A — Commissioner Self-Service** is **complete**. foundedYear field, league hub status panel + setup checklist, admin light mode, aliases promoted to platform scope. PRs #252–#256.
- **P7B-4 — Pre-Season Setup Flow** is **complete**. Preseason page, assignment method selection, Go Live, lifecycle year sync. Branch `claude/add-league-status-field-jPzcQ`.
- **P7B-5 — Owner Confirmation Flow** is **complete**. Owner confirmation page, preseason-owners store, draft auto-populate, lifecycle year fixes, Clerk auth bridge.
- **P7B-6 — Draft Board UI Polish** is **complete**. Rosters column removed, DraftCard simplified to name/conference/dot, DraftBoardGrid color update, landing page cleanup.
- **P7B-7 — Draft Flow Polish** is **complete**. Carousel redesign, page layout/centering, timer/round fixes, draft summary page, display name resolution. PRs #262–#266.

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

## Roadmap phases

## Phase 2A — Production hardening (complete)

### Objective
Make the existing league-first app safe and efficient for hosted member traffic without rewriting the architecture.

### Key workstreams

#### 1. Production hosting readiness
- Validate hosted deployment assumptions for serverless execution.
- Remove dependence on writable local runtime files for shared production state.
- Make shared cache behavior deterministic enough for member traffic.

#### 2. Durable shared storage
- Introduce a small shared durable storage layer for commissioner-managed data.
- Keep file fallback only for local development or non-hosted scenarios if helpful.
- Ensure public/member reads consume the shared version of the data.

#### 3. Shared owner roster
- Persist the owner roster server-side so all members get the same league mapping.
- Preserve commissioner upload/edit workflows, but stop relying on per-browser local storage as the primary source.

#### 4. Shared alias persistence
- Persist alias edits durably and make all server consumers read through the same shared path.
- Preserve diagnostics and alias repair workflows.

#### 5. Admin protection for mutating routes
- Protect commissioner-only actions such as alias edits, owner uploads, forced refreshes, and team sync.
- Keep public/member reads broadly accessible.

#### 6. Persistent season data caching
- Treat schedule/reference data as shared cached state.
- Refresh these data only through admin-triggered rebuild flows.
- Ensure member traffic primarily reads cached/shared season data.

#### 7. Quota-safe scores and odds refresh
- Scores: shared cache-first with conservative freshness windows.
- Odds: especially conservative, favor existing shared snapshots and admin/manual refresh over repeated public upstream fetches.
- Avoid wasteful polling-heavy production behavior.

#### 8. Production observability and recovery tooling
- Clarify which diagnostics are authoritative versus ephemeral.
- Add recovery guidance for quota exhaustion, stale cache, alias mistakes, and owner-roster mistakes.
- Preserve commissioner-facing diagnostics for schedule/score/odds reconciliation.

#### 9. Mobile/device production validation
- Validate the hosted experience on mobile Safari, Android Chrome, and major desktop browsers.
- Confirm commissioner/admin flows remain usable enough on small screens.

### Completion criteria
Phase 2A is complete when:
- core commissioner-managed state is shared and durable
- public traffic primarily reads shared cached state
- mutating/admin flows are protected
- schedule-first architecture remains intact
- quota usage is conservative enough for the hobby-scale deployment target

## Phase 2B — League UX / engagement (complete)

Complete. See `docs/completed-work.md` for the full record.
PROMPT_ID: P2B-OVERVIEW-UX-CAMPAIGN-v1

## Phase 2C — Overview Visual Redesign (complete)

Complete. See `docs/completed-work.md` for the full record.
PROMPT_ID: P2C-OVERVIEW-REDESIGN-v1

## Phase 2D — Overview Trends Visual Sweep (complete)

See `docs/completed-work.md` for the full record.
PROMPT_IDs: P2D-TRENDS-TITLE-CHASE-v1, P2D-TRENDS-FORM-DOTS-v1, P2-OVR-TRENDS-POSTSEASON-v1, P2-OVR-TRENDS-POLISH-v1, P2-OVR-TRENDS-LABELS-v1, P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1

## Phase 3 — Multi-League Commissioner Support (complete)

Complete. See `docs/completed-work.md` for the full record.
PRs: #192–#196. PROMPT_IDs: P3-MULTILEG-FOUNDATION-v1 through P3-MULTILEG-CLOSEOUT-v1.

## Phase 4 — Historical Analytics (complete)

### Objective
Archive completed seasons and surface historical league performance for members. **Phase 3 prerequisite is satisfied** — league slugs and scoped key convention are in place; archive keys will be league-scoped from the first write.

### Design
See `docs/phase-4-historical-analytics-design.md` for the full approved design. Key decisions:
- `SeasonArchive` type wraps existing `StandingsHistory` + owner roster snapshot + `leagueSlug`
- Storage: `appStateStore` with `scope='standings-archive:${leagueSlug}', key='${year}'` — league-scoped from day one
- Dedicated `/league/[slug]/history/` route hierarchy (not `?year=` on existing pages)
- Season rollover is a global platform admin action on `/admin/`; CFP Final detection surfaces the prompt; all leagues archived atomically
- Re-archival requires diff confirmation before overwrite
- 2025 is the first archived season — no retroactive archival for prior years

### Subphases

#### P4A — Data Foundation (not started)
- `SeasonArchive` type definition
- `src/lib/seasonArchive.ts` — `getSeasonArchive` / `setSeasonArchive` wired to `appStateStore`
- `/api/history/[year]?league=${slug}` server route

#### P4B — Season Rollover and Admin Action (not started)
- CFP Final detection logic from shared game schedule
- `"Start New Season"` button on `/admin/` conditioned on CFP Final detection
- `/api/admin/rollover` — per-league archive loop, year increment, atomic action
- Re-archive diff logic with admin confirmation before overwrite

#### P4C — Season Detail UI (complete)

Complete. PR #201 merged. See `docs/completed-work.md` for full record.
PROMPT_IDs: P4C-SEASON-DETAIL-UI-v1, P4C-ARCHIVE-DATA-MODEL-FIX-v1, P4C-ARCHIVE-DATA-MODEL-FIX-v2, P4C-BUGS-v1, P4C-LINT-FIX-v1, P4C-CLOSEOUT-v1

#### Roster Upload Fuzzy Matching (complete)

Complete. PRs #202–#203 merged. See `docs/completed-work.md` for full record.
PROMPT_IDs: P4-ROSTER-UPLOAD-FUZZY-MATCH-DOCS-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-REVIEW-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2

#### P4D — League History and Owner Career UI (complete)

Complete. PR #204 merged. See `docs/completed-work.md` for full record.
PROMPT_IDs: P4D-KICKOFF-v1, P4D-LEAGUE-HISTORY-UI-v1, P4D-LEAGUE-HISTORY-UI-REVIEW-v1, P4D-LEAGUE-HISTORY-UI-FIX-v1, P4D-LEAGUE-HISTORY-UI-FIX-v2, P4D-BUGS-v1, P4D-CLOSEOUT-v1

#### Historical Season Backfill Endpoint (complete)

Complete. Shipped in same PR as P4D fixes. See `docs/completed-work.md` for full record.
PROMPT_IDs: P4-BACKFILL-v1, P4D-BACKFILL-REVIEW-v1

#### P4D Polish, Historical Cache Endpoints, and NoClaim Fix (complete)

Complete. PR #207 merged. See `docs/completed-work.md` for full record.
PROMPT_IDs: P4D-HISTORY-POLISH-v1, P4D-HISTORY-LAYOUT-v1, P4D-HISTORY-BANNER-v1, P4-HISTORICAL-SCHEDULE-CACHE-v1, P4-HISTORICAL-SCORES-CACHE-v1, P4D-NOCLAIM-FIX-v1

Key deliverables:
- All-time standings sort: championships → winPct → totalWins; Win% column added
- NoClaim owner excluded from all history views (selectors, not storage)
- History landing: asymmetric 60/40 layout (lg:grid-cols-5)
- "Season in Progress" banner card with current leader on ChampionshipsBanner
- Live season standings merged into all-time standings without crediting a championship
- History nav tab added to WeekViewTabs via leagueSlug prop
- `POST /api/admin/cache-historical-schedule` — caches CFBD schedule for a past year
- `POST /api/admin/cache-historical-scores` — caches CFBD scores for a past year
- selectOwnerCareer NoClaim early-return removed; NoClaim guard scoped to H2H matrix only

### Post-launch (not scheduled)
- Owner identity system (stable cross-season IDs)
- Season comparison views
- Upset / odds retrospectives

## Phase 5 — Draft / Owner Assignment Tool (complete)

**Status:** All subphases (P5A–P5D) complete. PR #214 open. See `docs/completed-work.md` for full record.

### Objective
Replace manual CSV owner roster uploads with a live in-app draft tool for the commissioner. The CSV upload workflow is preserved as an admin fallback.

### Subphases

#### P5A — Draft Data Infrastructure (complete)

Complete. PR #210 merged. See `docs/completed-work.md` for full record.
PROMPT_IDs: P5A-DRAFT-DATA-INFRA-v1, P5A-DRAFT-DATA-INFRA-REVIEW-v1, P5A-IDENTITY-FIX-v1, P5A-CLOSEOUT-v1

#### P5B — Draft Setup and Settings (complete)

Complete. PR #211 open. See `docs/completed-work.md` for full record.
PROMPT_IDs: P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-REVIEW-v1, P5B-DRAFT-SETUP-FIX-v1, P5B-DRAFT-SETUP-FIX-REVIEW-v1, P5B-DRAFT-SETUP-FIX-v2, P5B-DRAFT-SETUP-FIX-v3, P5B-DRAFT-SETUP-FIX-v4, P5B-CLOSEOUT-v1

#### P5C — Live Draft Board (complete)

Complete. PR #213 open. See `docs/completed-work.md` for full record.
PROMPT_IDs: P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-REVIEW-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1, P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v1, P5C-LIVE-DRAFT-BOARD-FIX-v2, P5C-LIVE-DRAFT-BOARD-FIX-v3, P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v2, P5C-CLOSEOUT-AND-P5D-KICKOFF-v1

#### P5D — Draft Summary and Confirmation (complete)

Complete. PR #214 open. See `docs/completed-work.md` for full record.
PROMPT_IDs: P5D-DRAFT-SUMMARY-v1, P5D-DRAFT-SUMMARY-REVIEW-v1, P5D-DRAFT-SUMMARY-FIX-v1, P5D-DRAFT-SUMMARY-FIX-REVIEW-v1, P5D-DRAFT-REOPEN-v1, P5D-DRAFT-REOPEN-REVIEW-v1, P5D-CLOSEOUT-v1

## Phase 6 — Admin Cleanup and Auth (active)

**Design doc:** `docs/phase-6-admin-auth-design.md`
**Status:** All subphases P6A–P6E complete. See `docs/completed-work.md` for full record.

### P6A — Clerk Setup and Login ✓ Complete
### P6B — Admin Page Restructure ✓ Complete
### P6C — Root Route and Landing Page Polish ✓ Complete

### P6D — Admin UI Restructure ✓ Complete

See `docs/completed-work.md` for full record. PR #228.

### P6E — Roster Editor ✓ Complete

Complete. PR #229. See `docs/completed-work.md` for full record.
PROMPT_IDs: P6E-ROSTER-EDITOR-v1, P6E-ROSTER-EDITOR-REVIEW-v1, P6E-ROSTER-EDITOR-FIX-v1, P6E-CLOSEOUT-v1

**Phase 6 subphases P6A through P6E are all complete.**

## Phase 7 — Product Design Audit (active)

### Objective
Systematic page-by-page UI/UX review and improvement. Design principles codified in `DESIGN.md`.

### Subphases

#### 7A — Standings page ✓ Complete
NoClaim exclusion, Win% format, DIFF colors, MOVE column at season end, ranked colors, table-as-legend, bidirectional hover/select, mode switcher removed, legend tables removed, chart improvements (Y-axis domain, convergence scaling, Final label, right edge padding, tabbed charts).

#### 7B — FBS Polls tab ✓ Complete
Built Rankings tab, postseason Final Poll week, debug pill removed, three-column layout with movement indicators.

#### 7C — Nav redesign ✓ Complete
Underline tabs, sub-nav band removed, inline content tabs, League Table / FBS Polls / Matchups tab naming.

#### 7D — Mobile standings ✓ Complete
PF/PA hidden, card borders removed, compact column set, mobile legend + scrollable chart.

#### 7E — Speed Insights ✓ Complete
Added Vercel Speed Insights to layout.tsx.

#### 7F — Overview page ✓ Complete
Featured Games redesign (renamed from Recent Results), 2-column card grid, CFP/conf championship badges with neutral slate styling, inline W16 CFP rankings, dark card styling, context-aware selection logic, blue highlight removal, First Round classification via neutral site detection. PR #241.

#### 7G — Matchups page (next)
Review and improve the Matchups tab layout, information density, and interaction model.

#### 7H — History page (planned)
Review history landing, season detail, and owner career pages for design consistency.

#### 7I — Members page (planned)
Review member-facing views for design consistency and information density.

## Phase 8 — Commissioner Self-Service (planned)

### Objective
Extend Clerk auth to commissioner and member roles. Remove `ADMIN_API_TOKEN` fallback. Enable commissioner self-registration and invite-based league access.

### Key workstreams
- Commissioner role enforcement on `/league/[slug]/draft/*` routes
- Commissioner self-registration and invite link flow
- League-scoped permissions in Clerk `publicMetadata`
- Member login and personalized views
- `ADMIN_API_TOKEN` full removal

### Longer-term vision
If the app grows beyond manually managed leagues, the minimal viable expansion is lightweight commissioner signup — not a full SaaS platform.
- Commissioner signup flow — create an account, name a league, receive a shareable URL
- No per-member accounts or permissions
- No visibility controls — league URL is the access mechanism
- League picker UI for commissioners managing multiple leagues
- Only warranted if Phase 3 is actively used by multiple leagues **and** manual commissioner management becomes a bottleneck. Full SaaS auth is out of scope indefinitely.

## Upcoming campaigns (post-P7B-7)

### Slow Draft Mode (planned)
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

### Game Stats Pipeline (planned)
Fetch and cache weekly game-level team stats from CFBD to power the Insights Engine.

- **Data source:** CFBD `game_team_stats` endpoint — one call per week, returns all team stats for all games in that week
- **Storage:** Cached in `appStateStore` by week, same pattern as scores
- **Cron:** Monday 11am UTC — fetch weekend game stats (complements existing Wednesday cron for season transition)
- **Owner aggregation:** Sum/average stats across all teams owned by each owner, derived at query time using existing team→owner mapping
- **Stats available:** Yards gained/allowed, turnovers, third-down conversion %, red zone efficiency, time of possession
- **API cost:** ~19 additional calls per season — well within 1,000/month free tier
- **Prerequisite for:** Insights Engine

### Insights Engine (planned)
Generate contextual, data-driven narrative insights that add value beyond what's visible in standings and tables.

**Core principle:** Every insight must tell the user something they couldn't figure out just by reading the table. No restating visible data without a compelling angle.

**Placement:** 2–3 highlight insights on overview page; full pulse on dedicated tab.

**Two weekly pulses:**
- **Monday 6am ET (11am UTC) — Look Back:** Weekend recap, notable results, standings movement, trash-talk fodder, owner vs owner outcomes, surprising performances
- **Thursday 6am ET (11am UTC) — Forward Look:** Games to watch this weekend, owner vs owner collision preview, rivalry implications, who needs a win

**Data sources (tiered by availability):**
- **Always available:** League history archive, current standings, owner rosters, head-to-head records
- **August onward:** AP poll rankings per owner, preseason projections vs actual
- **In-season:** Game stats (via Game Stats Pipeline), schedule strength, owner vs owner matchup frequency, form/momentum

**Insight categories:**
- Historical context ("Maleski's runner-up finish is the closest gap in 4 years")
- Cross-table connections ("Pruitt leads standings but has the hardest remaining schedule")
- Owner vs owner narrative ("Ballard has never beaten Pruitt in 6 matchups")
- Championship race ("Three owners within 2 games of first with 4 weeks remaining")
- Trash-talk fodder ("Shambaugh's teams have been outgained in 3 straight weeks")
- Projection vs reality ("Jordan's roster was rated highest by SP+ but sits 8th")

**Tone:** Mix of dry stats, narrative storytelling, and light humor.
**Prerequisite:** Game Stats Pipeline

### Copy / UX Writing Audit (planned)
Systematic review and rewrite of all user-facing strings for consistent voice and quality before public launch.
- Inventory all UI copy: headings, subheadings, labels, empty states, error messages, button text, tooltips, banners
- Apply a single consistent voice: concise, direct, league-aware, no filler phrases
- Identify and fix copy that is generic, redundant, inconsistent, or that reveals implementation details to members
- Flag any places where new-name "Turf War" branding can be reinforced
- No logic changes — copy only

### Draft Difficulty Settings (planned)
- Auto-pick algorithm configuration (random, SP+ rating, preseason rank)
- Team data visibility controls during draft (show/hide SP+ ratings, win totals, schedule insights)

### Back Button Audit (planned)
- App-wide review of back links: styling consistency, copy, destinations
- Ensure all "← Back" links follow a single visual pattern and navigate to the correct parent

### Clerk Production Instance Migration ✓ Complete
- Migrated from Clerk development instance to production instance
- DNS configured, session token customized, production keys set in Vercel
- Commissioner account created with `platform_admin` role; all auth flows verified

### P7A-4: Aliases Platform Migration (planned)
- Complete migration of aliases from year-scoped to global platform scope
- Remove legacy year-scoped alias support code

### Season State Transition Workflow ✓ Complete
- "Go Live" renamed to "Complete Setup" — decoupled from state transition
- Automatic season transition via Vercel cron job (weekly Wednesday midnight UTC)
- Schedule probe: CFBD fetch → cache → derive first game date → transition the day before
- `setupComplete` flag on preseason `LeagueStatus` variant
- Pre-season overview with owner rosters and schedule placeholder
- See `docs/completed-work.md` for full record

### Custom Domain Setup ✓ Complete
- `turfwar.games` and `tscturfwar.com` registered via Porkbun
- `turfwar.games` connected to Vercel production via A record
- `tscturfwar.com` → `https://turfwar.games/league/tsc` permanent 301 redirect in `vercel.json`

### App Naming: Turf War ✓ Complete
- "CFB League Dashboard" renamed to "Turf War" across all user-facing surfaces
- URL examples updated to `turfwar.games`
- Landing page tagline: "Your league, upgraded."

### P7B Dry Run Polish ✓ Complete
- Overview lifecycle banners: state-driven, left-border accent, pulsing live dot, draft countdown
- Preseason setup flow: "Complete Setup" button, `setupComplete` state, green admin hub badge
- Roster check satisfied by owners CSV (draft completion sufficient)
- Draft start fix: phase transition before redirect to board
- Commissioner setup links from draft board banner and summary page
- Sandbox reset controls: idempotent dry runs, auto-complete draft button
- See `docs/completed-work.md` for full record

### Preseason Insights Panel (planned)
Replace the empty insights area during preseason with meaningful, data-driven content that upgrades automatically as data becomes available. No commissioner action needed beyond what the cron already handles.

**Tier 1 — Always available (static data from history archives + draft results)**
- Defending champion, runner-up, longest championship drought, most titles
- Biggest collapse (highest finish drop year-over-year)
- Draft-based: conference concentration per owner, most/least diversity, owner with most teams from one conference

**Tier 2 — August (once CFBD publishes preseason AP poll)**
- Most preseason top-25 teams per owner
- Highest-ranked team drafted
- Owner with the most ranked opponents on their schedule

**Tier 3 — Schedule cached (cron-driven, before first game)**
- Schedule strength per owner (ranked opponent count, aggregate SP+)
- Most home games, most rivalry games per owner
- Earliest/latest bye weeks
- Peak exposure weeks (most owner-relevant games in one week)
- Owner vs owner matchup frequency ("Ballard plays himself 18 times")
- Most common rivalry matchup across owners
- Defending champion gauntlet (most games against last year's champion's teams)

**Scope:** Insights selectors, rankings data, schedule data, overview panel, owner vs owner matchup derivation. Panel gracefully upgrades itself as each tier's data becomes available.

## Architecture rules

See `docs/cfb-engineering-operating-instructions.md` Section 5 for canonical architecture principles.
