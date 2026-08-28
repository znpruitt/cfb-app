import { selectWeeklyRecapFacts } from '../selectors/weeklyRecapFacts.ts';
import { buildWeekLabelMap, formatWeekLabel } from '../weekLabel.ts';
import type { WeeklyRecapContextResult } from './loadRecapContext.ts';

export type WeeklyRecapOwnerLine = {
  owner: string;
  recordLabel: string;
  pointsLabel: string;
};

export type WeeklyRecapViewModel =
  | { status: 'absent' }
  | { status: 'unavailable' }
  | {
      status: 'available';
      week: number;
      weekLabel: string;
      ownerLines: WeeklyRecapOwnerLine[];
      unresolvedMessage: string | null;
      abandonedMessage: string | null;
    };

function countMessage(count: number, singular: string, plural: string): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function composeWeeklyRecap(
  contextResult: WeeklyRecapContextResult,
  now: Date
): WeeklyRecapViewModel {
  if (contextResult.status === 'unavailable') return { status: 'unavailable' };
  if (contextResult.status === 'absent') return { status: 'absent' };

  const facts = selectWeeklyRecapFacts({
    games: contextResult.context.games,
    rosterByTeam: contextResult.context.rosterByTeam,
    scoresByKey: contextResult.context.scoresByKey,
    now,
  });
  if (!facts) return { status: 'absent' };

  const compactWeekLabel = formatWeekLabel(
    facts.targetWeek.week,
    buildWeekLabelMap(contextResult.context.games)
  );
  const weekLabel = compactWeekLabel.startsWith('W')
    ? `Week ${facts.targetWeek.week}`
    : `${compactWeekLabel} · Week ${facts.targetWeek.week}`;

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
  };
}
