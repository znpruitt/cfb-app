# Phase 4 — Historical Analytics Design

**Status:** Design approved — open questions resolved. Ready for implementation prompt.
**Depends on:** Phase 3 design (see §6 for dependency boundary decisions).
**No implementation has begun.**

---

## 1. Goals

### What questions should historical data answer for league members?

- Who has won the most league titles?
- How has a given owner performed across seasons (overall record, finish position)?
- Who improved most between seasons? Who regressed?
- What was the final standings for a past season?
- How did the title race unfold in a past season (the trends chart, historically)?

### Minimum viable historical dataset for 2026 season launch

The 2026 MVP requires exactly one historical record: the **2025 completed season archive**. That is sufficient to give the Standings and Trends pages a "previous season" comparison point, which is the primary member-facing value.

The full historical feature is not required at launch — just the ability to archive a season and render its final standings on demand.

---

## 2. Data Model

### Season Archive Shape

The existing `StandingsHistory` type in `src/lib/standingsHistory.ts` is the correct shape for historical archives. It captures the full week-by-week progression including final standings and the entire time series:

```ts
// StandingsHistory (existing, src/lib/standingsHistory.ts)
{
  weeks: number[];
  byWeek: Record<number, StandingsHistoryWeekSnapshot>;
  byOwner: Record<string, OwnerStandingsSeriesPoint[]>;
}
```

A complete season archive wraps this with metadata:

```ts
type SeasonArchive = {
  year: number;
  archivedAt: string;              // ISO timestamp
  ownerRosterSnapshot: string;     // raw CSV at time of archival
  standingsHistory: StandingsHistory;
  finalStandings: StandingsHistoryStandingRow[]; // convenience: last week's snapshot
};
```

**Why include `ownerRosterSnapshot`:** Owner names may change between seasons (owner reassignments, nickname edits). Archiving the roster CSV alongside the standings ensures historical data renders correctly even after roster changes. The archived owner names are the source of truth for that season — do not re-derive them from the live roster.

### Owner Identity Across Seasons

- Owner identity is name-based within a season (same as today).
- Cross-season owner performance is keyed by owner name as it appeared in that season's archived roster.
- No persistent owner ID is introduced. Owner last names are stable enough for the primary league. If the same person changes their display name between seasons, they appear as two separate owners in historical views. This is a known limitation — revisit only when a concrete cross-season identity problem is demonstrated.
- A future owner identity system (mapping display names to stable IDs) can be layered on top without changing the archive format.

### Storage Key Structure

Using existing `appStateStore` conventions:

```
scope: "standings-archive:${leagueSlug}"
key: "${year}"
value: SeasonArchive
```

Example: `getAppState<SeasonArchive>('standings-archive:tsc', '2025')`

Phase 4 (historical analytics) is built after Phase 3 (multi-league), so archive keys are **league-scoped from the first write** — no migration is needed. Year-only scoping is not used. See §6 for the sequencing dependency.

---

## 3. Storage Approach

### Can existing `appStateStore` support multi-season archives without schema changes?

**Yes.** The Postgres schema is:

```sql
create table app_state (
  scope text not null,
  key   text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
)
```

This is a generic key-value store. Each season archive is one row:
- `scope = 'standings-archive:tsc'`, `key = '2025'` → 2025 season for the `tsc` league
- `scope = 'standings-archive:tsc'`, `key = '2026'` → 2026 season for the `tsc` league

No schema changes required. The `jsonb` value column holds the full `SeasonArchive` object.

### Tradeoffs: Postgres key-value vs. dedicated archive tables

| Approach | Pros | Cons |
|----------|------|------|
| `appStateStore` key-value (recommended) | No migration, no schema work, consistent with existing admin model | Single JSON blob per season; no row-level season queries |
| Dedicated `season_archives` table | Richer query capability, indexed by owner/year | Schema migration required, new persistence module, complexity without clear current need |

**Recommendation:** Use `appStateStore` key-value for Phase 4. A dedicated table is warranted only if cross-season analytical queries (e.g., "owner performance across all years ranked") become a product requirement. That belongs to a later phase.

### How should the 2025 season be archived?

The 2025 archive is created by:

1. Running all existing season data through `deriveStandingsHistory(games, roster, scores)` one final time.
2. Taking the last week's `byWeek` entry as `finalStandings`.
3. Snapshotting the current owner CSV from `getAppState('owners', '2025')`.
4. Writing the result to `setAppState('standings-archive:tsc', '2025', archive)`.

This can be triggered from the existing admin panel as a one-time action. No automated mechanism is required.

---

## 4. Season Rollover Process

### End-of-season archival workflow

1. Commissioner triggers "Archive Season" from admin panel (new admin action, not yet built).
2. Admin route fetches current season's games, scores, and owner roster.
3. `deriveStandingsHistory` is called to produce the full season arc.
4. `SeasonArchive` object is assembled and written to appStateStore.
5. Commissioner confirms successful archival in admin UI.
6. Season year is incremented for the next season's data (separate action).

### What triggers archival — manual admin or automatic?

**Manual admin action only.** This is consistent with the admin-only refresh semantics established in Phase 2A. Automatic archival from public traffic violates the quota-conscious, admin-controlled refresh model.

