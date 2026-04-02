# Completed Work Log

## Purpose / How to use this document

- This file is an **append-only log** of completed phases and major milestones.
- Record **what was built and why it mattered** (outcomes), not a commit-by-commit changelog.
- This is **not** an active task list.
- Add future completed phases/milestones here instead of mixing history into `docs/next-tasks.md`.

## Completed phases / milestones

### P4D — History UI Polish, Historical Cache Endpoints, NoClaim Fix

- **Status:** Complete. PR #207 merged.
- **PROMPT_IDs:** P4-HISTORICAL-SCHEDULE-CACHE-v1, P4-HISTORICAL-SCORES-CACHE-v1, P4D-HISTORY-POLISH-v1, P4D-HISTORY-POLISH-REVIEW-v1, P4D-HISTORY-LAYOUT-v1, P4D-HISTORY-BANNER-v1, P4D-NOCLAIM-FIX-v1
- **Goals completed:**
  - **`POST /api/admin/cache-historical-schedule`** (P4-HISTORICAL-SCHEDULE-CACHE-v1): Admin-gated endpoint that fetches both regular and postseason CFBD schedule for a specified past year and writes a combined `CacheEntry` to `appStateStore` at scope=`schedule`, key=`${year}-all-all` — the exact key `buildSeasonArchive` reads as its primary cache lookup. Returns `{ alreadyCached: true }` if entry already exists (skippable with `force: true`). Rejects active season year. Graceful 502 on CFBD failure.
  - **`POST /api/admin/cache-historical-scores`** (P4-HISTORICAL-SCORES-CACHE-v1): Admin-gated endpoint that fetches both regular and postseason scores for a specified past year and writes two `CacheEntry` records at scope=`scores`, keys=`${year}-all-regular` and `${year}-all-postseason` — the exact keys `buildSeasonArchive` reads. Both must exist for `alreadyCached: true` to trigger. Companion to schedule cache endpoint; together they enable full historical season backfill.
  - **All-time standings sort fix** (P4D-HISTORY-POLISH-v1): `selectAllTimeStandings` now sorts by championships desc → win percentage desc → total wins desc. Win percentage (`winPct`) added to `AllTimeStandingRow` type; computed after all wins/losses are accumulated (including live merge), normalizing for tenure length and roster size. Handles division by zero.
  - **NoClaim removed from all history views** (P4D-HISTORY-POLISH-v1, P4D-NOCLAIM-FIX-v1): NoClaim excluded from `selectAllTimeStandings` (archive iteration and live merge), `selectDynastyAndDrought`, `selectMostImprovedSeasonOverSeason`. `selectOwnerCareer` no longer short-circuits for NoClaim — real season records are returned if they exist; NoClaim excluded from H2H opponent matrix only. `selectAllTimeHeadToHead` and `selectTopRivalries` inherit NoClaim exclusion from `selectHeadToHead` (pre-existing).
  - **Win% column in AllTimeStandingsTable** (P4D-HISTORY-POLISH-v1): `Win%` column added between Record and Titles, showing `(winPct * 100).toFixed(1)%`.
  - **60/40 asymmetric two-column layout** (P4D-HISTORY-LAYOUT-v1): History landing page uses `lg:grid-cols-5` — left column `lg:col-span-3` (AllTimeStandingsTable + SeasonListPanel), right column `lg:col-span-2` (TopRivalries + MostImproved + DynastyDrought). ChampionshipsBanner spans full width above. Single column on mobile.
  - **History tab in league nav bar** (P4D-HISTORY-POLISH-v1): `WeekViewTabs` accepts `leagueSlug?: string` and renders a History `<Link>` tab pointing to `/league/${slug}/history/`. `CFBScheduleApp` passes `leagueSlug` prop to `WeekViewTabs`.
  - **Live season standings merged into all-time totals** (P4D-HISTORY-POLISH-v1): `selectAllTimeStandings` accepts optional `liveStandings?: StandingsRow[]`. History page calls `buildSeasonArchive` for the active year (try/catch fallback) if not yet archived; live wins/losses merged into totals without crediting a championship or incrementing `seasonsPlayed`. `AllTimeStandingsTable` shows "Includes live {year} season (in progress)" indicator when live data is present. Year derived from `league.year` — not hardcoded.
  - **Season in Progress banner card** (P4D-HISTORY-BANNER-v1): `ChampionshipsBanner` accepts `currentSeasonYear?: number` and `currentLeader?: string`. Renders a neutral-styled card (gray/white border, distinct from amber champion card) showing the active year, current standings leader (first non-NoClaim owner in live standings), labeled "Current Leader". No card when props absent.
