# Completed Work Log

## Purpose / How to use this document

- This file is an **append-only log** of completed phases and major milestones.
- Record **what was built and why it mattered** (outcomes), not a commit-by-commit changelog.
- This is **not** an active task list.
- Add future completed phases/milestones here instead of mixing history into `docs/next-tasks.md`.

## Completed phases / milestones

### P7B-4 — Pre-Season Setup Flow: Complete

**Status:** Complete. Branch `claude/add-league-status-field-jPzcQ`.
**PROMPT_IDs:** P7B-4, P7B-4-FIX, P7B-4-FIX-2, P7B-4-FIX-3, P7B-4-FIX-4, P7B-4-FIX-5

**Key outcomes:**
- Pre-season setup page at `/admin/[slug]/preseason` with three-item checklist: Owners confirmed / Teams assigned / Season live
- Assignment method selection card (Run a Draft / Assign Manually) persisted to `league.assignmentMethod`
- Go Live button gated by checklist completion — transitions league to season and syncs `league.year`
- Draft card removed from league hub tool cards; draft accessible only through pre-season flow
- Draft setup page year derivation fixed to use lifecycle status year (`status.year`) rather than `league.year`
- Test league controls: idempotent preseason year (no double-increment), Reset to 2025 Season button
- `manualAssignmentComplete?: boolean` added to `League` type for method-aware team assignment check
- `teamsHref` on preseason page is method-aware: draft → draft setup, manual → `/assign` (P7B-6), null → self

**Key architectural decisions:**
- "League created" dropped from checklist — not meaningful for recurring season resets
- Pre-season checklist is the single model for both initial setup and recurring season transitions
- `goLive` action syncs both `status` and `league.year` atomically so downstream year derivation always resolves correctly

---

### Phase 7F — Overview Featured Games: Complete

**Status:** Complete. Branch `claude/fix-standings-ui-re94y`. PR #241.
**PROMPT_IDs:** PHASE-7F-FEATURED-GAMES, PHASE-7F-FIX-01 through PHASE-7F-FIX-06

**Key outcomes:**
- Renamed "Recent Results" → "Featured Games" with 2-column card grid layout
- CFP round badges with neutral slate/gray styling — full labels ("CFP Quarterfinal", "CFP First Round")
- Conference championship badges with conference name ("SEC Champ")
- Inline W16 CFP rankings on postseason game cards (not Final Poll)
- Dark card styling — no border, background-defined cards
- Winner score full weight, loser score muted
- Context-aware game selection: postseason surfaces playoff/bowl, in-season surfaces current week
- NoClaim owner filtering from display lines and game list
- First Round CFP classification via neutral site = false (campus games)
- 6-game display cap

**Key architectural decisions:**
- `deriveFeaturedGameBadge(game)` — badge logic driven by `playoffRound` (more specific) over `postseasonRole`
- `overviewRankingsByTeamId` memo in `CFBScheduleApp.tsx` — selects last regular-season CFP week for rankings instead of Final Poll
- `selectFeaturedGames()` in overview selectors — postseason tier sorting via `postseasonRolePriority()`
- First-round campus game fallback: `(round == null || round === 'playoff') && !game.neutral` → 'CFP First Round'

---

### Phase 7A–7E — Product Design Audit (Standings through Speed Insights): Complete

**Status:** Complete. Multiple PRs across branches.

**Key outcomes:**
- **7A Standings:** NoClaim exclusion, Win% format, DIFF colors, MOVE column hidden at season end, ranked colors, table-as-legend pattern, bidirectional hover/select, mode switcher removed, legend tables removed, chart improvements (Y-axis domain, convergence scaling, Final label, right edge padding, tabbed charts)
- **7B FBS Polls:** Built Rankings tab, postseason Final Poll week, debug pill removed, three-column layout with movement indicators
- **7C Nav redesign:** Underline tabs throughout, sub-nav band removed, inline content tabs, renamed to League Table / FBS Polls / Matchups
- **7D Mobile standings:** PF/PA hidden, card borders removed, compact column set, mobile legend + scrollable chart
- **7E Speed Insights:** Added Vercel Speed Insights to layout.tsx

**Design codification:**
- Created `DESIGN.md` at project root capturing all design principles established during Phase 7
- Added `DESIGN.md` reference to `CLAUDE.md` canonical doc pointers and architectural section

---

### P6E — Roster Editor: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PR #229.
**PROMPT_IDs:** P6E-ROSTER-EDITOR-v1, P6E-ROSTER-EDITOR-REVIEW-v1, P6E-ROSTER-EDITOR-FIX-v1, P6E-CLOSEOUT-v1

**Key decisions and architectural notes:**
- **`RosterEditorPanel` is a direct CRUD interface** — distinct from the draft tool (live event) and upload flow (bulk CSV with fuzzy matching). Handles post-draft fixes, leagues without a formal draft, mid-season transfers, and testing.
- **`savedOwners` / `draftOwners` Map split** enables per-row dirty tracking. `mapsEqual()` gates save/discard buttons. Dirty rows highlighted amber.
- **Save writes full CSV via `PUT /api/owners`** — same endpoint as the upload flow. `buildCsv()` filters teams with empty owner values; only assigned teams written to storage.
- **Bulk reassign updates `draftOwners` local state only** — commissioner must explicitly click Save Changes to persist.
- **RFC 4180 state-machine CSV parser** (`parseCsvRow()`) — handles quoted fields, comma-in-name (`"Smith, Jr"`), `""` unescaping, mixed quoted/unquoted fields. Replaces naive `indexOf(',')` split that caused quote amplification on re-save.
- **`buildCsv()` RFC 4180 escaping verified correct** — `csvField()` wraps fields containing commas/quotes/newlines and escapes `"` as `""`. Left unchanged.
- **Year sourced from `league.year`** — same source as `RosterUploadPanel` — ensures both panels target the same `owners:${slug}:${year}` scope key. `seasonYearForToday()` removed as a separate year source.
- **`NoClaim` and empty owner values both supported** — owner inputs are free-form text; no validation or exclusion logic.
- **On save success**: server response CSV re-parsed; both `savedOwners` and `draftOwners` synced from server state.

---

### P6 — Admin Polish and Commissioner UX: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PRs #230–#234.
**PROMPT_IDs:** P6-ADMIN-POLISH-v1, P6-ADMIN-POLISH-REVIEW-v1, P6-ADMIN-POLISH-FIX-v1, P6-ADMIN-POLISH-FIX-REVIEW-v1, P6-ADMIN-POLISH-CLOSEOUT-v1, P6-GEAR-ICON-FIX-v1, P6-ADMIN-FONT-FIX-v1, P6-ADMIN-SLUG-INDEX-v1, P6-LEAGUE-DATA-PAGE-v1, P6-LEAGUE-DATA-PAGE-FIX-v1, P6-ADMIN-COMMISSIONER-POLISH-v1, P6-ADMIN-COMMISSIONER-POLISH-REVIEW-v1, P6-ADMIN-COMMISSIONER-POLISH-FIX-v1, P6-ADMIN-NAV-FIX-v1, P6-FINAL-CLOSEOUT-v1

**Key decisions and architectural notes:**
- **Consistent back-nav pattern** — blue `← Label` top-left on all admin pages; label names the immediate parent (e.g. `← Admin`, `← {displayName}`).
- **Plain English copy** — developer terminology replaced throughout all diagnostic and action panels.
- **Gear icon in league view header** — right-justified, only visible to `platform_admin`, links to `/admin/[slug]`, tooltip "League settings". Rendered via `isAdmin` prop; no Clerk hooks in client component body.
- **`isAdmin` prop pattern** — `CFBScheduleApp` accepts `isAdmin?: boolean` prop; auth derived server-side via `auth()` from `@clerk/nextjs/server` in each parent page; cast pattern `sessionClaims as Record<string, unknown> & { publicMetadata?: Record<string, unknown> }` to extract role safely. No `useAuth()` in reusable components.
- **Commissioner bucket per league: four cards in 2×2 grid** — Roster, Draft, Data, Settings at `/admin/[slug]`.
- **`/admin/[slug]` landing page** — gear icon destination and direct commissioner entry point; `notFound()` on bad slug. "← Back to league" link gives clear return path after navigating from gear icon. Duplicate "← Admin" removed — layout breadcrumb handles admin navigation.
- **League Settings page at `/admin/[slug]/settings`** — `LeagueSettingsForm` (client component): editable display name and year, read-only slug field, `PATCH /api/admin/leagues/${slug}` with `requireAdminAuthHeaders()`, save/error/loading states.
- **`LeagueStatusPanel`** — server component at top of `/admin/[slug]/data`; reads `appStateStore` directly; shows roster owner count + age timestamp, schedule/scores cache status + age, draft phase with color coding (setup/settings: zinc; preview: blue; live: green; paused: amber; complete: white); returns `null` gracefully if storage unavailable.
- **Schedule cache key** — default `seasonType` in schedule route is `'all'`; default cache key is `${year}-all-all`. `LeagueStatusPanel` checks `${year}-all-all` first, falls back to `${year}-all-regular`.
- **`GlobalRefreshPanel`** on `/admin/data/cache` — platform-level schedule and both-season-type scores refresh; year input defaulting to `seasonYearForToday()` prevents wrong-season caching in offseason. All three fetch calls pass explicit `year` param.
- **Aliases kept per-league** — `LeagueDataPanel` on `/admin/[slug]/data` retains Aliases section only; Schedule/Scores removed (platform-level actions moved to `GlobalRefreshPanel`).
- **Win Totals moved to platform admin** — `/admin/[slug]/win-totals` now redirects to `/admin/data/cache`; Win Totals is a global action with no per-league scope.
- **`RESERVED_ADMIN_SLUGS`** enforced at league creation (`POST /api/admin/leagues`) — prevents slug collisions with named admin routes (`season`, `data`, `draft`, `diagnostics`, `leagues`, `cache`).
- **`/admin/data` as league selector** — single league auto-redirects to `/admin/[slug]/data`; multiple leagues shows card grid; no leagues shows link to `/admin/leagues`.
- **Legacy `CFBScheduleApp` Admin/Debug panel fully removed** from all commissioner-facing and public-facing league pages.
- **League name font** — `text-sm font-semibold text-zinc-100` in commissioner tools card; prevents oversized rendering at default `text-base`.

---

