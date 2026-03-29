# CFB App Roadmap

## Development philosophy

The CFB app is a single-developer, AI-assisted, league-first web app that should stay predictable, maintainable, and economical to run.

Core principles:

- **Schedule-first game identity.** The schedule remains the canonical source of truth for the game universe.
- **API-first ingestion.** CFBD and The Odds API remain upstream sources of truth for schedule/scores and odds.
- **Shared cached production reads.** Hosted member traffic should primarily consume shared cached state instead of repeatedly triggering upstream rebuild work.
- **Small durable footprint.** Use one small managed database for truly persistent shared state.
- **Quota-conscious freshness.** Freshness matters, but it must be balanced against CFBD and Odds API monthly quotas.
- **Admin-controlled persistence and refresh.** Season-persistent shared data should update through commissioner/admin flows, not opportunistically from public traffic.
- **Diagnostics over silent failure.** Problems should surface clearly and be recoverable.
- **Prompt traceability.** Codex prompts should use standardized headers and stable `PROMPT_ID`s so work can be referenced and revised cleanly across phases.

Prompt format and registry guidance live in `docs/prompt-registry.md`.

## Current status

- Phase 1 architecture stabilization is complete.
- Core league surfaces are in place.
- Phase 2A production hardening is in **late closeout**:
  - admin-only rebuild semantics are enforced for schedule/reference refresh paths
  - diagnostics now distinguish shared authoritative state from ephemeral process-memory counters
  - remaining closeout item is hosted mobile/device validation evidence
- The next major milestone after closeout is **Phase 2B league UX / engagement**.

## Production data policy

### 1. Season-persistent / admin-refresh only
**Rule:** store durably, read broadly, update only via admin-triggered edit/refresh flows, and never rebuild casually from member traffic.

Examples:
- owner roster
- alias map
- manual postseason overrides
- team database / team reference snapshot
- season schedule snapshot when used for hosted stability

### 2. Cached / controlled refresh
**Rule:** cache shared snapshots to reduce upstream usage. Refresh by admin action and/or conservative TTL rules.

Examples:
- conference data
- rankings
- durable odds snapshots
- diagnostics / usage snapshots

### 3. Live / freshness-sensitive
**Rule:** still cache when practical, but allow more frequent controlled refresh than season-persistent data. No wasteful interval polling.

Examples:
- scores
- near-window odds behavior if retained

## Hosted production target

### Goal
Deliver a hosted app that league members can reliably use throughout the season with low commissioner overhead and controlled API usage.

### Recommended stack
- **Vercel** for app hosting, preview deploys, and production deploys.
- **One small managed Postgres** for shared durable state.
- No extra queue/worker/cache layer unless proven necessary.

### Durable shared state target
Keep this intentionally small:
- aliases
- owner roster
- postseason overrides
- team database snapshot
- durable odds snapshots if retained for line continuity
- season/reference snapshots only where they materially reduce repeated upstream rebuild work

## Roadmap phases

## Phase 2A — Production hardening (late closeout)

### Objective
Make the existing league-first app safe and efficient for hosted member traffic without rewriting the architecture.

### Key workstreams

#### 1. Production hosting readiness
- Validate hosted deployment assumptions for serverless execution.
- Remove dependence on writable local runtime files for shared production state.
- Make shared cache behavior deterministic enough for member traffic.

#### 2. Durable shared storage
- Introduce a small shared durable storage layer for commissioner-managed data.
- Keep file fallback only for local development or non-hosted scenarios if helpful.
- Ensure public/member reads consume the shared version of the data.

#### 3. Shared owner roster
- Persist the owner roster server-side so all members get the same league mapping.
- Preserve commissioner upload/edit workflows, but stop relying on per-browser local storage as the primary source.

#### 4. Shared alias persistence
- Persist alias edits durably and make all server consumers read through the same shared path.
- Preserve diagnostics and alias repair workflows.

#### 5. Admin protection for mutating routes
- Protect commissioner-only actions such as alias edits, owner uploads, forced refreshes, and team sync.
- Keep public/member reads broadly accessible.

#### 6. Persistent season data caching
- Treat schedule/reference data as shared cached state.
- Refresh these data only through admin-triggered rebuild flows.
- Ensure member traffic primarily reads cached/shared season data.

#### 7. Quota-safe scores and odds refresh
- Scores: shared cache-first with conservative freshness windows.
- Odds: especially conservative, favor existing shared snapshots and admin/manual refresh over repeated public upstream fetches.
- Avoid wasteful polling-heavy production behavior.

#### 8. Production observability and recovery tooling
- Clarify which diagnostics are authoritative versus ephemeral.
- Add recovery guidance for quota exhaustion, stale cache, alias mistakes, and owner-roster mistakes.
- Preserve commissioner-facing diagnostics for schedule/score/odds reconciliation.

#### 9. Mobile/device production validation
- Validate the hosted experience on mobile Safari, Android Chrome, and major desktop browsers.
- Confirm commissioner/admin flows remain usable enough on small screens.

### Completion criteria
Phase 2A is complete when:
- core commissioner-managed state is shared and durable
- public traffic primarily reads shared cached state
- mutating/admin flows are protected
- schedule-first architecture remains intact
- quota usage is conservative enough for the hobby-scale deployment target

## Phase 2B — League UX / engagement after hardening

### Objective
Finish league-facing usability and engagement work once hosted stability is in place.

### Core UX workstreams

