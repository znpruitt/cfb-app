/**
 * PLATFORM-086C3 — the kickoff-window refresh policy (`getRefreshPlan`) that gated
 * Odds display and score auto-refresh on a `[-12h, +3d]` game window was RETIRED.
 *
 * Cached Odds now hydrate once per season independent of game time
 * (`src/components/hooks/useOddsHydration.ts`) — a stored line for a far-future or
 * completed game is displayed regardless of kickoff distance — and live-score
 * polling eligibility lives in `src/lib/liveScores/browserPolling.ts`. The old
 * `scores` sub-plan was already superseded by that browser-polling module; only the
 * manual-refresh cooldown below still has a live consumer (`useLiveRefresh`).
 */

export const LIVE_MANUAL_COOLDOWN_MS = 30 * 1000;
