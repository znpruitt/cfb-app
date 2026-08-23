/**
 * POLISH-013 — the one sentence a trend surface shows when it has nothing to
 * draw.
 *
 * Three wordings existed for this single idea: `No trend data available.` on the
 * season arc, `No trend data available yet.` on the trends detail surface, and
 * nothing at all on Overview's GB Race, which rendered its heading over an empty
 * body. They are one fact — no week has resolved yet, so there is no series —
 * and they now read the same.
 *
 * It names what the chart actually needs — resolved WEEKS — and promises
 * nothing. An earlier version read "No completed games yet—trends will appear
 * here." and was wrong twice, both reachable: a Saturday in week one can have
 * one game final and another in progress, so a completed result sits on screen
 * directly above a sentence denying any exist; and on an archived season whose
 * coverage never resolved a week, "will appear here" promises data that can
 * never arrive. Owner decision, 2026-08-23, after the confirming review
 * escalated it.
 */
export const TREND_EMPTY_MESSAGE = 'Not enough weekly results to show a trend.';
