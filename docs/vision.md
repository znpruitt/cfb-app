# CFB App Vision

Status: Current
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: product vision / intent and the canonical production data policy
Supersedes: (none)

## Product intent

Turf War is a **hosted, league-first dashboard** for a college-football office pool. It gives league
members a stable, low-friction place to understand the current league picture, weekly matchups,
standings, and relevant live context without needing commissioner intervention for ordinary use.

The product remains **API-first and schedule-first**:

- **CFBD** is the source of truth for schedule and scores and the sole normal production score
  provider.
- **The Odds API** is the source of truth for betting odds.
- The **schedule is the canonical game universe**. Scores, odds, ownership, standings, and
  diagnostics attach to schedule-derived game identities rather than creating parallel game truth.

The product should feel current and dependable while remaining economical for a small,
commissioner-operated league. It is not intended to become a large operational platform merely to
support ordinary in-season use.

## Product promise

A member should be able to open the league and, within seconds, understand:

- who is leading;
- what just happened;
- what is live or approaching;
- what matters next.

Routine member use should not require a commissioner to refresh data manually, explain internal
provider state, or repair a browser-specific cache. When upstream data is late or unavailable, the
app should preserve prior-good shared state, communicate uncertainty honestly, and give operators a
clear recovery path.

## Entry and access model (settled)

Owner decision, 2026-08-08, recorded during the PLATFORM-088 homepage audit:

- **Members reach their league through a link their commissioner shares.** That link is the normal
  entry path, subject to the league password gate where one is configured.
- **There is no public league directory or slug-entry tool.** Leagues are not discoverable from the
  root page.
- **There is no signup flow on the homepage.** League creation is currently a platform-admin
  operation. Conditional commissioner self-registration remains longer-term roadmap work.
- **The signed-out root explains Turf War and directs invited members back to their league link.** It
  is an entry page, not a general marketing site. `DESIGN.md` owns its visual and interaction rules.
- **Only platform admins see the root league dashboard.** A signed-in non-admin sees the same public
  landing as a signed-out visitor.

If commissioner self-registration and invite-based tenancy ship, revisit this section deliberately.
Do not let a future signup flow accidentally imply a public league directory or mandatory member
accounts.

## Product and operating principles

### 1. Schedule-first identity is non-negotiable

The schedule defines which games exist. Provider payloads, ownership overlays, and derived league
state must reconcile to schedule-derived identities through the shared identity and attachment
authorities.

### 2. Members read shared state

Core league data must not depend on one browser's local cache. Commissioner-managed state and
provider-backed snapshots live in shared storage so every member sees the same league truth.

### 3. The durable footprint stays intentionally small

Use one small managed database for the limited shared state the product needs. Add infrastructure
only when a demonstrated production requirement justifies its operational cost.

### 4. Provider work is controlled

Ordinary public and member reads consume shared cached state. Provider calls and durable mutations
belong to explicit authorized workflows: fixed scheduled jobs, lifecycle operations, and protected
admin actions. Manual and automatic callers should share the same refresh authorities so they
cannot disagree about validation, commit, or failure semantics.

### 5. Freshness is conservative, quota-aware, and truthful

Scores and game statistics may refresh frequently around active game windows; odds, schedule, and
rankings follow slower target-aware policies. Every policy must respect provider quotas, avoid work
when no eligible target exists, preserve prior-good state on uncertainty, and expose failures to
operators rather than silently substituting another source.

## Production data policy (canonical)

This policy classifies data by authority and durability, not by one hard-coded refresh interval.
Exact jobs and cadences belong in the runtime and operations documentation.

### Durable league and operator state

Shared product state that represents an intentional league or operator decision.

Examples:

- league registry and lifecycle state;
- owner rosters and published draft assignments;
- alias repairs and manual postseason overrides;
- provider-refresh settings and writer-control state.

This data changes only through authorized commissioner/platform-admin workflows or explicit
lifecycle transactions. Ordinary member traffic reads it but does not opportunistically rewrite it.

### Provider-backed shared snapshots

Reconstructible upstream projections stored centrally to control quota usage and give all members a
consistent view.

Examples:

- schedule and scores;
- odds and rankings;
- game statistics;
- team and conference reference data.

Schedule, scores, odds, rankings, and game statistics may be maintained by fixed, quota-aware
scheduled jobs as well as protected manual repair actions. Team and conference reference data remain
manually refreshed. Public/member paths remain cache-only. A failed or uncertain refresh preserves
prior-good durable state, and a valid empty provider partition is treated as absence rather than
fabricated failure or permission to erase good data.

### Derived read models and observability

Standings, insights, trends, matchup context, diagnostics summaries, and presentation caches are
derived from canonical shared inputs. They may be cached for performance, but they do not become a
second source of game, score, ownership, or provider truth. Observability records describe refresh
and scheduler behavior; they never establish canonical data by themselves.

## What success looks like

The product succeeds when:

- members can follow the league throughout the season without routine commissioner intervention;
- every member sees the same roster, standings, schedule, and matchup context;
- league state changes coherently as games complete;
- automatic and manual refreshes use the same validated, durable-first behavior;
- provider failures degrade to truthful stale or unavailable states rather than corrupting shared
  data;
- odds and scores feel timely without exhausting their monthly budgets;
- recovery paths are bounded, understandable, and visible to operators;
- the private-by-link access model remains clear and predictable.

## League experience direction

Production correctness is required but not sufficient. The member experience should communicate
league state quickly, with the Overview as the highest-signal entry point.

The Overview should prioritize:

1. leader and standings context;
2. recent results;
3. live games when applicable;
4. weekly matchup context.

In season, the product should feel active rather than static: standings movement should be legible,
recent outcomes easy to scan, and live-state language bounded by evidence. `DESIGN.md` remains
canonical for the visual system, layout, interaction, and responsive behavior.

## Growth boundary

Multi-league support exists today. Its architectural boundary should remain simple:

- schedule, scores, odds, rankings, conferences, and game statistics are shared global college
  football data;
- each league primarily adds its ownership, lifecycle, draft, and presentation overlay;
- provider ingestion and canonical game construction are never duplicated per league;
- current league creation and cross-league administration remain platform-admin managed.

### Conditional commissioner signup

Commissioner self-registration is warranted only if multiple leagues are actively using the app and
manual platform administration becomes a real bottleneck. The minimal expansion is:

- commissioner account creation;
- league creation and a shareable league URL;
- a league picker for commissioners managing multiple leagues.

Mandatory member accounts, public league discovery, and a full SaaS permissions model remain out of
scope unless future usage demonstrates a concrete need.
