CFB Schedule App – Focused Roadmap for a One‑Developer Project
Development Philosophy

The CFB Schedule App is a private fantasy‑style league dashboard built by a single developer using AI‑assisted tools. Because it serves a small league rather than a public audience, the app must stay simple, reliable and maintainable. The core principles are:

Deterministic matching via canonical identities: external data resolves through a canonical identity layer before matching. Exact matching yields high precision and prevents mismatched teams or false positives.

API‑first architecture with minimal local data: schedules, scores and odds come from authoritative APIs. Local files only map owners to teams and store alias overrides.

Clear diagnostics over silent failure: mismatches and errors should be surfaced to the commissioner rather than hidden.

MVP mindset and incremental improvements: build the simplest version that delivers value and add features only when they do not compromise reliability.

These principles help avoid feature creep and keep the project manageable for a single developer while preserving a long‑term vision.

Current Development Focus

The project is presently in Phase 1 – Architecture Stabilization. Recent work has focused on API-first schedule/scores ingestion, shared attachment boundaries, and maintainability decomposition of oversized modules. The next immediate tasks are to continue shrinking the largest remaining files (especially the main app orchestrator and score attachment helpers) while preserving behavior and architecture. This section should be updated as the project moves through the phases.

Development Workflow

Because development is performed by a single developer using AI‑assisted tools like Codex, the workflow emphasises small, safe iterations:

Identify a small architectural or usability improvement aligned with the roadmap.

Convert the improvement into a focused implementation task (e.g., “build alias editing UI”).

Use AI‑assisted tooling to implement the change.

Review and test locally, focusing on linting and runtime diagnostics rather than elaborate test suites.

Commit the change and update documentation. Repeat with the next task.

This iterative workflow encourages rapid progress while maintaining stability.

Core Local Data Model

To minimize manual data management, the app stores only a small set of local files. Everything else is pulled from APIs:

owners.json – maps each team’s canonical identifier to the league owner who drafted it. This file is maintained by the commissioner.

aliases.json – holds canonical team identifiers, known aliases and any manual overrides created through the alias editing UI.

cache/ directory – stores cached API responses (schedule, odds, scores) as JSON files to reduce API calls and improve reload performance. Caching should always exist at runtime in memory; writing cache files to disk is optional and primarily helps avoid repeated API calls across application restarts.

All other data (schedules, scores, betting lines and team metadata) should be fetched from APIs. Maintaining separate CSVs or spreadsheets is discouraged; the CFBD schedule API becomes the authoritative source of truth for the schedule.

Data Caching and Refresh Strategy

Caching reduces API calls and prevents rate limit issues, but not all data changes at the same cadence. A balanced strategy is:

Data that can be cached locally

Team metadata (team names, IDs, logos) and conference information – these are stable within a season and can be cached for days or kept locally for the entire season.

Season schedule and venue details – games and locations rarely change after release; update these once per day or when the app starts.

Data that should be refreshed frequently

Live scores and game status – update during active games every 60–120 seconds, still respecting API rate limits.

Betting odds – refresh every 15–30 minutes to reflect line movements.

This approach reduces unnecessary API traffic and ensures the app remains responsive without exhausting quotas.

API Refresh Strategy

For clarity, the following refresh intervals are recommended:

Schedule: refresh once per day (e.g., at app start).

Team and conference metadata: refresh rarely; treat as static per season.

Odds: refresh every 15–30 minutes.

Scores and game status: refresh every 60–120 seconds during games.

These intervals balance freshness with rate‑limit protection. Caching should be implemented using in‑memory structures or JSON files as described in Phase 1.

Canonical Identity Rules

All external data (schedule, scores, odds and ownership mappings) must resolve through the canonical identity layer before any matching or comparison. Matching should always occur on canonical identifiers rather than raw team names. This deterministic approach ensures consistent results across APIs and eliminates ambiguity.

Canonical identity structure (conceptual example)

Each team in the system has a canonical identifier and a list of known aliases. For example:

{
  "canonicalTeamId": "alabama",
  "aliases": [
    "Alabama",
    "Alabama Crimson Tide",
    "ALA",
    "Alabama (CFBD)"
  ]
}

The canonical identity resolver maps any alias from external APIs to the canonicalTeamId, ensuring deterministic matching. The commissioner can add or edit aliases through the alias editing UI.

Game Identity Model

