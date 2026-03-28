PROMPT_ID: P2C-STANDINGS-HISTORY-ARCHITECTURE-AUDIT-v1

Summary

- Current standings source-of-truth is `deriveStandings(games, rosterByTeam, scoresByKey)` in `src/lib/standings.ts`; it produces wins/losses, win%, PF/PA, point differential, games back, and final-game counts from canonical schedule games + attached final scores.
- `CFBScheduleApp.tsx` centralizes top-level snapshot assembly and passes standings/overview inputs into lib selectors; components mostly render derived outputs.
- There is no canonical season-over-time standings primitive today. Existing “movement” and “pulse” logic is mostly week-scoped or compares only two snapshots (`standings` vs `previousStandings`), and `previousStandings` is not currently wired from `CFBScheduleApp`.
- Clean insertion point: add a new canonical lib primitive in `src/lib/standingsHistory.ts` (or alongside `standings.ts`) that derives ordered per-week owner snapshots from schedule + scores + roster, then feed trend selectors from that single primitive.

Architecture / Responsibility Issues

- **Duplicate standings computation exists**: `src/lib/standings.ts` has canonical standings derivation, while `computeStandings` in `src/lib/leagueInsights.ts` recomputes similar owner stats for matchup cards. This creates drift risk for tie-break order, ownership edge cases, and future trend math.
- **Overview movement context is only partially connected**: `selectOverviewViewModel` supports `previousStandingsLeaders`, but `CFBScheduleApp` does not provide one when rendering `OverviewPanel`, so rank movement/gap delta depends on a pathway not populated by app state.
- **Week-scoped + season-scoped responsibilities are mixed** in `leagueInsights.ts`: it contains both overview insight helpers and standalone standings/weekly computations. This makes it a tempting but suboptimal place to add long-horizon standings history.
- **Current snapshots are “now-state only”**: `deriveStandings` aggregates all final games in scope but does not expose per-week intermediate states, forcing any trend feature to either duplicate accumulation or compute ad hoc in UI/selectors.

Domain Logic Centralization Opportunities

- Introduce **one canonical primitive**:
  - `deriveStandingsHistory({ games, rosterByTeam, scoresByKey, options })`
  - Place in `src/lib/` near standings domain (`src/lib/standingsHistory.ts` or extending `standings.ts`).
- Likely input shape:
  - canonical `AppGame[]`
  - `Map<string,string>` roster ownership
  - `Record<string, ScorePack>`
  - optional scope flags (`includePostseason`, `upToWeek`, `weekOrder` override).
- Likely output shape:
  - `weeks: number[]`
  - `snapshotsByWeek: Map<number, OwnerStandingsRow[]>`
  - `ownerSeries: Map<string, Array<{ week; wins; losses; winPct; gamesBack; pointsFor; pointsAgainst; pointDifferential; finalGames }>>`
  - optional helper indexes (`latest`, `previousWeek`, `leaderByWeek`).
- Build downstream selectors from this primitive (not from UI state):
  - games-back trend selector
  - win% trend selector
  - cumulative wins / win-bars selector
  - movement/highlight selector based on multi-week deltas (replace two-snapshot assumptions).
- Consumers to migrate toward history-backed selectors:
  - `src/lib/selectors/overview.ts` (movement, pulse, hero narrative deltas)
  - `src/components/StandingsPanel.tsx` (trend columns/chips should come from selector output)
  - `src/components/OverviewPanel.tsx` (league pulse / highlights should remain presentational).

State / Refresh / Effect Risks

- `CFBScheduleApp.tsx` recomputes major snapshots on every dependency update; naively adding trend derivation inside component-level `useMemo` chains could increase rerender cost and create subtle mismatch across overview/standings/matchups views.
- If Games Back / Win% trend are computed per component, the same week ordering and inclusion rules (week 0, postseason, missing scores) can diverge across surfaces.
- Score loading partial/error state is already represented by `deriveStandingsCoverage`; naive trend features may ignore this and present overconfident trend lines from incomplete finals.
- Not passing `previousStandingsLeaders` from app state means current movement logic is effectively stateless-over-time; naive additions may continue layering brittle “previous vs current” shortcuts instead of canonical history.

UI Complexity Issues

- `CFBScheduleApp.tsx` (1400+ LOC) is already orchestration-heavy; adding trend accumulation there would violate current architecture guidance.
- `OverviewPanel.tsx` already handles rich formatting and CTA routing; trend math should not be added there (keep to selector outputs only).
- `StandingsPanel.tsx` is currently table-focused; adding charts/bars directly from raw games would create presentation-domain coupling.

Test Coverage Gaps

- Existing standings tests validate aggregate snapshot correctness, but there are no tests for deterministic per-week cumulative snapshots/history.
- Overview selector tests cover movement copy paths, but not canonical weekly progression inputs (e.g., week 0 behavior, postseason transitions, partial score coverage effects on trend outputs).
- No integration test currently asserts that overview movement signals and standings trend signals are derived from the same underlying history primitive.

Low-Risk Cleanup Wins

- Add `standingsHistory` as a pure lib function first, with no UI changes.
- Add selector wrappers that adapt history into current movement outputs, then switch `selectOverviewViewModel` to consume them.
- Deprecate or constrain `computeStandings` in `leagueInsights.ts` to avoid parallel standings logic.
- Wire `previousStandingsLeaders` from canonical history (previous resolved week snapshot) instead of ad hoc/null.

Prioritized Plan
- Do now
  - Add canonical `deriveStandingsHistory(...)` in `src/lib` with tests covering week ordering, cumulative math, ties/no-decisions, week 0, postseason inclusion policy, and incomplete-score handling.
  - Add history selectors (`selectGamesBackTrend`, `selectWinPctTrend`, `selectCumulativeWins`) built only from the history primitive.
- Do next
  - Refactor `selectOverviewViewModel` movement/pulse inputs to consume history-derived selectors rather than bespoke two-snapshot assumptions.
  - Replace duplicate standings recomputation callsites (`computeStandings` usage in weekly matchups) with canonical standings/history-derived outputs.
- Later
  - Add presentation adapters for chart/bar-friendly data (labels, compact series) in selectors.
  - Add storyline/narrative generators that use history deltas over configurable windows (1-week, 3-week, season-to-date) without embedding logic in components.
