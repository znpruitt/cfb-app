import type { StandingsHistory } from '../standingsHistory';

import type { CanonicalStandings } from './leagueStandings';
import { selectSeasonContext, type SeasonContext } from './seasonContext';

/**
 * PLATFORM-109 — the server→client projection of canonical standings.
 *
 * `StandingsHistoryWeekSnapshot.pending` carries one `{key, week, kickoff}` per
 * unconcluded real game, for every week of the season. It exists for exactly one
 * consumer — `selectSeasonContext`, which applies the eight-hour abandonment
 * allowance at request time (AGENTS.md invariant 3 forbids caching that clock).
 * Nothing else reads it.
 *
 * Serializing it into the RSC payload therefore shipped the whole season's
 * unplayed-game list to the browser so the browser could reduce it to one of
 * three strings. This projection performs that reduction on the server — which
 * is still a request-time consumer, so the clock is read exactly where invariant
 * 3 requires — and drops `pending` from what crosses the boundary.
 *
 * The two values are returned together, and the league pages spread them as one
 * object, so a page cannot ship the stripped history without the context that
 * replaces it.
 *
 * HAZARD: do NOT pass the projected history back into `selectSeasonContext`. Its
 * abandonment test is `unresolved.every(...)`, which is vacuously true for an
 * empty list, so a history with no `pending` anywhere answers `final` regardless
 * of what actually happened. That is the latent trap recorded under item 64 in
 * `docs/next-tasks.md`; this projection is the one place that manufactures such
 * a history, which is why the context is derived HERE, from the unstripped
 * snapshot, and handed onward as a value rather than left to be re-derived.
 */
export type CanonicalStandingsClientProps = {
  canonicalStandings: CanonicalStandings | undefined;
  seasonContext: SeasonContext;
};

/**
 * The same history with `pending` removed from every week snapshot. `pending` is
 * optional on the snapshot type (durable archives predate it), so its absence is
 * already a representable state rather than a new shape.
 */
function withoutPendingGames(history: StandingsHistory | null): StandingsHistory | null {
  if (!history) return null;
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const [week, snapshot] of Object.entries(history.byWeek)) {
    // Copy first, then drop the field — the caller's snapshot is a cached value
    // other (server-side) consumers still read, so it must not be mutated.
    const projected = { ...snapshot };
    delete projected.pending;
    byWeek[Number(week)] = projected;
  }
  return { ...history, byWeek };
}

/**
 * Derive the client-facing canonical standings props.
 *
 * `now` defaults to call time. Pass it explicitly from tests, or from any caller
 * replaying a fixed moment.
 */
export function canonicalStandingsClientProps(
  canonicalStandings: CanonicalStandings | null | undefined,
  now?: Date
): CanonicalStandingsClientProps {
  if (!canonicalStandings) {
    // `selectSeasonContext` answers `in-season` for an absent history; deriving
    // it through the selector keeps that answer in one place.
    return {
      canonicalStandings: undefined,
      seasonContext: selectSeasonContext({ standingsHistory: null, now }),
    };
  }

  const seasonContext = selectSeasonContext({
    standingsHistory: canonicalStandings.standingsHistory,
    now,
  });

  return {
    canonicalStandings: {
      ...canonicalStandings,
      standingsHistory: withoutPendingGames(canonicalStandings.standingsHistory),
    },
    seasonContext,
  };
}
