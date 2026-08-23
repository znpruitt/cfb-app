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
 * The shape follows the convention already on the Overview page ("No recent
 * results yet—completed games will appear here."): name what is missing, then
 * say what will appear once it arrives. It states the CAUSE a member can
 * understand — completed games — rather than the internal vocabulary ("trend
 * data") that told them nothing.
 */
export const TREND_EMPTY_MESSAGE = 'No completed games yet—trends will appear here.';
