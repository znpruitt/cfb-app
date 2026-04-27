# Campaign: STANDINGS-OWNERSHIP-MODEL-REDESIGN

**Status:** Complete — all six phases shipped.
**PROMPT_IDs:** STANDINGS-CANONICAL-SELECTOR-DISCOVERY, STANDINGS-CANONICAL-SELECTOR-CORE, STANDINGS-CANONICAL-SELECTOR-OVERVIEW, STANDINGS-OWNERSHIP-MODEL-DISCOVERY, STANDINGS-OWNERSHIP-PHASE-0-INVALIDATION, STANDINGS-OWNERSHIP-PHASE-1-OVERVIEW, STANDINGS-OWNERSHIP-PHASE-2-STANDINGS-ROUTE, STANDINGS-OWNERSHIP-PHASE-3-MEMBERS-MATCHUPS, STANDINGS-OWNERSHIP-PHASE-4-HISTORY, STANDINGS-OWNERSHIP-PHASE-5-LIFECYCLE

---

## 1. Inciting Issue

A user screenshot showed NoClaim occupying the #1 slot on the Overview standings panel during Test League preseason. Multiple Overview surfaces — the top-3 hero, the condensed standings table, and the Games Back chart — all displayed different data simultaneously.

Root cause: every Overview surface independently merged client-side live data with partial server state at render time. Each surface had a slightly different readiness predicate ("has rows?", "has a resolved week?", etc.), so they resolved to different states depending on what had hydrated. During preseason, when canonical standings had no resolved data yet, these predicates misfired and NoClaim — which should never appear at #1 — floated to the top of whichever surface checked last.

---

## 2. Scope Evolution

**Original framing (4-prompt canonical selector campaign):**

1. STANDINGS-CANONICAL-SELECTOR-CORE — build `getCanonicalStandings` server selector
2. STANDINGS-CANONICAL-SELECTOR-OVERVIEW — migrate Overview to consume it
3. STANDINGS-CANONICAL-SELECTOR-FANOUT — migrate remaining consumers
4. STANDINGS-CANONICAL-SELECTOR-SERVER-INSIGHTS — wire insights to server canonical

After STANDINGS-CANONICAL-SELECTOR-OVERVIEW went through eight rounds of Codex remediation — every round addressing a different edge case of the merge-at-render-time pattern — the pattern was identified as architecturally brittle, not just under-specified. The campaign was replanned from scratch.

**Replanned as 6-phase ownership redesign (STANDINGS-OWNERSHIP-MODEL-DISCOVERY):**

The key insight: merge-at-render-time was not a fixable implementation detail. It was the wrong architecture. The correct boundary is: server owns the settled snapshot, client owns live overlays, both travel as separate props. Eight rounds of remediation had all been patching the same structural flaw.

---

## 3. Architectural Shift

**Before:** Components computed standings by merging two sources at render time:
```
// shape-readiness predicate (simplified)
const rows = canonical?.rows?.length ? canonical.rows : clientDerivedRows;
```

**After:** Server canonical and client liveDelta are permanently separate seams:
```
// Server RSC → component props
<StandingsPanel canonical={canonical} />

// Client hook → separate prop
const liveDelta = useLiveDelta(games, canonical);
<StandingsPanel canonical={canonical} liveDelta={liveDelta} />
```

Canonical defines what a row says. `liveDelta` defines what badges and chips annotate next to it. They never merge.

---

## 4. Phase-by-Phase Summary

### Phase 0 — Invalidation Infrastructure

**Problem:** Mutations (owner uploads, alias saves, score refreshes, admin operations) had no mechanism to invalidate stale standings cache.

**Solution:**
- Wrapped `getCanonicalStandings` with `unstable_cache` + `React.cache`
  - `React.cache`: per-request dedup (collapses N identical calls within one render pass)
  - `unstable_cache`: cross-request tag-based invalidation
- Added `invalidateStandings(slug, year)` helper
- Wired into all mutation routes: owners, aliases, postseason-overrides, draft confirm, schedule, scores, admin backfill, admin rollover
- `RosterUploadPanel` calls `router.refresh()` after successful upload

**Cache key design:** Closure pattern required — the function passed to `unstable_cache` must close over `slug` and `year` so they appear in the key array, not just as runtime arguments.

**Tag granularity:**
- `standings:{slug}` — invalidated on any mutation for the league (slug-level)
- `standings:{slug}:{year}` — invalidated on year-specific mutations

### Phase 1 — Overview Takeover Collapse

**Problem:** `CFBScheduleApp`'s Overview path merged client and server data at render time. All three Overview surfaces resolved independently, producing visually inconsistent displays.

**Solution:**
- Removed all merge-at-render-time logic from the Overview path
- Introduced `liveDelta` interface: `LiveGameDelta`, `LivePendingOwnerDelta`, `LiveDelta` types
- Added `selectLiveDelta` selector (pure function: `(games, canonical) => LiveDelta`)
- Added `useLiveDelta` hook (client-side: calls `selectLiveDelta` on each render)
- Server canonical now owns: rows, history, colorOrder, owner identity
- Client liveDelta owns: in-progress game annotations, per-owner pending W-L counts