### P6D — Admin UI Restructure: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PR #228.
**PROMPT_IDs:** P6D-ADMIN-RESTRUCTURE-v1, P6D-ADMIN-RESTRUCTURE-REVIEW-v1, P6D-ADMIN-RESTRUCTURE-FIX-v1, P6D-ADMIN-RESTRUCTURE-FIX-REVIEW-v1, P6D-CLOSEOUT-v1

**Key decisions and architectural notes:**
- **`/admin` landing restructured into two sections**: Platform Admin (global tools) and Commissioner Tools (per-league). Four platform admin cards; one block per league in registry for commissioner tools.
- **Commissioner tool buckets derived from league registry at runtime** — no hardcoded slugs anywhere.
- **League-scoped routes**: `/admin/[slug]/roster`, `/admin/[slug]/win-totals`, `/admin/[slug]/data` — each validates slug and calls `notFound()` on miss.
- **`/admin/data/cache`** serves as platform admin SP+ and historical cache page.
- **`/admin/draft`** retained for `DraftSequencingPanel` overview only — SP+ and Win Totals moved to league-scoped pages.
- **`/admin/data`** restored as a league selector — single league auto-redirects to `/admin/[slug]/data`; multiple leagues shows card grid; no leagues shows link to `/admin/leagues`.
- **`RESERVED_ADMIN_SLUGS`** enforced in league creation API (`POST /api/admin/leagues`): `season`, `data`, `draft`, `diagnostics`, `leagues`, `cache` — returns 400 with clear error message.
- **No route collisions**: named `/admin/*` routes take precedence over `[slug]` dynamic segment in Next.js App Router.
- **Phase 7 prerequisite satisfied**: bucket structure exists; commissioner self-service only needs Clerk role enforcement on existing routes — no restructuring required in Phase 7.

---

### P6 — Clerk Auth Fixes and Admin Data Cleanup: Complete

**Status:** Complete. Branch `claude/debug-owner-csv-log-VQqia`. PRs #221–#227.
**PROMPT_IDs:** P6A-CLERK-REQUIREMENTS-AUDIT-v1, P6A-CLERK-ROUTE-FIX-v1, P6A-CLERK-MIDDLEWARE-FIX-v1, P6A-CLERK-MIDDLEWARE-FIX-v2, P6A-CLERK-MIDDLEWARE-FIX-v3, P6A-CLERK-MIDDLEWARE-FIX-v4, P6A-CLERK-MIDDLEWARE-DEBUG-v1, P6B-ROSTER-UPLOAD-FIX-v1, P6B-ROSTER-UPLOAD-FIX-v2, P6B-ROSTER-UPLOAD-FIX-REVIEW-v1, P6B-BACKFILL-FIX-v1, P6B-BACKFILL-FIX-REVIEW-v1, P6C-OWNER-COUNT-FIX-v1, P6C-OWNER-COUNT-FIX-v2, P6C-OWNER-COUNT-FIX-v3, P6C-OWNER-COUNT-DEBUG-v1, P6C-OWNER-COUNT-DEBUG-v2, P6C-OWNER-SCOPE-AUDIT-v1, P6C-DEBUG-CLEANUP-v1, P6-CLERK-FIXES-CLOSEOUT-v1

**Key fixes and decisions:**
- **Clerk session token requires explicit publicMetadata claim** — add via Configure → Sessions → Customize session token: `{ "publicMetadata": "{{user.public_metadata}}" }`. Must be done for both Dev and Prod instances. See `docs/phase-6-admin-auth-design.md` section 9.
- **JWT templates are for third-party integrations only** — they do NOT affect middleware auth. Using a JWT template to expose `public_metadata` does not fix the session token. Delete any templates created for this purpose.
- **`currentUser()` cannot be called in middleware** — use `auth()` and `sessionClaims.publicMetadata.role` only.
- **Login page requires catch-all route at `[[...sign-in]]`** — multi-step Clerk auth flows (MFA, SSO) require a catch-all slug. A static `/login/page.tsx` will break after step 1.
- **`routing="path"` and `path="/login"` props required** on the `<SignIn>` component to enable catch-all routing correctly.
- **Owner count on landing page uses `seasonYearForToday()`** — not `league.year`. Matches league view behavior; owner CSV stored under `owners:${slug}:${year}` where year is the active CFB season year.
- **Owner CSV scope is `owners:${slug}:${year}` with key `csv`** — year must match active season year. CSV uploaded without `?league=` query param goes to `owners:${year}` (wrong scope); always include `?league=${slug}`.
- **Roster upload on `/admin/data`** uses full fuzzy-match validation pipeline — POST to `/api/owners/validate` first, review confirmed/needs-confirmation/no-match sections, then PUT resolved CSV to `/api/owners`. Confirmed matches saved as global aliases.
- **`/admin/data` page organization** — `RosterUploadPanel` placed at top, before `HistoricalCachePanel`. Further cleanup deferred to future pass.

---

### Phase 6 — Admin Cleanup and Auth (P6A–P6C): Complete

**Status:** All subphases complete. Branch `claude/improve-thread-speed-v1YFg`. PR #217 open.
**PROMPT_IDs:** P6A-CLERK-AUTH-v1, P6A-CLERK-AUTH-REVIEW-v1, P6A-CLERK-AUTH-FIX-v1, P6A-CLOSEOUT-v1, P6B-ADMIN-RESTRUCTURE-v1, P6B-ADMIN-RESTRUCTURE-REVIEW-v1, P6B-ADMIN-RESTRUCTURE-FIX-v1, P6B-CLOSEOUT-v1, P6B-BACKFILL-FIX-v1, P6B-BACKFILL-FIX-REVIEW-v1, P6C-LANDING-POLISH-v1, P6C-LANDING-POLISH-REVIEW-v1, P6C-CLOSEOUT-v1, P6C-OWNER-COUNT-FIX-v1

**Key architectural decisions across Phase 6:**
- **Clerk as auth provider** — three roles defined from day one in `publicMetadata`: `platform_admin`, `commissioner`, `member`. Only `platform_admin` enforced in Phase 6. Scales to Phase 7 without rework.
- **`clerkMiddleware()` in `middleware.ts`** — never `authMiddleware()` (deprecated). `/admin/*` protected at middleware level: unauthenticated → `/login`; authenticated without `platform_admin` → `/`.
- **`<Show when="signed-in/out">` throughout** — deprecated `<SignedIn>` / `<SignedOut>` never used.
- **`requireAdminAuth()`** — checks Clerk JWT first, falls back to `ADMIN_API_TOKEN` during transition. Phased replacement: token removed in Phase 7.
- **Root route `/` dynamic** — hardcoded `/league/tsc` redirect removed. Public landing for unauthenticated visitors; admin dashboard for `platform_admin`. No hardcoded slugs anywhere.
- **Admin restructured into five sub-pages**: `/admin/draft`, `/admin/data`, `/admin/season`, `/admin/diagnostics`, `/admin/leagues`. `/admin` is navigation-only.
- **Admin/Debug panel removed from league view** — league view is fully public-facing.
- **`DraftSequencingPanel`** — rollover guard and active roster guard per league at `/admin/draft`.
- **`HistoricalCachePanel`** — fills pre-existing API-only gap for historical schedule/scores cache at `/admin/data`.
- **Backfill flow fixed** — terminal on first write (no existing archive); confirm only when `requiresConfirmation` returned (existing archive diff).
- **Historical cache year default** — uses CFB season year logic (`month >= 7` → current year is active), not raw UTC year. Prevents offseason 400 errors.
- **Owner count on dashboard** — derived from `appStateStore` CSV at runtime; fails gracefully to `null` when unavailable.
- **Redirect audit clean** — no hardcoded slugs in any route, component, or middleware.

---

### Phase 6C — Landing Page Polish: Complete

**Status:** Complete. Branch `claude/improve-thread-speed-v1YFg`.
**PROMPT_IDs:** P6C-LANDING-POLISH-v1, P6C-LANDING-POLISH-REVIEW-v1, P6C-CLOSEOUT-v1, P6C-OWNER-COUNT-FIX-v1

**Goals completed:**
- **Public landing page** — app name (`text-4xl`), tagline, URL example in `<code>` block with border/bg styling, discrete "Commissioner login" link fixed bottom right.
- **Admin dashboard league cards** — `league.displayName` (large), slug/year/owner count metadata, "View League →" (blue) and "Draft Setup →" (muted) split links per card.
- **Owner count** — fetched server-side from `getAppState('owners:${slug}:${year}', 'csv')` per league; CSV rows counted minus header. Returns `0` when CSV empty/missing; returns `null` (graceful skip) when fetch throws.
- **Footer links** — "Platform admin tools →" (`/admin`) and "Add League →" (`/admin/leagues`) side-by-side.
- **Empty state** — links to `/admin/leagues` with clear instruction copy.
- **Redirect audit** — confirmed clean; no hardcoded slugs in `middleware.ts`, `page.tsx`, `RootPageClient.tsx`, `login/page.tsx`, or `admin/page.tsx`.
- **All seven E2E auth flows verified correct** in code review.
- **Owner count uses distinct owner values** — CSV format is `team,owner` (one row per team assignment). Raw row count returns team count, not owner count. Set-based distinct owner parsing returns correct participant count.

---

### Phase 6B — Admin Page Restructure: Complete

**Status:** Complete. Branch `claude/improve-thread-speed-v1YFg`.
**PROMPT_IDs:** P6B-ADMIN-RESTRUCTURE-v1, P6B-ADMIN-RESTRUCTURE-REVIEW-v1, P6B-ADMIN-RESTRUCTURE-FIX-v1, P6B-CLOSEOUT-v1

