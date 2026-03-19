Development Plan for the CFB Schedule App
Purpose and Scope

The CFB Schedule App is a **league-first dashboard** for a college-football-based office pool. It combines canonical college football schedule data from CFBD with live scores, betting context from The Odds API, and internal league ownership data to create a single place for members to understand the league. The schedule remains the canonical source of truth for game identity, kickoff context, and final outcomes, but the primary user value is league understanding: current standings, weekly matchups, overview/home context, and the league story as the season moves into postseason play.

The development plan below focuses on the major surfaces and implementation priorities that support that league-first experience while preserving the project’s architecture, deterministic identity matching, and diagnostic transparency.

Major Features
1. Data Acquisition & Identity Resolution

Canonical schedule ingestion: Use the CFBD schedule API as the sole source of truth for game dates, opponents, week numbers, and final game outcomes. A local cache can reduce API calls, but schedule-derived games remain the canonical base record.

Canonical identity resolver: Maintain a normalization layer that maps team names from CFBD, The Odds API, and league ownership inputs to a single canonical identity. This prevents mismatches such as “App State” vs “Appalachian State” and remains critical to joining scores, odds, and ownership cleanly.

Live score and odds attachment: After resolving identities, attach live scores from CFBD and betting lines from The Odds API to schedule-derived games. Odds provide league context and scanability, but they do not replace schedule truth.

League ownership mapping: Maintain a mapping of teams to league owners so the app can derive weekly owner matchups, standings inputs, and league-level context. Ownership should remain editable through commissioner tooling.

Deterministic game matching: Use canonical home team, canonical away team, and schedule-derived identity to join scores and odds. When data fails to match, surface diagnostics and support manual correction rather than silently guessing.

2. Live League Dashboard

League overview / home: Provide a lightweight league-first landing surface that summarizes the current standings picture, key live or upcoming league-relevant games, and the most important weekly matchup context.

Weekly Matchups view: Offer a dedicated view that shows owner-vs-owner matchups with score, odds, and outcome context. This should remain a core league surface, but as part of a broader experience rather than the entire product identity.

Owner standings and performance context: Display season-long standings driven by league rules, along with concise owner performance context such as record and point differential. Standings should be easy to understand and trustworthy.

Postseason league context: Ensure the app continues to tell the league story cleanly once the regular season ends, with postseason-aware matchup and standings presentation where appropriate.

Diagnostic tools: Continue surfacing unresolved identity conflicts, unmatched scores or odds, and reconciliation issues directly in the UI so the commissioner can fix problems quickly.

3. Enhanced Team & Game Information

Team and game context: Continue improving team/game presentation where it directly supports league consumption, such as records, rankings, kickoff details, and betting context.

Odds & predictions: Show point spreads, totals, and moneylines alongside relevant league matchups. Predictive or model-driven features can remain later enhancements.

History and analytics: Build historical league context gradually after core league surfaces are in place. Analytics should support league understanding, not distract from delivering dependable current-season views first.

4. Notification & Engagement Features

Feedback and issue reporting: Provide a simple reporting path so league members can flag data issues or UX confusion.

Personalization settings: Preserve useful preferences such as selected week, filters, or theme choices when they meaningfully improve day-to-day use.

Accessibility and usability: Ensure the interface is readable, responsive, keyboard-friendly, and practical across devices.

5. Commissioner Tools

Ownership & league management: Preserve commissioner controls for managing team-owner mappings and season transitions.

Alias and identity management: Allow manual alias overrides and expose unresolved matches through diagnostics.

Season configuration: Keep season-level settings conservative and focused on league needs, such as standings presentation inputs or display preferences, without introducing unnecessary admin complexity.

User Interface Improvements

The app should continue evolving from a schedule-and-data overlay into a league-first control center with a clear hierarchy of surfaces:

League-first navigation: Prioritize Overview / Home, Matchups, Standings, and Schedule as the main way users move through the app.

Responsive design: Ensure those core league surfaces remain readable and useful on desktop, tablet, and mobile.

Navigation and filtering: Maintain week selection and league-relevant filtering without overwhelming the primary league views.

Feedback and issue reporting: Keep a lightweight “Report Issue” or “Submit Feedback” entry point available from the primary experience.

Stateful interaction: Save practical user preferences such as selected week or theme.

Future Features & Innovation

Later enhancements can include deeper historical analytics, matchup predictions, upset tracking, season archives, and broader engagement ideas, but these should remain secondary to dependable league-first surfaces.

Phased Development Roadmap

Phase 1 – Architecture Stabilization (Complete)

Finalize API integrations (CFBD schedule, scores, Odds API).

Build the canonical identity resolver with alias management.

Implement deterministic matching and surface mismatches.

Create commissioner tooling for ownership and alias management.

Phase 2 – Core League Surfaces (Current)

Establish standings as a first-class league surface using clear, documented rules.

Build shared owner metrics / derived league utilities that support standings, overview, and matchup context, including agreed self-matchup handling.

Create the league overview / home foundation and strengthen weekly Matchups as a core league view.

Extend league usability into postseason scenarios before broad presentation polish.

Phase 3 – Responsive Polish & Broader Usability

Refine responsive behavior across Overview, Matchups, Standings, and Schedule.

Add lightweight feedback/reporting entry points and additional usability improvements.

Phase 4 – Advanced Analytics & Historical Context

Add optional historical league analytics, season archives, and richer performance context.

Explore more advanced predictive or presentation-oriented enhancements only after the core league experience is stable.

Conclusion

By keeping the schedule as canonical truth while building the product around league understanding, the CFB Schedule App can become the league’s control center rather than just a schedule viewer with overlays. The near-term path should prioritize dependable standings, strong weekly matchups, a useful league overview, and clean postseason continuity, with responsive polish and advanced analytics layered in only after those core league surfaces are established.
