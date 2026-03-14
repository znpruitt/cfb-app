Remove Legacy CSV Ingestion
Objective: Eliminate the outdated CSV schedule loader so the app relies exclusively on API‑driven schedules.
Key Implementation Steps:

Identify and remove CSV parsing code and related imports (e.g., in src/lib/legacySchedule.ts).

Remove CSV paths from configuration and environment variables.

Ensure CFBScheduleApp.tsx no longer references CSV functions.
Expected Result: The application no longer loads or references the legacy CSV; it expects schedule data from the new API route.

Create CFBD Schedule API Route
Objective: Build a Next.js API route that fetches schedule data from CFBD for use in constructing the game model.
Key Implementation Steps:

Add src/app/api/schedule/route.ts with a GET handler that fetches the CFBD schedule via fetch.

Parse the response and return a normalized structure (e.g., an array of raw game objects) to the client.

Include basic error handling and environment‑driven API keys.
Expected Result: A working /api/schedule route supplies raw CFBD schedule data for downstream processing.

Define the Schedule‑Derived Game Model
Objective: Create an authoritative game representation that other data will attach to.
Key Implementation Steps:

In src/lib/models.ts, define a Game interface containing canonical homeTeamId, awayTeamId, week, startTime, venue and status fields; leave score and odds optional for later attachments.

Provide a factory function in src/lib/gameModel.ts that accepts raw schedule entries and returns Game objects (team names remain unresolved at this stage).
Expected Result: A clear, extensible game model is available for identity resolution and data attachment.

Build Canonical Team Identity Resolver
Objective: Implement a shared normalization layer without changing existing owner/alias persistence.
Key Implementation Steps:

Create src/lib/identity.ts to read the current alias and owner mappings (using whatever storage mechanism exists today).

Implement resolveTeamName to map any team name to a canonical ID using these mappings.

Expose helper functions to look up team owners and refresh alias data from storage.
Expected Result: The app can consistently resolve team names to canonical IDs without migrating the underlying alias/owner storage.

Integrate Identity into Schedule Ingestion
Objective: Produce canonicalized game objects when ingesting the schedule.
Key Implementation Steps:

Modify the schedule factory in src/lib/gameModel.ts to call resolveTeamName for the home and away team fields.

Populate homeTeamId and awayTeamId in Game objects using canonical IDs.

Update /api/schedule to use this canonicalizing factory so clients receive schedule‑derived games ready for score/odds attachments.
Expected Result: The schedule API now returns canonical game objects representing the authoritative list of games.

Implement Scores Ingestion Route
Objective: Attach CFBD score data to the schedule‑derived game model using the canonical matching layer.
Key Implementation Steps:

Add src/app/api/scores/route.ts with a GET handler calling the CFBD scores endpoint.

Normalize each score’s team names via resolveTeamName.

Match scores to Game objects based on canonical homeTeamId, awayTeamId and start time/week (using a shared matching function rather than in‑memory UI state).

Return a data structure keyed by game ID or add the scores to an exported games collection.
Expected Result: The app exposes /api/scores that reliably attaches score/status updates to canonical games without assuming a global in‑memory schedule.

Implement Odds Ingestion Route
Objective: Attach betting lines to canonical games via a Next.js API route.
Key Implementation Steps:

Create src/app/api/odds/route.ts that fetches the relevant Odds API endpoint.

Use resolveTeamName to canonicalize team identifiers.

Match each odds record to the corresponding Game object using canonical IDs and the week.

Return odds keyed by game ID or update a shared games data structure.
Expected Result: /api/odds provides betting context mapped to the schedule‑derived games.

Add Lightweight Caching to Ingestion Modules
Objective: Reduce repeated external calls by caching schedule, score and odds responses.
Key Implementation Steps:

Implement a simple cache in src/lib/cache.ts (e.g., an object or Map) with get/set functions and TTL support.

Optionally persist cache data to JSON files in a cache/ directory (only if low risk).

Integrate cache checks into /api/schedule, /api/scores and /api/odds so data is served from cache when fresh; otherwise fetch and update cache.
Expected Result: The API routes use cached data where appropriate, reducing API calls and improving response times.

Add Rate‑Limit Protection and Retry Logic
Objective: Ensure external API calls respect provider limits and handle transient failures gracefully.
Key Implementation Steps:

Create or update src/lib/apiClient.ts to wrap fetch with a throttle that enforces a minimum interval between requests.

Implement simple retry logic with exponential backoff for HTTP 429 or network errors.

Use this wrapper in the schedule, scores and odds API routes.
Expected Result: The ingestion modules respect API rate limits and recover from temporary failures without crashing.

Adapt Diagnostics and Alias Editing Workflow
Objective: Update existing admin tools to operate on canonical games and identity without changing storage.
Key Implementation Steps:

Modify diagnostics logic in CFBScheduleApp.tsx or admin components to detect unmatched games, missing odds/scores and alias conflicts using canonical IDs.

Update the alias editing UI (e.g., src/components/AliasEditor.tsx) to call functions in identity.ts for reading and updating alias mappings, preserving the existing human‑in‑the‑loop flow.

Ensure diagnostics entries link to the alias editor where appropriate, enabling repairs without direct JSON edits.

Conduct a final cleanup: remove outdated imports, verify the orchestrator in CFBScheduleApp.tsx invokes the new API routes, and update comments/documentation.
Expected Result: Admin users can view and resolve data mismatches through the existing interface, and the application runs end‑to‑end with canonicalized games, scores, odds, caching and rate‑limit protection.
