import type { LeagueStatus } from '../league.ts';
import {
  selectForwardLookInputs,
  selectForwardStandings,
  selectForwardUpsets,
  type ForwardLook,
  type ForwardLookLine,
} from '../selectors/forwardLook.ts';
import { selectForwardRivalries } from '../selectors/forwardLookRivalries.ts';
import { isWeeklyRecapActiveSeason } from '../selectors/weeklyRecapFacts.ts';
import { buildWeekLabelMap, formatWeekLabel } from '../weekLabel.ts';
import type { WeeklyRecapContextResult } from './loadRecapContext.ts';

function familyLines(select: () => ForwardLookLine[]): ForwardLookLine[] {
  try {
    return select();
  } catch {
    return [];
  }
}

export function composeForwardLook(
  result: WeeklyRecapContextResult,
  now: Date,
  scope: { seasonYear: number; leagueStatus: LeagueStatus | undefined }
): ForwardLook | null {
  if (
    !isWeeklyRecapActiveSeason(scope) ||
    result.status !== 'available' ||
    result.context.seasonYear !== scope.seasonYear
  )
    return null;
  const inputs = selectForwardLookInputs(result.context, now);
  if (!inputs) return null;
  const labels = buildWeekLabelMap(result.context.games);
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