1. **Top-level league summary strip**
   - Add a compact league summary bar at the top of Overview.
   - Prioritize immediate league-state cues (leader, near-term movement, active week context).

2. **Overview hierarchy restructuring**
   - Reorder Overview to foreground standings context first.
   - Increase prominence of recent results and live games when relevant.
   - Keep weekly matchup context visible but secondary to league-state signal.

3. **Signal-first copy and layout pass**
   - Reduce explanatory filler copy in primary league surfaces.
   - Prefer concise labels, stronger hierarchy, and data-first scanning.
   - Tune head-to-head/table density so the highest-signal blocks remain dominant.

4. **Mobile-first scanning/readability**
   - Improve readability and section hierarchy for mobile league checks.
   - Confirm summary, standings, and recent/live context remain legible without deep scrolling.

5. **Lightweight league narrative layer**
   - Add compact weekly narrative cues:
     - movement in standings
     - recent outcomes
     - notable results/top performers
   - Keep narrative output lightweight and deterministic (no heavy content system).

6. **Follow-on polish**
   - feedback/report issue entry point
   - commissioner-friendly recovery UX refinements


### Shared Insights System (planned, selector-first)

#### Purpose
Establish a single selector-owned insight catalog so league insights are **derived once and consumed many ways** across Overview and Standings. This aligns narrative/highlight output, reduces duplicated derivation logic, and keeps UI layers focused on presentation.

**Rule:** Insights are selector-owned. UI must not derive insights independently.

#### Architecture (text diagram)

1. Canonical inputs (standings history, current standings, resolved weeks, schedule context)
2. `deriveLeagueInsights(...)` in `src/lib/selectors/insights.ts`
3. Shared ranked `Insight[]` catalog (deterministic ordering)
4. Consumer filters:
   - Overview: top 2–4 headline insights
   - Standings: 1–2 contextual insights + movement column context

#### Insight type catalog (initial)

- `movement`
- `toilet_bowl`
- `surge`
- `collapse`
- `race`
- `milestone`

Draft model (for implementation phase):

```ts
type Insight = {
  id: string
  type: 'movement' | 'toilet_bowl' | 'surge' | 'collapse' | 'race' | 'milestone'
  title: string
  description: string
  score: number
  owners: string[]
  week?: number
  navigationTarget?: {
    type: 'standings' | 'matchup' | 'trends'
    params?: Record<string, string | number>
  }
}
```

#### Responsibility split

- **Selector layer (`deriveLeagueInsights`)**
  - Owns all insight derivation and ranking.
  - Includes biggest rise/drop, toilet bowl tracking, streak/surge/collapse detection, and tight-race detection.
  - Depends only on canonical league inputs (no UI state).
- **Overview page**
  - Consumes top-N ranked insights (headline mode).
  - Keeps copy minimal/high-signal.
- **Standings page**
  - Shows movement column plus 1–2 context insights relevant to standings interpretation.
  - Must not duplicate movement information already visible in table deltas.

#### Phased implementation plan

1. **Phase 1 — Planning + documentation (current)**
   - Document architecture, responsibilities, and rollout boundaries.
   - Mark `Recent Momentum` as deprecated as a primary concept.
2. **Phase 2 — Movement column foundation**
   - Add week-over-week rank delta column to standings table.
   - No shared selector yet.
3. **Phase 3 — Shared selector core engine**
   - Implement `deriveLeagueInsights(...)` with 3–5 initial insight types.
   - Add deterministic scoring/ordering rules.
4. **Phase 4 — Overview integration**
   - Replace page-owned pulse/highlight derivation with top insights from selector.
   - Cap to 2–4 items.
5. **Phase 5 — Standings integration**
   - Replace/downgrade `Recent Momentum` and add 1–2 context insight cards.
6. **Phase 6 — Cleanup + convergence**
   - Remove duplicate legacy insight derivations.
   - Ensure all insights flow from shared selector.
7. **Phase 7 — Expansion**
   - Add optional types (longest streak, volatility, late-season pressure, etc.) after core convergence.

#### Test planning requirements (for implementation phases)

- Deterministic ranking: same inputs must always produce the same sorted insight list.
- Coverage by type: each insight type emits only under valid conditions.
- Conflict/duplication guardrails: no duplicate or contradictory insights.
- Edge cases: early season, completed season, ties/identical records.

## Phase 3 — Historical analytics (optional)

### Objective
Add historical/analytical features only after hosted current-season operation is stable.

### Examples
- season archives
- upset / odds retrospectives
- historical owner performance summaries
- deeper visualizations

## Phase 4 — Multi-league commissioner support (future)

### Objective
Support multiple private leagues managed by the same commissioner while preserving shared global sports data pipelines.

### Scope

- Multiple private leagues (work/family/friends-style) under one commissioner.
- League-specific data is the ownership overlay (owner roster/mapping and related league views).
- Shared global CFB data remains common across leagues:
  - schedule
  - scores
  - odds
  - rankings
  - conferences
- Likely routing boundary: league slug or `leagueId` scoped league pages.

### Non-goals

- No duplication of CFBD ingestion/schedule pipelines per league.
- No broad SaaS/self-serve multi-tenant platform redesign.
- No change to the small-footprint production model unless scale requirements prove it necessary.

## Architecture rules that remain unchanged

- Schedule-derived games remain the canonical attachment boundary for scores and odds.
- Do not introduce duplicate matching systems.
- Keep heavy matching and normalization logic in shared libraries rather than UI components.
- Prefer explicit diagnostics and manual repair over hidden heuristics.
