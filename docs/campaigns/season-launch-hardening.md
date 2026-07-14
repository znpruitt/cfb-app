# Season Launch Hardening — Campaign Retrospective

**Status:** Complete. All three phases merged (PRs #302–#304). Campaign closeout committed on `claude/season-launch-hardening-closeout`.

---

## Inciting issues

A pre-launch discovery audit (SEASON-LAUNCH-HARDENING-DISCOVERY) identified four interlinked blockers with the season rapidly approaching:

1. **Draft auth leakage** — `/league/[slug]/draft` and `/draft/setup` RSCs serialized full `DraftState` (including admin fields) into server HTML before the client component could redirect. Non-admin users received the full state payload in the HTML before any client-side check ran. Additionally, three client components (`DraftBoardClient`, `DraftSetupShell`, `DraftSummaryClient`) embedded inline `clerkRole === 'platform_admin'` comparisons, violating AGENTS.md Auth Invariant #6.

2. **Draft polling excess** — Draft board polling was hardcoded to 1.5s intervals regardless of phase. A completed draft with a browser tab open would poll 40× per minute × multiple potential viewers = estimated ~690 MB/day of unnecessary Neon egress in the worst case. At the time, Neon Launch tier provides 50 GB/month; sustained draft-day waste would compress the headroom reserved for real traffic.

3. **Standings preseason blank state** — During preseason with a cold cache, the standings page rendered silently blank. The `CanonicalStandingsSource` had no code path for the "waiting for kickoff" state, so `resolveSeason` and `resolvePreseason` both fell through to the `empty` snapshot without providing actionable copy.

4. **Insights lifecycle blindness** — Insight generators ran their full logic regardless of lifecycle state, producing nonsensical output during preseason: "Toilet bowl leader in 0 games", rookie benchmarks comparing returning members to first-archive owners, and championship-race insights over zero-game rows.

---

## Campaign structure

The campaign was structured as three implementation phases plus a discovery and closeout:

| Prompt | Commits | Description |
|--------|---------|-------------|
| SEASON-LAUNCH-HARDENING-DISCOVERY | — | Read-only audit; no code changes |
| SEASON-LAUNCH-HARDENING-PHASE-1-DRAFT-AUTH-AND-POLLING | `5968604` | Part A (auth gate) + Part B (phase-aware polling) |
| SEASON-LAUNCH-HARDENING-PHASE-1-CODEX-REMEDIATION | `d24a2f3` | Fix summary spectator block + complete-phase polling |
| SEASON-LAUNCH-HARDENING-PHASE-2-STANDINGS-PRESEASON-STATE | `88af434` | preseason-awaiting-kickoff source + StandingsPanel placeholder |
| SEASON-LAUNCH-HARDENING-PHASE-2-CODEX-REMEDIATION | `43516b0` | Move Date.now() out of cached selector |
| SEASON-LAUNCH-HARDENING-PHASE-3-INSIGHTS-LIFECYCLE-AWARENESS | `385a071` | Engine suppression + framing helpers + zero-game guards + 22 tests |
| SEASON-LAUNCH-HARDENING-PHASE-3-CODEX-REMEDIATION | `6358c2c` | Gate shouldSuppressGenerator on bypassSuppression |
| SEASON-LAUNCH-HARDENING-CAMPAIGN-CLOSEOUT | — | Documentation only |

---

## Phase 1 — Draft Auth + Polling

### What changed

**Auth gate** (`canAccessDraftBoard`):

- New `src/lib/server/canAccessDraftBoard.ts` wrapping `isPlatformAdminSession()`. Phase 7 will add slug-scoped commissioner enforcement; the helper is already the right entry point.
- `/league/[slug]/draft/page.tsx` and `/draft/setup/page.tsx`: compute `isAdmin = await canAccessDraftBoard(slug)`, redirect non-admins to `/draft/board`, pass `isAdmin` as prop. Full `DraftState` is no longer serialized into server HTML for non-admins.
- `/draft/summary/page.tsx`: computes `isAdmin` but does NOT redirect — spectator access to the summary view is intentional.
- `DraftBoardClient`, `DraftSetupShell`, `DraftSummaryClient`: removed `useUser()` / `clerkRole` / `isTokenAdmin` entirely; accept `isAdmin: boolean` prop from server.

**Phase-aware polling**:

- `DraftBoardClient`: polling IIFE — 1.5s when `draft.phase === 'live' && draft.status === 'running'`, 30s when `draft.phase === 'complete'`, 5s otherwise.
- `SpectatorBoardClient`: `const intervalMs = draft.phase === 'complete' ? 30000 : 5000`.

### Codex remediations

**Finding 1 — Summary blocked spectators**: The initial implementation had `if (!isAdmin) redirect(...)` on the summary page, breaking the "View Draft Summary →" link that non-admin users legitimately follow after a draft completes. Fixed by removing the redirect — kept only `isAdmin` computation for prop-passing.

**Finding 2 — Polling stopped on complete**: Original polling used `if (draft.phase === 'complete') return` (clearing the interval), meaning clients would never detect a draft re-open. Fixed by changing to 30s slow polling so re-open events eventually deliver.

---

## Phase 2 — Standings Preseason State

### What changed

**`CanonicalStandingsSource` extension**:

- New source value: `'preseason-awaiting-kickoff'`.
- New field: `inferredSeasonStart: string | null` on `CanonicalStandings` — populated from `getScheduleProbeState(year).firstGameDate` when available, null otherwise.

**Selector logic**:

- `resolveSeason` empty path: calls `getScheduleProbeState(year)`. If probe exists, returns `preseasonAwaitingKickoffSnapshot(slug, status, year, probe.firstGameDate)`. Otherwise returns `emptySnapshot`. No `Date.now()` anywhere in the selector.
- `resolvePreseason` empty path: always returns `preseasonAwaitingKickoffSnapshot`.

**Consumer changes**:

- `StandingsPanel`: renders three distinct empty states — `preseason-awaiting-kickoff` with a kickoff-date formatted message (time checked at render via `Date.now()`), `empty` with a diagnostic message.
- `CFBScheduleApp`: `isAwaitingKickoff` IIFE checks `canonical.source === 'preseason-awaiting-kickoff'` + render-time `Date.now() < kickoffMs`. `isPreseason` broadened: `leagueStatus.state === 'preseason' || isAwaitingKickoff`.

### Codex remediation

**Finding — `Date.now()` in cached selector**: The initial implementation computed `kickoffMs > Date.now()` inside `computeCanonicalStandings`, which is wrapped in `unstable_cache` with tag-only invalidation. Once cached as `preseason-awaiting-kickoff`, the snapshot would remain so indefinitely after kickoff — until someone manually invalidated the tag.

**Fix**: Selector returns the time-invariant fact (kickoff date string). Consumers perform the time check at render time. This pattern is now an AGENTS.md invariant: "Time-dependent classification belongs in consumers, not cached selectors."

**Test consequence**: Test `p2-season-kickoff-past` originally asserted `source: 'empty'` for a kickoff-in-past case. After remediation, it correctly asserts `source: 'preseason-awaiting-kickoff'` (the selector returns the fact; the consumer decides what it means).

---

## Phase 3 — Insights Lifecycle Awareness

### What changed

**Engine filter (`shouldSuppressGenerator`)**:

- New function in `src/lib/insights/engine.ts` for cross-cutting (id, lifecycle, flag)-based generator skips.
- Initial rule: `career:rookie_benchmark` is suppressed when `context.usingArchivedRoster` — the first-archive-owner detection would mislabel all returning members as rookies during rollover window.
- Gated by `bypassSuppression`: `generators.filter((g) => bypassSuppression || !shouldSuppressGenerator(g, context))`.

**Framing helpers (`src/lib/insights/framing.ts`)**:

- `applyLastSeasonFraming(insight)`: prepends "Last season's " to insight title (idempotent — checks if already present).
- `applyReturningOwnerFraming(insight)`: prepends "Returning owner " to description when description starts with the owner name (idempotent — checks if already present; no-op for multi-owner insights).

**Per-generator changes**:

| Generator | Behavior when `usingArchivedRoster` |
|-----------|-------------------------------------|
| `seasonWrapGenerator` | All insights get `applyLastSeasonFraming` |
| 6 stats generators | All insights get `applyLastSeasonFraming` via `frameStatsInsights()` helper |
| `volatilityGenerator` | Insight gets `applyReturningOwnerFraming` |
| `neverFinishedLastGenerator` | Insight gets `applyReturningOwnerFraming` |
| `titleChaserGenerator` | Insight gets `applyReturningOwnerFraming` |
| `trendingGenerator` | Insight gets `applyReturningOwnerFraming` (only in `RETURNING_OWNER_TRENDING_LIFECYCLES`) |
| `rookieBenchmarkGenerator` | Returns `[]` (early exit); also suppressed at engine level |
| `championshipRaceGenerator` | Zero-game guard: `rows.every(r => r.wins + r.losses === 0)` → returns `[]` |

**Legacy path zero-game guards**:

- `deriveLeagueInsights`: bails early if no eligible owner has played any games.
- `deriveTightRaceInsight`: bails if all rows have zero games.
- `deriveTightClusterInsight`: same guard on eligible rows.

**Tests** (22 new): `src/lib/__tests__/insights-lifecycle-awareness.test.ts` — framing helper idempotency, per-generator framing on/off, lifecycle assertions, engine bypass with global registry save/restore.

### Codex remediation

**Finding — `shouldSuppressGenerator` unconditional**: The new engine filter ran regardless of `bypassSuppression`, meaning `?bypassSuppression=1` admin diagnostic runs would still have the new generator-level filter applied. Fixed by gating: `bypassSuppression || !shouldSuppressGenerator(g, context)`.

---

## Architectural decisions

### Cache/time separation

This campaign established a firm principle: `unstable_cache`-wrapped selectors must return time-invariant facts; consumers evaluate time-dependent state at render. Violations cause silent stale-classification bugs that persist until a cache tag is manually invalidated.

This principle is now codified in AGENTS.md Season Launch Hardening Invariants as rule #3.

### Layered suppression in the insights engine

The engine now has two suppression layers that interact correctly with `bypassSuppression`:

1. **Generator-level** (`shouldSuppressGenerator`): skips the generator entirely based on (id, lifecycle, flag). Good for cases where running the generator would produce output that's categorically wrong (e.g., rookie detection during rollover window).
2. **Insight-level** (`isSuppressed`): per-insight suppression record gate for change-detection suppression (deduplication across render cycles).

Both layers are bypassed by `bypassSuppression`. Any future rule added to either layer must respect this contract.

### Framing vs. suppression

The framing approach (rewriting insight text) was chosen over suppression for `usingArchivedRoster` cases because:

- The underlying data is valid — last season's stats are real stats.
- Suppressing them would leave the panel empty during a long preseason window.
- Reframing with "Last season's" / "Returning owner" prefixes accurately communicates the temporal context.

Suppression is the right choice only when reframing is also misleading (e.g., `rookieBenchmarkGenerator` — there is no meaningful "returning owner" framing for a first-archive-owner comparison).

---

## Files created

- `src/lib/server/canAccessDraftBoard.ts` — server-side draft admin auth helper
- `src/lib/insights/framing.ts` — `applyLastSeasonFraming`, `applyReturningOwnerFraming`
- `src/lib/__tests__/insights-lifecycle-awareness.test.ts` — 22 lifecycle awareness tests

## Files modified

- `src/lib/insights/engine.ts` — `shouldSuppressGenerator`, gated filter
- `src/lib/selectors/leagueStandings.ts` — `preseason-awaiting-kickoff` source, `inferredSeasonStart`
- `src/components/StandingsPanel.tsx` — three-state empty rendering
- `src/components/CFBScheduleApp.tsx` — `isAwaitingKickoff` + broadened `isPreseason`
- `src/lib/selectors/insights.ts` — zero-game guards on legacy derive functions
- `src/lib/insights/generators/career.ts` — framing + rookie early-exit
- `src/lib/insights/generators/stats.ts` — `frameStatsInsights` helper on all 6 generators
- `src/lib/insights/generators/existing.ts` — `seasonWrapGenerator` framing + `championshipRaceGenerator` zero-game guard
- `src/app/league/[slug]/draft/page.tsx` — `canAccessDraftBoard` gate
- `src/app/league/[slug]/draft/setup/page.tsx` — `canAccessDraftBoard` gate
- `src/app/league/[slug]/draft/summary/page.tsx` — `isAdmin` prop-passing (no redirect)
- `src/components/draft/DraftBoardClient.tsx` — phase-aware polling, `isAdmin` prop
- `src/components/draft/DraftSetupShell.tsx` — `isAdmin` prop
- `src/components/draft/DraftSummaryClient.tsx` — `isAdmin` prop
- `src/components/draft/SpectatorBoardClient.tsx` — complete-phase 30s polling
- `src/lib/__tests__/selectors-leagueStandings.test.ts` — Phase 2 test updates + 5 new tests

---

## Deferred items (non-blocking)

- **Commissioner slug-scoped enforcement** — `canAccessDraftBoard` stubs `void slug` and delegates to `isPlatformAdminSession()`. Phase 7 will add league-scoped commissioner checks. The helper is already the right entry point.
- **`shouldSuppressGenerator` rules** — Only one rule exists today (`career:rookie_benchmark` + `usingArchivedRoster`). Future lifecycle-specific suppressions should be added here with narrow, well-commented id-based branches.
- **INSIGHTS-LIFECYCLE-AWARENESS backlog item** — This campaign resolves the backlog item added during Standings Ownership Phase 5. Closed.
- **STANDINGS-PRESEASON-STATE backlog item** — This campaign resolves the backlog item added during INSIGHTS-017. Closed.
