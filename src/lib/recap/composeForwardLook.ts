import type { LeagueStatus } from '../league.ts';
import {
  selectForwardLookInputs,
  selectForwardStandings,
  selectForwardUpsets,
  type ForwardLook,
  type PreparedForwardLook,
  type ForwardLookLine,
} from '../selectors/forwardLook.ts';
import {
  prepareForwardLookHistory,
  type ForwardLookHistory,
  selectForwardRivalries,
} from '../selectors/forwardLookRivalries.ts';
import { isWeeklyRecapActiveSeason } from '../selectors/weeklyRecapFacts.ts';
import { formatWeekLabel } from '../weekLabel.ts';
import type { ScorePack } from '../scores.ts';
import type { OwnerStandingsRow } from '../standings.ts';
import type { WeeklyRecapContextResult } from './loadRecapContext.ts';

function familyLines(select: () => ForwardLookLine[]): ForwardLookLine[] {
  try {
    return select();
  } catch {
    return [];
  }
}

export function prepareForwardLookPayload(
  result: WeeklyRecapContextResult,
  scope: { seasonYear: number; leagueStatus: LeagueStatus | undefined }
): ForwardLookHistory | null {
  if (
    !isWeeklyRecapActiveSeason(scope) ||
    result.status !== 'available' ||
    result.context.seasonYear !== scope.seasonYear
  )
    return null;
  return prepareForwardLookHistory(result.context);
}

export function composeForwardLook(
  context: PreparedForwardLook,
  scoresByKey: Record<string, ScorePack>,
  standings: OwnerStandingsRow[],
  now: Date,
  scope: { seasonYear: number; leagueStatus: LeagueStatus | undefined }
): ForwardLook | null {
  if (!isWeeklyRecapActiveSeason(scope) || context.seasonYear !== scope.seasonYear) return null;
  const inputs = selectForwardLookInputs(context, scoresByKey, standings, now);
  if (!inputs) return null;
  const labels = context.labels;
  return {
    seasonYear: scope.seasonYear,
    recapTarget: inputs.recapTarget,
    target: inputs.target,
    weekLabel: labels.has(inputs.target.week)
      ? formatWeekLabel(inputs.target.week, labels)
      : `Week ${inputs.target.week}`,
    lines: [
      ...familyLines(() => selectForwardStandings(inputs)),
      ...familyLines(() => selectForwardRivalries(inputs)),
      ...familyLines(() => selectForwardUpsets(inputs)),
    ],
  };
}