**Goals completed:**
- **`/admin` is now navigation-only** — no tools on the landing page; five section cards link to sub-pages.
- **`/admin/draft`** — `DraftSequencingPanel` (server component) shows rollover guard and active roster guard per league with green/red/amber status indicators; `SpRatingsCachePanel` and `WinTotalsUploadPanel` also present.
- **`/admin/data`** — `HistoricalCachePanel` (new, fills pre-existing API-only gap for `cache-historical-schedule` and `cache-historical-scores`); `CFBScheduleApp surface="admin"` retained for schedule rebuild, scores/odds refresh, alias editor, and owner CSV upload.
- **`/admin/season`** — `RolloverPanel`, `BackfillPanel`, `ArchiveListPanel`.
- **`/admin/diagnostics`** — `AdminUsagePanel`, `AdminTeamDatabasePanel`, `AdminStorageStatusPanel`, `DiagnosticsScorePanel`.
- **`/admin/leagues`** — unchanged (already existed).
- **Admin/Debug button and panel removed from league view entirely** — league view is now fully public-facing. `CFBScheduleApp` no longer references `adminAlertCount` or renders the Admin/Debug toggle. Fatal error link updated to `/admin/data`.
- **Owner Roster CSV Upload retained at `/admin/data`** as clearly labeled admin fallback.
- **`requireAdminAuthHeaders()` fixed** — now returns `{}` instead of throwing when no sessionStorage token; Clerk session cookie handles auth automatically for browser requests.

**Key architectural decisions:**
- Admin sub-pages are server components where possible (DraftSequencingPanel, ArchiveListPanel, DiagnosticsPage) — no client fetch needed when data is available at render time.
- `BackfillPanel` and `DiagnosticsScorePanel` are client components using `getAdminAuthHeaders()` for fetch calls.
- `DiagnosticsScorePanel` is a thin `'use client'` wrapper around `ScoreAttachmentDebugPanel` — `onStageAlias` stub directs users to `/admin/data` for alias operations (alias staging requires full CFBScheduleApp state machine).
- `HistoricalCachePanel` fills the gap identified in review: historical cache API routes existed but had no UI.
- All admin sub-page headers include `← Admin` back link for consistent navigation.

---

### Phase 6A — Clerk Auth Setup: Complete

**Status:** Complete. PR #216 open. Branch `claude/improve-thread-speed-v1YFg`.
**PROMPT_IDs:** P6A-CLERK-AUTH-v1, P6A-CLERK-AUTH-REVIEW-v1, P6A-CLERK-AUTH-FIX-v1, P6A-CLOSEOUT-v1

**Goals completed:**
- **`@clerk/nextjs` v7.0.8** installed with `--legacy-peer-deps` (React 19.1.0 peer conflict); `.npmrc` added to project root with `legacy-peer-deps=true` for Vercel compatibility.
- **`src/middleware.ts`**: `clerkMiddleware()` from `@clerk/nextjs/server` — never `authMiddleware()` (deprecated). `/admin/*` protected: unauthenticated → redirect `/login`; authenticated without `platform_admin` → redirect `/`. All other routes pass through.
- **`src/app/layout.tsx`**: `<ClerkProvider>` wraps body content.
- **`src/app/login/page.tsx`**: Clerk `<SignIn forceRedirectUrl="/admin" />` embedded — no custom form. Dark theme matching app.
- **`src/app/page.tsx` + `src/components/RootPageClient.tsx`**: Root route replaced — hardcoded `/league/tsc` redirect removed. Server component loads leagues from registry; `RootPageClient` uses `<Show when="signed-out">` for public landing and `<Show when="signed-in">` for admin league dashboard. `force-dynamic` set. No hardcoded slugs.
- **`src/lib/server/adminAuth.ts`**: `requireAdminAuth(req)` — checks Clerk JWT first (`sessionClaims.publicMetadata.role === 'platform_admin'`), falls back to `ADMIN_API_TOKEN` with Phase 7 removal comment. `requireAdminRequest` exported as `@deprecated` alias. All 25 existing API route call sites updated to `await requireAdminRequest(req)`.

**Key architectural decisions:**
- Three roles defined in Clerk `publicMetadata` from day one: `platform_admin`, `commissioner`, `member` — only `platform_admin` enforced in Phase 6.
- `<Show when="signed-in/out">` used throughout — deprecated `<SignedIn>`/`<SignedOut>` never used.
- `requireAdminAuth` checks Clerk JWT first; ADMIN_API_TOKEN fallback is temporary — remove in Phase 7.
- Admin dashboard reads leagues from registry at runtime — never hardcoded.
- **Manual step required post-deploy:** set `publicMetadata: { "role": "platform_admin" }` in Clerk Dashboard for first user. Cannot be done in code.

---

### Phase 5 — Draft / Owner Assignment Tool (P5A–P5D): Complete

**Status:** All subphases complete. PR #214 open. Branch `claude/improve-thread-speed-v1YFg`.

Key architectural decisions across Phase 5:
- **Draft state** persisted in `appStateStore`: scope `draft:${leagueSlug}`, key `${year}`
- **Snake draft order** computed on-demand from `draftOrder` — never stored per-pick
- **Timer is server-authoritative** — `timerExpiresAt` stored as ISO timestamp in `DraftState`; clients derive remaining time from it
- **Client expire dispatch** — `DraftBoardClient` fires `timerAction: 'expire'` when countdown reaches zero; guarded by `expireDispatchedRef` per pick
- **`effectiveBehavior`** — forces auto-pick when commissioner is in paused-expired overlay state regardless of `timerExpiryBehavior` setting
- **Auto-pick metric** respects draft settings: SP+ descending or preseason rank ascending; alphabetical tiebreak when metric unavailable
- **Team resolution for picks** uses `teamIdentity.ts` resolver with merged SEED_ALIASES + stored alias maps — no raw string equality
- **`DraftPick.team`** stores `resolution.canonicalName` (canonical school name string) — consistent with `parseOwnersCsv()` + `rosterByTeam` downstream ownership pipeline
- **Drafted teams hidden** from available teams panel entirely — not dimmed
- **Confirm writes same format as CSV upload** — `owners:${slug}:${year}` scope, `csv` key; `parseOwnersCsv()` / standings / rollover pipeline transparent
- **CSV upload preserved** as admin fallback — can override a confirmed draft without requiring a full reset
- **Draft card is informational only** — no recommendations, no color coding implying good/bad teams
- **Draft → ownership map → app**: downstream systems never depend on draft state directly; the confirmed CSV is the hand-off artifact

---

### P5D — Draft Summary and Confirmation

- **Status:** Complete. PR #214 open. Branch `claude/improve-thread-speed-v1YFg`.
- **PROMPT_IDs:** P5D-DRAFT-SUMMARY-v1, P5D-DRAFT-SUMMARY-REVIEW-v1, P5D-DRAFT-SUMMARY-FIX-v1, P5D-DRAFT-SUMMARY-FIX-REVIEW-v1, P5D-DRAFT-REOPEN-v1, P5D-DRAFT-REOPEN-REVIEW-v1, P5D-CLOSEOUT-v1
- **Goals completed:**
  - **`POST /api/draft/[slug]/[year]/confirm`**: Admin-gated. Derives expected pick count from FBS team count at runtime (never hardcoded): `teamsPerOwner = floor(fbsTeamCount / ownerCount)`, `totalExpectedPicks = teamsPerOwner * ownerCount`. Validates `picks.length === totalExpectedPicks` and all owners have equal counts (422 with formula in message if not). Generates RFC 4180 CSV — fields containing comma, double quote, or newline are quoted; embedded double quotes escaped by doubling (`"` → `""`). Writes to `owners:${slug}:${year}` scope, `csv` key — same format as CSV upload route. Advances `phase` to `complete`.
  - **`DELETE /api/draft/[slug]/[year]/confirm`**: Admin-gated. Validates `phase === 'complete'`. Sets phase back to `live`. Preserves all picks and does not remove the previously confirmed owner assignment from `appStateStore` — previous CSV remains in effect until commissioner confirms again.
  - **`/league/[slug]/draft/summary` (server page)**: Server component, `force-dynamic`. Derives interesting facts server-side from historical archives — league anniversaries at 2/5/10 seasons, top 3 rivalries via `selectTopRivalries`, returning champion from most recent archive. Passes only `facts: string[]` to client — avoids shipping large `SeasonArchive[]` to browser. Loads `allTeamNames` (FBS canonical, NoClaim excluded, alphabetical) for inline team picker.
  - **`DraftSummaryClient`**: Admin-gated via `hasStoredAdminToken()` + `useEffect` redirect + synchronous early return. Owner roster cards grid in draft order. Inline team picker per pick — excludes all other drafted teams; allows re-selecting the current pick's own team. Two-step Confirm Draft flow with irreversibility warning. Two-step Reopen Draft flow with "previous rosters remain in effect" warning; on success updates local draft state to `phase: 'live'`. Confirm section hidden when `phase === 'complete'`; Reopen section shown only when `phase === 'complete'`.
  - **`InterestingFactsPanel`**: Pure presentational. Renders `null` when `facts.length === 0`. Each fact as a bordered card in a `<ul>`.
  - **Draft board link**: "Draft Summary →" shown in commissioner board subtitle when `phase === 'complete'`.
- **Key architectural decisions:**
  - **Pick count derived at runtime** — `classification === 'fbs'` filter on `teams.json`; never hardcoded. NoClaim teams fill the FBS remainder not divisible by owner count.
  - **Per-owner count check** — equal team distribution enforced before confirmation; uneven counts blocked with 422.
  - **RFC 4180 CSV** — `csvField()` helper handles all edge cases; field quoting and double-quote escaping consistent with spec.
  - **Reopen does not clear owner assignment** — previous confirmed CSV remains in `appStateStore` until re-confirm; dialogue makes this explicit.
  - **Interesting facts are server-side only** — `deriveFacts()` runs in page server component; only `string[]` passed to `DraftSummaryClient`; avoids shipping archive data to browser.
  - **Admin gate is client-side** — sessionStorage not readable server-side; same pattern as `DraftBoardClient`.

---

### P5C — Live Draft Board