### Phase 2 — Standings Route + StandingsPanel Migration

**Problem:** The dedicated `/league/[slug]/standings` page independently derived standings rather than consuming canonical.

**Solution:**
- Server RSC route calls `getCanonicalStandings` and passes result as props
- `StandingsPanel` consumes `canonical.rows`, `canonical.history`, `canonical.colorOrder` directly
- First liveDelta UI integration: W-L pending badges appear next to owner names during active games
- **NoClaim filtering moved to source:** `deriveStandings` now returns `{ rows, noClaimRow, ... }` where `rows` excludes NoClaim. The `splitOutNoClaim` helper in `src/lib/standings.ts` is the single filter site.

### Phase 3 — Members + Matchups Route Migrations

**Problem:** `OwnerPanel`, `MatchupsWeekPanel`, `MatchupMatrixView` each derived or re-fetched standings independently. Admin forms showed stale standings after mutations.

**Solution:**
- Members route and all owner-facing components consume canonical
- Matchups route and all matchup views consume canonical
- Second liveDelta UI integration: pulsing dot added to LIVE pill in `MatchupsWeekPanel` for in-progress games
- Admin form refresh polish: alias editor, postseason override, season rollover, backfill, and roster editor all call `router.refresh()` after success

### Phase 4 — History Live-Rebuild Migration

**Problem:** The History page called `buildSeasonArchive(slug, activeYear)` to rebuild a current-season archive on the fly, bypassing the canonical standings path entirely.

**Solution:**
- Replaced `buildSeasonArchive(slug, activeYear)` with `getCanonicalStandings({ slug, year: activeYear })`
- History page now uses the same server canonical path as all other consumers
- Eliminated a parallel derivation that could produce a different result than the standings page for the same season

### Phase 5 — Lifecycle Hardening

**Problem:** `deriveLifecycleState` captured `currentDate` via `new Date()` internally, making lifecycle derivation non-deterministic and untestable. Preseason insight generators produced nonsensical output ("Toilet bowl leader", "Crowded finish in 0 games") because they ran against current-roster data with no season data yet.

**Solution:**
- `currentDate` captured once at request-handler entry, passed through all derivation layers
- No implicit `new Date()` inside `deriveLifecycleState` or any downstream derivation function
- `usingArchivedRoster: boolean` added to `InsightContext` — signals when a `fresh_offseason` state is using the prior season's roster snapshot rather than a current upload. Future generators can gate on this flag to suppress preseason-unsafe insights.
- `POSTSEASON_START_WEEK = 16` documented with rationale comment (Option B: constant with explanation; Option A: derive from schedule data — deferred)

---

## 5. Key Technical Decisions

### Tag-based invalidation with React.cache + unstable_cache composition

Considered three options:
- A: Manual revalidation (call `revalidatePath` per mutation route) — rejected because it requires knowing all URLs that display standings data, and that set grows with every new route
- B: Time-based TTL (`revalidate: 60`) — rejected because mutations would silently show stale data for up to 60 seconds
- C: Tag-based invalidation (chosen) — `revalidateTag('standings:{slug}')` from any mutation route invalidates all pages that consumed the tag, regardless of URL

`React.cache` wrapping `unstable_cache` is not redundant: `React.cache` collapses N identical server-component calls within a single render tree into one; `unstable_cache` provides the cross-request persistence and tag surface.

### liveDelta as a separate seam (not a merged value)

The original `canonical?.rows ?? clientRows` pattern was the root cause of all eight Phase 2 remediation rounds. Each edge case addressed by a round was a different condition under which the merge predicate misfired (preseason, mid-week, empty roster, partial hydration, etc.).

The correct framing: these are two different things. Canonical is a settled fact. `liveDelta` is a transient annotation on top of that fact. They should never be unified into a single value; they should travel as separate props and be rendered at separate layers.

### Per-route compatibility shim

During the migration, some routes had canonical data while others didn't yet. A shim (`canonical?.rows ?? client.rows`) allowed pages to migrate one at a time without breaking pages that hadn't migrated yet. Each shim was retired when the route completed its migration. This avoided a flag-day rewrite.

### NoClaim filtering at source

Before this campaign, NoClaim filtering was scattered — some consumers filtered it, some didn't, and the Overview showed it at #1 because its merge predicate resolved before the filter ran.

Moving `splitOutNoClaim` inside `deriveStandings` makes the invariant unconditional: if you get rows from canonical, NoClaim is not in them. No consumer needs to know about or handle NoClaim unless it explicitly reads `noClaimRow` for display purposes (e.g., a component that needs to show NoClaim at the bottom as a special row).

GB calculation note: Games Back is computed on the filtered row set, so NoClaim's removal from the sorted list doesn't distort GB values. This was a pre-condition for moving the filter to source.

