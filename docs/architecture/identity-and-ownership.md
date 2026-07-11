# Team Identity & Game Ownership

Status: Current
Last verified: 2026-07-09
Owner: Project documentation
Canonical for: team-name canonicalization boundary, alias precedence, current-season ownership attribution, CSV's role
Supersedes: (none — complements `AGENTS.md` Core rules #10–#12 and the Standings Ownership Invariants)

Two separate boundaries keep identity and ownership from leaking across the app: `src/lib/teamIdentity.ts` (who a team *is*) and `src/lib/gameOwnership.ts` (which owner a game *belongs to*). Neither may be duplicated elsewhere.

## Team identity — `src/lib/teamIdentity.ts`

`teamIdentity.ts` is the single boundary for resolving a provider team name to a canonical identity. All runtime team matching goes through it; UI/routes/selectors must not re-implement name matching.

`createTeamIdentityResolver(...)` builds a `TeamIdentityResolver` (`resolveName`, `getTeamIdentity`, `buildPairKey`, `buildGameKey`, `variantsForName`, `isFbsName`, …) over a registry assembled from the teams catalog (plus each team's alternates), the passed-in alias map, and any observed provider names.

Resolution precedence inside `resolveName` is a strict three-step order:

1. **Invalid-label guard** — obviously-bad labels resolve to `invalid_label` (unresolved).
2. **Direct canonical hit** — `registry.get(normalizeTeamName(raw))` → source `canonical`.
3. **Alias hit** — `aliasMap[normalizeAliasLookup(raw)]`, then the target is re-resolved through the registry → source `alias`.

A miss returns `unresolved` with a null identity key. The identity key is `normalizeTeamName(displayName)` throughout.

**Separation from roster upload:** roster-CSV fuzzy matching lives in the upload validation pipeline (FBS-only match pool), **not** in `teamIdentity.ts`, which resolves already-clean runtime data over the full catalog (including FCS opponents). Confirmed fuzzy matches are saved as global aliases; the upload pipeline never writes unresolved teams.

### Alias precedence

Runtime alias resolution flows through `getScopedAliasMap(_leagueSlug, year)` in `src/lib/server/globalAliasStore.ts`. Since PLATFORM-067 the **league slug argument is ignored** (kept only for call-site compatibility) — team aliases are not league-specific. The effective precedence, first-wins:

```
stored global (aliases:global)  >  year (aliases:${year})  >  SEED_ALIASES (code defaults)
```

Persisted copies of a known seed default are demoted (`withoutCopiedSeedDefaults`) so the current code seed resolves the identity, while a genuine manual repair (different target) always wins over the seed. Only two functions write the stored global map (`upsertGlobalAliases`, `migrateYearScopedAliasesToGlobal`), serialized behind a write lock; no read path writes aliases.

## Game ownership — `src/lib/gameOwnership.ts`

Current-season game-ownership attribution flows through `gameOwnership.ts` (exports `sideIdentityCandidates`, `getOwnerForGameSide`, `getGameOwners`, `getGameSideForTeam`). It is **intentionally resolver-free**: the canonical `AppGame` already carries alias-resolved identity (`canHome`/`canAway`, `participants.*`), so ownership is decided from the identity candidates on the game — never by raw provider-label equality re-derived elsewhere.

For each game side, `sideIdentityCandidates` produces an ordered, de-duplicated candidate list:

1. participant `teamId` (null if the slot isn't a team, e.g. a placeholder bowl slot)
2. participant `canonicalName`
3. participant `displayName`
4. participant `rawName`
5. side `canonicalName` (`canHome`/`canAway`)
6. `csvName` (`csvHome`/`csvAway`) — raw provider label, **legacy fallback only**

`getOwnerForGameSide` returns the first candidate that hits `rosterByTeam` (a `team-label → owner` map). Matching is **exact-key only** — there is no normalized ownership-key index yet (deferred as **PLATFORM-040**, because normalizing stored labels can collide). Ownership is an **overlay on canonical schedule games**; schedule-derived `AppGame` identity remains the source of truth for game identity.

**Known deferrals (do not document as fixed):** historical/archive ownership surfaces (`historySelectors`, `trends`, `leagueRecords`, and the Insights context/generators) still resolve owners by raw label — a distinct deferral from PLATFORM-040, recorded under **PLATFORM-039**. A canonical **owner-identity mapping across seasons** (renamed/returning owners) is also deferred; owner display names are raw strings today.

## CSV's current role

CSV is never a schedule or game-identity source. Current ownership is an overlay on canonical schedule games, although some current roster persistence paths still use CSV serialization. Historical archives preserve roster CSV snapshots.

Concretely:

- **Game identity** comes only from `buildScheduleFromApi` (CFBD schedule → resolver). The `csvHome`/`csvAway` fields on `AppGame` are the **raw provider labels from the API item**, not a CSV file — and they are only the lowest-priority ownership-attribution fallback candidate.
- **Current-season ownership** is persisted as an owners CSV in app-state at scope `owners:${slug}:${year}` (key `csv`) — written on draft confirm, patched on a post-confirm pick edit, and writable via `PUT /api/owners` (an explicit **admin repair** path, not the default flow). `parseOwnersCsv` reads it into the `rosterByTeam` maps that `gameOwnership` consumes.
- `PUT /api/owners` (used by both the CSV bulk-import panel and the inline roster editor) is platform-admin-only and, since **PLATFORM-083**, carries an **active-season overwrite guard**: a league-scoped write to the league's active season (`year >= league.year`) that would replace an already-populated roster returns `409 { error: 'owner_roster_overwrite_requires_override' }` unless `?override=1` is passed (surfaced in the UI as an explicit repair confirmation). Past-year/backfill writes and initial roster creation are unguarded. This prevents a CSV import or editor save from silently clobbering a confirmed-draft/manual current-season roster.
- The in-app **draft / team-assignment flow is the intended current-season ownership mechanism**; CSV import is an admin repair, not CSV-first architecture. Because current roster persistence still serializes via CSV, CSV **cannot yet be declared strictly history-only** — do not overstate this as resolved — but current-season overwrites are now guarded, not silent.
