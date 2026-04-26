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
      }),
    [
      input.canonical,
      input.scoresByKey,
      input.games,
      input.rosterByTeam,
      input.currentWeekKey,
      input.lastScoresFetchedAt,
    ]
  );
}