### Lifecycle dispatch on leagueStatus.state + canonical.source

Full `LifecycleState` recomputation on every render was unnecessary and created inconsistency when `currentDate` wasn't passed correctly. The dispatch was simplified to read `leagueStatus.state` (from the server) and `canonical.source` (whether the canonical result came from a live derivation or an archive), avoiding duplicate lifecycle computation at render time.

---

## 6. Lessons Learned

### Merge-at-render-time is architecturally brittle

Eight remediation rounds on a single PR, all addressing edge cases of merge logic, is the signal. Shape-readiness predicates ("if rows exist") are not robust: "rows exist" ≠ "data is resolved." The correct check was "resolved week is present" — but even that was a symptom. The underlying problem was that merged values create a state space where any combination of two partially-loaded sources is valid input to the merge function, and each such combination produces a different UI outcome.

The fix is not a better predicate. The fix is to eliminate the merge: server owns the settled fact, client owns the live annotation, and they never combine.

### Shape-vs-content readiness checks need explicit framing upfront

The debugging pattern was: "rows are present but wrong." The initial diagnosis was "wrong rows," but the actual issue was "wrong source won the merge." Explicit upfront framing — "what does it mean for canonical data to be ready?" — would have surfaced the architectural boundary earlier and avoided several remediation rounds.

### Temporal coherence needs explicit design

Insight derivations must use resolved-week-anchored inputs; live-display surfaces can use partial-week current state. Before this campaign, both paths used the same derived week, producing insight outputs that reflected "what happened this week so far" rather than "what happened through the most recently completed week." These are different consumers with different temporal requirements, and the architecture now makes that explicit via the `useLiveDelta` vs canonical split.

### Filtered-source dependencies need auditing before the filter moves

GB calculation depends on the ordered row set. Before moving NoClaim filtering to source, it was necessary to confirm that GB is computed on the filtered list — otherwise removing NoClaim from position 1 would shift all GB values by one game. The audit was quick but necessary.

### Defer fixes for the next planned phase

Several code review findings during Phase 1–3 PRs were items that the next phase was about to address anyway. Applying them early in Phase 2's PR created throwaway work when Phase 3 restructured the same code. The correct call is: if a finding will be directly addressed by the next planned phase, log it as a known pre-existing state in the PR description and defer.

---

## 7. Deferred Items (Backlog)

| Item | Finding | Why deferred |
|------|---------|--------------|
| **INSIGHTS-LIFECYCLE-AWARENESS** | Preseason insight generators produce nonsensical output ("Toilet bowl leader", "Crowded finish in 0 games") because they run against current-roster data with no resolved season stats yet. | Phase 5 added `usingArchivedRoster` flag to `InsightContext` as the future gating surface. Generators need to read this flag and suppress or reframe preseason-unsafe types. Separate prompt when generator tuning work begins. |
| **POSTSEASON-START-WEEK-SCHEDULE-DERIVED** | `POSTSEASON_START_WEEK = 16` is a hardcoded constant. The correct value should be derived from the schedule: the week of the earliest `seasonType === 'postseason'` game. | Constant works for current seasons. Schedule-derived derivation requires a CFBD fetch at derivation time, which needs caching and error handling. Deferred as Option B with a rationale comment; revisit before any season with unusual bracket structure. |
| **INVALIDATE-STANDINGS-PER-LEAGUE** | `invalidateStandings` enumerates all leagues for global-scope mutations (e.g., alias writes that can apply across leagues). This is unnecessarily broad for mutations that only affect one league. | Documented in `invalidateStandings` JSDoc as a known limitation. Requires per-league alias scoping to fix correctly. Dependent on the Aliases Platform Migration work. |
| **HEADER-ARCHITECTURE-UNIFICATION** | `LeaguePageShell` and `CFBScheduleApp` render independent header regions. Flagged during LEAGUE-HEADER-USER-MENU work — they should share a single `LeagueHeader` component. | Out of scope for this campaign. Structural header change risks visual regression across all league pages. Separate Polish prompt when header structure is ready to unify. |

---

## 8. Architectural Invariants Established

These invariants are now documented in `AGENTS.md` under "Standings Ownership Invariants." Summarized here for campaign reference:

1. `getCanonicalStandings` is the single source of truth for standings rows, history, color order, and lifecycle.
2. `liveDelta` (`selectLiveDelta` / `useLiveDelta`) is the only path for live game annotations. Never merge canonical and liveDelta.
3. All mutation routes call `invalidateStandings(slug, year)`. Admin forms call `router.refresh()`.
4. Cache key uses `resolveStandingsYear`. Tags: `standings:{slug}` and `standings:{slug}:{year}`. Closure pattern required.
5. `splitOutNoClaim` runs inside `deriveStandings`. `rows` never contains NoClaim; `noClaimRow` is explicit.
6. `currentDate` is captured at request-handler level. No `new Date()` inside derivation functions.
