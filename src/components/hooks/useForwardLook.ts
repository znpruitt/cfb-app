'use client';

import { useMemo } from 'react';
import type { LeagueStatus } from '../../lib/league.ts';
import { composeForwardLook } from '../../lib/recap/composeForwardLook.ts';
import {
  prepareForwardLook,
  selectForwardLookTargets,
  isForwardLookVisible,
  mergeForwardLookLines,
  type ForwardLookContext,
} from '../../lib/selectors/forwardLook.ts';
import { isWeeklyRecapActiveSeason } from '../../lib/selectors/weeklyRecapFacts.ts';

type Args = Pick<
  ForwardLookContext,
  | 'games'
  | 'rosterByTeam'
  | 'seasonYear'
  | 'scoresByKey'
  | 'canonicalRows'
  | 'oddsByKey'
  | 'history'
> & {
  leagueStatus: LeagueStatus | undefined;
  scheduleLoaded: boolean;
  scoresReady: boolean;
  enabled: boolean;
  nowTick: number;
};

export function useForwardLook(args: Args) {
  const {
    games,
    rosterByTeam,
    seasonYear,
    scheduleLoaded,
    scoresReady,
    enabled,
    leagueStatus,
    nowTick,
    history,
    canonicalRows,
    scoresByKey,
    oddsByKey,
  } = args;
  const prepared = useMemo(() => {
    if (!scheduleLoaded) return null;
    try {
      return prepareForwardLook(games, rosterByTeam, seasonYear);
    } catch {
      return null;
    }
  }, [games, rosterByTeam, seasonYear, scheduleLoaded]);

  return useMemo(() => {
    if (
      !prepared ||
      !enabled ||
      !scoresReady ||
      nowTick === 0 ||
      !isWeeklyRecapActiveSeason({ seasonYear, leagueStatus })
    )
      return null;
    try {
      const now = new Date(nowTick);
      const targets = selectForwardLookTargets(prepared, now);
      if (!targets || !isForwardLookVisible(targets, now)) return null;
      const look = composeForwardLook(
        {
          ...prepared,
          history: history?.seasonYear === seasonYear ? history : null,
          canonicalRows,
          scoresByKey,
          oddsByKey,
        },
        now,
        { seasonYear, leagueStatus },
        targets
      );
      return look ? { ...look, lines: mergeForwardLookLines([look.lines]) } : null;
    } catch {
      return null;
    }
  }, [
    prepared,
    enabled,
    scoresReady,
    nowTick,
    seasonYear,
    leagueStatus,
    history,
    canonicalRows,
    scoresByKey,
    oddsByKey,
  ]);
}
