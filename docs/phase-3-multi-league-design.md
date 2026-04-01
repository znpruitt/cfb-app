# Phase 3 — Multi-League Support Design

**Status:** Complete. All Phase 3 work merged (PRs #192–#196). Phase 4 prerequisite satisfied.
**Affects:** Phase 4 storage key structure (see §7).

### Slugs are runtime data, not configuration

**No slug or league name may be hardcoded anywhere in application code.** Slugs live exclusively in the league registry (appStateStore). Source code treats slugs as opaque strings — it never imports, embeds, or defaults to a specific slug value. The registry is the sole source of truth for what leagues exist and what their slugs are.

This applies without exception to all routes, components, and lib modules.

---

## 1. Goals

### What does multi-league support need to enable for the 2026 season?

- A single deployed app instance can serve **2–5 private leagues** managed by the same commissioner.
- Each league has its own **owner roster** (team-to-owner mapping), **aliases**, and **postseason overrides**.
- Shared global CFB data — schedule, scores, odds, rankings, team catalog — remains **common across all leagues** and is never duplicated per league.
- League members access their specific league via a URL or selection mechanism.
- The commissioner manages all leagues from one admin interface.

### Minimum viable multi-league implementation

The MVP is **two leagues working in parallel** with isolated owner rosters and league-scoped durable data. The first league is the existing league (migrated from the single-league model). The second is a new league configured by the commissioner.

Full SaaS multi-tenant, self-serve league creation, or public league discovery are explicitly **not goals**.

---

## 2. Routing Strategy

### Proposed URL structure

**Recommended: path-based league prefix**

```
/league/:slug/overview
/league/:slug/standings
/league/:slug/schedule
/league/:slug/matchups
/league/:slug/trends
/league/:slug/rankings
```

**Decided: Option A — Hard redirect.** The existing root routes (`/standings`, `/overview`, etc.) redirect to `/league/:slug/standings`, etc., where `:slug` is the primary league's slug read from the league registry at request time. All existing bookmarks and shared links continue to work via redirect. Root routes are deprecated after one season.

The redirect target is not hardcoded — it is derived from the first (or designated primary) league in the registry. If no leagues are registered yet, root routes render normally (single-league fallback behavior).

Option B (parallel coexistence) and Option C (query params) are not used.

### How are league slugs created and managed?

- Slugs are lowercase, alphanumeric, hyphenated strings (e.g., `tsc`, `work-league`, `family-pool`).
- Created by the commissioner via the `/admin/leagues/` interface (new, not yet built).
- The slug is the permanent identifier — changing it would break all existing URLs.
- Stored in a league registry (see §3).

---

## 3. Data Model

### What is a "league" in the data model?

```ts
type League = {
  slug: string;           // URL identifier, permanent
  displayName: string;    // Human-readable name shown in UI
  year: number;           // Active season year
  createdAt: string;      // ISO timestamp
};
```

A league is a named ownership overlay on the shared CFB schedule. It has no game data of its own — it only scopes the owner-to-team mapping and related commissioner-managed state.

### League registry storage

```
scope: "leagues"
key:   "registry"
value: League[]
```

The commissioner creates and manages leagues via the admin interface. The registry is a simple array — no per-league admin isolation is required for MVP.

### How does league slug scope existing durable data?

Current single-league scope pattern:
```
owners:${year}        → owner roster CSV
aliases:${year}       → alias map
postseason-overrides:${year} → postseason matchup overrides
```

Multi-league scope pattern:
```
owners:${leagueSlug}:${year}
aliases:${leagueSlug}:${year}
postseason-overrides:${leagueSlug}:${year}
```

The `appStateStore` API accepts arbitrary `scope` and `key` strings — no database schema changes are required. The composite key format just gains a league segment.

### Proposed full scope inventory

| Data | Single-league (current) | Multi-league |
|------|------------------------|--------------|
| Owner roster | `scope=owners:${year}` | `scope=owners:${slug}:${year}` |
| Alias map | `scope=aliases:${year}` | `scope=aliases:${slug}:${year}` |
| Postseason overrides | `scope=postseason-overrides:${year}` | `scope=postseason-overrides:${slug}:${year}` |
| Season archive (Phase 4) | — | `scope=standings-archive:${slug}, key=${year}` |
| League registry | — | `scope=leagues, key=registry` |

No Postgres schema migration needed. Only key naming conventions change.

---

## 4. Type System Changes

### Which core types need league scoping?

| Type | Change needed? | Notes |
|------|---------------|-------|
| `AppGame` | **No** | Games are global; ownership overlay is separate |
| `TeamIdentity.owner` | **No** | Owner is injected at resolver creation time, not baked into the type |
| `TeamIdentityResolver` | **No** | Already accepts `ownersByTeamId: Map<string, string>` — pass the league-specific map |
| `OwnerStandingsRow` | **No** | Owner name is a string; same type works per league |
| `StandingsHistory` | **No** | Pure computation result; shape is the same per league |
| `SeasonArchive` | **Add `leagueSlug`** | Needed so an archive is self-describing |
| `League` | **New type** | See §3 |

### How does `teamIdentity.ts` support league-scoped ownership?

**No changes to `teamIdentity.ts` are needed.** The existing `createTeamIdentityResolver` already accepts `ownersByTeamId: Map<string, string>` as a parameter. To support multi-league, the caller (currently `CFBScheduleApp.tsx` bootstrap) passes the correct league's owner map:

```ts
// Current (single league):
createTeamIdentityResolver({ aliasMap, teams, ownersByTeamId: globalRosterMap });

// Multi-league (same API, different input):
createTeamIdentityResolver({ aliasMap: leagueAliasMap, teams, ownersByTeamId: leagueRosterMap });
```

The resolver itself is pure — it produces a registry from whatever ownership map it is given. Multiple resolver instances can coexist simultaneously for different leagues.

### What does need to change in the type system?

1. **App bootstrap context** — `CFBScheduleApp.tsx` (or whatever holds top-level state) needs to know which league is active and hold the league-specific `ownersByTeamId` and `aliasMap`. This is a props/context change, not a type-shape change.

2. **API routes** — all durable-read routes (`/api/owners`, `/api/aliases`, `/api/postseason-overrides`) need a `league` query parameter alongside `year`. Routes currently use `?year=2025`; multi-league adds `?league=${slug}&year=2025`.

3. **`SeasonArchive` type** (Phase 4) — should include `leagueSlug: string` so archived data is self-describing.

---

## 5. Admin & Commissioner Model

### How are leagues created and configured?

New admin action: "Create league" — commissioner provides display name and slug. The league is added to the registry in appStateStore. League management lives at **`/admin/leagues/`** — a dedicated admin page separate from single-league admin functions.

No per-league commissioner role is needed for MVP. The single `ADMIN_API_TOKEN` controls all leagues.

### Is there a per-league commissioner role?

**Not for MVP.** The commissioner manages all leagues from one admin interface. If a multi-commissioner model is needed in the future, it would require per-league tokens or a proper auth system — that is explicitly out of scope here.

### How does the existing `ADMIN_API_TOKEN` model extend?

No change to the token model for MVP. All mutating admin routes remain protected by the same `requireAdminRequest()` check. The only change is that mutating routes accept an additional `league` parameter to scope their writes.

If per-league admin isolation is needed later, the simplest extension is per-league tokens stored in the league registry:

```ts
type League = {
  ...
  adminToken?: string; // optional per-league override; falls back to global ADMIN_API_TOKEN
};
```

---

## 6. Migration Path

### How does existing single-league 2025 data migrate?

**Migration strategy: slug assignment via registry seed + first admin write.**

1. The commissioner seeds the league registry with the desired slug via the admin API (see §9 Setup). No slug is hardcoded in source code.
2. On first admin write after Phase 3 deployment, the admin UI writes data to the new `owners:${slug}:${year}` scope.
3. The read path falls back to `owners:${year}` if `owners:${slug}:${year}` is not found — backward compatibility for a single transition period. This fallback is clearly marked as temporary in code comments and will be removed after migration is confirmed complete.
4. Once the commissioner confirms migration is complete, the fallback is removed in the next deployment.

This avoids a one-time migration script and handles the transition gracefully.

### What slug does the existing league use?

The slug is chosen and registered by the commissioner at migration time via the admin seed command in §9. It is stored in the registry as data — not in source code. The commissioner can choose any valid slug (lowercase, alphanumeric, hyphens).

### Can both models coexist during a transition period?

**Yes, with a read fallback.** API routes read from `owners:${slug}:${year}` first, then fall back to `owners:${year}` if not found. This allows a phased migration without downtime or data loss.

The fallback is time-limited — removed in the next deployment cycle after the commissioner confirms all leagues are migrated. Permanent fallback is technical debt.

---

## 7. Impact on Phase 4 (Historical Analytics)

### How does multi-league scoping change historical storage?

Phase 4 season archives use `scope='standings-archive:${leagueSlug}', key='${year}'` — league-scoped from the first write. Because Phase 3 (multi-league) is built first, no migration from year-only keys is needed.

The `SeasonArchive` type and `deriveStandingsHistory` function do not change — only the storage key includes the league slug.

### Sequencing

**Phase 3 (multi-league) must complete before Phase 4 (historical analytics) begins.** This ensures:
- League slugs and the league registry are in place before the first archive is written
- Archive keys are league-scoped from day one — no migration required
- The `/api/history/[year]?league=${slug}` route convention is available when Phase 4 builds its API

Phase 4 (historical analytics) builds directly on Phase 3 infrastructure. No standalone year-only scoping period.

---

## 9. Setup

### Seeding the first league

After Phase 3 is deployed, the commissioner runs a single admin API call to register the primary league. The slug value is data — it lives in the registry, never in source code.

```bash
curl -X POST https://<your-app>/api/admin/leagues \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <ADMIN_API_TOKEN>" \
  -d '{"slug": "tsc", "displayName": "TSC League", "year": 2026}'
```

Replace `tsc` with the actual league slug, `TSC League` with the display name, and `2026` with the active season year. The app reads the slug from the registry at runtime — changing it here changes it everywhere.

To add a second league:
```bash
curl -X POST https://<your-app>/api/admin/leagues \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <ADMIN_API_TOKEN>" \
  -d '{"slug": "family-league", "displayName": "Family Pool", "year": 2026}'
```

---

## 8. Resolved Decisions

All open questions from the design review have been resolved.

| # | Question | Decision |
|---|----------|----------|
| 1 | Default slug | **`tsc`** — primary league slug. All primary league URLs use `/league/tsc/`. |
| 2 | League selection UI | **Commissioner shares direct URL.** No league picker UI at Phase 3. Members bookmark `/league/tsc/`. |
| 3 | URL stability | **Redirect from root routes.** `/standings` → `/league/tsc/standings`, etc. Root routes deprecated after one season. |
| 4 | Alias isolation | **Per-league.** Each league has its own alias map scoped to its slug and year. Different leagues may have different team-name quirks. |
| 5 | CFBD ingestion scoping | **Global.** Schedule and scores are ingested once, shared across all leagues. Per-league owner overlays apply on top of shared game data. |
| 6 | League deletion | **Not supported at Phase 3 launch.** Add later if a concrete need arises. |
| 7 | Season scoping per league | **All leagues share the same active season year.** Not supported to run different leagues in different seasons. |
| 8 | Commissioner UX | **Dedicated `/admin/leagues/` page.** Separate from single-league admin functions. |