The commissioner decides when the season is final (all postseason scores confirmed, overrides applied) and triggers archival at that point. This prevents archiving before postseason scores are resolved.

### Data that must be captured at season close

For a complete historical record, all of the following must be present at archive time:

| Data | Source | Already durable? |
|------|--------|-----------------|
| Final game schedule | CFBD API (cached) | Yes, in-memory/cached |
| Final score results | CFBD API (cached) | Yes, in-memory/cached |
| Postseason overrides | appStateStore | Yes |
| Owner roster CSV | appStateStore (`owners:${year}`) | Yes |
| Alias map | appStateStore (`aliases:${year}`) | Yes — needed to re-run identity resolution |

The archive action must read all of these and compute `StandingsHistory` at archive time. Post-archive, the historical record is immutable by default.

**Re-archival policy:** Re-archiving a season is allowed but must be an explicit admin action. Before overwriting, the system must present a diff of what changed between the existing archive and the proposed new archive. The admin must confirm before the write commits. Accidental overwrites are not permitted.

---

## 5. UI Surfaces

### New pages and components needed

Historical data lives under a dedicated **`/history/`** route hierarchy — this is a distinct browsing experience from live-season views and warrants its own route, not a `?year=` parameter on existing pages.

**Minimum viable (2026 launch):**
- **`/history/`** — League History landing page listing all archived seasons with winner and final standings per season.
- **`/history/[year]/`** — Per-season detail: final standings, season arc (trends chart), owner roster for that season.
- **`/api/history/[year]`** — Server route that reads `SeasonArchive` from appStateStore and returns it.

**Post-launch additions (not required at launch):**
- **Owner performance view** — lifetime record, season finish positions, win titles across all archived seasons.
- **Season comparison** — side-by-side standings from two seasons.

### How does the `/history/` route integrate with existing page architecture?

The existing pages (Standings, Trends) continue to render live-season data only. Historical views at `/history/[year]` are standalone pages that:

1. Fetch `SeasonArchive` from `/api/history/[year]`.
2. Feed the archived `standingsHistory` and `ownerRosterSnapshot` into the same existing components (`StandingsPanel`, `MiniTrendsGrid`).
3. Display a prominent "Archived — [Year] Season" banner to distinguish from live views.

The selector inputs (`StandingsHistory`, `rosterByTeam`) are the same shape — archived data feeds the same selectors without new selector variants. No season picker is added to live Standings/Trends pages; navigation is via the `/history/` landing page.

### Which existing selectors need multi-season variants?

None for the MVP. The existing selectors (`selectGamesBackTrend`, `selectPositionDeltas`, `deriveLeagueInsights`) are pure functions that accept data as parameters — they already work with any `StandingsHistory` snapshot, historical or current.

Multi-season aggregation selectors (e.g., `selectOwnerLifetimeRecord`) would be new additions, not variants.

---

## 6. Dependencies on Phase 3 (Multi-League)

### Decisions that must wait for Phase 3 scoping

| Decision | Dependency |
|----------|-----------|
| Final storage key structure | Phase 3 establishes `standings-archive:${leagueSlug}:${year}` key pattern; Phase 4 uses it from day one |
| `/api/history/[year]` route signature | Will need `?league=${slug}` parameter once Phase 3 routing is in place |
| Commissioner archive trigger | Must be scoped to the correct league slug |

### Decisions that can be built season-scoped now and extended later

**Phase 4 builds after Phase 3, so league-scoped keys are used from the start.** No migration from year-only keys is needed.

| Decision | Phase 4 approach |
|----------|-----------------|
| Storage key | `scope='standings-archive:${leagueSlug}', key='${year}'` — league-scoped from day one |
| API route | `/api/history/[year]?league=${slug}` — uses Phase 3 routing conventions |
| Season picker | Shows current league's history only (scoped by league context from the URL) |

**Sequence dependency:** Phase 3 (multi-league) must be complete before Phase 4 (historical analytics) is implemented. This ensures archive keys are league-scoped from the first write and no migration is required. The `SeasonArchive` type itself does not change.

---

## 7. Resolved Decisions

All open questions from the design review have been resolved.

| # | Question | Decision |
|---|----------|----------|
| 1 | Owner identity stability | **Deferred.** No stable owner ID introduced. Owner last names are stable enough for the primary league. Known limitation — revisit only when a concrete cross-season problem is demonstrated. |
| 2 | Archive immutability | **Re-archival allowed, but admin-gated.** System must present a diff between existing and proposed archive before the write. Admin must confirm. Accidental overwrites not permitted. |
| 3 | Pre-2025 seasons | **Show a message.** Display "Historical data available from the 2025 season onward." Do not silently hide empty years. |
| 4 | CFBD retroactive archival | **Not supported.** Alias and roster state at season time cannot be reliably reconstructed. 2025 is the first archived season by design. |
| 5 | Storage size | **Single `app_state` table is sufficient.** ~500 KB–1 MB over ten seasons is negligible. A separate `season_archives` table is premature optimization and will not be introduced. |
| 6 | Season picker placement | **Dedicated `/history/` route.** This is a distinct browsing experience from live-season views. `?year=` parameter on existing routes is not used. |