- **Status:** Complete. PR #213 open. Branch `claude/improve-thread-speed-v1YFg`.
- **PROMPT_IDs:** P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-REVIEW-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1, P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v1, P5C-LIVE-DRAFT-BOARD-FIX-v2, P5C-LIVE-DRAFT-BOARD-FIX-v3, P5C-LIVE-DRAFT-BOARD-FIX-REVIEW-v2, P5C-CLOSEOUT-AND-P5D-KICKOFF-v1
- **Goals completed:**
  - **Redirect TODO resolved** (v1, Task 0): All four `/draft/setup` redirect targets in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` updated to `/draft` now that the live board route exists.
  - **`POST /api/draft/[slug]/[year]/pick`** (v1, FIX-v1, FIX-v3): Admin-gated. Validates `phase === 'live'`. Resolves team name via `createTeamIdentityResolver` with SEED_ALIASES + stored alias map. Validates not already picked. Derives pick owner from snake draft formula. Advances `currentPickIndex`. Starts next pick timer if configured. Transitions to `complete` when all picks exhausted. `autoSelected: false` on manual picks.
  - **`POST /api/draft/[slug]/[year]/unpick`** (v1): Admin-gated. Validates phase in `live|paused|complete`. Removes last pick, decrements `currentPickIndex`, resets timer, sets `phase: 'live'`.
  - **`PUT /api/draft/[slug]/[year]/pick/[n]`** (v1, FIX-v1, FIX-v3): Admin-gated. Edits pick `n` (1-indexed) via resolver. Validates no conflict at other positions. Preserves `pickNumber/round/roundPick/owner`; updates `team`, `pickedAt`, clears `autoSelected`.
  - **`POST /api/draft/[slug]/[year]/reset`** (v1, FIX-v1, FIX-v2): Admin-gated. Validates phase in `live|paused|complete|preview`. Resets to `phase: 'setup'`, clears picks/timer. JSDoc corrected to say "setup" not "preview".
  - **`timerAction` on `PUT /api/draft/[slug]/[year]`** (v1, FIX-v1, FIX-v3): `start|resume` → `timerState: running` + new `timerExpiresAt`. `pause` → null expiry. `expire` → validated server-side then dispatches `pause-and-prompt` or `auto-pick` per `timerExpiryBehavior`; also accepted when `phase=paused` + `timerState=expired` (commissioner auto-pick overlay) — always forces auto-pick via `effectiveBehavior` in that state. `timerExpiresAt` null-check and timestamp validation only applied on live-expire path; timestamp/null checks skipped for paused-expired path. Auto-pick branches on `autoPickMetric`: SP+ descending or preseason rank ascending (unranked last); both fall back to alphabetical when metric data unavailable.
  - **`/league/[slug]/draft` (commissioner page)** (v1, FIX-v1, FIX-v3): Server component, `force-dynamic`. Redirects to `/draft/setup` when draft is null/setup/settings/preview. Loads SP+, win totals, schedule, AP poll, prior-year games + scores for `selectDraftTeamInsights`. Alias maps loaded from `appStateStore` directly — global `aliases:${year}` and league-scoped `aliases:${slug}:${year}` merged with SEED_ALIASES; no browser-oriented `loadAliasMap()` call. Prior-year alias maps use `priorYear` in both scope keys. Renders `DraftBoardClient` (1s polling).
  - **`/league/[slug]/draft/board` (spectator page)** (v1): Public server component. Waiting card for pre-live phases. Same insight data. Renders `SpectatorBoardClient` (3s polling, no pick controls, available teams sliced to 30).
  - **`DraftBoardClient`** (v1, FIX-v1, FIX-v3): `'use client'`, 1s polling. Redirects non-admins to spectator view via `useEffect` + synchronous `hasStoredAdminToken()`. Filters drafted teams from available panel entirely (not dimmed). Post-reset: detects `phase === 'setup'` in `onUpdate` → navigates to `/draft/setup`. Client-side expire dispatch: when countdown reaches zero and `phase=live`+`timerState=running`, dispatches `PUT { timerAction: 'expire' }` to server; guarded by `expireDispatchedRef` (reset on `timerExpiresAt` change or network error) to prevent double-dispatch. Hooks ordering violation fixed — polling effect moved before early return.
  - **`SpectatorBoardClient`**: `'use client'`, 3s polling. No admin actions, no pick panel. Shows current pick owner and available teams (undrafted only, top 30).
  - **`DraftBoardGrid`**: Snake draft grid. Correct column alignment for odd rounds: `posInRound = isEvenRound ? colIdx : n-1-colIdx`. Highlights current pick cell in blue. Amber text for auto-selected picks.
  - **`OwnerRosterPanel`**: Highlights current owner with blue border + "← picking" label.
  - **`TimerDisplay`**: Countdown derived from server-authoritative `timerExpiresAt`. Urgent styling ≤10s. Progress bar. Paused/expired states.
  - **`PickNavigator`**: On-the-clock + on-deck owners with round/pick numbers. Previous pick section (team, owner, `(auto)` label when `autoSelected`).
  - **`DraftControls`**: Commissioner-only. Start/pause/resume timer; undo last pick; reset with two-click confirm. Pause-and-prompt overlay. Auto-pick button calls `timerAction: 'expire'` from `paused+expired` state.
- **Key architectural decisions:**
  - **Server-authoritative timer** — `timerExpiresAt` stored as ISO timestamp in `DraftState`; clients derive countdown from `timerExpiresAt - Date.now()`. Expiry validated server-side before state changes; client signals expiry via `timerAction: 'expire'`, server validates and applies.
  - **Client-side expire dispatch** — `DraftBoardClient` fires `timerAction: 'expire'` when countdown reaches zero; guarded by ref to prevent double-dispatch per pick; polling recovers state on non-200 responses.
  - **Expire from paused-expired state** — auto-pick button in pause-and-prompt overlay sends `timerAction: 'expire'` when `phase=paused` + `timerState=expired`; server accepts and always resolves to auto-pick via `effectiveBehavior`; the live-expire timestamp guards are skipped on this path.
  - **Auto-pick metric** — `autoPickMetric` in `DraftSettings`; `sp-plus` (default) sorts by SP+ descending; `preseason-rank` loads rankings cache and sorts by rank ascending (unranked last); both fall back to alphabetical when metric data unavailable.
  - **Identity resolver in all pick routes** — `createTeamIdentityResolver` with merged SEED_ALIASES + stored alias map; no direct `teamsData` scans.
  - **Server-safe alias loading** — draft page reads alias maps from `appStateStore` (global `aliases:${year}` + league-scoped `aliases:${slug}:${year}`, merged with SEED_ALIASES); `loadAliasMap()` is browser-only and removed from server components.
  - **Admin gate is client-side at the board** — sessionStorage not readable server-side; `DraftBoardClient` redirects non-admins via `useEffect`.
  - **Prior year data is optional** — `selectDraftTeamInsights` degrades gracefully when prior-year cache is cold; `lastSeasonRecord` is `null`.
  - **Reset targets `phase: 'setup'`** — consistent with PUT phase transition; triggers full draft re-configuration on reset.

---

### P5B — Draft Setup and Settings
- **Goals completed:**
  - **Redirect TODO resolved** (P5C-LIVE-DRAFT-BOARD-v1, Task 0): All four redirect targets in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` updated from `/draft/setup` to `/draft` now that the live board route exists.
  - **`POST /api/draft/[slug]/[year]/pick`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Admin-gated. Validates `phase === 'live'`. Resolves team name via `createTeamIdentityResolver` with SEED_ALIASES + stored alias map (F8 fix). Validates team not already picked. Derives pick owner from snake draft formula. Creates `DraftPick` with `autoSelected: false`. Advances `currentPickIndex`. Starts next pick timer if configured. Transitions to `phase: 'complete'` when all picks exhausted.
  - **`POST /api/draft/[slug]/[year]/unpick`** (P5C-LIVE-DRAFT-BOARD-v1): Admin-gated. Validates phase in `live|paused|complete`, picks non-empty. Removes last pick, decrements `currentPickIndex`, resets timer, sets `phase: 'live'`.
  - **`PUT /api/draft/[slug]/[year]/pick/[n]`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Admin-gated. Validates pick `n` (1-indexed) exists. Resolves team via identity resolver (F8 fix). Validates no conflict at other positions. Updates pick preserving `pickNumber/round/roundPick/owner`; updates `team`, `pickedAt`, sets `autoSelected: false`.
  - **`POST /api/draft/[slug]/[year]/reset`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Admin-gated. Validates phase in `live|paused|complete|preview`. Resets to `phase: 'setup'` (F1 fix — was `'preview'`), clears picks/timer.
  - **`timerAction` on `PUT /api/draft/[slug]/[year]`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Accepts `start|pause|resume|expire`. `start`/`resume`: sets `timerState: 'running'`, new `timerExpiresAt`. `pause`: `timerState: 'paused'`, null expiry. `expire`: validates `phase === 'live'` and `timerExpiresAt` not null and timestamp past (F9 fix); dispatches `pause-and-prompt` or `auto-pick` behavior per `timerExpiryBehavior` setting. Auto-pick selects best available team by SP+ rating (alphabetical tiebreak) and advances the draft.
  - **`/league/[slug]/draft` (commissioner page)** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): Server component, `force-dynamic`. Redirects to `/draft/setup` when draft is null/setup/settings/preview (F3 fix — preview added). Loads SP+, win totals, schedule, AP poll, and prior year games + scores for `selectDraftTeamInsights`. Renders `DraftBoardClient`. Prior year `lastSeasonRecord` computed via `buildScheduleIndex` + `attachScoresToSchedule` (F7 fix).
  - **`/league/[slug]/draft/board` (spectator page)** (P5C-LIVE-DRAFT-BOARD-v1): Public server component. Shows waiting card when draft is null/setup/settings. Loads same team insight data. Renders `SpectatorBoardClient` (3s polling, no pick controls, available teams sliced to 30).
  - **`DraftBoardClient`** (P5C-LIVE-DRAFT-BOARD-v1, P5C-LIVE-DRAFT-BOARD-FIX-v1): `'use client'`, 1s polling. Redirects non-admins to spectator board via `useEffect` (F2 fix — was read-only banner). Filters drafted teams from available panel entirely (F4 fix — was dimming). Post-reset redirect: detects `phase === 'setup'` in `onUpdate` callback and navigates to `/draft/setup` (F5 fix).
  - **`SpectatorBoardClient`**: `'use client'`, 3s polling. No admin actions, no pick panel. Shows current pick owner and available teams (undrafted only, top 30).
  - **`DraftBoardGrid`**: Snake draft grid. Rows = rounds, cols = owner headers (always owner[0..n-1] order). Correct column alignment for odd rounds: `posInRound = isEvenRound ? colIdx : n-1-colIdx`. Highlights current pick cell in blue. Amber text for auto-selected picks.
  - **`OwnerRosterPanel`**: Shows each owner's drafted teams. Highlights current owner with blue border + "← picking" label. Snake formula used to derive `currentOwnerIdx`.
  - **`TimerDisplay`**: Derives countdown from server-authoritative `timerExpiresAt` via `useEffect` interval. Urgent styling ≤10s. Progress bar. Shows paused/expired states.
  - **`PickNavigator`**: "On the clock" + "On deck" owners with round/pick numbers. Previous pick section shows last pick team, owner, and `(auto)` label when `autoSelected` (F6 fix).
  - **`DraftControls`**: Commissioner-only. Start/pause/resume timer; undo last pick; reset with two-click confirm. Pause-and-prompt overlay shows when `phase === 'paused' && timerState === 'expired'`; "Auto-pick" button calls `timerAction: 'expire'` to trigger server-side auto-pick.
