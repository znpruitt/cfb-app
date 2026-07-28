'use client';

import { useMemo } from 'react';

import { selectLiveDelta, type LiveDelta } from '../../lib/selectors/liveDelta';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';
import type { AppGame } from '../../lib/schedule';
import type { ScorePack } from '../../lib/scores';

export type UseLiveDeltaInput = {
  canonical: CanonicalStandings | null;
  scoresByKey: Record<string, ScorePack>;
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  /** Identifier for the "current unresolved week" context. Typically
   *  `${season}:${selectedWeek ?? 'all'}` or similar. */
  currentWeekKey: string;
  /** ISO timestamp (or any `Date`-parseable string) of the last successful
   *  scores fetch. `null` when scores have not yet been fetched. */
  lastScoresFetchedAt: string | null;
  /**
   * A periodically-updated `Date.now()` sample (PLATFORM-086B2B). `selectLiveDelta`
   * derives `isStale` from `now - lastFetchedAt`, but the memo below recomputes
   * only when its inputs change — so with static scores (e.g. a network outage
   * that leaves `lastScoresFetchedAt` and scores unchanged) `isStale` would never
   * flip. Passing a ticking `now` re-evaluates staleness over time. Omit (or `0`)
   * to fall back to `Date.now()` at memo time (non-reactive).
   */
  nowTick?: number;
};

/**
 * Memoized client-side wiring around `selectLiveDelta`. Returns the live
 * overlay computed from the current scoresByKey snapshot. The result is
 * passed alongside canonical to consumers; canonical owns rows/history,
 * this hook owns the partial-week annotation layer.
 */
export function useLiveDelta(input: UseLiveDeltaInput): LiveDelta {
  return useMemo(
    () =>
      selectLiveDelta({
        canonical: input.canonical,
        scoresByKey: input.scoresByKey,
        games: input.games,
        rosterByTeam: input.rosterByTeam,
        weekKey: input.currentWeekKey,
        lastFetchedAt: input.lastScoresFetchedAt,
        // `undefined` (no tick yet) lets selectLiveDelta fall back to Date.now().
        now: input.nowTick,
      }),
    [
      input.canonical,
      input.scoresByKey,
      input.games,
      input.rosterByTeam,
      input.currentWeekKey,
      input.lastScoresFetchedAt,
      input.nowTick,
    ]
  );
}
