# Completed Work Log

## Purpose / How to use this document

- This file is an **append-only log** of completed phases and major milestones.
- Record **what was built and why it mattered** (outcomes), not a commit-by-commit changelog.
- This is **not** an active task list.
- Add future completed phases/milestones here instead of mixing history into `docs/next-tasks.md`.

## Completed phases / milestones

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