- **Key architectural decisions:**
  - **Server-authoritative timer** — `timerExpiresAt` stored as ISO timestamp in draft state; client derives countdown from `timerExpiresAt - Date.now()`. Expiry validated server-side before state changes; client cannot trigger auto-pick early.
  - **Auto-pick via `timerAction: 'expire'`** — client signals expiry; server validates timestamp and applies pick. Same code path as manual expire keeps timer logic in one place.
  - **Admin gate is client-side at board level** — server can't read sessionStorage, so `DraftBoardClient` redirects non-admins to spectator view via `useEffect` + synchronous `hasStoredAdminToken()` check.
  - **Identity resolver used in all pick routes** — `createTeamIdentityResolver` with merged SEED_ALIASES + stored alias map is the canonical team resolution path; no direct `teamsData` scans.
  - **Reset targets `phase: 'setup'`** — consistent with PUT phase transition on `targetPhase === 'setup'`; ensures full draft re-configuration on reset.
  - **Prior year data passed as optional params** — `selectDraftTeamInsights` degrades gracefully when prior year cache is cold; `lastSeasonRecord` is null rather than blocking the page.

---

### P5B — Draft Setup and Settings

- **Status:** Complete. PR #211 open.
- **PROMPT_IDs:** P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-REVIEW-v1, P5B-DRAFT-SETUP-FIX-v1, P5B-DRAFT-SETUP-FIX-REVIEW-v1, P5B-DRAFT-SETUP-FIX-v2, P5B-DRAFT-SETUP-FIX-v3, P5B-DRAFT-SETUP-FIX-v4, P5B-CLOSEOUT-v1
- **Goals completed:**
  - **`src/lib/draft.ts`** (P5B-DRAFT-SETUP-v1): Shared type definitions — `DraftState`, `DraftSettings`, `DraftPick`, `DraftPhase`, `defaultDraftSettings()`, `draftScope()`. All draft state persisted in appStateStore at scope=`draft:${slug}`, key=`${year}`.
  - **`GET /api/draft/[slug]/[year]`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v1): Public read. Returns 404 when no draft exists. Validates slug in registry and year >= 2000.
  - **`POST /api/draft/[slug]/[year]`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v1): Admin-gated draft creation. Accepts `owners` + optional `settings`. Validates: owners min 2, settings.style='snake', pickTimerSeconds null or positive, totalRounds positive integer, draftOrder must match owners exactly when provided. Returns 409 if draft already exists. Sets initial phase to `'preview'` when `settings.scheduledAt` is a future date; `'setup'` otherwise.
  - **`PUT /api/draft/[slug]/[year]`** (P5B-DRAFT-SETUP-v1): Admin-gated. Updates owners, settings (merge), and/or phase. Validates phase transitions server-side against allowed transition table. Resets picks/timer on transition to 'setup'.
  - **`/league/[slug]/draft/setup` page** (P5B-DRAFT-SETUP-v1): Server component. Fetches league, existing draft state, prior year owners from most recent season archive (via `parseOwnersCsv(ownerRosterSnapshot)`), reverse-championship order from archive `finalStandings`, and FBS team count from `teams.json` for auto-suggesting rounds.
  - **`DraftSetupShell`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v4): Client shell component. Routes to `RosterSetupPanel`, `DraftSettingsPanel`, or preview card based on current `draftState.phase`. Preview→settings transition persists via API before updating local state (not client-only flip).
  - **`RosterSetupPanel`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v1): Auto-populates from prior year archive owners. Initialises to empty `[]` with dashed empty-state message when no prior archive. Add/remove/reorder owners. Validates min 2 before continuing. Creates draft via POST then advances to settings via PUT.
  - **`DraftSettingsPanel`** (P5B-DRAFT-SETUP-v1, P5B-DRAFT-SETUP-FIX-v4): Draft order (random/manual/reverse-championship), timer (none/30s/60s/90s/2min), expiry behavior (pause-and-prompt / auto-pick), auto-pick metric, total rounds (auto-suggested as `ceil(FBS / owners)`), optional scheduled start. Redirects to `/draft/setup` on preview or live transition (temporary — see redirect TODO below).
  - **Draft tab added to `WeekViewTabs`** (P5B-DRAFT-SETUP-v1): Links to `/league/${slug}/draft/setup`. Matches existing History tab style.
- **Key architectural decisions:**
  - **Phase transitions validated server-side** — no skipping; allowed transitions encoded in `VALID_PHASE_TRANSITIONS` map; 422 on invalid transition.
  - **POST accepts settings at creation time** — full settings validation on POST (not just PUT); draftOrder cross-validated against owners array on creation.
  - **Preview promoted at creation** — POST sets `phase: 'preview'` when `scheduledAt` is a future date; no separate promotion step needed.
  - **Back to Settings persists via API** — preview→settings transition calls PUT before updating local state; server state always reflects the true phase.
  - **RosterSetupPanel initialises empty** — `[]` not `['']` when no prior owners; clear empty-state message removes ambiguity.
- **⚠️ Redirect TODO for P5C:** All redirects in `DraftSettingsPanel.tsx` and `DraftSetupShell.tsx` currently point to `/league/${slug}/draft/setup` because the `/league/${slug}/draft` live board route does not exist until P5C. When the live draft board route is implemented, update all four redirect targets back to `/league/${slug}/draft`.

---

### P5A — Draft Data Infrastructure

- **Status:** Complete. PR #210 merged.
- **PROMPT_IDs:** P5A-DRAFT-DATA-INFRA-v1, P5A-DRAFT-DATA-INFRA-REVIEW-v1, P5A-IDENTITY-FIX-v1, P5A-CLOSEOUT-v1
- **Goals completed:**
  - **`POST /api/admin/cache-sp-ratings`** (P5A-DRAFT-DATA-INFRA-v1): Admin-gated endpoint that fetches SP+ ratings from CFBD `/ratings/sp?year=${year}` and caches in appStateStore at scope=`sp-ratings`, key=`${year}`. Returns `{ status: 'awaiting-ratings' }` gracefully when CFBD returns no data (ratings not yet published for the season) — does not write to store, does not error. Returns `{ alreadyCached: true }` on repeat call unless `force: true`. Adds `buildCfbdSpRatingsUrl` to `src/lib/cfbd.ts`.
  - **`GET/POST /api/admin/win-totals`** (P5A-DRAFT-DATA-INFRA-v1, P5A-IDENTITY-FIX-v1): GET returns stored win totals for a year (public). POST is admin-gated; parses `Team, WinTotalLow, WinTotalHigh` CSV and resolves team names via `createTeamIdentityResolver` with SEED_ALIASES + season alias map merged — the same pattern used in `odds/route.ts`. Unresolved teams reported in `unresolvedTeams` without blocking the upload. Writes to `appStateStore` scope=`win-totals`, key=`${year}`.
  - **`src/lib/selectors/draftTeamInsights.ts`** (P5A-DRAFT-DATA-INFRA-v1, P5A-IDENTITY-FIX-v1): Pure selector — no API calls, no side effects. Exports `DraftTeamInsights` type and `selectDraftTeamInsights()`. Derives: SP+ tier as relative quartiles across all FBS teams (top 25% = Elite, next 25% = Strong, next 25% = Average, bottom 25% = Weak); SOS tier as relative percentiles of avg opponent SP+ (top 30% = Hard, middle 40% = Medium, bottom 30% = Easy); home/away/neutral split from schedule; ranked opponent count from AP poll; last season record from optional `priorYearGames` + `priorYearScoresByKey` params (same pattern as `historySelectors.ts`). Provider team names (SP+ ratings, AP poll) resolved to canonical school names via `providerToCanonical` map built from `teams[].alts[]` before keying lookup maps. NoClaim filtered from output.
  - **`src/components/draft/DraftCard.tsx`** (P5A-DRAFT-DATA-INFRA-v1): Compact team card. Absent fields omitted entirely — no placeholders, no dashes. SP+ tier shown as neutral slate badge (no good/bad colors). "Ratings pending" in muted text when `awaitingRatings`. "Drafted" overlay when `isDrafted`. Hover ring + cursor-pointer when `onSelect` provided (commissioner view). No recommendation language.
  - **`SpRatingsCachePanel` + `WinTotalsUploadPanel`** added to `/admin/` page (P5A-DRAFT-DATA-INFRA-v1): SP+ panel has year input, cache trigger button, `alreadyCached` state with force-refresh option, `awaiting-ratings` amber message. Win totals panel has year input, CSV textarea, resolved count + unresolved team list on result. Both follow existing admin panel patterns.
- **Key architectural decisions:**
  - **awaiting-ratings is not an error** — SP+ ratings are typically published in preseason; the endpoint must handle early calls gracefully without polluting the cache with empty data.
  - **Win total upload uses full identity resolver** — same SEED_ALIASES + stored alias map merge used in `odds/route.ts`; sportsbook name variants are covered by the same alias infrastructure.
  - **Selector is pure** — all external data (SP+, AP poll, win totals, schedule, prior year games) passed as params by the caller; the selector never fetches. `lastSeasonRecord` null when `priorYearGames` not passed; degrades gracefully.
  - **Provider name canonicalization via alts[]** — SP+ and AP poll provider names resolved to canonical school names using `teams[].alts[]` before building lookup maps; no new matching logic introduced.
  - **DraftCard absent = absent** — spec explicitly requires no placeholder UI for missing data fields; each conditional block simply omits the element.

---

### P4D Polish, Backfill, and Historical Data Infrastructure