The schedule ingestion module constructs the core game model. The schedule is the authoritative list of games; other data must attach to games derived from it. Each game is uniquely identified using the canonical home team, canonical away team, week and start time. After canonical identity resolution, scores and betting odds are associated with these schedule‑derived games. This prevents duplicate game records and ensures that all data attaches to the same underlying game.

Data Flow Overview

At a high level, data moves through the system in the following stages:

External APIs → Data Ingestion Modules: The app fetches schedules, scores and odds from authoritative APIs (CFBD and Odds API).

Ingestion Modules → Canonical Identity Resolver: Raw data passes through the canonical identity layer, which maps team names to canonical identifiers.

Canonical Identity Resolver → Schedule‑Derived Game Model: The system constructs a list of games from the schedule. Scores and odds are attached to these games after identity resolution.

Game Model → Application UI: The processed data (weekly schedules, matchups, scores, standings and odds) is presented in the user interface.

This conceptual flow clarifies how data travels from external sources to the end‑user without delving into technical details.

Phase 1 – Architecture Stabilization

Goal: Create a dependable, easy‑to‑maintain data pipeline and identity system that can run reliably with minimal manual intervention.

The first phase establishes a stable foundation for all subsequent work. It separates architecture from features and focuses solely on reliability and simplicity.

Key Objectives

Data architecture and caching:

Remove the legacy schedule CSV ingestion path and use the CFBD schedule API as the single source of truth for the season schedule. Eliminating the CSV path avoids redundant workflows.

Consolidate local data files (e.g., owners.json, aliases.json) into a clear, minimal schema.

Adopt an API‑first workflow: ingest schedules, scores and odds directly from their respective APIs. To reduce external calls and improve reload speed, use lightweight caching: keep responses in memory during runtime and optionally write them to simple JSON files on disk. Do not introduce a full database in Phase 1.

Canonical identity layer:

Build a canonical team identity system to normalise team names across all data sources (CFBD schedule, CFBD scores, Odds API data and league ownership). Deterministic identity matching uses exact identifiers to achieve high accuracy and avoids fuzzy or probabilistic matching.

Provide an admin interface for the commissioner to view alias mappings, add overrides and resolve conflicts.

Ensure all matching (scores, odds, ownership) goes through this identity layer; never match on raw strings.

API integration stability and rate‑limit protection:

Implement modules to ingest data from the CFBD schedule, CFBD scores and Odds API. Each module should handle lightweight caching and include retry logic for transient network errors.

Add request throttling and back‑off logic to respect API rate limits. An API rate limit defines how many calls a client can make per second; exceeding it results in errors. Throttling protects the system from overuse and ensures stable access.

Avoid excessive polling by caching responses and only refreshing data at reasonable intervals.

Document API endpoints and expected response formats to make maintenance easier.

Diagnostics and error reporting:

The system should never silently fail. Implement a diagnostic dashboard or admin panel that surfaces issues such as unmatched teams, missing odds or scores, alias conflicts and failed score matching. This aligns with the philosophy that problems should be visible and fixable rather than hidden.

Developer workflow and code quality:

Establish a clean modular code structure separating data ingestion, identity resolution and presentation layers.

Focus on linting, type safety and runtime diagnostics to maintain code quality. Formal unit tests can be introduced later once the architecture stabilises; at this stage, prioritise descriptive errors and clear logging over extensive test suites.

Document the architecture, modules and data flows to enable future maintenance by the single developer or collaborators.

Completion criteria

Phase 1 is complete when:

The legacy schedule CSV is fully removed and replaced by CFBD schedule ingestion.

Scores and odds ingestion modules reliably fetch data with caching, retry logic and rate‑limit protection.

The canonical identity layer successfully normalises all teams across APIs and supports manual overrides.

A basic alias editing UI exists for the commissioner to manage mappings.

Diagnostics surface all mismatches and errors; the system runs without manual intervention during data matching.

Once these criteria are met, the foundation is stable enough to move to user‑facing features.

Phase 2 – Core League Features (Usability)

Goal: Deliver a clean, intuitive interface that league members enjoy using during game days while maintaining simplicity.

After stabilizing the architecture, shift focus to user‑facing functionality. This phase should avoid features typical of large platforms (such as native mobile apps, push notifications, email alerts, public APIs, WebSocket streaming, chat or gamification). Instead, concentrate on practical features that make the app the league’s go‑to dashboard.

Key Objectives

Clear weekly schedule view:

Provide a simple schedule page listing games involving league teams for each week. Show kickoff times, opponents, locations and betting context (e.g., spreads, totals). Use color coding or icons to indicate game status (upcoming, live, final).

