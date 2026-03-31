# Phase 3 — Historical Analytics Design

**Status:** Design draft — for human review before implementation begins.
**Depends on:** Phase 4 design (see §6 for dependency boundary decisions).
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
- No persistent owner ID is required for the 2026 MVP. If the same person changes their display name between seasons, they appear as two separate owners in historical views. This is acceptable for the MVP.
- A future owner identity system (mapping display names to stable IDs) can be layered on top without changing the archive format.

### Storage Key Structure

Using existing `appStateStore` conventions:

```
scope: "standings-archive"
key: "${year}"
value: SeasonArchive
```

Example: `getAppState<SeasonArchive>('standings-archive', '2025')`

This is intentionally **year-scoped only** for Phase 3. When Phase 4 multi-league is built, the scope or key will be extended to include league ID (see §6).

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
- `scope = 'standings-archive'`, `key = '2025'` → 2025 season
- `scope = 'standings-archive'`, `key = '2026'` → 2026 season

No schema changes required. The `jsonb` value column holds the full `SeasonArchive` object.

### Tradeoffs: Postgres key-value vs. dedicated archive tables

| Approach | Pros | Cons |
|----------|------|------|
| `appStateStore` key-value (recommended) | No migration, no schema work, consistent with existing admin model | Single JSON blob per season; no row-level season queries |
| Dedicated `season_archives` table | Richer query capability, indexed by owner/year | Schema migration required, new persistence module, complexity without clear current need |

**Recommendation:** Use `appStateStore` key-value for Phase 3. A dedicated table is warranted only if cross-season analytical queries (e.g., "owner performance across all years ranked") become a product requirement. That belongs to a later phase.

### How should the 2025 season be archived?

The 2025 archive is created by:

1. Running all existing season data through `deriveStandingsHistory(games, roster, scores)` one final time.
2. Taking the last week's `byWeek` entry as `finalStandings`.
3. Snapshotting the current owner CSV from `getAppState('owners', '2025')`.
4. Writing the result to `setAppState('standings-archive', '2025', archive)`.

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

The archive action must read all of these and compute `StandingsHistory` at archive time. Post-archive, the historical record is immutable.

---

## 5. UI Surfaces

### New pages and components needed

**Minimum viable (2026 launch):**
- **Season picker** — a select/dropdown in the Standings page header and Trends page header, allowing navigation between current season and archived seasons. Previous season data renders the same components with archived data.
- **Historical Standings view** — the existing `StandingsPanel` with archived `finalStandings` as input. No new component needed if the data contract matches.
- **Historical Trends view** — the existing `MiniTrendsGrid` with archived `standingsHistory` as input. No new component needed.

**Stretch (post-launch, lower priority):**
- **Owner history summary** — lifetime record, season finish positions, win titles.
- **Season comparison** — side-by-side current vs. prior season standings.

### How does a season picker integrate with existing page architecture?

The existing pages are fully client-side rendered against live state. A season picker adds a `selectedYear` control that:

1. On current year: uses live in-memory `StandingsHistory` (existing behavior).
2. On archived year: fetches `SeasonArchive` from a new `/api/history/[year]` route and renders the same components against the archived data.

The selector inputs (`StandingsHistory`, `rosterByTeam`) are the same shape — archived data feeds the same selectors without new selector variants.

### Which existing selectors need multi-season variants?

None for the MVP. The existing selectors (`selectGamesBackTrend`, `selectPositionDeltas`, `deriveLeagueInsights`) are pure functions that accept data as parameters — they already work with any `StandingsHistory` snapshot, historical or current.

Multi-season aggregation selectors (e.g., `selectOwnerLifetimeRecord`) would be new additions, not variants.

---

## 6. Dependencies on Phase 4 (Multi-League)

### Decisions that must wait for Phase 4 scoping

| Decision | Dependency |
|----------|-----------|
| Final storage key structure | If Phase 4 uses `standings-archive:${leagueId}:${year}`, the Phase 3 keys will need migration |
| `/api/history/[year]` route signature | May need `/api/history/[leagueSlug]/[year]` in a multi-league world |
| Commissioner archive trigger | Must be scoped to the correct league in multi-league context |

### Decisions that can be built season-scoped now and extended later

| Decision | Phase 3 approach | Phase 4 extension |
|----------|-----------------|------------------|
| Storage key | `scope='standings-archive', key='${year}'` | Add league prefix: `scope='standings-archive:${leagueId}', key='${year}'` |
| API route | `/api/history/[year]` | `/api/history/[year]?league=${slug}` or route restructure |
| Season picker | Shows current league's history only | Extended to show current league's history only (same behavior, scoped by league context) |

**Recommendation:** Build Phase 3 with year-only scoping. When Phase 4 is implemented, migrate `standings-archive` keys to include `leagueId` and update the API route. The `SeasonArchive` type itself does not need to change.

---

## 7. Open Questions

1. **Owner identity stability.** Should a stable owner ID be introduced now to enable cross-season performance tracking when display names change? Or defer until a concrete need is demonstrated?

2. **Archive immutability.** If postseason scores are retroactively corrected after archival, should re-archival be allowed? What is the policy for overwriting an existing season archive?

3. **Historical data for pre-2025 seasons.** The 2025 season is the first to be archived programmatically. Prior seasons (2024 and earlier) have no archivable data. Should the app surface a message explaining this, or should historical pages silently hide years without archives?

4. **CFBD data retention.** CFBD returns data for prior seasons if queried with a year parameter. Could the 2025 archive be reconstructed retroactively from the CFBD API, or does the alias/roster state needed for correct identity resolution make retroactive archival unreliable?

5. **Storage size.** A full `StandingsHistory` for a 16-week season with 15 owners is estimated at ~50–100 KB JSON. Ten seasons of archives ≈ 500 KB–1 MB. Is this acceptable in the single Postgres `app_state` table, or does it warrant a separate `season_archives` table at larger scale?

6. **Season picker placement.** Should archived season data be accessible from the current URL structure (`/standings?year=2025`) or require a separate `/history/` route? The former is simpler; the latter is cleaner for sharing.
