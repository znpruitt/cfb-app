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
- **Active phase: Phase 6 — Admin Cleanup and Auth.**

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

## Phase 6 — Admin Cleanup and Auth (active campaign)

**Design doc:** `docs/phase-6-admin-auth-design.md`
**Status:** Design approved — ready for implementation.

### Objective
Replace the `ADMIN_API_TOKEN` sessionStorage pattern with Clerk-based auth. Restructure `/admin` into a clean multi-page layout. Establish a public landing page at `/` with a discrete admin login entry point. Build the auth foundation so Phase 7 commissioner and member roles can be added without rework.

### P6A — Clerk Setup and Login ✓ Complete
- Install and configure Clerk in Next.js App Router
- Define three-role model in Clerk `publicMetadata`: `platform_admin`, `commissioner`, `member`
- Implement `/login` page (Clerk embedded UI)
- Implement Clerk middleware: `/admin/*` requires `platform_admin`; `/league/[slug]/*` public
- Update root route: public landing for unauthenticated visitors; league dashboard for `platform_admin`
- Add `requireAdminAuth(req)` helper — Clerk JWT first, ADMIN_API_TOKEN fallback during transition

### P6B — Admin Page Restructure ✓ Complete

See `docs/completed-work.md` for full record. Branch `claude/improve-thread-speed-v1YFg`.
PROMPT_IDs: P6B-ADMIN-RESTRUCTURE-v1, P6B-ADMIN-RESTRUCTURE-REVIEW-v1, P6B-ADMIN-RESTRUCTURE-FIX-v1, P6B-CLOSEOUT-v1

### P6C — Root Route and Landing Page Polish (active)
- Public landing page final polish (app name, tagline, league URL entry, discrete admin login link)
- Admin dashboard league cards with live stats (league name, slug, active year, owner count)
- All redirects runtime-derived from registry — no hardcoded slugs anywhere

### Deferred to Phase 7
- Commissioner role enforcement on `/league/[slug]/draft/*` routes
- Commissioner self-registration and invite link flow
- League-scoped permissions in Clerk `publicMetadata`
- Member login and personalized views
- `ADMIN_API_TOKEN` full removal

### Longer-term (not scheduled)

#### Commissioner Self-Service (Phase 7, Long-Term Vision)
If the app grows beyond manually managed leagues, the minimal viable expansion is lightweight commissioner signup — not a full SaaS platform.
- Commissioner signup flow — create an account, name a league, receive a shareable URL
- No per-member accounts or permissions
- No visibility controls — league URL is the access mechanism
- League picker UI for commissioners managing multiple leagues
- Only warranted if Phase 3 is actively used by multiple leagues **and** manual commissioner management becomes a bottleneck. Full SaaS auth is out of scope indefinitely.

## Architecture rules

See `docs/cfb-engineering-operating-instructions.md` Section 5 for canonical architecture principles.
