import type { LeagueStatus } from '../league.ts';
import {
  isWeeklyRecapActiveSeason,
  selectWeeklyRecapFacts,
} from '../selectors/weeklyRecapFacts.ts';
import { standingsCoverageNotice } from '../standings.ts';
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
      ownerLines: WeeklyRecapOwnerLine[];
      unresolvedMessage: string | null;
      abandonedMessage: string | null;
      missingResultMessage: string | null;
    };

export type WeeklyRecapSeasonScope = {
  leagueStatus: LeagueStatus | undefined;
  seasonYear: number;
};

function countMessage(count: number, singular: string, plural: string): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function incompleteResultsMessage(count: number): string | null {
  if (count === 0) return null;
  const claim = standingsCoverageNotice({ state: 'partial', message: null });
  if (!claim) return null;
  const sentenceClaim = `${claim.charAt(0).toLowerCase()}${claim.slice(1)}`;
  return `${count} ${count === 1 ? 'game' : 'games'} — ${sentenceClaim}.`;
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
    ownerLines: facts.ownerResults.map((result) => ({
      owner: result.owner,
      recordLabel: `${result.wins}–${result.losses}`,
      pointsLabel: `${result.pointsFor} PF · ${result.pointsAgainst} PA`,
    })),
    unresolvedMessage: countMessage(
      facts.unresolvedCount,
      'game remains unresolved.',
      'games remain unresolved.'
    ),
    abandonedMessage: countMessage(
      facts.abandonedCount,
      'game has no recorded result.',
      'games have no recorded result.'
    ),
    missingResultMessage: incompleteResultsMessage(facts.missingResultCount),
  };
}
