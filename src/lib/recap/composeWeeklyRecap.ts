import type { LeagueStatus } from '../league.ts';
import {
  isWeeklyRecapActiveSeason,
  selectWeeklyRecapLeaders,
  selectWeeklyRecapFacts,
  selectWeeklyRecapTileState,
} from '../selectors/weeklyRecapFacts.ts';
import { buildWeekLabelMap, formatWeekLabel } from '../weekLabel.ts';
import type { WeeklyRecapContextResult } from './loadRecapContext.ts';

export type WeeklyRecapOwnerLine = {
  owner: string;
  recordLabel: string;
  pointsLabel: string;
};

export type WeeklyRecapViewModel =
  | { status: 'inactive' }
  | { status: 'absent' }
  | { status: 'unavailable' }
  | {
      status: 'available';
      week: number;
      weekLabel: string;
      latestGameDate: string;
      headline: string | null;
      ownerLines: WeeklyRecapOwnerLine[];
    };

export type AvailableWeeklyRecapViewModel = Extract<WeeklyRecapViewModel, { status: 'available' }>;

export type WeeklyRecapTileViewModel =
  | { state: 'hidden' }
  | { state: 'upcoming' }
  | { state: 'recap'; recap: AvailableWeeklyRecapViewModel };

export type WeeklyRecapSeasonScope = {
  leagueStatus: LeagueStatus | undefined;
  seasonYear: number;
};

const SMALL_COUNT_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
] as const;

function weeklyHeadline(facts: ReturnType<typeof selectWeeklyRecapFacts>): string | null {
  if (!facts) return null;
  if (facts.unresolvedCount > 0 || facts.abandonedCount > 0 || facts.missingResultCount > 0) {
    return null;
  }

  const leaders = selectWeeklyRecapLeaders(facts.ownerResults);
  const first = leaders[0];
  if (!first) return null;
  const record = `${first.wins}–${first.losses}`;
  if (leaders.length === 1) return `${first.owner} takes the week at ${record}`;
  if (leaders.length === 2) {
    return `${leaders[0].owner} and ${leaders[1].owner} share the week at ${record}`;
  }

  const count = SMALL_COUNT_WORDS[leaders.length] ?? String(leaders.length);
  return `${count} owners share the week at ${record}`;
}

export function composeWeeklyRecap(
  contextResult: WeeklyRecapContextResult,
  now: Date,
  scope: WeeklyRecapSeasonScope
): WeeklyRecapViewModel {
  if (!isWeeklyRecapActiveSeason(scope)) return { status: 'inactive' };
  if (contextResult.status === 'unavailable') return { status: 'unavailable' };
  if (contextResult.status === 'absent') return { status: 'absent' };
  if (contextResult.context.seasonYear !== scope.seasonYear) return { status: 'unavailable' };

  const facts = selectWeeklyRecapFacts({
    games: contextResult.context.games,
    rosterByTeam: contextResult.context.rosterByTeam,
    scoresByKey: contextResult.context.scoresByKey,
    now,
  });
  if (!facts) return { status: 'absent' };

  const weekLabelMap = buildWeekLabelMap(contextResult.context.games);
  const compactWeekLabel = formatWeekLabel(facts.targetWeek.week, weekLabelMap);
  const weekLabel = weekLabelMap.has(facts.targetWeek.week)
    ? compactWeekLabel
    : `Week ${facts.targetWeek.week}`;

  return {
    status: 'available',
    week: facts.targetWeek.week,
    weekLabel,
    latestGameDate: facts.targetWeek.latestGameDate,
    headline: weeklyHeadline(facts),
    ownerLines: facts.ownerResults.map((result) => ({
      owner: result.owner,
      recordLabel: `${result.wins}–${result.losses}`,
      pointsLabel: `${result.pointsFor} PF · ${result.pointsAgainst} PA`,
    })),
  };
}

export function composeWeeklyRecapTile(
  contextResult: WeeklyRecapContextResult,
  now: Date,
  scope: WeeklyRecapSeasonScope
): WeeklyRecapTileViewModel {
  const recap = composeWeeklyRecap(contextResult, now, scope);
  if (recap.status !== 'available') return { state: 'hidden' };

  const state = selectWeeklyRecapTileState(
    { week: recap.week, latestGameDate: recap.latestGameDate },
    now
  );
  return state === 'recap' ? { state, recap } : { state };
}