- **Key architectural decisions:**
  - **Historical cache endpoints are quota-safe** — `alreadyCached` check prevents repeat CFBD calls; `force: true` allows intentional overwrite. Active season year rejected to prevent interference with the live cache path.
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

### Phase 3 — Multi-League Support

- **Status:** Complete. PRs #192–#196 merged.
- **PROMPT_IDs:** P3-MULTILEG-FOUNDATION-v1, P3-MULTILEG-FOUNDATION-REVIEW-v1, P3-MULTILEG-FOUNDATION-FIX-v1, P3-MULTILEG-FOUNDATION-FIX-VERIFY-v1, P3-MULTILEG-FOUNDATION-FIX-v2, P3-MULTILEG-ROUTING-v1, P3-MULTILEG-ROUTING-REVIEW-v1, P3-MULTILEG-ROUTING-FIX-v1, P3-MULTILEG-ROUTING-FIX-REVIEW-v1, P3-MULTILEG-WRITE-SCOPE-FIX-v1, P3-MULTILEG-WRITE-SCOPE-REVIEW-v1, P3-MULTILEG-ADMIN-UI-v1, P3-MULTILEG-ADMIN-UI-REVIEW-v1, P3-MULTILEG-ADMIN-UI-FIX-v1, P3-MULTILEG-ADMIN-UI-COPY-v1, P3-MULTILEG-FALLBACK-REMOVAL-v1, P3-MULTILEG-FALLBACK-REMOVAL-REVIEW-v1, P3-MULTILEG-FALLBACK-CLEANUP-v1, P3-MULTILEG-CLOSEOUT-v1
- **PRs merged:** #192 (foundation), #193 (routing), #194 (admin UI), #195 (admin UI copy polish), #196 (fallback removal + cleanup)
- **Goals completed:**
  - **League type and registry** (PR #192, P3-MULTILEG-FOUNDATION-v1): Defined `League` type (`slug`, `displayName`, `year`, `createdAt`). Implemented `leagueRegistry.ts` with `getLeagues`, `getLeague`, `addLeague`, `updateLeague`. Added admin API routes — `GET /api/admin/leagues` (public), `POST /api/admin/leagues` (admin-gated), `PATCH /api/admin/leagues/:slug` (admin-gated). Updated all three durable data routes (`/api/owners`, `/api/aliases`, `/api/postseason-overrides`) with league-scoped read/write and TRANSITION FALLBACK for migration.
  - **Foundation fixes** (PR #192, P3-MULTILEG-FOUNDATION-FIX-v1 + v2): Added duplicate guard to `addLeague()`. Made `GET /api/admin/leagues` public for server-side routing. Added PUT registry validation. Fixed malformed slug silent coercion bug. Fixed alias incremental merge inheritance bug by introducing `readAliasesScopedOnly`.
  - **League-scoped routing** (PR #193, P3-MULTILEG-ROUTING-v1 + fix): Created `/league/[slug]/` route hierarchy — `page.tsx` (overview), `standings/page.tsx`, `trends/page.tsx` (redirect to standings?view=trends), `rankings/page.tsx`. Converted all four root routes to registry-based redirects reading `getLeagues()` at request time. Threaded `leagueSlug` through full bootstrap chain: `CFBScheduleApp` → `useScheduleBootstrap` → `bootstrapAliasesAndCaches` → all three API client functions. Updated `OverviewPanel` and `RankingsPageContent` nav links for league-aware routing.
  - **Write-scope symmetry** (PR #193, P3-MULTILEG-WRITE-SCOPE-FIX-v1): All three save functions (`saveServerAliases`, `saveServerOwnersCsv`, `saveServerPostseasonOverrides`) updated to pass `leagueSlug` to API calls. Read/write now fully symmetric.
  - **Admin leagues UI** (PR #194–#195, P3-MULTILEG-ADMIN-UI-v1 + fixes): Created `src/app/admin/leagues/page.tsx` — league list, inline edit (displayName + year), create form with client-side slug validation, `AdminAuthPanel` reuse, plain-language copy. Added "League Management" navigation link to `AdminDebugSurface`.
  - **Fallback removal** (PR #196, P3-MULTILEG-FALLBACK-REMOVAL-v1): Removed TRANSITION FALLBACK from all three GET handlers after TSC league migration confirmed complete. Removed redundant `readAliasesScopedOnly` function (now identical to `readAliases` after fallback removal).
- **Key architectural decisions implemented:**
  - **Slugs are runtime data, not configuration** — no slug hardcoded in application code; all routing and storage keys derive from the registry at runtime.
  - **League-scoped storage key convention** — `${type}:${slug}:${year}` for owners, aliases, postseason-overrides; year-only path unchanged for callers without `?league=`.
  - **Registry-based dynamic redirects** — root routes read the registry at request time, redirect to the first league's slug; no hardcoded redirect target.
  - **Bootstrap call chain is league-aware end-to-end** — `leagueSlug` flows from route param through every layer to API calls.
  - **Read fallback introduced for migration, then removed** — TRANSITION FALLBACK enabled phased migration without downtime; removed after TSC league confirmed migrated to scoped keys.
  - **Phase 4 sequencing satisfied** — league slugs and registry in place; archive keys can be league-scoped from first write with no migration debt.
- **Optional follow-up (not scheduled):**
  - `/league/:slug/schedule` and `/league/:slug/matchups` as discrete routes (currently served via `?view=` query params on main page).
  - League deletion support (explicitly deferred at Phase 3 launch).

---

### Post-Phase 2D Corrections and Trend Enhancements

- **Status:** Complete. PRs #184–#188 merged on phase-3b-visual-sweep.
- **PROMPT_IDs:** P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1, P2-OVR-TRENDS-POSTSEASON-v1, P2-OVR-TRENDS-POLISH-v1, P2-OVR-TRENDS-LABELS-v1
- **Goals completed:**
  - **Standings sort rule fix** (PR #184, P2C-STANDINGS-RULE-AND-DOCS-REALIGNMENT-v1): Corrected sort comparator from winPct-first to wins-first per league rules. Added three regression tests covering wins-beats-winPct, winPct tiebreaker, and point differential tiebreaker.
  - **Postseason week truncation fix** (PR #188, P2-OVR-TRENDS-POSTSEASON-v1): CFBD postseason API restarts week numbers from 1; `buildScheduleFromApi` now computes `postseasonCanonicalWeek = maxRegularSeasonWeek + providerWeek`, making postseason weeks 17+ and preventing Set deduplication from collapsing them into regular-season slots. `providerWeek` preserved for score attachment. `selectPositionDeltas` selector added to `trends.ts` — derives week-over-week standings position delta (positive = moved up) for last N resolved weeks. Replaced `RecentFormPanel` (W/L dots) in Overview with `PositionDeltaPanel` (rank change arrows).
  - **Chart dead space and week labels** (P2-OVR-TRENDS-POLISH-v1): Removed empty label lane from `MiniTrendsGrid` VIEWBOX when no annotations were present. Added `buildWeekLabelMap` / `formatWeekLabel` utilities in `src/lib/weekLabel.ts` — map postseason game stages to human-readable labels (CFP, Bowl, CCG) driven by actual schedule data; x-axis now shows meaningful postseason week labels instead of W17/W18.
  - **Endpoint annotations and color coordination** (P2-OVR-TRENDS-LABELS-v1): Restored 90-unit annotation lane in `MiniTrendsGrid` with owner name + GB endpoint labels (collision-detected). Exported `CONTENDER_COLORS` from `MiniTrendsGrid` for shared use. `PositionDeltaPanel` owner name `<span>`s colored to match their corresponding trend line using `CONTENDER_COLORS`.
- **Key outcomes:**
  - Standings sort now correctly ranks by wins (primary), then win percentage, then point differential — matching the stated league rules.
  - Trend charts display the full season arc including postseason weeks; no data truncation at week 16.
  - Overview Trends card shows position-change momentum alongside the title-race chart, with color continuity between panels.
  - Postseason x-axis labels (CFP, Bowl, CCG) replace meaningless W17/W18 labels throughout the chart.
- **Optional follow-up (not scheduled):**
  - Magic number / elimination tracker as a third panel candidate.

---

### Phase 2D — Overview Trends Visual Sweep

*Formerly labeled Phase 3B prior to phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).*

- **Status:** Complete. PRs #178–#183 merged.
- **PROMPT_IDs:** P2D-TRENDS-TITLE-CHASE-v1, P2D-TRENDS-FORM-DOTS-v1
- **Goals completed:**
  - Built `MiniTrendsGrid` component — compact SVG line chart embedded in Overview Trends card.
  - Iterated through viewBox letterboxing fix, inline end labels with push-down deconfliction, and bump chart (all 15 owners).
  - Pivoted to "title chase" framing: top-5-contenders Games Back chart, last 5 weeks, half-width layout, leader label clamp.
  - Added `selectGamesBackTrend`, `selectRankTrend` selectors to `src/lib/selectors/trends.ts`.
  - Added Games Back column to `CondensedStandingsTable` on the Overview standings card.
  - Added `selectRecentOutcomes` selector — derives per-week W/L from actual game scores (`games + scoresByKey + rosterByTeam`), not inferred cumulative diffs.
  - Built `RecentFormPanel` — green/red dot grid for last 5 game outcomes, all owners, sorted by current standings rank (superseded by `PositionDeltaPanel` in post-2D corrections).
  - Responsive layout — stacks vertically on mobile, side-by-side on `sm+`.
- **Key outcomes:**
  - Overview Trends card conveys the title race narrative at a glance without navigating to the full Trends page.
  - Form dots reflect verified final game scores, not standing estimates.
  - Chart and form panel are visually cohesive, compact, and work on mobile.
- **Optional follow-up (not scheduled):**
  - Further form dot polish (sizing, legend, win-streak callout).
  - Magic number / elimination tracker as a third panel candidate.

---

### Phase 2C — Overview Visual Redesign

*Formerly labeled Phase 3A prior to phase numbering reconciliation (DOCS-PHASE-RECONCILIATION-v1).*

- **Status:** Complete. PRs #173–#177 merged.
- **PROMPT_ID:** P2C-OVERVIEW-REDESIGN-v1
- **Goals completed:**
  - Redesigned Overview hero into a champion podium with gold/silver/bronze medal accents and a "Champion" badge for the season winner.
  - Added Win% leaders section and a dedicated Rankings tab surfacing AP/Coaches poll data.
  - App-wide visual sweep — tab bar styling, matchup card layout, flat insights list.
  - Design refinements — muted blue palette, corrected win bar rendering, removed duplicate bars from Trends.
  - Restructured Trends section — removed embedded `TrendsDetailSurface` from Overview; relocated to a compact mini-chart placeholder in Standings sidebar pending Phase 3B build-out.
- **Key outcomes:**
  - Overview has a clear visual hierarchy: podium hero → standings/insights grid → results/matchups → trends.
  - App-wide color and type language is consistent across Overview, Standings, and Matchups surfaces.
  - Rankings data is surfaced without cluttering primary league views.
- **Optional follow-up (not scheduled):**
  - Podium animation or expanded champion celebration for postseason.
  - Win% bar chart integration into Trends card if space allows.

---

### Phase 2B — UX/Engagement Campaign

- **Status:** Complete. PRs #167–#172 merged.
- **PROMPT_ID:** P2B-OVERVIEW-UX-CAMPAIGN-v1
- **Goals completed:**
  - Overview hierarchy fix — standings + insights grid repositioned immediately after the hero; narrative sections pushed below.
  - Signal-first copy pass — removed redundant "League" prefixes, filler language, and "this week" suffixes throughout.
  - Member feedback entry point — lightweight "Report an issue" link added to the page footer.
  - UX / information density pass — mobile nav improvements, discoverability enhancements, layout clarity.
  - App flow — tab reorder reflecting usage priority, Matrix season-scope fix, copy alignment across pages.
  - Visual design language — consistent type size floor, letter-spacing, border-radius, and hover state conventions.
- **Key outcomes:**
  - Standings are visible on mobile without scrolling past narrative sections.
  - Copy is data-first throughout; reduced cognitive overhead for scan-and-leave usage patterns.
  - Members have a low-friction path to report data issues without leaving the app.
  - Design language is consistent enough to extend without per-component decisions.
- **Optional follow-up (not scheduled):**
  - Commissioner recovery UX refinements — defer until real hosted usage patterns emerge.

---

### Shared Insights System + Overview Restructure (Phase 2B delivery)

- **Status:** Complete through Phase 6 (convergence). Phase 7 expansion items are optional and not scheduled.
- **Goals completed:**
  - Built `deriveLeagueInsights()` as the canonical shared selector in `src/lib/selectors/insights.ts` (589 lines).
  - Implemented 8 deterministic insight types: `movement`, `toilet_bowl`, `surge`, `collapse`, `race`, `champion_margin`, `failed_chase`, `tight_cluster`.
  - Built filtered consumer selectors: `deriveOverviewInsights()` (top-3 for Overview) and `deriveStandingsInsights()` (1–2 contextual insights for Standings).
  - Integrated shared selector into both OverviewPanel and StandingsPanel; removed all page-level insight derivation.
  - Added standings movement (rank delta) column with directional arrow indicators.
  - Restructured Overview into a two-column grid: standings context left, insights/results/live right.
  - Moved head-to-head matchup matrix from Overview into a dedicated week-view matrix tab.
- **Key outcomes:**
  - All league insights derive from a single source — no duplicate or contradictory derivation across pages.
  - Insight ranking is deterministic: same inputs always produce the same ordered output.
  - Overview and Standings both surface the same insight catalog through different filtered lenses.
  - Head-to-head matrix is accessible without cluttering the primary Overview layout.
- **Optional follow-up (not scheduled):**
  - Phase 7 insight type expansion (longest streak, volatility, late-season pressure) — add only if specific member feedback warrants it.

---

### Phase 2A — Production Hardening Closeout

- **Status:** Complete. Engineering closeout and mobile/device validation sign-off both landed.
- **Goals completed:**
  - Hardened shared durable commissioner-managed state for hosted reads.
  - Protected commissioner mutation and refresh flows with lightweight admin authorization.
  - Enforced season-persistent cache-first behavior with admin-only rebuild semantics for schedule/reference refresh.
  - Landed shared cache snapshots for expensive regenerable data and conservative quota-aware refresh behavior.
  - Clarified diagnostics authority by distinguishing shared durable state from ephemeral process-memory counters.
  - Shipped targeted mobile responsiveness fixes: text size floors, touch target improvements, admin button sizing, and AliasEditorPanel header wrapping.
- **Key outcomes:**
  - Ordinary member traffic now reads shared cached state without opportunistic upstream rebuilds of schedule/reference data.
  - Commissioner/admin refresh actions are explicit and auditable.
  - Diagnostics are clearer for hosted operators, reducing confusion during production recovery workflows.
  - Core member surfaces (GameScoreboard, GameWeekPanel, MatchupsWeekPanel, StandingsPanel, OverviewPanel, WeekControls) validated for real-device mobile use.
- **Optional follow-up debt (non-blocking):**
  - Continue tightening admin/debug copy based on real hosted usage feedback.
  - Optional decomposition of larger files remains available after hosted validation stabilizes.

---

### Phase 2 — Score Hydration + Weekly Usability Progress

- **Status:** Landed; follow-on Phase 2 usability work remains active.
- **Goals completed:**
  - Defaulted the dashboard to the current in-season week with sensible fallback behavior.
  - Improved weekly dashboard scanability and cleaned up ownership labeling.
  - Expanded score hydration to cover season-wide manual refresh flows.
  - Tightened bootstrap score hydration scope for safer initial loading.
  - Added automatic postseason score hydration on first postseason tab visit.
- **Key outcomes:**
  - The weekly dashboard now opens closer to the most relevant league view with less user friction.
  - Score visibility and refresh behavior are more complete across regular-season and postseason browsing.
  - The remaining Phase 2 queue can now focus on matchup framing, responsive polish, standings, and feedback entry points.
- **Optional follow-up debt (non-blocking):**
  - Additional refinement of weekly matchup presentation and mobile ergonomics is still tracked in the active Phase 2 queue.

---

### Phase 1 — Architecture Stabilization

- **Status:** Complete (close-out audit finished).
- **Goals completed:**
  - Shifted runtime flow to API-first schedule and scores via CFBD-backed adapters.
  - Established odds ingestion through internal adapter boundaries.
  - Preserved alias persistence, local fallback behavior, and repair workflows.
  - Maintained diagnostics surfaces for reconciliation and operator visibility.
  - Landed shared retry/backoff/pacing protections and schedule-derived attachment boundaries.
- **Key outcomes:**
  - Stable and predictable ingestion pipeline: schedule as source-of-truth, with scores/odds attached through shared identity helpers.
  - Clear architecture boundaries between routes, orchestrator UI, and shared lib logic.
  - Practical local caching model retained for commissioner workflows.
- **Optional follow-up debt (non-blocking):**
  - Additional decomposition of `src/components/CFBScheduleApp.tsx`.
  - Additional decomposition of `src/lib/scoreAttachment.ts`.

---

### Template for future entries

Use this structure for each new completed phase/milestone:

- **Status:**
- **PROMPT_ID(s):**
- **Goals completed:**
- **Key outcomes:**
- **Optional follow-up debt (non-blocking):**
