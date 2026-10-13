import type { LeagueStatus } from '../league.ts';
import {
  selectForwardLookInputs,
  selectForwardStandings,
  selectForwardUpsets,
  type ForwardLook,
  type ForwardLookLine,
  type ForwardLookContext,
  selectForwardLookTargets,
} from '../selectors/forwardLook.ts';
import { selectForwardRivalries } from '../selectors/forwardLookRivalries.ts';
import { isWeeklyRecapActiveSeason } from '../selectors/weeklyRecapFacts.ts';
import { formatWeekLabel } from '../weekLabel.ts';

function familyLines(select: () => ForwardLookLine[]): ForwardLookLine[] {
  try {
    return select();
  } catch {
    return [];
  }
}

export function composeForwardLook(
  context: ForwardLookContext,
  now: Date,
  scope: { seasonYear: number; leagueStatus: LeagueStatus | undefined },
  targets = selectForwardLookTargets(context, now)
): ForwardLook | null {
  if (!isWeeklyRecapActiveSeason(scope) || context.seasonYear !== scope.seasonYear) return null;
  const inputs = selectForwardLookInputs(context, now, targets);
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
