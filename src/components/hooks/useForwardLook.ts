'use client';

import { useMemo } from 'react';
import { composeForwardLook } from '../../lib/recap/composeForwardLook.ts';
import {
  prepareForwardLook,
  selectVisibleForwardLook,
  selectForwardLookTargets,
  isForwardLookVisible,
} from '../../lib/selectors/forwardLook.ts';
import type { AppGame } from '../../lib/schedule.ts';
import type { ScorePack } from '../../lib/scores.ts';
import type { CombinedOdds } from '../../lib/odds.ts';
import type { OwnerStandingsRow } from '../../lib/standings.ts';
import type { LeagueStatus } from '../../lib/league.ts';
import type { ForwardLookHistory } from '../../lib/selectors/forwardLookRivalries.ts';

export function useForwardLook(args: {
  history: ForwardLookHistory | null;
  games: AppGame[];
  rosterByTeam: Map<string, string>;
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  standings: OwnerStandingsRow[];
  seasonYear: number;
  leagueStatus: LeagueStatus | undefined;
  nowTick: number;
  scheduleLoaded: boolean;
  scoresHydrated: boolean;
}) {
  const {
    history,
    games,
    rosterByTeam,
    oddsByKey,
    scoresByKey,
    standings,
    seasonYear,
    leagueStatus,
    nowTick,
    scheduleLoaded,
    scoresHydrated,
  } = args;
  const prepared = useMemo(() => {
    if (!scheduleLoaded || history?.seasonYear !== seasonYear) return null;
    return prepareForwardLook({
      games,
      rosterByTeam,
      history,
    });
  }, [scheduleLoaded, history, seasonYear, games, rosterByTeam]);
  return useMemo(() => {
    if (!prepared || !scoresHydrated || nowTick === 0) return null;
    const now = new Date(nowTick);
    const targets = selectForwardLookTargets(prepared, now);
    if (!targets || !isForwardLookVisible(targets, now)) return null;
    return selectVisibleForwardLook(
      composeForwardLook(prepared, scoresByKey, standings, oddsByKey, now, {
        seasonYear,
        leagueStatus,
      }),
      now
    );
  }, [
    prepared,
    scoresHydrated,
    nowTick,
    scoresByKey,
    standings,
    oddsByKey,
    seasonYear,
    leagueStatus,
  ]);
}
