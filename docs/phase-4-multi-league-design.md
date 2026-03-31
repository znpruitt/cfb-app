# Phase 4 — Multi-League Support Design

**Status:** Design draft — for human review before implementation begins.
**Affects:** Phase 3 storage key structure (see §7).
**No implementation has begun.**

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

Current single-league URL structure (`/`, `/standings`, `/matchups`, etc.) is the implicit default league. Migration options:

**Option A — Hard redirect (recommended for MVP):** The existing root routes (`/standings`, `/overview`, etc.) redirect to `/league/default/standings`, etc. The league slug for the existing league is `default` (configurable by commissioner). All bookmarks and shared links continue to work via redirect.

**Option B — Parallel coexistence:** Root routes continue to serve the existing league. `/league/:slug/` routes serve additional leagues. Avoids redirect complexity but creates two code paths for the same pages.

**Option C — Query parameter:** `/standings?league=slug`. Simpler routing, no path restructuring needed, but less clean for sharing and SEO.

**Recommendation:** Option A. Path-based routing is the cleanest architecture for the long term and is consistent with how Next.js App Router handles dynamic segments. Option C (query params) is acceptable as a transitional first step if Option A's full route refactor is too large for the initial implementation.

### How are league slugs created and managed?

- Slugs are lowercase, alphanumeric, hyphenated strings (e.g., `work-league`, `family-pool`).
- Created by the commissioner via an admin interface (new, not yet built).
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
| Season archive (Phase 3) | `scope=standings-archive, key=${year}` | `scope=standings-archive:${slug}, key=${year}` |
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

2. **API routes** — all durable-read routes (`/api/owners`, `/api/aliases`, `/api/postseason-overrides`) need a `league` query parameter alongside `year`. Routes currently use `?year=2025`; multi-league adds `?league=default&year=2025`.

3. **`SeasonArchive` type** (Phase 3) — should include `leagueSlug: string` so archived data is self-describing.

---

## 5. Admin & Commissioner Model

### How are leagues created and configured?

New admin action: "Create league" — commissioner provides display name and slug. The league is added to the registry in appStateStore.

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

**Recommended migration strategy: slug assignment on first access.**

1. Define the existing league's slug as `default` (or a commissioner-chosen slug).
2. On first admin write after Phase 4 deployment, the admin UI writes data to the new `owners:default:2025` scope.
3. The read path falls back to `owners:2025` if `owners:default:2025` is not found — backward compatibility for a single transition period.
4. Once the commissioner confirms migration is complete, the fallback is removed.

This avoids a one-time migration script and handles the transition gracefully.

### What is the default league slug for the existing league?

**Recommendation:** `default`. Simple, URL-safe, clearly communicates that it is the original league. The commissioner can configure a display name (`"My Work League"`) independently of the slug.

Alternative: allow the commissioner to choose the slug at first Phase 4 admin login. This avoids `default` appearing in shared URLs, but adds complexity to the migration flow.

### Can both models coexist during a transition period?

**Yes, with a read fallback.** API routes read from `owners:${slug}:${year}` first, then fall back to `owners:${year}` if not found. This allows a phased migration without downtime or data loss.

The fallback should be time-limited — removed in the next deployment cycle after the commissioner confirms all leagues are migrated. Permanent fallback is technical debt.

---

## 7. Impact on Phase 3 (Historical Analytics)

### How does multi-league scoping change historical storage?

Phase 3 season archives are currently proposed as `scope='standings-archive', key='${year}'`. With multi-league, this becomes `scope='standings-archive:${leagueSlug}', key='${year}'`.

The `SeasonArchive` type and `deriveStandingsHistory` function do not change — only the storage key gains a league prefix.

### Should Phase 3 wait for Phase 4, or build season-scoped first?

**Recommended: Build Phase 3 with year-only scoping first.** The 2025 archive is the immediate priority. When Phase 4 is implemented, the storage keys are migrated to include league slug (same pattern as owners/aliases).

The Phase 3 API route (`/api/history/[year]`) can be extended to accept `?league=slug` in Phase 4 without breaking existing behavior — same pattern as the existing `/api/owners?year=2025` extension.

**Risk:** If Phase 3 and Phase 4 are built in close sequence, it may be more efficient to implement Phase 4 key scoping from the start. If there will be a multi-month gap between phases, building Phase 3 first is the lower-risk path.

---

## 8. Open Questions

1. **Default slug choice.** Should the existing league use `default` as its slug, or should the commissioner assign a custom slug during Phase 4 setup? `default` is simple but will appear in all URLs for the primary league.

2. **League selection UI.** How does a member navigate to their league? Options: (a) the app remembers the last league via localStorage, (b) the app root shows a league picker, (c) the commissioner shares a direct `/league/:slug/` URL with members. Which pattern is expected?

3. **URL stability.** If the existing league root URL changes from `/standings` to `/league/default/standings`, all existing bookmarks break unless redirects are implemented. Is the redirect approach (Option A in §2) acceptable, or should the root routes remain for the primary league indefinitely?

4. **Alias isolation.** Should each league have its own alias map, or should aliases be global (shared across leagues)? The current model is global — a single alias map for the entire app. For multi-league, different leagues may have different team-name quirks. Recommendation: per-league alias maps, same as owner rosters.

5. **CFBD ingestion scoping.** Schedule and scores are global (not per-league). Are there any scenarios where different leagues need different schedule years or different postseason filtering? If so, the global schedule assumption breaks.

6. **League deletion.** What happens if a league is deleted? Should its historical archives be deleted, archived, or preserved indefinitely? Is league deletion a supported operation at all?

7. **Season scoping per league.** The current `year` parameter is app-wide. In a multi-league world, could different leagues be in different active seasons? (Unlikely for same-year leagues, but possible if one league runs a different schedule year.) Recommendation: all leagues share the same active season year for MVP.

8. **Commissioner UX for league management.** What does the admin interface look like for managing multiple leagues? Is it a tab switcher, a sidebar, or a separate `/admin/leagues/` page? This is a UX design question, not a data model question, but it affects implementation scope.