- **Status:** Complete. PR #207 merged.
- **PROMPT_IDs:** P4-HISTORICAL-SCHEDULE-CACHE-v1, P4-HISTORICAL-SCORES-CACHE-v1, P4-BACKFILL-v1, P4D-HISTORY-POLISH-v1, P4D-HISTORY-LAYOUT-v1, P4D-HISTORY-BANNER-v1, P4D-NOCLAIM-FIX-v1
- **Goals completed:**
  - **`POST /api/admin/cache-historical-schedule`** (P4-HISTORICAL-SCHEDULE-CACHE-v1): Admin-gated endpoint that fetches both regular and postseason CFBD schedule for a specified past year and writes a combined `CacheEntry` to `appStateStore` at scope=`schedule`, key=`${year}-all-all` — the exact key `buildSeasonArchive` reads as its primary cache lookup. Returns `{ alreadyCached: true }` if entry already exists (skippable with `force: true`). Rejects active season year. Graceful 502 on CFBD failure.
  - **`POST /api/admin/cache-historical-scores`** (P4-HISTORICAL-SCORES-CACHE-v1): Admin-gated endpoint that fetches both regular and postseason scores for a specified past year and writes two `CacheEntry` records at scope=`scores`, keys=`${year}-all-regular` and `${year}-all-postseason` — the exact keys `buildSeasonArchive` reads. Both must exist for `alreadyCached: true` to trigger. Companion to schedule cache endpoint; together they enable full historical season backfill.
  - **`POST /api/admin/backfill`** (P4-BACKFILL-v1): Admin-gated backfill endpoint. Builds and saves a `SeasonArchive` for a specified past year via `buildSeasonArchive` without calling `updateLeague` or advancing the active season year. Two-phase confirmation for overwrites: first call returns `{ requiresConfirmation: true, diff }`; second call with `confirmed: true` performs the overwrite.
  - **2021–2024 seasons backfilled:** Real roster, schedule, and score data loaded via the cache and backfill endpoints for all prior seasons. Historical league data is now live on the history landing page.
  - **All-time standings sort fix** (P4D-HISTORY-POLISH-v1): `selectAllTimeStandings` now sorts by championships desc → win percentage desc → total wins desc. Win percentage (`winPct`) added to `AllTimeStandingRow` type; computed after all wins/losses are accumulated (including live merge), normalizing for tenure length and roster size. Handles division by zero.
  - **NoClaim removed from all history views** (P4D-HISTORY-POLISH-v1, P4D-NOCLAIM-FIX-v1): NoClaim excluded from `selectAllTimeStandings` (archive iteration and live merge), `selectDynastyAndDrought`, `selectMostImprovedSeasonOverSeason`. `selectOwnerCareer` no longer short-circuits for NoClaim — real season records are returned if they exist; NoClaim excluded from H2H opponent matrix only. `selectAllTimeHeadToHead` and `selectTopRivalries` inherit NoClaim exclusion from `selectHeadToHead` (pre-existing).
  - **Win% column in AllTimeStandingsTable** (P4D-HISTORY-POLISH-v1): `Win%` column added between Record and Titles, showing `(winPct * 100).toFixed(1)%`.
  - **60/40 asymmetric two-column layout** (P4D-HISTORY-LAYOUT-v1): History landing page uses `lg:grid-cols-5` — left column `lg:col-span-3` (AllTimeStandingsTable + SeasonListPanel), right column `lg:col-span-2` (TopRivalries + MostImproved + DynastyDrought). ChampionshipsBanner spans full width above. Single column on mobile.
  - **History tab in league nav bar** (P4D-HISTORY-POLISH-v1): `WeekViewTabs` accepts `leagueSlug?: string` and renders a History `<Link>` tab pointing to `/league/${slug}/history/`. `CFBScheduleApp` passes `leagueSlug` prop to `WeekViewTabs`.
  - **Live season standings merged into all-time totals** (P4D-HISTORY-POLISH-v1): `selectAllTimeStandings` accepts optional `liveStandings?: StandingsRow[]`. History page calls `buildSeasonArchive` for the active year (try/catch fallback) if not yet archived; live wins/losses merged into totals without crediting a championship or incrementing `seasonsPlayed`. `AllTimeStandingsTable` shows "Includes live {year} season (in progress)" indicator when live data is present. Year derived from `league.year` — not hardcoded.
  - **Season in Progress banner card** (P4D-HISTORY-BANNER-v1): `ChampionshipsBanner` accepts `currentSeasonYear?: number` and `currentLeader?: string`. Renders a neutral-styled card (gray/white border, distinct from amber champion card) showing the active year, current standings leader (first non-NoClaim owner in live standings), labeled "Current Leader". No card when props absent.
- **Key architectural decisions:**
  - **Historical cache endpoints are quota-safe** — `alreadyCached` check prevents repeat CFBD calls; `force: true` allows intentional overwrite. Active season year rejected to prevent interference with the live cache path.
  - **Backfill never advances the season year** — `updateLeague` is not imported in the backfill route; file-level comment explicitly prohibits it.
  - **Live standings via buildSeasonArchive** — reuses existing battle-tested assembly path rather than reimplementing standings derivation. try/catch ensures the history page degrades gracefully if caches are cold.
  - **NoClaim exclusion is view-level, not data-level** — archives are stored as-is; NoClaim is filtered in selectors at the point of display. `selectOwnerCareer` preserves raw data for NoClaim in case it appears as a legitimate archive entry.

---

### Historical Season Backfill Endpoint

- **Status:** Complete. Merged as part of P4D PR.
- **PROMPT_IDs:** P4-BACKFILL-v1
- **Goals completed:**
  - **`POST /api/admin/backfill`** (P4-BACKFILL-v1): New admin-gated endpoint at `src/app/api/admin/backfill/route.ts`. Accepts `{ leagueSlug, year, confirmed? }`. Validates leagueSlug (non-empty string) and year (finite integer >= 2000). Returns 404 if league not found in registry. Two-phase confirmation flow: first call without `confirmed` returns `{ requiresConfirmation: true, diff }` via `diffSeasonArchives` — no write; second call with `confirmed: true` overwrites and returns `{ success: true, replaced: true }`. If no existing archive, builds and saves immediately (`replaced: false`). Schedule cache unavailable surfaced as `500` with the descriptive error message from `buildSeasonArchive`.
- **Key architectural decisions:**
  - **No year increment** — `updateLeague` is not imported; file-level comment explicitly prohibits it. This is a backfill-only operation; the active season year is never touched.
  - **Two-phase confirmation for overwrites** — diff is computed and returned before any write; admin must send `confirmed: true` to overwrite an existing archive.
  - **Schedule cache required** — `buildSeasonArchive` throws a clear error if the schedule cache is unavailable for the requested year; the endpoint surfaces it as 500 with the message rather than silently failing.

---

### P4D — League History and Owner Career UI

- **Status:** Complete. PR #204 merged.
- **PROMPT_IDs:** P4D-KICKOFF-v1, P4D-LEAGUE-HISTORY-UI-v1, P4D-LEAGUE-HISTORY-UI-REVIEW-v1, P4D-LEAGUE-HISTORY-UI-FIX-v1, P4D-BACKFILL-REVIEW-v1, P4D-LEAGUE-HISTORY-UI-FIX-v2, P4D-BUGS-v1
- **Goals completed:**
  - **Cross-season selectors** (P4D-LEAGUE-HISTORY-UI-v1): Seven new pure selectors added to `src/lib/selectors/historySelectors.ts` — `selectAllTimeStandings`, `selectChampionshipHistory`, `selectAllTimeHeadToHead`, `selectTopRivalries`, `selectDynastyAndDrought`, `selectMostImprovedSeasonOverSeason`, `selectOwnerCareer`. No modifications to the four existing single-season selectors. All seven are pure functions — no API calls, no side effects.
  - **League History Landing** (P4D-LEAGUE-HISTORY-UI-v1): New server component at `/league/[slug]/history/`. Fetches all archived years via `listSeasonArchives`, loads all archives in parallel. Renders: championships banner, all-time standings table (with career page links), season list, most improved panel, dynasty/drought panel, top rivalries panel. Empty state: "League history isn't available yet. Check back next offseason." 404 if league not found.
  - **Owner Career Page** (P4D-LEAGUE-HISTORY-UI-v1): New server component at `/league/[slug]/history/owner/[name]/`. `params.name` used directly — no `decodeURIComponent` (Next.js App Router already decodes route params). Renders: career summary card (record, championships, avg finish, seasons), season finish history table (season, finish, record, GB), all-time H2H panel with progressive per-season disclosure. Friendly empty state if owner not found in any archive.
  - **Nine new history components** (P4D-LEAGUE-HISTORY-UI-v1): `ChampionshipsBanner`, `AllTimeStandingsTable`, `SeasonListPanel`, `MostImprovedPanel`, `DynastyDroughtPanel`, `AllTimeHeadToHeadPanel`, `CareerSummaryCard`, `SeasonFinishHistory`, `AllTimeOwnerHeadToHeadPanel`.
  - **Back link fix** (P4D-LEAGUE-HISTORY-UI-v1): Both back links in `history/[year]/page.tsx` (archive-found and archive-missing states) updated from `/league/${slug}/` to `/league/${slug}/history/`. TODO comments removed.
  - **Fix round** (P4D-LEAGUE-HISTORY-UI-FIX-v1 + FIX-v2): Missing career page links added to `AllTimeHeadToHeadPanel`, `DynastyDroughtPanel`, `MostImprovedPanel` (slug prop added to latter two); Games Back column added to `SeasonFinishHistory` (`gamesBack` added to `OwnerSeasonRecord` type and populated from `finalStandings`); empty state copy corrected to match spec; `AllTimeHeadToHeadPanel` slug destructuring bug fixed (slug was in Props but not destructured — produced `/league/undefined/...` URLs).
  - **Bug fixes** (P4D-BUGS-v1): Removed double `decodeURIComponent` on owner route param (Next.js already decodes; double-decode throws `URIError` for names containing `%`). Fixed rivalry lead/trail/tied label in expanded detail — now correctly names the leader first with record flipped when ownerB leads; shows "Series tied" when record is equal.