Automatic week detection: Determine the current college football week from the schedule or current date and default the UI to that week on page load. This reduces friction for users and ensures they immediately see relevant games.

Improved matchup presentation:

Develop a card‑based interface that pairs owners against each other based on their teams. Keep critical information (teams, owners, score and spread) visible while scrolling, inspired by ESPN’s pinned‑score design.

Responsive layout:

Ensure the web app renders well on desktops, tablets and phones without building native mobile apps. This can be achieved through responsive CSS frameworks and testing.

Owner vs owner visualization:

Clearly indicate which owner’s team is favored based on the point spread and show who is currently winning as scores update. Display both teams’ logos or colors to aid quick recognition.

Basic standings tracking:

Maintain a simple standings table showing each owner’s record (wins/losses) and optional point differential. This helps members understand league standings at a glance.

User feedback mechanisms:

Include a “Report Issue” or “Submit Feedback” button in the interface. Inspired by user feedback options in fantasy apps, this feature allows league members to flag data errors or suggest improvements.

Completion criteria

Phase 2 is complete when:

A weekly schedule view displays all league games for the current week with automatic week detection.

Matchup cards clearly show owner vs owner matchups with live scores and betting context.

The web interface is responsive across devices.

Standings tracking (wins/losses and optional point differential) is available.

A feedback mechanism allows users to report issues.

These features should be stable and intuitive, making the app the default place for league members to follow games.

Phase 3 – Historical Analytics (Optional)

Goal: Provide optional long‑term tracking and analysis after the system has proven stable and the league actively uses the app.

In this phase, analytics features are added carefully, ensuring they do not jeopardize reliability. Historical features are not essential for the basic functioning of the league but can enhance engagement and insight.

Key Objectives

Owner win/loss records:

Persist each owner’s season performance (wins, losses, draws) in a simple database or file.

Display a season summary page that lists owners’ records and identifies the champion.

Season history tracking:

Store past seasons’ schedules, results and standings to allow users to review previous years. Provide an interface for selecting past seasons and viewing their details.

Upset and odds analysis:

Identify games where the underdog (according to the point spread) won outright and compile a list of upsets for each season.

Compare pre‑game point spreads to final results to analyze how often favorites cover. This analysis should remain simple and optional rather than a predictive model.

Completion criteria

Phase 3 is considered complete when:

The system persists owner win/loss records for a season and displays a season summary.

Past season data (schedules, results and standings) can be browsed via the UI.

Basic upset and odds analysis is implemented, identifying underdog wins and comparing pre‑game spreads to outcomes.

These analytics features are optional; they should not jeopardize reliability and can be toggled off if unnecessary.

Long‑Term Ideas (Not Part of the Active Roadmap)

Although the initial roadmap is intentionally scoped for a single developer, the following ideas may be revisited in the distant future if the league’s needs grow. They are explicitly not in the current roadmap:

Native mobile apps or a comprehensive progressive web app (PWA).

Push notification or email alert systems.

Public APIs or WebSocket infrastructure for third‑party integrations.

Monitoring or uptime infrastructure beyond simple logging.

Accessibility audits beyond basic usability.

Chat systems, social platforms or streaming integrations.

Achievements, badges or other gamification features.

Complex predictive models or betting analytics.

Implementation Backlog (Example Tasks)

This section illustrates how the roadmap translates into concrete development tasks. Each task should be scoped small enough to complete in a single iteration. Examples include:

Remove the schedule CSV ingestion pipeline.

Implement the CFBD schedule ingestion module that fetches and caches the season schedule.

Implement the scores ingestion module for live and final scores.

Implement the Odds API ingestion module for point spreads, totals and moneylines.

Build the canonical identity resolver and the alias editing interface for the commissioner.

Implement a diagnostics panel that surfaces unmatched teams, missing odds or scores and alias conflicts.

Add a simple API caching layer (in‑memory with optional JSON files) and rate‑limit protection in the ingestion modules.

Conclusion

This roadmap reduces unnecessary scope and clearly separates architecture work (Phase 1), user‑facing league features (Phase 2) and optional historical analytics (Phase 3). It places reliability and maintainability at the core, preserves the strengths of deterministic identity resolution and diagnostic transparency, and remains realistic for a single developer using AI assistance. By progressing through these three phases, the CFB Schedule App can deliver a dependable private league dashboard while leaving room for future ideas when capacity allows.
