# Phase 4 — Historical Analytics Design

**Status:** Design finalized — planning session complete. Implementation sequence defined. Ready for first implementation prompt.
**Depends on:** Phase 3 design (see §6 for dependency boundary decisions). Phase 3 is complete.
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

The 2026 MVP requires exactly one historical record: the **2025 completed season archive**. That is sufficient to give the history pages a "previous season" record, which is the primary member-facing value.

The full historical feature is not required at launch — just the ability to archive a season and render its final standings and season arc on demand.

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
  leagueSlug: string;                // which league this archive belongs to
  year: number;
  archivedAt: string;                // ISO timestamp
  ownerRosterSnapshot: string;       // raw CSV at time of archival
  standingsHistory: StandingsHistory;
  finalStandings: StandingsHistoryStandingRow[]; // convenience: last week's snapshot
};
```

**Why include `leagueSlug`:** Archives are self-describing — the leagueSlug field identifies which league the archive belongs to without relying on the storage key. Required for any cross-league administrative tooling.

**Why include `ownerRosterSnapshot`:** Owner names may change between seasons (owner reassignments, nickname edits). Archiving the roster CSV alongside the standings ensures historical data renders correctly even after roster changes. The archived owner names are the source of truth for that season — do not re-derive them from the live roster.

### Owner Identity Across Seasons

- Owner identity is name-based within a season (same as today).
- Cross-season owner performance is keyed by owner name as it appeared in that season's archived roster.
- No persistent owner ID is introduced. Owner last names are stable enough for the primary league. If the same person changes their display name between seasons, they appear as two separate entries in historical views. This is a known limitation (Decision 1) — revisit only when a concrete cross-season identity problem is demonstrated.
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

---

## 4. Season Rollover Process

### Season rollover is a global platform admin action

Season completion is a global signal — the CFP Final ending is a fact of the CFB calendar that affects all leagues simultaneously. All leagues follow the same game schedule. "Start New Season" is therefore a **site admin function** on `/admin/`, not a per-league or per-commissioner action. It is protected by the existing `ADMIN_API_TOKEN`.

There is no separate "Archive Season" button. Triggering **"Start New Season"** automatically:

1. Detects that the CFP Final is marked as final in the shared game schedule.
2. Loops through all registered leagues in the league registry.
3. For each league: fetches current season's games, scores, owner roster, aliases, and postseason overrides; calls `deriveStandingsHistory`; assembles a `SeasonArchive`; and writes it to `setAppState('standings-archive:${leagueSlug}', '${year}', archive)`.
4. Increments the active season year for all leagues.
5. Confirms successful rollover in the admin UI.

This is a single atomic action. The commissioner does not decide when the season is final on a per-league basis — the game schedule determines this globally.

### CFP Final detection

The admin page detects when the CFP Final is marked as final in the shared game schedule and surfaces a **"Start New Season" prompt** on `/admin/`. Until that condition is met, the prompt is not shown (or is shown as disabled with a status indicator). The admin may override the detection and force-trigger rollover if needed.

### Data captured at season close

For a complete historical record, all of the following must be present at archive time:

| Data | Source | Already durable? |
|------|--------|-----------------|
| Final game schedule | CFBD API (cached) | Yes, in-memory/cached |
| Final score results | CFBD API (cached) | Yes, in-memory/cached |
| Postseason overrides | appStateStore | Yes |
| Owner roster CSV | appStateStore (`owners:${leagueSlug}:${year}`) | Yes |
| Alias map | appStateStore (`aliases:${leagueSlug}:${year}`) | Yes — needed to re-run identity resolution |

The rollover action reads all of these per-league and computes `StandingsHistory` at archive time. Post-archive, the historical record is immutable by default.

### Re-archival policy

Re-archiving a season is allowed but requires explicit admin confirmation. Before overwriting any existing archive, the system must present a **diff in summary form** showing:

1. Number of scores that changed.
2. Number of outcomes that flipped (win-to-loss or loss-to-win) and which owners were affected.
3. Final standings order changes — who moved and by how much.

Admin must confirm before any overwrite proceeds. Accidental overwrites are not permitted.

---

## 5. UI Surfaces

### Route hierarchy

All history routes are league-scoped within the `/league/[slug]/` hierarchy established in Phase 3. No top-level `/history/` route exists.

```
/league/[slug]/history/                   — League history landing (all-time view)
/league/[slug]/history/[year]/            — Season detail page
/league/[slug]/history/owner/[name]/      — Owner career page
/api/history/[year]?league=${slug}        — Server route returning SeasonArchive
```

### League history landing — `/league/[slug]/history/`

The league history landing is a **season-spanning all-time view** — not a copy of the live season UI. It is a purpose-built history experience covering all archived seasons for the league. It includes:

- **All-time standings table** — total wins, losses, championships, and average finish position per owner across all archived seasons.
- **Championships banner** — who has won, how many times, and which years.
- **All-time head-to-head matrix** — head-to-head record between every pair of owners across all seasons combined.
- **Dynasty and drought tracker** — longest championship winning streak and longest championship drought per owner.
- **Most improved** — biggest finish position improvement season over season.
- **Rivalries** — closest head-to-head records across seasons.
- **Season list** — links to per-season detail pages with the champion and final record highlighted.

### Season detail page — `/league/[slug]/history/[year]/`

The season detail page is a **purpose-built view for a single archived season**. It includes:

- **Final standings** — wins, losses, games back, record, and point differential.
- **Season arc trends chart** — the GB race week by week for the full season using existing `MiniTrendsGrid` and `StandingsHistory` components.
- **Owner roster** — who owned which teams that season, from `ownerRosterSnapshot`.
- **Season superlatives** — highest single-week score, biggest upset, most dominant stretch, closest finish.
- **Head-to-head results** — each owner's record against every other owner that season. Progressive disclosure: top level shows W-L record per pairing; expanded view shows individual matchup details (week, game, outcome).
- **Owner cards** — each owner's season summary with record, finish, and notable wins and losses.
- **"Archived — [Year] Season" banner** — prominent display distinguishing this from live views.

### Owner career page — `/league/[slug]/history/owner/[name]/`

The owner career page is a dedicated view for a single owner's performance across all archived seasons. It includes:

- **Career summary** — all-time record, championships, and average finish position.
- **Season finish history** — year-by-year finish position and win/loss record.
- **All-time head-to-head records** — against every other owner across all seasons. Progressive disclosure: top level shows overall W-L record per opponent; expanded view shows per-season breakdown and individual matchup details.

Owner identity is name-based, keyed by owner name as it appeared in each season's archived roster. If an owner's name changes between seasons, they may appear as separate entries. This is a known limitation (Decision 1).

### Existing selectors and components

The existing selectors (`selectGamesBackTrend`, `selectPositionDeltas`, `deriveLeagueInsights`) are pure functions that accept data as parameters — they already work with any `StandingsHistory` snapshot, historical or current. No selector variants are needed.

Multi-season aggregation selectors (e.g., `selectOwnerLifetimeRecord`) are new additions for the history landing and owner career page — not variants of existing selectors.

The existing pages (Standings, Trends, Overview) continue to render live-season data only. No season picker is added to live pages; navigation to history is via the `/league/[slug]/history/` landing.

---

## 6. Dependencies on Phase 3 (Multi-League)

Phase 3 is complete. All sequencing dependencies are satisfied.

| Decision | Phase 4 approach |
|----------|-----------------|
| Storage key | `scope='standings-archive:${leagueSlug}', key='${year}'` — league-scoped from day one |
| API route | `/api/history/[year]?league=${slug}` — uses Phase 3 routing conventions |
| History route | `/league/[slug]/history/` — within Phase 3 route hierarchy |
| Season rollover | Loops through all registered leagues in the Phase 3 league registry |

---

## 7. Resolved Decisions

All open questions from the design review have been resolved.

| # | Question | Decision |
|---|----------|----------|
| 1 | Owner identity stability | **Deferred.** No stable owner ID introduced. Owner last names are stable enough for the primary league. Known limitation — revisit only when a concrete cross-season problem is demonstrated. |
| 2 | Archive immutability | **Re-archival allowed, but admin-gated.** System must present a diff (score changes, outcome flips, standings order changes) before the write. Admin must confirm. Accidental overwrites not permitted. |
| 3 | Pre-2025 seasons | **Show a message.** Display "Historical data available from the 2025 season onward." Do not silently hide empty years. |
| 4 | CFBD retroactive archival | **Not supported.** Alias and roster state at season time cannot be reliably reconstructed. 2025 is the first archived season by design. |
| 5 | Storage size | **Single `app_state` table is sufficient.** ~500 KB–1 MB over ten seasons is negligible. A separate `season_archives` table is premature optimization and will not be introduced. |
| 6 | Season picker placement | **Dedicated `/league/[slug]/history/` route.** This is a distinct browsing experience from live-season views. `?year=` parameter on existing routes is not used. |
| 7 | Season rollover trigger | **Global platform admin action.** "Start New Season" on `/admin/` archives all leagues atomically. CFP Final detection surfaces the prompt. No per-league archive button. |
| 8 | Archive bundling | **Archival is bundled into rollover.** There is no separate "Archive Season" button. One action rolls over and archives all leagues. |

---

## 8. Implementation Sequence

Phase 4 is implemented in four subphases:

### P4A — Data Foundation

- `SeasonArchive` type definition
- `src/lib/seasonArchive.ts` — `getSeasonArchive(leagueSlug, year)` and `setSeasonArchive(archive)` read/write functions wired to `appStateStore` with `scope='standings-archive:${leagueSlug}', key='${year}'`
- `/api/history/[year]?league=${slug}` server route returning a `SeasonArchive`

### P4B — Season Rollover and Admin Action

- CFP Final detection logic from shared game schedule
- `"Start New Season"` button on `/admin/` — global platform admin action conditioned on CFP Final detection
- `/api/admin/rollover` — per-league archive loop: reads owners, aliases, overrides, schedule, and scores for each registered league; calls `deriveStandingsHistory`; writes `SeasonArchive` via `setSeasonArchive`; increments active year across all leagues as a single atomic action
- Re-archive diff logic — score changes, outcome flips, and standings order changes presented in summary form before any overwrite; admin must confirm before write proceeds

### P4C — Season Detail UI

- `/league/[slug]/history/[year]/` page
- Final standings, season arc trends chart (reusing `MiniTrendsGrid` + `StandingsHistory`)
- Owner roster from `ownerRosterSnapshot`
- Season superlatives (highest single-week score, biggest upset, most dominant stretch, closest finish)
- Expandable head-to-head results (top-level W-L per pairing, expanded matchup detail with week, game, and outcome)
- Owner cards with season summary
- "Archived — [Year] Season" banner

### Roster Upload Fuzzy Matching

- Fuzzy team name matching at roster CSV upload time — resolves minor name variants (abbreviations, typos, alternate spellings) automatically before writing to storage
- FBS-only match pool — FCS teams are never suggested
- Admin reviews bulk results; confirmed fuzzy matches and manual selections saved as global aliases automatically
- See §9 for the full design

### P4D — League History and Owner Career UI

- `/league/[slug]/history/` landing page with all-time stats:
  - All-time standings table (wins, losses, championships, average finish)
  - Championships banner (who won, how many times, which years)
  - All-time head-to-head matrix across all seasons combined
  - Dynasty and drought tracker (longest winning streak, longest championship drought)
  - Most improved section (biggest finish position improvement season over season)
  - Rivalries section (closest head-to-head records across seasons)
  - Season list with champion links
- `/league/[slug]/history/owner/[name]/` owner career page:
  - Career summary (all-time record, championships, average finish)
  - Season finish history (year-by-year finish position and W-L record)
  - All-time head-to-head with progressive disclosure (overall W-L per opponent; expanded per-season breakdown and individual matchup details)

---

## 9. Roster Upload Validation

### Problem

Owner roster CSVs use informal team name variants — abbreviations, shorthand, nicknames — that do not exactly match CFBD canonical team names. The current alias map requires manual population and fails silently when a team name is unresolved. No warning is surfaced to the admin.

### Solution: FBS-only fuzzy matching at upload time

The roster upload pipeline gains a pre-processing validation step that runs before any data is saved. This is an upload cleanliness concern — not a teamIdentity concern. `teamIdentity.ts` is unchanged.

### Flow

1. Admin uploads owner roster CSV.
2. System attempts exact match for every team name against FBS canonical names from `teams.json`.
3. Unresolved teams go through fuzzy matching against FBS-only pool — FCS and non-FBS teams are excluded from the match pool entirely.
4. Results presented to admin in bulk:
   - **Exact matches:** confirmed automatically, no action needed.
   - **Alias matches:** confirmed automatically from existing alias store.
   - **Fuzzy suggestions:** shown with confidence indicator, admin must explicitly confirm or override each one.
   - **No match found:** admin presented with a searchable FBS team picker (typeahead search plus alphabetical dropdown) for manual selection.
5. Admin resolves all items — upload cannot complete until every team is resolved.
6. Confirmed fuzzy matches and manual selections saved as global aliases automatically — apply across all leagues and years.
7. Only fully resolved CSV is written to storage.

### Algorithm

Best available fuzzy matching algorithm or combination — implementation detail left to Claude Code. Must be constrained to FBS-only match pool. May combine Levenshtein distance, token-based matching, or other approaches as needed for accuracy. Tune conservatively — prefer no suggestion over a bad suggestion.

### Alias system changes

- Confirmed fuzzy matches and manual selections are saved to the global alias store automatically.
- Existing manually-maintained aliases are migrated into the new confirmed alias store at deploy time.
- The legacy year-scoped alias map is deprecated — the new system replaces it.
- Aliases are global — a confirmed match applies across all leagues and years.

### Constraints

- FCS teams are never suggested as matches for owner roster uploads.
- No unresolved teams may reach storage — upload is blocked until all teams are resolved.
- `teamIdentity.ts` is not modified — fuzzy matching is a pre-upload validation layer only.
- Schedule and game identity resolution (which includes FCS opponents) is unaffected.