- **Key architectural decisions:**
  - **Seven pure cross-season selectors** — all accept `SeasonArchive[]` and return plain data; no modifications to existing single-season selectors (`selectFinalStandings`, `selectOwnerRoster`, `selectSeasonSuperlatives`, `selectHeadToHead`).
  - **Owner identity is name-based across seasons** — same name = same career entry; name change = separate entry. Known limitation (Decision 1 from design doc). No persistent owner ID introduced.
  - **Same-owner pairings excluded from all H2H and rivalry selectors** — inherited from `selectHeadToHead` which guards `awayOwner === homeOwner`.
  - **Route params already decoded** — Next.js App Router decodes route params before the page component receives them; `decodeURIComponent` must not be applied again.
  - **Rivalry lead label always names the leader first** — when ownerB is ahead, the record is flipped so the display reads "[leader] leads [winner_count]–[loser_count]" regardless of lexicographic ordering.
  - **Back links point to history landing** — `/league/${slug}/history/` is the canonical back destination from season detail pages; the temporary `/league/${slug}/` links and TODO comments are fully removed.
- **Optional follow-up (not scheduled):**
  - Owner identity system (stable cross-season IDs mapping display names to persistent IDs).
  - Season comparison views.
  - All-time H2H matrix in a dedicated expandable section rather than the toggle-based panel.

---

### Roster Upload Fuzzy Matching

- **Status:** Complete. PRs #202–#203 merged.
- **PROMPT_IDs:** P4-ROSTER-UPLOAD-FUZZY-MATCH-DOCS-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-REVIEW-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v1, P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2
- **PRs merged:** #202 (docs), #203 (implementation + fixes)
- **Goals completed:**
  - **`rosterUploadValidator.ts`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New pure validation lib. `getFBSTeams(teams)` filters team catalog to FBS-only pool via `inferSubdivisionFromConference` — FCS teams never included. `findFuzzyMatch(inputName, fbsTeams)` implements Levenshtein distance + token overlap scoring with a conservative 0.65 confidence threshold. `validateRosterCSV(csvText, existingAliases, teams)` applies exact → alias → fuzzy resolution priority; exact lookup includes the full `alts[]` array from teams.json for broad abbreviation coverage without fuzzy.
  - **`globalAliasStore.ts`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New server-side global alias storage at `aliases:global / map`. `getGlobalAliases()`, `upsertGlobalAliases()`. `migrateYearScopedAliasesToGlobal()` performs a one-time exhaustive migration using `listAppStateKeys()` to discover all alias scopes across a year range (year−10 to year+1) for every known league slug — not just the single active year. Migration sentinel recorded after all scopes are processed. Idempotent — subsequent calls are immediate no-ops.
  - **`POST /api/owners/validate`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New admin-gated endpoint at `src/app/api/owners/validate/route.ts`. Returns `RosterValidationResult + fbsTeams[]` for the admin UI. No writes of any kind.
  - **`PUT /api/owners` safety guard** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): Server-side validation runs before every PUT — rejects with HTTP 400 and `unresolvedTeams` list if any team name cannot be resolved against FBS names and existing aliases. Enforced independently of the UI.
  - **`?scope=global` aliases support** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1, FIX-v1): `GET /api/aliases?scope=global` reads the global alias store; lazy migration triggered on first read. `PUT /api/aliases?scope=global` patches the global alias store. Year and league params ignored for global scope.
  - **`RosterUploadPanel.tsx`** (P4-ROSTER-UPLOAD-FUZZY-MATCH-v1): New three-phase admin upload component. Phase 1: league/year selector, file picker, validate button → POST to validate endpoint. Phase 2 (review): Confirmed section (collapsible, exact and alias matches), Needs Confirmation section (fuzzy suggestions with confidence indicator, confirm/override per item), No Match Found section (full FBS team picker with typeahead + alphabetical). Progress indicator. Complete Upload disabled until all items resolved. Phase 3: success message with team count and alias count. Added to `/admin/` page above `CFBScheduleApp`.
  - **Persistent upload error** (P4-ROSTER-UPLOAD-FUZZY-MATCH-FIX-v2): `uploadError` moved to a phase-agnostic render position with a "Try again" button — auto-upload failures (isComplete: true path) now surface immediately without requiring the admin to enter the review phase.
- **Key architectural decisions:**
  - **Upload-layer only** — fuzzy matching lives in the upload validation pipeline; `teamIdentity.ts` is unchanged. Schedule and game identity resolution are unaffected.
  - **FBS-only match pool** — `getFBSTeams()` is the hard boundary; FCS teams are never reachable regardless of input.
  - **`alts[]` in exact lookup** — common abbreviations (e.g., team.json entries like "App St", "Boise St") resolve as exact matches, not fuzzy, reducing unnecessary confirmation prompts.
  - **Global alias store** — confirmed fuzzy matches and manual selections are global (no league or year scoping); apply to all future uploads across all leagues and years. Legacy year-scoped aliases deprecated.
  - **Exhaustive lazy migration** (FIX-v2): Migration scans all league slug × year combinations via `listAppStateKeys()` rather than the single active year — ensures multi-year, multi-league alias history is fully migrated before the sentinel is written.
  - **Conservative confidence threshold** — 0.65; prefers returning null over a low-confidence suggestion. No-match items go to the manual FBS picker.
  - **Double-enforced upload guard** — UI prevents submission until `isComplete: true`; server-side PUT handler verifies independently.
- **Optional follow-up (not scheduled):**
  - Further fuzzy algorithm tuning based on observed real-world upload patterns.
  - Admin alias management page for reviewing and editing global aliases directly.

---

### Phase 4C — Season Detail UI

- **Status:** Complete. PR #201 merged.
- **PROMPT_IDs:** P4C-SEASON-DETAIL-UI-v1, P4C-ARCHIVE-DATA-MODEL-FIX-v1, P4C-ARCHIVE-DATA-MODEL-FIX-REVIEW-v1, P4C-ARCHIVE-DATA-MODEL-FIX-v2, P4C-LINT-FIX-v1, P4C-BUGS-v1, P4C-CLOSEOUT-v1
- **PRs merged:** #201
- **Goals completed:**
  - **`SeasonArchive` data model extension** (P4C-ARCHIVE-DATA-MODEL-FIX-v1): Added `games: AppGame[]` and `scoresByKey: Record<string, ScorePack>` to the `SeasonArchive` type in `src/lib/seasonArchive.ts`. Updated `buildSeasonArchive` in `src/lib/seasonRollover.ts` to include both fields in the returned archive. Required to enable game-pairing-level selectors (superlatives, H2H) — `StandingsHistory` alone does not store individual game pairings.
  - **Null guards for legacy archives** (P4C-ARCHIVE-DATA-MODEL-FIX-v2): Added `?? []` and `?? {}` at both selector consumption points in `historySelectors.ts` so archives written before the data model extension do not crash with `TypeError: undefined is not iterable`.
  - **`historySelectors.ts`** (P4C-SEASON-DETAIL-UI-v1): New selector file at `src/lib/selectors/historySelectors.ts`. Exports `selectFinalStandings`, `selectOwnerRoster`, `selectSeasonSuperlatives`, `selectHeadToHead`. `selectSeasonSuperlatives` derives 6 superlatives from game data: highest single-week score, biggest blowout, closest matchup, biggest upset (pre-game standings-based), most dominant stretch (consecutive wins), most improved (Week 1 to final rank). `selectHeadToHead` derives per-owner-pair W-L records and matchup details; `ownerA` is always lexicographically smaller; wins/losses from ownerA's perspective.
  - **Season detail page** (P4C-SEASON-DETAIL-UI-v1): New server component at `src/app/league/[slug]/history/[year]/page.tsx`. Validates year (>= 2000), looks up league from registry, reads archive via `getSeasonArchive`. Renders friendly "no archive" state with back link for missing seasons (with note that historical data starts from 2025). Back links point to `/league/${slug}/` with TODO comment to update to P4D history landing once that route exists.
  - **History components** (P4C-SEASON-DETAIL-UI-v1): 6 new components under `src/components/history/` — `ArchiveBanner` (amber "Archived — {year} Season" banner), `FinalStandingsTable` (rank/owner/record/GB/diff table), `SeasonArcChart` (client component wrapping `MiniTrendsGrid`), `SuperlativesPanel` (6 superlative cards with "Not available" fallbacks), `HeadToHeadPanel` (collapsible owner-pair rows with matchup detail expansion), `OwnerRosterCard` (team → owner grid from ownerRosterSnapshot).
  - **Bug fixes** (P4C-BUGS-v1): Added `awayOwner === homeOwner` exclusion guard in `getOwnedFinalGames` to prevent same-owner matchups from contaminating blowout/closest/H2H derivation. Fixed back links that pointed to unbuilt P4D route (consistent 404).
  - **Lint fix** (P4C-LINT-FIX-v1): Removed unused `ownerB` variable assignment in `selectHeadToHead` — confirmed not a logic bug; `pairingKey()` independently derives canonical ordering.
- **Key architectural decisions:**
  - **`StandingsHistory` gap** — `StandingsHistory` stores cumulative per-owner stats, not individual game pairings. Game-pairing data must come from `archive.games + archive.scoresByKey`. These were added to `SeasonArchive` rather than modifying `StandingsHistory` to avoid changing the charting data model.
  - **`NoClaim` exclusion** — `NO_CLAIM_OWNER = 'NoClaim'` sentinel is excluded from all game-pairing-level derivation to prevent unclaimed teams from appearing in superlatives or H2H.
  - **Biggest upset "pre-game" rank** — uses `byWeek[weeks[weekIdx - 1]]` (prior week standings) as the pre-game rank proxy; Week 1 games are excluded because no prior week exists.
  - **H2H canonical ordering** — `ownerA` is always lexicographically smaller; `pairingKey = ownerA::ownerB`; wins/losses from ownerA's perspective throughout.
  - **Null guards for backward compatibility** — `archive.games ?? []` and `archive.scoresByKey ?? {}` ensure the page does not crash when rendering archives written before the model extension; old archives render all game-derived panels as "Not available."
- **Optional follow-up (not scheduled):**
  - Update back links to `/league/${slug}/history/` once P4D history landing page is implemented (TODO comments left in page.tsx).
  - Owner career links from `OwnerRosterCard` once P4D owner career pages exist.

### Navigation, CTA Consistency & History Chrome (standalone)

**Navigation & Selector Integrity**
- Fixed matchup deep links in OverviewPanel and StandingsPanel to use league-scoped routes (`/league/[slug]/matchups`) instead of unsupported `?view=matchups` query params
- Fixed trends CTAs in OverviewPanel and StandingsPanel to use league-scoped routes (`/league/[slug]/standings?view=trends#trends`) instead of hardcoded root-scoped paths
- Retired `leagueHighlights` from `selectOverviewViewModel` — was producing an empty array with no consuming UI
- Removed TEMP-DIAG console logs from OverviewPanel.tsx

