# CFB App Vision

## Product intent

The CFB app is a **hosted, league-first dashboard** for a college-football office pool. It should give league members a stable, low-friction place to check the current league picture, weekly matchups, standings, and relevant live context without needing commissioner intervention for ordinary use.

The product remains **API-first**:

- **CFBD** is the source of truth for schedule and scores.
- **The Odds API** is the source of truth for betting odds.
- The **schedule remains the canonical game universe** that all downstream score and odds attachment must respect.

## Prompt governance (execution hygiene)

- Codex implementation prompts for this project should include a standardized header with `PROMPT_ID`, `PURPOSE`, and `SCOPE`.
- Prompt IDs should follow `<PHASE>-<AREA>-<SHORT_NAME>-v<version>` and be referenced explicitly in later discussion.
- Use `docs/prompt-registry.md` as the lightweight reference list for important prompts.

## Production direction

The app is a **low-maintenance hosted deployment** used for repeated member access during the season. Production hardening (Phase 2A) is complete, and the hosted preview is live.

The production model optimizes for:

- stable league-member access from the web
- deterministic schedule-first behavior
- low surprise and low operational overhead
- quota-conscious API usage
- shared server-side state for commissioner-managed data
- admin-controlled refresh of season-persistent data
- public/member reads that primarily consume shared cached state rather than repeatedly hitting upstream APIs

## Core production principles

### 1. Schedule-first remains non-negotiable
The schedule is the authoritative list of games. Scores, odds, standings, matchup context, and diagnostics must continue to attach to schedule-derived identities rather than introducing parallel matching systems.

### 2. Hosted users should read shared state
League members should not depend on per-browser local caches for core league configuration. Commissioner-managed data should live in shared durable storage and be read consistently by all users.

### 3. Durable footprint stays intentionally small
Use one small managed database for the limited set of truly persistent shared data. Do not introduce a large operational stack unless there is a clear production need.

### 4. Admin refresh controls season-persistent data
Season-long reference/configuration data should be stored durably and refreshed intentionally through commissioner/admin workflows. Ordinary member traffic should not trigger opportunistic rebuilds of season-persistent state.

### 5. Live data stays conservative and quota-aware
Freshness matters most for scores and selectively for odds, but monthly quotas remain the governing constraint. Avoid wasteful interval polling and prefer shared cache-first reads with conservative refresh policy.

## Production data policy summary (canonical)

> This is the canonical production data policy. `docs/roadmap.md` references this section rather than maintaining a separate copy.

### Season-persistent / admin-refresh only
Stored durably, read by all users, updated only via admin-triggered edit/refresh flows.

Examples:
- owner roster
- alias map
- manual postseason overrides
- team reference snapshot / team database
- season schedule snapshot, when persisted for hosted stability

### Cached / controlled refresh
Cached to reduce upstream cost. Refreshed by admin action and/or conservative TTLs. Public traffic should prefer shared cached snapshots over repeated upstream fetches.

Examples:
- conference data
- rankings
- durable odds snapshots
- diagnostics / usage snapshots

### Live / freshness-sensitive
Still cached when practical, but allowed to refresh more often than season-persistent data. No aggressive polling.

Examples:
- scores
- near-window odds if retained in live mode

## What success looks like

The hosted preview is live and meets these criteria:

- league members can open the site and immediately see the shared owner roster, aliases, standings, and matchup context
- schedule, conferences, rankings, and other reference data come from shared cached snapshots rather than ad hoc per-user rebuilds
- commissioner edits and refreshes are intentional and protected
- scores feel timely enough for hobby-scale use without burning through CFBD quota
- odds remain useful without exhausting the smaller monthly Odds API budget
- production recovery paths are simple and understandable when upstream APIs fail or quotas get tight

## League experience direction (additive product layer)

Production correctness is required, but not sufficient. The hosted app must also communicate league state quickly and clearly for ordinary members.

### Core league-experience requirement

- A member should understand the current league state within seconds of opening the app.
- Primary user questions to answer immediately:
  - who is winning the league?
  - what just happened?
  - what matters right now?
  - what should I look at next?

### Overview page hierarchy target

The Overview page should be the highest-signal league entry point and should prioritize, in order:

1. leader / standings context
2. recent results
3. live games (when applicable)
4. weekly matchup context

### UI communication rules

- Prefer signal over explanation: data-first presentation with clear visual hierarchy.
- Reduce descriptive filler copy that competes with standings/results/live context.
- Keep league-state surfaces scan-friendly on desktop and mobile.
- During active game windows, emphasize that league state is changing as scores finalize.

### Seasonal “alive” expectation

In-season behavior should feel active, not static:

- as games complete, the visible league picture should update coherently
- standings movement should be legible
- recent outcomes should remain easy to scan without digging through secondary panels

### Future multi-league direction (scope guard)

Future multi-league support should keep the current API-first, schedule-first model:

- a commissioner may manage multiple private leagues
- league-specific variation is primarily the ownership overlay (owner roster/mapping)
- schedule/scores/odds/rankings/conferences remain shared global CFB data
- avoid per-league duplication of CFBD ingestion or schedule pipelines