**CTA Consistency**
- Removed redundant "See full trends" CTA from Standings page — user is already viewing full trends content
- Replaced Trends section CTA with linked section header on Overview page
- Standardized all Overview page CTAs to plain text ↗ pattern matching "All results ↗"
- Removed `onViewStandings` prop from OverviewPanel after its consuming button was replaced with a Link

**History Page Chrome**
- Created `LeaguePageShell.tsx` — shared server-compatible league chrome component for standalone route pages
- Replaced standalone History page chrome (back link, h1, subtitle) with consistent league header and nav bar
- Added History as a separated muted tab in the main league nav with a vertical divider before it
- History page subtitle set to "Est. 2021" instead of active season year
- Removed "4 archived seasons" text from History page
- `foundedYear` identified as a Phase 7 commissioner settings field — hardcoded for now, to be made dynamic when league settings are built
- `LeaguePageShell` noted as a known duplication point with CFBScheduleApp header — to be reconciled in Phase 7

**Follow-up Fixes**
- Created `/league/[slug]/members/page.tsx` — Members was a client-side-only view mode with no dedicated route, causing LeaguePageShell Members tab to land on Overview instead. New route mirrors the Matchups/Standings pattern and renders CFBScheduleApp with `initialWeekViewMode="owner"`. All five nav tabs now have proper dedicated routes.
- Fixed Members tab href in `LeaguePageShell.tsx` to `/league/[slug]/members`

---

### Overview Page Polish (standalone)

**De-containerization**
- Removed outer card wrappers from Standings, Insights, Featured games, and GB Race sections
- Individual game cards retain borders — they are discrete objects
- Horizontal dividers replace card borders as section separators
- Season podium retains card treatment — amber border is doing meaningful visual work

**Podium redesign**
- Replaced mixed layout (wide #1 card + two half-width cards below) with three equal horizontal cards
- #1 card gets amber border and amber rank label — amber reserved exclusively for champion signals
- #2 and #3 get neutral borders and plain muted rank labels
- Removed narrative text from all podium cards — data speaks for itself
- Removed "Season podium" section title — self-evident from content
- Removed CHAMPION badge from Overview standings rows — podium handles champion signal

**Standings section restructure**
- Converted to trifold layout: Standings (25%) · AP Poll (25%) · Insights (50%)
- Removed column headers from Overview standings table — self-evident at this density
- Reordered standings row hierarchy: rank · name · record · GB on primary line, Win% · Diff on secondary line
- GB elevated to primary line — most important metric in a pool format
- Added inline last-5-weeks position delta columns to standings rows (Option A: week headers once at top)
- Removed CHAMPION badge from standings rows — redundant with podium above

**Champion narrative copy fix**
- Fixed champion margin narrative to use games back as primary descriptor
- Win% is a tiebreaker — no longer used as the margin of victory descriptor
- Correct: "Won the title by 7 games over Maleski"

**Owner color system**
- Created src/lib/ownerColors.ts as shared owner color utility
- getOwnerColor(ownerName) is now the sole source of owner color across the entire app
- Replaced position-based alphabetical color assignment with hardcoded name-to-color lookup
- Colors are now stable and consistent across all surfaces — chart lines, table legends, rank numbers
- Owner names are color-coded only when the table serves as a legend for an adjacent chart

**GB Race section**
- Renamed from "Trends" to "GB Race"
- Removed inline chart line labels — companion table serves as legend
- Reverted to top 5 lines on Overview — 14 lines too cluttered at this surface
- Added companion table showing GB change over last 5 weeks with current GB column
- Owner names color-coded in companion table to match chart lines

**AP Poll column**
- Added AP Poll snapshot as middle column of trifold
- Shows top 10 teams with week-over-week movement indicators
- Switches to CFP Rankings during postseason, back to AP at season end
- "Full rankings ↗" CTA links to FBS Polls page
- Fixed movement delta bug — was showing NR for all teams due to reference equality failure in previous week lookup
- Fixed week label alignment — converted to CSS grid so headers stay pinned to delta columns at all viewport widths

**DESIGN.md updates**
- Containerization rules
- Owner color encoding rules
- Podium design rules
- Champion narrative copy rules
- Section header rules
- Overview trifold layout
- Poll phase logic (inSeason → AP, postseason → CFP, complete → AP)

---

### Light Mode & Owner Color System (standalone)

**Light/dark mode foundation**
- Removed hardcoded className="dark" from layout.tsx
- Switched Tailwind darkMode from class-based to media strategy (prefers-color-scheme)
- Updated globals.css to use @media (prefers-color-scheme: dark) for CSS variables
- Landing page (RootPageClient.tsx) converted to theme-aware classes
- All card surfaces, borders, nav elements, and text hierarchy fixed for light mode
- Dark mode appearance unchanged throughout

**Owner color architecture**
- Deleted dead file src/app/trends/presentationColors.ts
- Rewrote ownerColors.ts with dynamic index-based palette (20 colors) supporting variable owner counts
- Centralized color map construction in CFBScheduleApp.tsx using canonical standings owner list
- Single ownerColorMap built once and passed as prop to all consuming components: StandingsPanel, OverviewPanel, MiniTrendsGrid, TrendsDetailSurface
- SeasonArcChart builds its own local map (isolated from app shell, correct deviation)
- Added isDark state with window.matchMedia listener so color map updates when system preference changes
- Removed all local buildOwnerColorMap() calls from consuming components

**Owner color palette**
- PALETTE_DARK: 20-color Tableau-derived palette optimized for dark backgrounds, vivid and distinct
- PALETTE_LIGHT: 20-color independently designed palette of rich saturated mid-lightness colors optimized for white backgrounds
- Both palettes designed for maximum perceptual separation across 20 slots
- Light and dark palettes are independent — each optimized for its own background, not required to match each other
- Assignment is alphabetical-index-based within each league for stable consistent color per owner
- Fallback: hash-based assignment for owners not in the sorted list

**Known limitations / future work**
- Dimmed chart lines in light mode (non-selected owners) are faint on white — opacity values tuned for dark mode
- Some color adjacency remains between a few owners at 14+ lines — inherent to the problem, mitigated by interactive hover/highlight
- User preference override (light/dark toggle) deferred until user accounts are built
- When user accounts land: switch Tailwind back to class strategy, add theme provider, store preference in user settings

---

### P7A-1 — Founded Year (Phase 7A)

**Data model**
- Added foundedYear?: number to the League type in src/lib/league.ts
- Auto-populated on league creation from current year — no commissioner input required
- PATCH /api/admin/leagues/[slug] now accepts and validates foundedYear (must be >= 1900, <= current year)

**Settings UI**
- Added Founded Year field to LeagueSettingsForm — editable number input
- Field pre-populates from saved value or current year if not yet set
- Helper text removed — field is self-explanatory

**History page**
- LeaguePageShell renders "Est. {foundedYear}" as subtitle when activeTab is history
- Subtitle only renders when foundedYear is explicitly set — no misleading fallback
- Added force-dynamic to history/page.tsx to prevent Next.js caching stale league data
- Fixed bug: second LeaguePageShell render path (main content) was missing foundedYear prop — only the empty state path had it
- TSC League foundedYear set to 2021 in production

**Debugging notes**
- Root cause of rendering failure: one of two render paths in history/page.tsx was missing the prop due to a partial find-and-replace during implementation
- Confirmed via Vercel function logs showing foundedYear: undefined in LeaguePageShell
- Diagnostic API route and console.logs removed before merge

---

### Phase 7A — Commissioner Self-Service

**PROMPT_IDs:** P7A-1-FOUNDED-YEAR-v1, P7A-1-FOUNDED-YEAR-FIX-v1 through v3, P7A-1-FOUNDED-YEAR-CLEANUP-v1 through v3, P7A-2-LEAGUE-HUB-STATUS-v1, P7A-3-ADMIN-POLISH-v1, P7A-3-FIX, P7A-4, P7A-4-FIX, P7A-4-FIX-2

**foundedYear field (P7A-1)**
- Added optional `foundedYear?: number` to League type
- Auto-populated on league creation from current year
- Editable in league settings via PATCH API (validated 1900–current year)
- History page subtitle shows "Est. {foundedYear}" when set, nothing when unset
- Bug fix: second LeaguePageShell render path was missing the prop due to partial find-and-replace

**League hub improvements (P7A-2)**
- LeagueStatusPanel surfaced on league hub (`/admin/{slug}`) above tool cards
- Setup progress checklist: league created, owners configured, draft confirmed, season live — incomplete steps link to relevant tools
- Settings card restored to Platform Admin hub commissioner tools
- Post-creation redirect sends commissioner to league hub instead of staying on leagues list

**Admin light mode (P7A-3)**
- All 10 admin shared components converted from hardcoded dark-only classes to theme-aware light/dark variants
- All 8 admin page files similarly fixed
- Pattern: bg-white/dark:bg-zinc-900 backgrounds, border-gray-200/dark:border-zinc-700 borders, text-gray-900/dark:text-zinc-100 text

**Aliases promoted to platform scope (P7A-4)**
- New `/admin/aliases` page loads and saves from `aliases:global` scope
- Aliases card added to Platform Admin hub
- Alias section removed from league Data page (replaced with redirect notice)
- Data card removed from commissioner tools on both hubs
- Existing `migrateYearScopedAliasesToGlobal()` handles legacy data migration automatically

**Status panel fixes (P7A-4-FIX, P7A-4-FIX-2)**
- Roster status simplified to "Roster set" (green) / "Not configured" (red) — no count, no timestamp
- "Not configured" indicator changed from amber to red (amber reserved for champion signals)

**Key decisions**
- `aliases:global` chosen over `aliases:{year}` — team names are stable across seasons, year-scoping added unnecessary complexity
- League Data page retained as redirect stub rather than deleted — preserves existing bookmarks and links

---

*Phases 1–3 entries have been moved to `docs/completed-work-archive.md`.*

---

### Template for future entries

Use this structure for each new completed phase/milestone:

- **Status:**
- **PROMPT_ID(s):**
- **Goals completed:**
- **Key outcomes:**
- **Optional follow-up debt (non-blocking):**
